/**
 * Mood / energy / affinity + sleep + lastword + proactive pings.
 */
import { mergeDefaults } from '../core/state.js'
import { FEELING_BY_KIND, formatMoodLine } from './mood-words.js'
import { reactToOwnerText } from './owner-react.js'
import {
  DEFAULT_PROACTIVE,
  DEFAULT_TIME_ZONE,
  dayPart,
  hourInTimeZone,
  planProactiveTick,
  pushRecent,
} from './proactive.js'

export { reactToOwnerText } from './owner-react.js'

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
  /** One-shot “刚才心里那一下” (cleared slowly by overwrite) */
  lastFeeling: '',
  style: { shortBias: 0.7, samples: 0 },
  updatedAt: 0,
}

// Avoid bare「睡了」— proactive「喂，该睡了吧」must not put the whale to sleep.
const SLEEP_WORDS = /晚安|去睡|先睡|睡觉了|困了|撑不住|我睡了|要睡了|去睡觉/

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

  const timeZone =
    typeof mod.timeZone === 'string' && mod.timeZone.trim()
      ? mod.timeZone.trim()
      : DEFAULT_TIME_ZONE

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
      const snap = api.snapshot()
      const stage = runtime.tier?.stage?.() || null
      const h = hourInTimeZone(Date.now(), timeZone)
      return formatMoodLine({
        ...snap,
        shortBias: snap.style?.shortBias,
        tierId: stage?.id || '',
        tierLabel: stage?.label || '',
        dayPart: dayPart(h),
      })
    },
    styleHint() {
      // Kept for back-compat; prompt folds length into moodLine.
      const b = state.style?.shortBias ?? 0.7
      return b > 0.6 ? '偏短句' : b < 0.4 ? '可稍长' : '中等'
    },
    onOwnerMessage(text) {
      regen()
      state.lastOwnerAt = Date.now()
      state.lastOwnerText = String(text || '').trim().slice(0, 80)
      state.asleep = false

      const react = reactToOwnerText(text)
      state.energy = clamp(state.energy + react.energyDelta, 5, 100)
      state.affinity = clamp(state.affinity + react.affinityDelta, 0, 100)
      state.mood = clamp(state.mood + react.moodDelta, 0, 100)
      if (react.fatFish) {
        state.fatFishHits = (state.fatFishHits || 0) + 1
      }
      // feiyu-mood style: tell her the feeling once, don't freeze voice with rule lists
      const feel =
        FEELING_BY_KIND[react.kind] ||
        (react.fatFish ? FEELING_BY_KIND.fatfish : '')
      if (feel) state.lastFeeling = feel
      else if (react.kind === 'normal') state.lastFeeling = ''

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
    /** Full mood/affinity wipe for /whale-reset mood|all */
    reset() {
      state = mergeDefaults(DEFAULT_STATE, {})
      state.updatedAt = Date.now()
      store.set('mood-state.json', state)
      lastword = { text: '', at: 0, count: 0 }
      store.set('lastword.json', lastword)
      return { ok: true }
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

      try {
        runtime.wechatSessions?.refresh?.()
        const bound = runtime.wechatSessions?.list?.()?.[0]
        const opts = {
          to,
          proactive: true,
          agentId: bound?.sessionId || undefined,
        }
        if (typeof runtime.speak === 'function') {
          const sent = await runtime.speak(plan.line, opts)
          if (!(sent?.sent > 0)) {
            throw new Error(sent?.reason || sent?.skipped || 'speak sent 0')
          }
        } else if (runtime.rhythm?.sendPaced) {
          await runtime.rhythm.sendPaced(plan.line, opts)
          api.observeOutbound(plan.line)
          api.recordLastword(plan.line)
        } else {
          await runtime.wechat.sendText(plan.line, opts)
          api.observeOutbound(plan.line)
          api.recordLastword(plan.line)
        }

        // Commit cooldown / recent only after a successful send
        state.lastProactiveAt = Date.now()
        state.lastProactiveIntent = plan.intent
        state.recentProactive = pushRecent(state.recentProactive, plan.line)
        save()
        runtime.stats.proactiveSent = (runtime.stats.proactiveSent || 0) + 1
        runtime.stats.proactiveIntent = plan.intent
        runtime.stats.proactiveFailReason = ''

        if (plan.stickerKeyword && runtime.media?.findSticker && runtime.media?.sendImage) {
          try {
            const found = await runtime.media.findSticker(plan.stickerKeyword)
            if (found?.ok && found.path) {
              const stickerSent = await runtime.media.sendImage(found.path, opts)
              if (stickerSent?.ok) {
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
        // Soft retry window ~20min instead of full cooldown; do not pollute recent lines
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
