/**
 * dsh-wechat-whale-companion — Cordis plugin entry.
 * WeChat DM companion on top of dsh-wechat (persona / mood / paced speak / wx_*).
 */
import { normalizeConfig } from './core/config.js'
import { StateStore, defaultStateDir } from './core/state.js'
import { WechatSessionIndex } from './core/wechat-state.js'
import { ensureWechatSilent, readWechatConfig } from './core/wechat-config.js'
import { probeWechat } from './core/wechat.js'
import { applyGuard, cleanOutbound } from './modules/guard.js'
import { applyRhythm } from './modules/rhythm.js'
import { applyPrompt } from './modules/prompt.js'
import { applyPersona } from './modules/persona.js'
import { applyNurture } from './modules/nurture.js'
import { applyMemory } from './modules/memory.js'
import { applyMedia } from './modules/media.js'
import { applyOwnerGate } from './modules/owner.js'
import { applyHttp } from './modules/http.js'
import { applyReset } from './modules/reset.js'

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

  /** @type {any} */
  const runtime = {
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
  if (typeof ctx.on === 'function') {
    try {
      const off = ctx.on('session/event', (session, event) => {
        const sessionId =
          session?.id ?? session?.sessionId ?? event?.sessionId ?? event?.session?.id
        if (!sessionId || !runtime.wechatSessions?.has?.(sessionId)) return
        const text = textFromSessionEvent(event)
        if (!text) return

        if (event?.type === 'user/message') {
          const sourceKind = event?.data?.source?.kind
          if (sourceKind && sourceKind !== 'user') return
          runtime.persona?.onOwnerMessage?.(text)
          try {
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
          // fingerprint already checked above
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
        runtime.stats.wechatAssistantMessages =
          (runtime.stats.wechatAssistantMessages || 0) + 1
      })
      disposers.push(typeof off === 'function' ? off : () => {})
    } catch {
      /* host may not expose session/event */
    }
  }

  ctx.provide('whaleCompanion', api)

  return { dispose: disposeAll }
}

export default { name, apply }
