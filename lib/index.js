/**
 * dsh-wechat-whale-companion — Cordis plugin entry.
 * WeChat DM companion on top of dsh-wechat (persona / mood / paced speak / wx_*).
 */
import { normalizeConfig } from './core/config.js'
import { StateStore, defaultStateDir } from './core/state.js'
import { WechatSessionIndex } from './core/wechat-state.js'
import { ensureWechatSilent, readWechatConfig } from './core/wechat-config.js'
import { probeWechat } from './core/wechat.js'
import {
  applyGuard,
  blankAssistantTextBlocks,
  cleanOutbound,
  hasSplitMarkers,
} from './modules/guard.js'
import { applyRhythm } from './modules/rhythm.js'
import { applyPrompt } from './modules/prompt.js'
import { applyPersona } from './modules/persona.js'
import { applyNurture } from './modules/nurture.js'
import { applyMemory } from './modules/memory.js'
import { applyMedia } from './modules/media.js'
import { applyVision } from './modules/vision.js'
import { applyOwnerGate } from './modules/owner.js'
import { applyHttp } from './modules/http.js'
import { applyReset } from './modules/reset.js'
import {
  createToolForceState,
  markStickerSent,
  moodToStickerTag,
  needsStickerFallback,
  onOwnerTurnForSticker,
} from './core/tool-force.js'
import { looksLikeAlarm } from './core/parse-due.js'

export const name = 'dsh-wechat-whale-companion'

/** Event timestamps may be seconds (iLink) or milliseconds (DSH). */
function toEpochMs(value, fallback = Date.now()) {
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

function fingerprintMatch(runtime, text) {
  const fp = runtime._spokeFingerprint
  if (!fp?.text) return false
  if (Date.now() - (fp.at || 0) > 8000) return false
  return String(fp.text).trim() === String(text || '').trim()
}

/** Claim outbound immediately so concurrent assistant/message can't double-send. */
function claimSpeakFingerprint(runtime, text) {
  runtime._spokeFingerprint = {
    text: String(text || '').trim(),
    at: Date.now(),
  }
}

function refreshWechatSilent(runtime) {
  try {
    runtime.wechatSilent = readWechatConfig(runtime.config.wechatStorageDir).silent
  } catch {
    /* keep previous */
  }
  return Boolean(runtime.wechatSilent)
}

/**
 * @param {any} ctx
 * @param {Record<string, unknown>} config
 */
export function apply(ctx, config = {}) {
  const cfg = normalizeConfig(config)
  if (!cfg.enabled) {
    ctx.logger?.info?.('[whale-companion] disabled by config')
    return
  }

  const store = new StateStore(defaultStateDir(cfg.stateDir))
  const wechatSessions = new WechatSessionIndex(cfg.wechatStorageDir)
  let wechat = probeWechat(ctx)
  const stats = {}
  const log = ctx.logger || console

  log.info?.(`[whale-companion] boot; ${wechat.notes}`)

  const forceMod = cfg.modules.toolForce || {}
  const forceOn = forceMod.enabled !== false
  let forceState = createToolForceState(
    store.get('tool-force.json', createToolForceState()),
  )
  const persistForce = () => store.setDebounced('tool-force.json', forceState)
  /** Last owner text this turn (for alarm fallback after assistant reply). */
  let lastOwnerForForce = ''
  let promiseCountAtOwner = 0

  /** @type {any} */
  const runtime = {
    ctx,
    config: cfg,
    store,
    wechatSessions,
    get wechat() {
      if (!wechat?.present) wechat = probeWechat(ctx)
      return wechat
    },
    set wechat(v) {
      wechat = v
    },
    stats,
    log,
    wechatSilent: false,
    toolForce: {
      pendingSticker: () => Boolean(forceState.pendingSticker),
      markSent: () => {
        forceState = markStickerSent(forceState)
        persistForce()
      },
      snapshot: () => ({ ...forceState }),
    },
  }

  const outbound = cfg.modules.outbound
  if (outbound?.enabled !== false && outbound?.ensureWechatSilent !== false) {
    const result = ensureWechatSilent(cfg.wechatStorageDir, { log })
    runtime.wechatSilent = readWechatConfig(cfg.wechatStorageDir).silent
    if (!result.ok) {
      log.warn?.(
        '[whale-companion] could not ensure dsh-wechat silent; assistant may double-send if deliverAssistant is on',
      )
    }
  } else {
    runtime.wechatSilent = readWechatConfig(cfg.wechatStorageDir).silent
  }

  const reprobe = setTimeout(() => {
    const again = probeWechat(ctx)
    if (again.present && again.capabilities.length >= wechat.capabilities.length) {
      wechat = again
      runtime.log?.info?.(`[whale-companion] re-probed wechat; ${again.notes}`)
    }
    runtime.wechatSilent = readWechatConfig(cfg.wechatStorageDir).silent
  }, 3000)
  reprobe.unref?.()

  const disposers = []
  let disposed = false
  const disposeAll = () => {
    if (disposed) return
    disposed = true
    clearTimeout(reprobe)
    for (const d of disposers) {
      try {
        d?.()
      } catch {
        /* ignore */
      }
    }
    store.flush()
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => disposeAll)
  }

  disposers.push(applyOwnerGate(ctx, runtime))
  disposers.push(applyGuard(ctx, runtime))
  disposers.push(applyRhythm(ctx, runtime))
  disposers.push(applyPersona(ctx, runtime))
  disposers.push(applyPrompt(ctx, runtime))
  disposers.push(applyNurture(ctx, runtime))
  // after nurture so diary→memory bridge can wrap wx_diary
  disposers.push(applyMemory(ctx, runtime))
  disposers.push(applyMedia(ctx, runtime))
  disposers.push(applyVision(ctx, runtime))
  disposers.push(applyReset(ctx, runtime))
  disposers.push(applyHttp(ctx, runtime))

  /** @type {any} */
  const api = {
    runtime,
    reprobeWechat() {
      wechat = probeWechat(ctx)
      return wechat
    },
    /**
     * Guard + paced send. Used for proactive / promise / outbound takeover.
     * @param {string} text
     * @param {{ skipObserve?: boolean }} [opts]
     */
    async speak(text, opts = {}) {
      if (disposed) return { sent: 0, skipped: 'disposed' }
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
        // onReply also drives sleep/lastword
        runtime.persona?.onReply?.(filtered.text)
      }
      return result
    },
  }
  // Persona / nurture timers call runtime.speak — must be wired (api alone is not enough).
  runtime.speak = (text, opts) => api.speak(text, opts)

  // Observe bound WeChat sessions: mood inbound + optional assistant delivery.
  // Prepend so we can blank `||` / wx-next text before dsh-wechat silent-buffers it.
  if (typeof ctx.on === 'function') {
    try {
      const onSessionEvent = (session, event) => {
        const sessionId =
          session?.id ?? session?.sessionId ?? event?.sessionId ?? event?.session?.id
        if (!sessionId || !runtime.wechatSessions?.has?.(sessionId)) return
        const text = textFromSessionEvent(event)
        if (!text) return

        if (event?.type === 'user/message') {
          const sourceKind = event?.data?.source?.kind
          if (sourceKind && sourceKind !== 'user') return
          // /whale-reset: if dsh-wechat forwarded as text (unknown cmd), still clear.
          if (runtime.handleWhaleResetText?.(text)) {
            runtime.stats.wechatUserMessages =
              (runtime.stats.wechatUserMessages || 0) + 1
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
            promiseCountAtOwner = runtime.promise?.due
              ? (store.get('promises.json', { items: [] }).items || []).filter(
                  (i) => !i.done,
                ).length
              : 0
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

        // Skip when we already claimed / sent this text (incl. in-flight).
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
                  runtime.stats.stickerFallback =
                    (runtime.stats.stickerFallback || 0) + 1
                } else {
                  runtime.log?.warn?.(
                    '[whale-companion] sticker fallback failed',
                    r?.error,
                  )
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
            const openNow = (store.get('promises.json', { items: [] }).items || []).filter(
              (i) => !i.done,
            ).length
            if (openNow <= promiseCountAtOwner) {
              try {
                const r = runtime.promise.maybeAutoFromOwner(lastOwnerForForce)
                if (r?.ok && r.item) {
                  const when = r.label || '到点'
                  Promise.resolve(
                    api.speak(`行 到点喊你（${when}）`, { proactive: true }),
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

        // Persona `||` / ---wx-next--- : we paced-send bubbles; blank event so
        // dsh-wechat silent mode does not also push the raw "a||b" string.
        if (outbound?.enabled !== false && hasSplitMarkers(text)) {
          blankAssistantTextBlocks(event)
          claimSpeakFingerprint(runtime, text)
          runtime.stats.bubbleSplitTakeover =
            (runtime.stats.bubbleSplitTakeover || 0) + 1
          Promise.resolve(api.speak(text)).catch((err) => {
            runtime.log?.warn?.(
              '[whale-companion] bubble split speak failed',
              err?.message || err,
            )
          })
          try {
            runtime.memory?.noteAssistantTurn?.(text)
          } catch {
            /* ignore */
          }
          runStickerAndAlarmFallback()
          runtime.stats.wechatAssistantMessages =
            (runtime.stats.wechatAssistantMessages || 0) + 1
          return
        }

        // dsh-wechat always pushes the final assistant reply itself.
        // deliverAssistant re-sends via send_wechat → identical double bubbles.
        // Default is off; only observe for mood / lastword / sleep.
        const wantDeliver =
          outbound?.enabled !== false && outbound?.deliverAssistant === true

        if (wantDeliver) {
          runtime.stats.wechatAssistantMessages =
            (runtime.stats.wechatAssistantMessages || 0) + 1
          runtime.log?.warn?.(
            '[whale-companion] deliverAssistant=true will double-send with dsh-wechat; prefer false',
          )
          claimSpeakFingerprint(runtime, text)
          Promise.resolve(api.speak(text)).catch((err) => {
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

      let off
      try {
        off = ctx.on('session/event', onSessionEvent, true)
        runtime.stats.sessionEventPrepend = true
      } catch {
        off = ctx.on('session/event', onSessionEvent)
        runtime.stats.sessionEventPrepend = false
        runtime.log?.warn?.(
          '[whale-companion] session/event prepend unsupported; || split may still leak raw markers',
        )
      }
      disposers.push(typeof off === 'function' ? off : () => {})
    } catch {
      /* host may not expose session/event */
    }
  }

  ctx.provide('whaleCompanion', api)

  return { dispose: disposeAll }
}

export default { name, apply }
