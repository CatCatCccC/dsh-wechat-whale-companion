/**
 * Mood / energy / affinity + sleep + lastword + social policy / agenda state.
 * Proactive tick lives in proactive-engine.js.
 */
import { mergeDefaults } from '../core/state.js'
import { ensureAgenda, shanghaiDayKey } from '../core/proactive-agenda.js'
import {
  applyFeedback,
  classifyOwnerReply,
  normalizePolicy,
} from '../core/social-policy.js'
import { parseBusySignal, isBusy } from '../core/busy-gate.js'
import { dayKey } from '../core/day-key.js'
import { normalizeMilestones, tryUnlockMilestone } from '../core/milestones.js'
import { STORE, bootStore, saveStore } from '../core/stores.js'
import { FEELING_BY_KIND, formatMoodLine } from './mood-words.js'
import { reactToOwnerText } from './owner-react.js'
import { DEFAULT_PROACTIVE, DEFAULT_TIME_ZONE, pushRecent } from './proactive.js'

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
  lastProactiveMotive: '',
  lastProactiveLine: '',
  lastProactiveForm: '',
  lastOwnerText: '',
  lastFeeling: '',
  lastFeedbackKind: '',
  lastFeedbackAt: 0,
  busyUntil: 0,
  busyHitDay: '',
  echoMood: {
    day: '',
    tags: [],
    hitsToday: 0,
    taggedDays: [],
    lastAt: 0,
    consumedDay: '',
  },
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
  const loadedMood = bootStore(store, STORE.MOOD, DEFAULT_STATE, {
    migrate: (raw) => {
      const next = { ...raw }
      delete next.style
      return next
    },
  })
  let state = mergeDefaults(DEFAULT_STATE, loadedMood.data)

  const sleepOn = runtime.config.modules.sleep?.enabled !== false
  const lastwordOn = runtime.config.modules.lastword?.enabled !== false
  let lastword = bootStore(store, STORE.LASTWORD, { text: '', at: 0, count: 0 }).data
  let policy = normalizePolicy(bootStore(store, STORE.SOCIAL_POLICY, null).data)
  const timeZone =
    typeof mod.timeZone === 'string' && mod.timeZone.trim()
      ? mod.timeZone.trim()
      : DEFAULT_TIME_ZONE
  let agenda = ensureAgenda(bootStore(store, STORE.AGENDA, null).data, {
    day: shanghaiDayKey(Date.now(), timeZone),
    dailyMax: Number(mod.proactiveDailyMax) || policy.dailyMax || 3,
  })
  // Normalize day/shape onto disk at boot (cheap; avoids stale day keys).
  saveStore(store, STORE.AGENDA, agenda)

  const save = () => {
    state.updatedAt = Date.now()
    saveStore(store, STORE.MOOD, state, { debounce: true })
  }
  const savePolicy = () => saveStore(store, STORE.SOCIAL_POLICY, policy, { debounce: true })
  const saveAgenda = () => saveStore(store, STORE.AGENDA, agenda, { debounce: true })

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
    timeZone,
    regen,
    snapshot: () => {
      regen()
      const now = Date.now()
      const day = dayKey(now, timeZone)
      const echo = state.echoMood || DEFAULT_STATE.echoMood
      const tagged = Array.isArray(echo.taggedDays) ? echo.taggedDays : []
      const yesterday = dayKey(now - 24 * 3600 * 1000, timeZone)
      const multiDay =
        tagged.includes(day) && (tagged.includes(yesterday) || tagged.length >= 2)
      const sameDayReady = echo.day === day && (echo.hitsToday || 0) >= 2
      const echoMoodReady =
        runtime.config.modules.relation?.echoMood !== false &&
        echo.consumedDay !== day &&
        (multiDay || sameDayReady)
      const echoMoodTag = [...(echo.tags || [])].includes('annoyed')
        ? 'annoyed'
        : 'tired'
      return {
        ...state,
        busyUntil: isBusy(state.busyUntil, now) ? state.busyUntil : 0,
        busyHitDay: state.busyHitDay || '',
        echoMoodReady,
        echoMoodTag,
        lastwordHint: lastwordOn && lastword.text ? String(lastword.text).slice(0, 24) : '',
      }
    },
    markEchoConsumed(now = Date.now()) {
      const day = dayKey(now, timeZone)
      state.echoMood = {
        ...(state.echoMood || DEFAULT_STATE.echoMood),
        consumedDay: day,
      }
      save()
    },
    moodLine() {
      const snap = api.snapshot()
      const stage = runtime.tier?.stage?.() || null
      return formatMoodLine({
        ...snap,
        tierId: stage?.id || '',
        tierLabel: stage?.label || '',
      })
    },
    onOwnerMessage(text, opts = {}) {
      regen()
      const now = Date.now()
      const replyClass = classifyOwnerReply(text, {
        lastProactiveAt: state.lastProactiveAt,
        now,
      })
      if (replyClass.withinWindow && state.lastProactiveMotive) {
        let kind =
          replyClass.kind === 'annoy' ||
          replyClass.kind === 'dismiss' ||
          replyClass.kind === 'engage'
            ? replyClass.kind
            : 'dismiss'
        // Short learn answers (怕冷 / 偏辣) look like dismiss; don't punish learn_owner
        if (opts.pendingLearn && kind === 'dismiss') kind = 'engage'
        policy = applyFeedback(policy, state.lastProactiveMotive, kind)
        savePolicy()
        runtime.stats.proactiveFeedback = kind
        runtime.stats.proactivePolicySamples = policy.samples
        state.lastFeedbackKind = kind
        state.lastFeedbackAt = now
        state.lastProactiveMotive = ''
      }

      state.lastOwnerAt = now
      state.lastOwnerText = String(text || '').trim().slice(0, 80)
      state.asleep = false

      const rel = runtime.config.modules.relation || {}
      if (rel.busyGate !== false) {
        const busySig = parseBusySignal(text, { now })
        if (busySig?.clear) {
          state.busyUntil = 0
        } else if (busySig?.busyUntil) {
          state.busyUntil = busySig.busyUntil
          state.busyHitDay = dayKey(now, timeZone)
        }
      }

      const react = reactToOwnerText(text)
      state.energy = clamp(state.energy + react.energyDelta, 5, 100)
      state.affinity = clamp(state.affinity + react.affinityDelta, 0, 100)
      state.mood = clamp(state.mood + react.moodDelta, 0, 100)
      if (react.fatFish) {
        state.fatFishHits = (state.fatFishHits || 0) + 1
      }
      const feel =
        FEELING_BY_KIND[react.kind] ||
        (react.fatFish ? FEELING_BY_KIND.fatfish : '')
      if (feel) state.lastFeeling = feel
      else if (react.kind === 'normal') state.lastFeeling = ''

      if (rel.echoMood !== false && react.dayTag) {
        const day = dayKey(now, timeZone)
        const prev = state.echoMood || { ...DEFAULT_STATE.echoMood }
        const sameDay = prev.day === day
        const tags = sameDay ? [...(prev.tags || [])] : []
        if (!tags.includes(react.dayTag)) tags.push(react.dayTag)
        const taggedDays = [...(prev.taggedDays || [])]
        if (!taggedDays.includes(day)) taggedDays.push(day)
        state.echoMood = {
          day,
          tags,
          hitsToday: sameDay ? (prev.hitsToday || 0) + 1 : 1,
          taggedDays: taggedDays.slice(-7),
          lastAt: now,
          consumedDay: prev.consumedDay || '',
        }
      }

      if (rel.milestones !== false && runtime.share?.getMilestones) {
        const recentDismiss =
          (state.lastFeedbackKind === 'dismiss' || state.lastFeedbackKind === 'annoy') &&
          now - (Number(state.lastFeedbackAt) || 0) < 24 * 3600 * 1000
        const affinityDrop = Number(react.affinityDelta) < 0 || react.kind === 'dismiss'
        try {
          const cur = normalizeMilestones(runtime.share.getMilestones())
          const unlocked = tryUnlockMilestone(cur, text, {
            now,
            recentDismiss,
            affinityDrop,
          })
          if (unlocked.changed) {
            runtime.share.setMilestones?.(unlocked.state)
            runtime.stats.milestoneUnlocked = unlocked.unlockedId
          }
        } catch {
          /* ignore */
        }
      }

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
    reset() {
      state = mergeDefaults(DEFAULT_STATE, {})
      state.updatedAt = Date.now()
      saveStore(store, STORE.MOOD, state)
      lastword = { text: '', at: 0, count: 0 }
      saveStore(store, STORE.LASTWORD, lastword)
      policy = normalizePolicy(null)
      saveStore(store, STORE.SOCIAL_POLICY, policy)
      agenda = ensureAgenda(null, {
        day: shanghaiDayKey(Date.now(), timeZone),
        dailyMax: Number(mod.proactiveDailyMax) || 3,
      })
      saveStore(store, STORE.AGENDA, agenda)
      return { ok: true }
    },
    getSocialPolicy: () => normalizePolicy(policy),
    getAgenda: () => ({ ...agenda }),
    /** @param {object} next */
    setAgenda(next) {
      agenda = next
      saveAgenda()
    },
    /** Roll calendar day on agenda; persist only when day changes. */
    rollAgendaDay(now = Date.now()) {
      const prevDay = agenda?.day
      agenda = ensureAgenda(agenda, {
        day: shanghaiDayKey(now, timeZone),
        dailyMax: Number(mod.proactiveDailyMax) || policy.dailyMax || 3,
        preferred: agenda.preferred,
      })
      if (prevDay && prevDay !== agenda.day) saveAgenda()
      return agenda
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
      saveStore(store, STORE.LASTWORD, lastword, { debounce: true })
    },
    getLastword: () => ({ ...lastword }),
    /**
     * After a successful proactive send.
     * @param {{ intent: string, motive?: string, line?: string, form?: string }} hit
     * @param {{ used: number }} agendaNext
     */
    commitProactiveSuccess(hit, agendaNext) {
      state.lastProactiveAt = Date.now()
      state.lastProactiveIntent = hit.intent || ''
      state.lastProactiveMotive = hit.motive || hit.intent || ''
      state.lastProactiveLine = hit.line || ''
      state.lastProactiveForm = hit.form || ''
      if (hit.line) state.recentProactive = pushRecent(state.recentProactive, hit.line)
      saveStore(store, STORE.MOOD, { ...state, updatedAt: Date.now() })
      agenda = agendaNext
      saveStore(store, STORE.AGENDA, agenda)
    },
    /** Soft cooldown bump after a failed send (retry sooner than full cooldown). */
    softFailProactive(cooldownMs) {
      state.lastProactiveAt = Date.now() - cooldownMs + 20 * 60 * 1000
      saveStore(store, STORE.MOOD, { ...state, updatedAt: Date.now() })
    },
  }

  runtime.persona = api
  runtime.lastword = {
    record: (t) => api.recordLastword(t),
    get: () => api.getLastword(),
  }

  return () => {}
}

export { DEFAULT_PROACTIVE }
