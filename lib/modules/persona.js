/**
 * Mood / energy / affinity + sleep + lastword + proactive pings.
 */
import { mergeDefaults } from '../core/state.js'
import {
  bumpAgendaUsed,
  ensureAgenda,
  shanghaiDayKey,
} from '../core/proactive-agenda.js'
import { draftProactiveLine } from '../core/proactive-draft.js'
import { worldFromRuntime } from '../core/proactive-world.js'
import {
  applyFeedback,
  classifyOwnerReply,
  normalizePolicy,
} from '../core/social-policy.js'
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
  lastProactiveMotive: '',
  lastProactiveLine: '',
  lastProactiveForm: '',
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
  let policy = normalizePolicy(store.get('social-policy.json', null))
  let agenda = ensureAgenda(store.get('proactive-agenda.json', null), {
    day: shanghaiDayKey(Date.now(), mod.timeZone || DEFAULT_TIME_ZONE),
    dailyMax: Number(mod.proactiveDailyMax) || policy.dailyMax || 3,
  })

  const timeZone =
    typeof mod.timeZone === 'string' && mod.timeZone.trim()
      ? mod.timeZone.trim()
      : DEFAULT_TIME_ZONE

  const save = () => {
    state.updatedAt = Date.now()
    store.setDebounced('mood-state.json', state)
  }
  const savePolicy = () => store.setDebounced('social-policy.json', policy)
  const saveAgenda = () => store.setDebounced('proactive-agenda.json', agenda)

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
      const now = Date.now()
      const replyClass = classifyOwnerReply(text, {
        lastProactiveAt: state.lastProactiveAt,
        now,
      })
      if (replyClass.withinWindow && state.lastProactiveMotive) {
        const kind =
          replyClass.kind === 'annoy' ||
          replyClass.kind === 'dismiss' ||
          replyClass.kind === 'engage'
            ? replyClass.kind
            : 'dismiss'
        policy = applyFeedback(policy, state.lastProactiveMotive, kind)
        savePolicy()
        runtime.stats.proactiveFeedback = kind
        runtime.stats.proactivePolicySamples = policy.samples
        // One feedback per ping
        state.lastProactiveMotive = ''
      }

      state.lastOwnerAt = now
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
      policy = normalizePolicy(null)
      store.set('social-policy.json', policy)
      agenda = ensureAgenda(null, {
        day: shanghaiDayKey(Date.now(), timeZone),
        dailyMax: Number(mod.proactiveDailyMax) || 3,
      })
      store.set('proactive-agenda.json', agenda)
      return { ok: true }
    },
    getSocialPolicy: () => normalizePolicy(policy),
    getAgenda: () => ({ ...agenda }),
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
  const socialEngine = mod.proactiveSocialEngine !== false
  const llmDraft = mod.proactiveLlmDraft !== false
  const minMotiveScore = Number(mod.proactiveMinMotiveScore)

  const sendSticker = async (keyword, opts) => {
    if (!keyword || !runtime.media?.findSticker || !runtime.media?.sendImage) return false
    try {
      const found = await runtime.media.findSticker(keyword)
      if (found?.ok && found.path) {
        const stickerSent = await runtime.media.sendImage(found.path, opts)
        if (stickerSent?.ok) {
          runtime.stats.proactiveSticker = (runtime.stats.proactiveSticker || 0) + 1
          return true
        }
      }
    } catch (stickerErr) {
      runtime.log?.warn?.(
        '[whale-companion] proactive sticker',
        stickerErr?.message || stickerErr,
      )
    }
    return false
  }

  const sendTextLine = async (line, opts) => {
    if (!line) return { sent: 0, skipped: 'empty' }
    if (typeof runtime.speak === 'function') {
      const sent = await runtime.speak(line, opts)
      if (!(sent?.sent > 0)) {
        throw new Error(sent?.reason || sent?.skipped || 'speak sent 0')
      }
      return sent
    }
    if (runtime.rhythm?.sendPaced) {
      await runtime.rhythm.sendPaced(line, opts)
      api.observeOutbound(line)
      api.recordLastword(line)
      return { sent: 1 }
    }
    await runtime.wechat.sendText(line, opts)
    api.observeOutbound(line)
    api.recordLastword(line)
    return { sent: 1 }
  }

  const timer = setInterval(async () => {
    try {
      regen()
      // Daily diary is independent of sleep / proactive quiet hours.
      try {
        runtime.diary?.tickDaily?.(Date.now())
      } catch (err) {
        runtime.log?.warn?.(
          '[whale-companion] daily diary tick failed',
          err?.message || err,
        )
      }
      if (api.shouldSuppressProactive()) return

      const now = Date.now()
      const dayKey = shanghaiDayKey(now, timeZone)
      const prevDay = agenda?.day
      agenda = ensureAgenda(agenda, {
        day: dayKey,
        dailyMax: Number(mod.proactiveDailyMax) || policy.dailyMax || 3,
        preferred: agenda.preferred,
      })
      // Only persist when the calendar day rolls — avoid debounce stomping used=N
      if (prevDay && prevDay !== agenda.day) saveAgenda()

      const to = runtime.owner?.id || ''
      const snap = api.snapshot()
      const world = worldFromRuntime(runtime, snap, {
        now,
        hour: hourInTimeZone(now, timeZone),
        lastword: lastword.text || '',
        recent: state.recentProactive || [],
      })

      const plan = planProactiveTick({
        now,
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
        cooldownBiasMin: policy.cooldownBiasMin || 0,
        hasSendText: Boolean(runtime.wechat?.sendText),
        hasOwner: Boolean(to),
        timeZone,
        socialEngine,
        minMotiveScore: Number.isFinite(minMotiveScore)
          ? minMotiveScore
          : DEFAULT_PROACTIVE.minMotiveScore,
        world,
        policyWeights: policy.weights,
        agenda,
      })

      runtime.stats.proactiveTimeZone = timeZone
      runtime.stats.proactiveLastSkip = plan.fire ? '' : plan.reason || ''
      runtime.stats.proactiveLastSkipMotive = plan.motive || ''
      runtime.stats.proactiveSocial = plan.social !== false
      runtime.stats.proactiveForced = Boolean(plan.forced)
      if (!plan.fire) return

      try {
        runtime.wechatSessions?.refresh?.()
        const bound = runtime.wechatSessions?.list?.()?.[0]
        const opts = {
          to,
          proactive: true,
          agentId: bound?.sessionId || undefined,
        }

        let line = plan.line
        let lineSource = plan.lineSource || 'template'
        let stickerKeyword = plan.stickerKeyword || ''
        let critic = ''

        if (plan.form !== 'sticker_only') {
          const drafted = await draftProactiveLine({
            motiveId: plan.motive || plan.intent,
            world,
            recent: state.recentProactive || [],
            lastword: lastword.text || '',
            ctx: runtime.ctx,
            enabledLlm: llmDraft,
            provider: mod.proactiveDraftProvider || undefined,
            model: mod.proactiveDraftModel || undefined,
            agentId: bound?.sessionId,
            timeoutMs: Number(mod.proactiveDraftTimeoutMs) || 12000,
          })
          line = drafted.line || line
          lineSource = drafted.source || lineSource
          critic = drafted.critic || ''
          if (drafted.stickerKeyword && plan.form !== 'text') {
            stickerKeyword = drafted.stickerKeyword
          }
          if (drafted.route) runtime.stats.proactiveDraftRoute = drafted.route
          if (drafted.error) {
            runtime.stats.proactiveDraftError = drafted.error
          }
        }

        const form = plan.form || 'text'
        if (form === 'sticker_only') {
          const ok = await sendSticker(stickerKeyword || '傲娇', opts)
          if (!ok) {
            await sendTextLine(line || '喂', opts)
          }
        } else if (form === 'sticker_then_text') {
          await sendSticker(stickerKeyword, opts)
          await sendTextLine(line, opts)
        } else {
          await sendTextLine(line, opts)
          if (form === 'text_then_sticker' && stickerKeyword) {
            await sendSticker(stickerKeyword, opts)
          }
        }

        // Commit cooldown / recent only after a successful send (flush now)
        state.lastProactiveAt = Date.now()
        state.lastProactiveIntent = plan.intent
        state.lastProactiveMotive = plan.motive || plan.intent
        state.lastProactiveLine = line || ''
        state.lastProactiveForm = form
        if (line) state.recentProactive = pushRecent(state.recentProactive, line)
        store.set('mood-state.json', { ...state, updatedAt: Date.now() })

        agenda = bumpAgendaUsed(agenda)
        store.set('proactive-agenda.json', agenda)

        runtime.stats.proactiveSent = (runtime.stats.proactiveSent || 0) + 1
        runtime.stats.proactiveIntent = plan.intent
        runtime.stats.proactiveMotive = plan.motive || plan.intent
        runtime.stats.proactiveMotiveScore = plan.motiveScore || 0
        runtime.stats.proactiveHook = plan.hook || ''
        runtime.stats.proactiveForm = form
        runtime.stats.proactiveLineSource = lineSource
        runtime.stats.proactiveCritic = critic
        runtime.stats.proactiveAgendaUsed = agenda.used
        runtime.stats.proactiveFailReason = ''
        runtime.log?.info?.(
          `[whale-companion] proactive sent motive=${plan.motive || plan.intent} line=${String(line || '').slice(0, 40)}`,
        )
      } catch (err) {
        // Soft retry — do not keep a false "sent" line if we never committed success
        state.lastProactiveAt = Date.now() - cooldownMs + 20 * 60 * 1000
        store.set('mood-state.json', { ...state, updatedAt: Date.now() })
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
