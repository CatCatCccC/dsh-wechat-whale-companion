/**
 * dsh-wechat-whale-companion — Cordis plugin entry.
 * WeChat DM companion on top of dsh-wechat (persona / mood / paced speak / wx_*).
 */
import { normalizeConfig, parseDelayRange } from './core/config.js'
import { StateStore, defaultStateDir } from './core/state.js'
import { WechatSessionIndex } from './core/wechat-state.js'
import { ensureWechatSilent, readWechatConfig } from './core/wechat-config.js'
import { probeWechat } from './core/wechat.js'
import { scheduleWechatBubbleSplitPatch } from './core/patch-wechat-split.js'
import { assertRuntimePorts } from './core/runtime-ports.js'
import { applyGuard } from './modules/guard.js'
import { applyRhythm } from './modules/rhythm.js'
import { applyPrompt } from './modules/prompt.js'
import { applyPersona } from './modules/persona.js'
import { applyProactiveEngine } from './modules/proactive-engine.js'
import { applyNurture } from './modules/nurture.js'
import { applyMemory } from './modules/memory.js'
import { applyMedia } from './modules/media.js'
import { applyVision } from './modules/vision.js'
import { applyOwnerGate } from './modules/owner.js'
import { applyHttp } from './modules/http.js'
import { applyReset } from './modules/reset.js'
import { attachSessionObserver, createSpeak, textFromSessionEvent } from './modules/observe.js'

export const name = 'dsh-wechat-whale-companion'
export { textFromSessionEvent }

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
    assertRuntimePorts(runtime, log)
  }, 3000)
  reprobe.unref?.()

  const disposers = []
  const delayRange = parseDelayRange(cfg.modules.rhythm?.bubbleDelayMs || '600,1800')
  disposers.push(
    scheduleWechatBubbleSplitPatch({
      delayRange,
      log,
      onResult(r) {
        runtime.stats.bubbleSplitPatch = r?.ok ? r.path || true : r?.reason || false
        if (r?.peerVersion) runtime.stats.bubbleSplitPeerVersion = r.peerVersion
        if (typeof r?.peerOk === 'boolean') runtime.stats.bubbleSplitPeerOk = r.peerOk
      },
    }),
  )

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
  disposers.push(applyProactiveEngine(ctx, runtime))
  disposers.push(applyPrompt(ctx, runtime))
  disposers.push(applyNurture(ctx, runtime))
  disposers.push(applyMemory(ctx, runtime))
  disposers.push(applyMedia(ctx, runtime))
  disposers.push(applyVision(ctx, runtime))
  disposers.push(applyReset(ctx, runtime))
  disposers.push(applyHttp(ctx, runtime))

  const speak = createSpeak(runtime, { isDisposed: () => disposed })
  runtime.speak = (text, opts) => speak(text, opts)
  disposers.push(attachSessionObserver(ctx, runtime, speak))

  assertRuntimePorts(runtime, log)

  const api = {
    runtime,
    speak,
    reprobeWechat() {
      wechat = probeWechat(ctx)
      return wechat
    },
  }

  ctx.provide('whaleCompanion', api)

  return { dispose: disposeAll }
}

export default { name, apply }
