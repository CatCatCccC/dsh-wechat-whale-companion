/**
 * Mood / energy / affinity + proactive pings + light style learning.
 */
import { mergeDefaults } from '../core/state.js'

const DEFAULT_STATE = {
  mood: 55,
  energy: 70,
  affinity: 15,
  asleep: false,
  lastProactiveAt: 0,
  lastOwnerAt: 0,
  style: { shortBias: 0.7, samples: 0 },
  updatedAt: 0,
}

const QUIET_HOURS = { start: 1, end: 8 } // [1, 8) local

/**
 * @param {object} runtime
 */
export function applyPersona(ctx, runtime) {
  const mod = runtime.config.modules.persona
  if (!mod?.enabled) return () => {}

  const store = runtime.store
  let state = mergeDefaults(DEFAULT_STATE, store.get('mood-state.json', DEFAULT_STATE))

  const save = () => {
    state.updatedAt = Date.now()
    store.setDebounced('mood-state.json', state)
  }

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n))

  /** Passive regen: ~1 energy / 3 min wall clock while idle */
  let lastTick = Date.now()
  const regen = () => {
    const now = Date.now()
    const mins = (now - lastTick) / 60000
    lastTick = now
    if (mins > 0 && !state.asleep) {
      state.energy = clamp(state.energy + mins / 3, 5, 100)
    }
  }

  const inQuietHours = (d = new Date()) => {
    const h = d.getHours()
    return h >= QUIET_HOURS.start && h < QUIET_HOURS.end
  }

  const api = {
    snapshot: () => {
      regen()
      return { ...state, style: { ...state.style } }
    },
    styleHint() {
      const b = state.style?.shortBias ?? 0.7
      return b > 0.6 ? '偏短句' : b < 0.4 ? '可稍长' : '中等'
    },
    onOwnerMessage(text) {
      regen()
      state.lastOwnerAt = Date.now()
      state.asleep = false
      state.energy = clamp(state.energy - 1, 5, 100)
      state.affinity = clamp(state.affinity + 0.15, 0, 100)
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
    },
    setAsleep(v) {
      state.asleep = Boolean(v)
      save()
    },
    bump(field, delta) {
      if (!(field in state) || typeof state[field] !== 'number') return
      state[field] = clamp(state[field] + delta, 0, 100)
      save()
    },
  }

  runtime.persona = api

  const chance = Number(mod.proactiveChance) || 0.08
  const cooldownMs = (Number(mod.proactiveCooldownMin) || 45) * 60 * 1000

  const timer = setInterval(async () => {
    try {
      regen()
      if (state.asleep || runtime.sleep?.shouldSuppressProactive?.()) return
      if (runtime.focus?.isBusy?.()) return
      if (inQuietHours()) return
      if (state.energy < 20) return
      if (Date.now() - state.lastProactiveAt < cooldownMs) return
      // Don't ping if owner never spoke, or spoke very recently
      if (!state.lastOwnerAt) return
      if (Date.now() - state.lastOwnerAt < cooldownMs / 2) return
      // Prefer owner's active circadian hours when we have data
      const hours = runtime.circadian?.activeHours?.() || []
      if (hours.length >= 3 && !hours.includes(new Date().getHours())) return
      if (Math.random() > chance) return
      if (!runtime.wechat?.sendText) return

      state.lastProactiveAt = Date.now()
      save()
      const tier = runtime.tier?.stage?.()?.label
      const lines = [
        '在干嘛',
        '记得吃饭',
        '哼，本小姐偶尔也关心你一下',
        '……你还在吗',
        tier === '羁绊' ? '想你了，就一句' : '喂',
      ]
      const line = lines[Math.floor(Math.random() * lines.length)]

      try {
        const opts = { to: runtime.owner?.id || undefined, proactive: true }
        if (runtime.rhythm?.sendPaced) {
          await runtime.rhythm.sendPaced(line, opts)
        } else {
          await runtime.wechat.sendText(line, opts)
        }
        runtime.stats.proactiveSent = (runtime.stats.proactiveSent || 0) + 1
      } catch (err) {
        // Soft backoff 20m — don't zero the clock or next 5-min tick may spam
        state.lastProactiveAt = Date.now() - cooldownMs + 20 * 60 * 1000
        save()
        runtime.log?.warn?.(
          '[whale-companion] proactive failed (context_token?)',
          err?.message || err,
        )
      }
    } catch (err) {
      runtime.log?.warn?.('[whale-companion] proactive tick', err?.message || err)
    }
  }, 5 * 60 * 1000)

  // Unref so it doesn't keep process alive alone in tests
  timer.unref?.()

  return () => clearInterval(timer)
}
