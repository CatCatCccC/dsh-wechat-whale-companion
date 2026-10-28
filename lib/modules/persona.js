/**
 * Mood / energy / affinity + sleep + lastword + proactive pings.
 */
import { mergeDefaults } from '../core/state.js'
import { formatMoodLine } from './mood-words.js'
import {
  DEFAULT_PROACTIVE,
  DEFAULT_TIME_ZONE,
  planProactiveTick,
  pushRecent,
} from './proactive.js'

const DEFAULT_STATE = {
  mood: 55,
  energy: 70,
  affinity: 15,
  asleep: false,
  lastProactiveAt: 0,
  lastOwnerAt: 0,
  fatFishHits: 0,
  /** @type {string[]} */
  recentProactive: [],
  lastProactiveIntent: '',
  /** Last owner text snippet for prompt hints (e.g. sticker ask) */
  lastOwnerText: '',
  style: { shortBias: 0.7, samples: 0 },
  updatedAt: 0,
}

const SLEEP_WORDS = /晚安|去睡|睡了|困了|撑不住|先睡|睡觉了/
const FAT_FISH = /大肥鱼/

/**
 * @param {any} ctx
 * @param {object} runtime
 */
export function applyPersona(_ctx, runtime) {
  const mod = runtime.config.modules.persona
  if (!mod?.enabled) return () => {}

  const store = runtime.store
  let state = mergeDefaults(DEFAULT_STATE, store.get('mood-state.json', DEFAULT_STATE))

  const sleepOn = runtime.config.modules.sleep?.enabled !== false
  const lastwordOn = runtime.config.modules.lastword?.enabled !== false
  let lastword = store.get('lastword.json', { text: '', at: 0, count: 0 })

  const save = () => {
    state.updatedAt = Date.now()
    store.setDebounced('mood-state.json', state)
  }

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n))

  let lastTick = Date.now()
  const regen = () => {
    const now = Date.now()
    const mins = (now - lastTick) / 60000
    lastTick = now
    if (mins > 0 && !state.asleep) {
      state.energy = clamp(state.energy + mins / 3, 5, 100)
    }
  }

  const api = {
    snapshot: () => {
      regen()
      return {
        ...state,
        style: { ...state.style },
        lastwordHint: lastwordOn && lastword.text ? String(lastword.text).slice(0, 24) : '',
      }
    },
    moodLine() {
      return formatMoodLine(api.snapshot())
    },
    styleHint() {
      const b = state.style?.shortBias ?? 0.7
      return b > 0.6 ? '偏短句' : b < 0.4 ? '可稍长' : '中等'
    },
    onOwnerMessage(text) {
      regen()
      state.lastOwnerAt = Date.now()
      state.lastOwnerText = String(text || '').trim().slice(0, 80)
      state.asleep = false
      state.energy = clamp(state.energy - 1, 5, 100)
      state.affinity = clamp(state.affinity + 0.15, 0, 100)
      if (FAT_FISH.test(String(text || ''))) {
        state.fatFishHits = (state.fatFishHits || 0) + 1
        state.mood = clamp(state.mood - 2, 0, 100)
      }
      const len = String(text || '').length
      const short = len <= 20 ? 1 : 0
      if (!state.style) state.style = { shortBias: 0.7, samples: 0 }
      state.style.samples += 1
      state.style.shortBias = state.style.shortBias * 0.9 + short * 0.1
      save()
    },
    onReply(text) {
      regen()
      const len = String(text || '').length
      if (len > 80) state.mood = clamp(state.mood - 1, 0, 100)
      else state.mood = clamp(state.mood + 0.5, 0, 100)
      save()
      if (sleepOn) api.observeOutbound(text)
      if (lastwordOn) api.recordLastword(text)
    },
    setAsleep(v) {
      state.asleep = Boolean(v)
      save()
    },
    observeOutbound(text) {
      if (!sleepOn) return
      if (SLEEP_WORDS.test(String(text || ''))) {
        state.asleep = true
        runtime.stats.sleepTriggers = (runtime.stats.sleepTriggers || 0) + 1
        save()
      }
    },
    shouldSuppressProactive() {
      return Boolean(state.asleep)
    },
    recordLastword(text) {
      if (!lastwordOn) return
      const t = String(text || '').trim()
      if (!t) return
      lastword = {
        text: t.slice(0, 200),
        at: Date.now(),
        count: (lastword.count || 0) + 1,
      }
      store.setDebounced('lastword.json', lastword)
    },
    getLastword: () => ({ ...lastword }),
  }

  runtime.persona = api
  // Back-compat aliases used by older call sites / tests
  runtime.sleep = {
    observeOutbound: (t) => api.observeOutbound(t),
    shouldSuppressProactive: () => api.shouldSuppressProactive(),
  }
  runtime.lastword = {
    record: (t) => api.recordLastword(t),
    get: () => api.getLastword(),
  }

  const timeZone =
    typeof mod.timeZone === 'string' && mod.timeZone.trim()
      ? mod.timeZone.trim()
      : DEFAULT_TIME_ZONE
  const chance = Number(mod.proactiveChance)
  const cooldownMin = Number(mod.proactiveCooldownMin)
  const minOwnerGapMin = Number(mod.proactiveMinOwnerGapMin)
  const stickerChance = Number(mod.proactiveStickerChance)
  const tickMs = Number(mod.proactiveTickMs)
  const tick = Number.isFinite(tickMs) && tickMs >= 60_000 ? tickMs : DEFAULT_PROACTIVE.tickMs
  const cooldownMs =
    (Number.isFinite(cooldownMin) ? cooldownMin : DEFAULT_PROACTIVE.cooldownMin) * 60 * 1000

  const timer = setInterval(async () => {
    try {
      regen()
      if (api.shouldSuppressProactive()) return

      const to = runtime.owner?.id || ''
      const plan = planProactiveTick({
        now: Date.now(),
        asleep: state.asleep,
        energy: state.energy,
        mood: state.mood,
        affinity: state.affinity,
        lastProactiveAt: state.lastProactiveAt,
        lastOwnerAt: state.lastOwnerAt,
        tier: runtime.tier?.stage?.()?.id || '',
        lastword: lastword.text || '',
        recent: state.recentProactive || [],
        activeHours: runtime.circadian?.activeHours?.() || [],
        chance: Number.isFinite(chance) ? chance : DEFAULT_PROACTIVE.chance,
        cooldownMin: Number.isFinite(cooldownMin) ? cooldownMin : DEFAULT_PROACTIVE.cooldownMin,
        minOwnerGapMin: Number.isFinite(minOwnerGapMin)
          ? minOwnerGapMin
          : DEFAULT_PROACTIVE.minOwnerGapMin,
        stickerChance: Number.isFinite(stickerChance)
          ? stickerChance
          : DEFAULT_PROACTIVE.stickerChance,
        hasSendText: Boolean(runtime.wechat?.sendText),
        hasOwner: Boolean(to),
        timeZone,
      })

      runtime.stats.proactiveTimeZone = timeZone
      runtime.stats.proactiveLastSkip = plan.fire ? '' : plan.reason || ''
      if (!plan.fire) return

      state.lastProactiveAt = Date.now()
      state.lastProactiveIntent = plan.intent
      state.recentProactive = pushRecent(state.recentProactive, plan.line)
      save()

      try {
        const opts = { to, proactive: true }
        if (runtime.rhythm?.sendPaced) {
          await runtime.rhythm.sendPaced(plan.line, opts)
        } else {
          await runtime.wechat.sendText(plan.line, opts)
        }
        runtime.stats.proactiveSent = (runtime.stats.proactiveSent || 0) + 1
        runtime.stats.proactiveIntent = plan.intent
        runtime.stats.proactiveFailReason = ''
        runtime._spokeFingerprint = { text: plan.line, at: Date.now() }
        api.observeOutbound(plan.line)
        api.recordLastword(plan.line)

        if (plan.stickerKeyword && runtime.media?.findSticker && runtime.media?.sendImage) {
          try {
            const found = await runtime.media.findSticker(plan.stickerKeyword)
            if (found?.ok && found.path) {
              runtime.wechatSessions?.refresh?.()
              const bound = runtime.wechatSessions?.list?.()?.[0]
              const sent = await runtime.media.sendImage(found.path, {
                ...opts,
                agentId: bound?.sessionId || opts.agentId,
              })
              if (sent?.ok) {
                runtime.stats.proactiveSticker = (runtime.stats.proactiveSticker || 0) + 1
              }
            }
          } catch (stickerErr) {
            runtime.log?.warn?.(
              '[whale-companion] proactive sticker',
              stickerErr?.message || stickerErr,
            )
          }
        }
      } catch (err) {
        // Soft retry window ~20min instead of full cooldown
        state.lastProactiveAt = Date.now() - cooldownMs + 20 * 60 * 1000
        save()
        const msg = String(err?.message || err)
        runtime.stats.proactiveFailReason = /token|context/i.test(msg)
          ? 'context_token'
          : msg.slice(0, 120)
        runtime.log?.warn?.(
          '[whale-companion] proactive failed',
          runtime.stats.proactiveFailReason,
        )
      }
    } catch (err) {
      runtime.log?.warn?.('[whale-companion] proactive tick', err?.message || err)
    }
  }, tick)

  timer.unref?.()

  return () => clearInterval(timer)
}
