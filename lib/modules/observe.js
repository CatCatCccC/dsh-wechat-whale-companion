/**
 * Turn / outbound pipeline: speak + session/event observation for bound WeChat sessions.
 */
import { cleanOutbound } from './guard.js'
import {
  createToolForceState,
  markStickerSent,
  moodToStickerTag,
  needsStickerFallback,
  onOwnerTurnForSticker,
} from '../core/tool-force.js'
import { looksLikeAlarm } from '../core/parse-due.js'
import { STORE, loadStore } from '../core/stores.js'

/** Event timestamps may be seconds (iLink) or milliseconds (DSH). */
export function toEpochMs(value, fallback = Date.now()) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return n < 1e12 ? n * 1000 : n
}

/** Pull plain text out of a DSH `user/message` or `assistant/message` event. */
export function textFromSessionEvent(event) {
  const data = event?.data
  const content =
    data?.message?.content ??
    data?.content ??
    data?.message?.text ??
    data?.text ??
    event?.message?.content ??
    event?.content ??
    event?.message?.text ??
    event?.text
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
  }
  return ''
}

export function fingerprintMatch(runtime, text) {
  const fp = runtime._spokeFingerprint
  if (!fp?.text) return false
  if (Date.now() - (fp.at || 0) > 8000) return false
  return String(fp.text).trim() === String(text || '').trim()
}

/** Claim outbound immediately so concurrent assistant/message can't double-send. */
export function claimSpeakFingerprint(runtime, text) {
  runtime._spokeFingerprint = {
    text: String(text || '').trim(),
    at: Date.now(),
  }
}

/**
 * Guard + paced send. Used for proactive / promise / optional deliverAssistant.
 * @param {object} runtime
 * @param {{ isDisposed?: () => boolean }} [ctl]
 */
export function createSpeak(runtime, ctl = {}) {
  return async function speak(text, opts = {}) {
    if (ctl.isDisposed?.()) return { sent: 0, skipped: 'disposed' }
    const { skipObserve, ...sendOpts } = opts
    const filtered = runtime.guard?.filterSend?.(text) ?? cleanOutbound(text)
    if (filtered.drop) {
      if (!runtime.guard) {
        runtime.stats.guardDropped = (runtime.stats.guardDropped || 0) + 1
        runtime.stats.lastGuardReason = filtered.reason
      }
      return { sent: 0, silent: true, reason: filtered.reason }
    }
    let result
    if (runtime.rhythm?.sendPaced) {
      result = await runtime.rhythm.sendPaced(filtered.text, sendOpts)
    } else if (runtime.wechat?.sendText) {
      await runtime.wechat.sendText(filtered.text, sendOpts)
      result = { sent: 1 }
    } else {
      return { sent: 0, skipped: 'no-channel' }
    }
    if ((result?.sent || 0) > 0 && !skipObserve) {
      runtime._spokeFingerprint = { text: filtered.text, at: Date.now() }
      runtime.persona?.onReply?.(filtered.text)
    }
    return result
  }
}

/**
 * @param {any} ctx
 * @param {object} runtime
 * @param {(text: string, opts?: object) => Promise<object>} speak
 * @returns {() => void}
 */
export function attachSessionObserver(ctx, runtime, speak) {
  if (typeof ctx.on !== 'function') return () => {}

  const store = runtime.store
  const outbound = runtime.config.modules.outbound
  const forceMod = runtime.config.modules.toolForce || {}
  const forceOn = forceMod.enabled !== false

  let forceState = createToolForceState(
    loadStore(store, STORE.TOOL_FORCE, createToolForceState()).data,
  )
  const persistForce = () =>
    store.setDebounced(STORE.TOOL_FORCE, { ...forceState, version: 1 })

  runtime.toolForce = {
    pendingSticker: () => Boolean(forceState.pendingSticker),
    markSent: () => {
      forceState = markStickerSent(forceState)
      persistForce()
    },
    snapshot: () => ({ ...forceState }),
  }

  /** Last owner text this turn (for alarm fallback after assistant reply). */
  let lastOwnerForForce = ''
  let promiseCountAtOwner = 0

  const openPromiseCount = () =>
    (loadStore(store, STORE.PROMISES, { items: [] }).data.items || []).filter(
      (i) => !i.done,
    ).length

  const onSessionEvent = (session, event) => {
    const sessionId =
      session?.id ?? session?.sessionId ?? event?.sessionId ?? event?.session?.id
    if (!sessionId || !runtime.wechatSessions?.has?.(sessionId)) return
    const text = textFromSessionEvent(event)
    if (!text) return

    if (event?.type === 'user/message') {
      const sourceKind = event?.data?.source?.kind
      if (sourceKind && sourceKind !== 'user') return
      if (runtime.handleWhaleResetText?.(text)) {
        runtime.stats.wechatUserMessages = (runtime.stats.wechatUserMessages || 0) + 1
        return
      }
      runtime.persona?.onOwnerMessage?.(text)
      lastOwnerForForce = text
      try {
        if (forceOn) {
          forceState = onOwnerTurnForSticker(forceState, text, {
            everyN: Number(forceMod.stickerEveryN) || 4,
          })
          persistForce()
        }
        promiseCountAtOwner = runtime.promise?.due ? openPromiseCount() : 0
        runtime.memory?.noteOwnerTurn?.(text)
        runtime.memory?.autoCaptureOwner?.(text)
      } catch {
        /* ignore */
      }
      runtime.circadian?.touch?.(
        toEpochMs(event?.time ?? event?.at ?? event?.timestamp),
      )
      runtime.stats.wechatUserMessages = (runtime.stats.wechatUserMessages || 0) + 1
      return
    }

    if (event?.type !== 'assistant/message') return

    if (fingerprintMatch(runtime, text)) {
      runtime.stats.observeDeduped = (runtime.stats.observeDeduped || 0) + 1
      return
    }

    const runStickerAndAlarmFallback = () => {
      if (forceOn && needsStickerFallback(forceState)) {
        const tag = moodToStickerTag(runtime.persona?.snapshot?.()?.mood)
        const bound = runtime.wechatSessions?.list?.()?.[0]
        Promise.resolve(
          runtime.media?.sendMoodSticker?.({
            tag,
            agentId: bound?.sessionId,
          }),
        )
          .then((r) => {
            if (r?.ok) {
              forceState = markStickerSent(forceState)
              persistForce()
              runtime.stats.stickerFallback = (runtime.stats.stickerFallback || 0) + 1
            } else {
              runtime.log?.warn?.('[whale-companion] sticker fallback failed', r?.error)
            }
          })
          .catch((err) => {
            runtime.log?.warn?.(
              '[whale-companion] sticker fallback error',
              err?.message || err,
            )
          })
      }

      if (looksLikeAlarm(lastOwnerForForce) && runtime.promise?.maybeAutoFromOwner) {
        const openNow = openPromiseCount()
        if (openNow <= promiseCountAtOwner) {
          try {
            const r = runtime.promise.maybeAutoFromOwner(lastOwnerForForce)
            if (r?.ok && r.item) {
              const when = r.label || '到点'
              Promise.resolve(
                speak(`行 到点喊你（${when}）`, { proactive: true }),
              ).catch(() => {})
            }
          } catch (err) {
            runtime.log?.warn?.(
              '[whale-companion] promise auto failed',
              err?.message || err,
            )
          }
        }
      }
    }

    // dsh-wechat pushes the final reply; || split is patched on sendReply.
    // deliverAssistant re-sends → doubles; default off.
    const wantDeliver =
      outbound?.enabled !== false && outbound?.deliverAssistant === true

    if (wantDeliver) {
      runtime.stats.wechatAssistantMessages =
        (runtime.stats.wechatAssistantMessages || 0) + 1
      runtime.log?.warn?.(
        '[whale-companion] deliverAssistant=true will double-send with dsh-wechat; prefer false',
      )
      claimSpeakFingerprint(runtime, text)
      Promise.resolve(speak(text)).catch((err) => {
        runtime.log?.warn?.(
          '[whale-companion] deliverAssistant failed',
          err?.message || err,
        )
      })
      return
    }

    runtime.persona?.onReply?.(text)
    try {
      runtime.memory?.noteAssistantTurn?.(text)
    } catch {
      /* ignore */
    }

    runStickerAndAlarmFallback()

    runtime.stats.wechatAssistantMessages =
      (runtime.stats.wechatAssistantMessages || 0) + 1
  }

  try {
    const off = ctx.on('session/event', onSessionEvent)
    return typeof off === 'function' ? off : () => {}
  } catch {
    return () => {}
  }
}
