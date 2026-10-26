/**
 * dsh-wechat-whale-companion — Cordis plugin entry.
 * Peer of dsh-onebot-companion for WeChat DM + whale-girl human chat.
 */
import { normalizeConfig } from './core/config.js'
import { StateStore, defaultStateDir } from './core/state.js'
import { WechatSessionIndex } from './core/wechat-state.js'
import { probeWechat } from './core/wechat.js'
import { applyGuard, cleanOutbound } from './modules/guard.js'
import { applyRhythm, deliverBatchToAgent } from './modules/rhythm.js'
import { applyPrompt } from './modules/prompt.js'
import { applyPersona } from './modules/persona.js'
import { applyStamp } from './modules/stamp.js'
import { applyAdopt } from './modules/adopt.js'
import { applySleep } from './modules/sleep.js'
import { applyLastword } from './modules/lastword.js'
import { applyNurture } from './modules/nurture.js'
import { applyMedia } from './modules/media.js'
import { applyOwnerGate } from './modules/owner.js'
import { applyHttp } from './modules/http.js'
import { applyQqStubs } from './modules/qq_stubs.js'

export const name = 'dsh-wechat-whale-companion'

/** Event timestamps may be seconds (iLink) or milliseconds (DSH). */
function toEpochMs(value, fallback = Date.now()) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return n < 1e12 ? n * 1000 : n
}

/** Pull plain text out of a DSH `user/message` or `assistant/message` event. */
function textFromSessionEvent(event) {
  // DSH session events carry the payload under `data`; accept both that and
  // the flattened shape some hosts expose.
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

// No inject: optional hosts (agents/tools/…) must be probed via ctx.get / ?.,
 // otherwise Cordis keeps this fiber PENDING forever (see 0.1.5).
 //
 // Deliberately do NOT export Config — non-schema objects break DSH loader
 // config projection (same lesson as dsh-onebot-companion).

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
      // dsh-wechat may register its `send_wechat` tool after this plugin's
      // apply(); re-probe lazily instead of caching an absent channel forever.
      if (!wechat?.present) wechat = probeWechat(ctx)
      return wechat
    },
    set wechat(v) {
      wechat = v
    },
    stats,
    log,
    emit(event, payload) {
      try {
        ctx.emit?.(event, payload)
      } catch {
        /* ignore */
      }
    },
  }

  // Re-probe shortly after boot — dsh-wechat may register later than this plugin
  const reprobe = setTimeout(() => {
    const again = probeWechat(ctx)
    if (again.present && again.capabilities.length >= wechat.capabilities.length) {
      wechat = again
      runtime.log?.info?.(`[whale-companion] re-probed wechat; ${again.notes}`)
    }
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
    // ctx.provide() owns the service lifetime; do not delete the property here.
  }

  // Register teardown before any module runs: a throwing module must not leave
  // an HTTP listener or timer behind.
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => disposeAll)
  }

  disposers.push(applyQqStubs(ctx, runtime))
  disposers.push(applyOwnerGate(ctx, runtime))
  disposers.push(applyGuard(ctx, runtime))
  disposers.push(applyRhythm(ctx, runtime))
  disposers.push(applyStamp(ctx, runtime))
  disposers.push(applyAdopt(ctx, runtime))
  disposers.push(applyPersona(ctx, runtime))
  disposers.push(applySleep(ctx, runtime))
  disposers.push(applyLastword(ctx, runtime))
  disposers.push(applyPrompt(ctx, runtime))
  disposers.push(applyNurture(ctx, runtime))
  disposers.push(applyMedia(ctx, runtime))
  disposers.push(applyHttp(ctx, runtime))

  // dsh-wechat delivers inbound through agent.followup and sends assistant
  // output from session/event; it exposes no service. Observe the session log
  // instead, gated by dsh-wechat's persisted user→session binding so GUI and
  // coding sessions in the same profile never feed the companion.
  if (typeof ctx.on === 'function') {
    try {
      const off = ctx.on('session/event', (session, event) => {
        const sessionId =
          session?.id ?? session?.sessionId ?? event?.sessionId ?? event?.session?.id
        if (!sessionId || !runtime.wechatSessions?.has?.(sessionId)) return
        const text = textFromSessionEvent(event)
        if (!text) return
        if (event?.type === 'user/message') {
          // Ignore plugin/developer injections; only a human prompt counts as
          // the owner speaking.
          const sourceKind = event?.data?.source?.kind
          if (sourceKind && sourceKind !== 'user') return
          runtime.persona?.onOwnerMessage?.(text)
          runtime.circadian?.touch?.(
            toEpochMs(event?.time ?? event?.at ?? event?.timestamp),
          )
          runtime.stats.wechatUserMessages = (runtime.stats.wechatUserMessages || 0) + 1
        } else if (event?.type === 'assistant/message') {
          runtime.persona?.onReply?.(text)
          runtime.sleep?.observeOutbound?.(text)
          runtime.lastword?.record?.(text)
          runtime.stats.wechatAssistantMessages =
            (runtime.stats.wechatAssistantMessages || 0) + 1
        }
      })
      disposers.push(typeof off === 'function' ? off : () => {})
    } catch {
      /* host may not expose session/event */
    }
  }

  /** Dedupe: host may emit both wechat/message and wechat/inbound for one bubble */
  let lastIngestKey = ''
  let lastIngestAt = 0
  /** Serialize outbound so concurrent speak() don't interleave bubbles */
  let speakChain = Promise.resolve()

  // Cordis 4 services must be declared before assignment: `ctx.x = ...` on an
  // undeclared property throws `cannot set property "x" without provide`.
  // ctx.provide() registers the service on this fiber and removes it on dispose.
  const api = {
    runtime,
    reprobeWechat() {
      wechat = probeWechat(ctx)
      return wechat
    },
    /**
     * @param {{ peer: string, text: string, at?: number }} msg
     */
    ingest(msg) {
      if (disposed) return null
      const peer = msg?.peer
      const text = msg?.text
      if (text == null || !String(text).length) return null
      if (!runtime.owner?.allow?.(peer)) return null
      const at = toEpochMs(msg.at)
      const now = Date.now()
      const dedupeKey = `${peer}\0${String(text)}`
      // Wall-clock window — event timestamps can disagree across dual emits
      if (dedupeKey === lastIngestKey && now - lastIngestAt < 800) {
        runtime.stats.ingestDeduped = (runtime.stats.ingestDeduped || 0) + 1
        return { peer, text, sessionId: runtime.adopt?.get?.(peer), deduped: true }
      }
      lastIngestKey = dedupeKey
      lastIngestAt = now
      runtime.sleep?.onOwnerInbound?.()
      runtime.persona?.onOwnerMessage?.(text)
      runtime.circadian?.touch?.(at)
      // Raw text into merger; stamp applied once at flush (see joinBatchTexts)
      if (runtime.rhythm?.pushInbound) {
        runtime.rhythm.pushInbound(peer, text)
      } else {
        deliverBatchToAgent(ctx, runtime, {
          peer,
          texts: [String(text)],
          at,
        }).catch(() => {})
      }
      return { peer, text, sessionId: runtime.adopt?.get?.(peer) }
    },
    /**
     * @param {string} text
     */
    async speak(text) {
      if (disposed) return { sent: 0, skipped: 'disposed' }
      // Always clean — even if guard module disabled
      const filtered = runtime.guard?.filterSend?.(text) ?? cleanOutbound(text)
      if (filtered.drop) {
        if (!runtime.guard) {
          runtime.stats.guardDropped = (runtime.stats.guardDropped || 0) + 1
          runtime.stats.lastGuardReason = filtered.reason
        }
        return { sent: 0, silent: true, reason: filtered.reason }
      }
      const run = async () => {
        let result
        if (runtime.rhythm?.sendPaced) {
          result = await runtime.rhythm.sendPaced(filtered.text)
        } else if (runtime.wechat?.sendText) {
          await runtime.wechat.sendText(filtered.text)
          result = { sent: 1 }
        } else {
          return { sent: 0, skipped: 'no-channel' }
        }
        if ((result?.sent || 0) > 0) {
          runtime.sleep?.observeOutbound?.(filtered.text)
          runtime.lastword?.record?.(filtered.text)
          runtime.persona?.onReply?.(filtered.text)
        }
        return result
      }
      const done = speakChain.then(run, run)
      speakChain = done.catch(() => {})
      return done
    },
  }

  ctx.provide('whaleCompanion', api)

  // Optional paced speak on agent/end — OFF by default to avoid double-send
  // when DSH already routes assistant text to WeChat. Opt in via
  // modules.rhythm.speakOnAgentEnd or per-event ev.companionSpeak=true.
  if (typeof ctx?.on === 'function') {
    try {
      const off = ctx.on('agent/end', async (ev) => {
        const text = ev?.text || ev?.message || ev?.assistantText
        if (!text || !runtime.wechat?.sendText) return
        if (ev?.skipCompanionSpeak) return
        const want =
          ev?.companionSpeak === true || runtime.config.modules.rhythm?.speakOnAgentEnd
        if (!want) return
        try {
          await api.speak(text)
          if (ev && typeof ev === 'object') ev.companionSpoke = true
        } catch (err) {
          log.warn?.('[whale-companion] agent/end speak', err?.message || err)
        }
      })
      disposers.push(typeof off === 'function' ? off : () => {})
    } catch {
      /* host may not have agent/end */
    }

    // Best-effort auto ingest from common WeChat inbound event names
    if (runtime.config.modules.rhythm?.autoIngest !== false) {
      const inboundEvents = [
        'wechat/message',
        'wechat/inbound',
        'weixin/message',
        'ilink/message',
      ]
      for (const evName of inboundEvents) {
        try {
          const off = ctx.on(evName, (ev, next) => {
            let consumed = false
            try {
              const peer =
                ev?.peer ||
                ev?.from ||
                ev?.wxid ||
                ev?.sender ||
                ev?.userId ||
                ev?.session?.peer
              const text =
                ev?.text ?? ev?.content ?? ev?.message?.text ?? ev?.body?.text
              if (peer && text != null && String(text).length) {
                const r = api.ingest({
                  peer: String(peer),
                  text: String(text),
                  at: ev?.at || ev?.timestamp || Date.now(),
                })
                if (r && ev && typeof ev === 'object') {
                  ev.companionIngested = true
                  if (typeof ev.preventDefault === 'function') ev.preventDefault()
                  ev.handled = true
                  // We already queue to agent via merger — skip host default path
                  if (runtime.config.modules.rhythm?.deliverToAgent !== false) {
                    consumed = true
                  }
                }
              }
            } catch (err) {
              log.warn?.('[whale-companion] autoIngest', err?.message || err)
            }
            if (consumed) return undefined
            return typeof next === 'function' ? next() : undefined
          })
          disposers.push(typeof off === 'function' ? off : () => {})
        } catch {
          /* event name unknown to host */
        }
      }
    }
  }

  return { dispose: disposeAll }
}

export default { name, apply }
