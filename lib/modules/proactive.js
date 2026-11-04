/**
 * Proactive ping: social motive engine + gates + optional sticker form.
 * Line pools kept only as emergency fallback (draft module owns real copy).
 */

import { agendaAllows } from '../core/proactive-agenda.js'
import { pickForm, pickMotive, motiveToSticker } from '../core/proactive-motive.js'
import { fallbackLine, tooSimilar } from '../core/proactive-draft.js'
import { DEFAULT_MOTIVE_WEIGHTS } from '../core/social-policy.js'

export { tooSimilar } from '../core/proactive-draft.js'

/** @typedef {'morning'|'meal'|'hydrate'|'miss'|'soft'|'lazy'|'night'|'generic'|string} ProactiveIntent */

export const DEFAULT_PROACTIVE = {
  chance: 0.28,
  cooldownMin: 22,
  /** Don't ping if owner messaged within this many minutes */
  minOwnerGapMin: 12,
  stickerChance: 0.32,
  tickMs: 5 * 60 * 1000,
  recentLimit: 8,
  /** Require a scored social motive (not clock-care spam) */
  socialEngine: true,
  minMotiveScore: 0.48,
  /** Silence hours that force a miss ping (skip chance dice) */
  forceMissSilentH: 4,
}

const QUIET = { start: 1, end: 8 }
export const DEFAULT_TIME_ZONE = 'Asia/Shanghai'

/**
 * Hour-of-day in a named IANA zone (avoids UTC Docker treating 11:00 CST as 03:00 quiet).
 * @param {number} [ms]
 * @param {string} [timeZone]
 */
export function hourInTimeZone(ms = Date.now(), timeZone = DEFAULT_TIME_ZONE) {
  const tz = String(timeZone || DEFAULT_TIME_ZONE).trim() || DEFAULT_TIME_ZONE
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(new Date(ms))
    const raw = parts.find((p) => p.type === 'hour')?.value
    const h = Number(raw)
    return Number.isFinite(h) ? h : new Date(ms).getHours()
  } catch {
    return new Date(ms).getHours()
  }
}

/** Legacy intent pools — emergency / tests only */
export const INTENT_POOLS = {
  morning: ['早', '起来了吗', '醒了就回我一声', '哼，我也醒了'],
  meal: ['吃饭了吗', '中午了诶', '晚饭吃了没'],
  hydrate: ['喂', '……'],
  miss: [
    '……还在吗',
    '喂，人呢',
    '消失这么久干什么',
    '想你了，就一句',
    '回我一句就行',
    '是不是把我忘了',
  ],
  soft: ['你还好吗', '想你了，就一句', '今天怎么样', '有空就回一下'],
  lazy: ['嗯', '……', '懒得理你，但又有点想', '有点困，还是来了'],
  night: ['在干嘛', '……还没睡？', '夜深了'],
  generic: ['喂', '在干嘛', '路过看一眼'],
}

/** Intent → sticker search keyword (cute style applied later) */
export const INTENT_STICKER = {
  morning: '早安',
  meal: '干饭',
  hydrate: '喝水',
  miss: '想你',
  soft: '比心',
  lazy: '困了',
  night: '晚安',
  generic: '傲娇',
  continue_thread: '疑惑',
  promise_soft: '比心',
}

/**
 * @param {number} h
 */
export function dayPart(h) {
  if (h >= 6 && h < 11) return 'morning'
  if (h >= 11 && h < 14) return 'noon'
  if (h >= 14 && h < 20) return 'evening'
  return 'night'
}

/**
 * @param {number|Date} [when]
 * @param {string} [timeZone]
 */
export function inQuietHours(when = Date.now(), timeZone = DEFAULT_TIME_ZONE) {
  const ms = when instanceof Date ? when.getTime() : Number(when)
  const h = hourInTimeZone(Number.isFinite(ms) ? ms : Date.now(), timeZone)
  return h >= QUIET.start && h < QUIET.end
}

/**
 * Legacy clock/mood intent (tests + socialEngine=false).
 * @param {object} ctx
 */
export function pickIntent(ctx) {
  const h = ctx.hour
  const silentH = (ctx.ownerSilentMs || 0) / 3600000
  const mood = Number(ctx.mood)
  const energy = Number(ctx.energy)
  const affinity = Number(ctx.affinity)
  const tier = ctx.tier || ''
  const random = typeof ctx.random === 'function' ? ctx.random : Math.random

  if (silentH >= 6) return 'miss'
  if (energy < 35 || mood < 40) return 'lazy'
  if ((tier === 'bond' || tier === 'close' || affinity >= 60) && random() < 0.35) {
    return 'soft'
  }
  if (h >= 6 && h < 10) return 'morning'
  if ((h >= 11 && h < 13) || (h >= 17 && h < 19)) return 'meal'
  if (h >= 14 && h < 17) return 'hydrate'
  if (h >= 22 || h < QUIET.start) return 'night'
  return 'generic'
}

/**
 * Silence stretches → higher fire chance (capped).
 * @param {number} baseChance
 * @param {number} ownerSilentMs
 */
export function effectiveChance(baseChance, ownerSilentMs) {
  const base = Number.isFinite(baseChance) ? baseChance : DEFAULT_PROACTIVE.chance
  const silentH = (ownerSilentMs || 0) / 3600000
  let mult = 1
  if (silentH >= 24) mult = 1.85
  else if (silentH >= 8) mult = 1.55
  else if (silentH >= 3) mult = 1.3
  else if (silentH < 1) mult = 0.75
  return Math.min(0.85, base * mult)
}

/**
 * @param {ProactiveIntent} intent
 * @param {{ recent?: string[], lastword?: string }} [opts]
 */
export function pickLine(intent, opts = {}) {
  const pool = [...(INTENT_POOLS[intent] || INTENT_POOLS.generic)]
  const recent = opts.recent || []
  const last = opts.lastword || ''
  const filtered = pool.filter(
    (l) => !tooSimilar(l, last) && !recent.some((r) => tooSimilar(l, r)),
  )
  const use = filtered.length ? filtered : pool
  return use[Math.floor(Math.random() * use.length)]
}

/**
 * Decide whether this tick should fire + motive/form (sync; LLM draft is separate).
 * @param {object} input
 */
export function planProactiveTick(input) {
  const {
    now = Date.now(),
    asleep,
    energy,
    lastProactiveAt = 0,
    lastOwnerAt = 0,
    mood,
    affinity,
    tier = '',
    lastword = '',
    recent = [],
    activeHours = [],
    chance = DEFAULT_PROACTIVE.chance,
    cooldownMin = DEFAULT_PROACTIVE.cooldownMin,
    minOwnerGapMin = DEFAULT_PROACTIVE.minOwnerGapMin,
    stickerChance = DEFAULT_PROACTIVE.stickerChance,
    cooldownBiasMin = 0,
    hasSendText = true,
    hasOwner = true,
    timeZone = DEFAULT_TIME_ZONE,
    random = Math.random,
    socialEngine = DEFAULT_PROACTIVE.socialEngine,
    minMotiveScore = DEFAULT_PROACTIVE.minMotiveScore,
    world = null,
    policyWeights = null,
    agenda = null,
  } = input

  if (asleep) return { fire: false, reason: 'asleep' }
  if (inQuietHours(now, timeZone)) return { fire: false, reason: 'quiet_hours' }
  if (energy < 20) return { fire: false, reason: 'low_energy' }
  if (!hasSendText) return { fire: false, reason: 'no_sendText' }
  if (!hasOwner) return { fire: false, reason: 'no_owner' }
  if (!lastOwnerAt) return { fire: false, reason: 'never_chatted' }

  const cooldownMs =
    ((Number.isFinite(cooldownMin) ? cooldownMin : 28) +
      (Number.isFinite(cooldownBiasMin) ? cooldownBiasMin : 0)) *
    60 *
    1000
  const gapMs = (Number.isFinite(minOwnerGapMin) ? minOwnerGapMin : 15) * 60 * 1000
  if (now - lastProactiveAt < cooldownMs) return { fire: false, reason: 'cooldown' }
  if (now - lastOwnerAt < gapMs) return { fire: false, reason: 'owner_recent' }

  const hour = hourInTimeZone(now, timeZone)
  const ownerSilentMs = now - lastOwnerAt
  const silentH = ownerSilentMs / 3600000
  const forceMissSilentH = Number.isFinite(input.forceMissSilentH)
    ? input.forceMissSilentH
    : DEFAULT_PROACTIVE.forceMissSilentH

  let p = effectiveChance(chance, ownerSilentMs)
  if (Array.isArray(activeHours) && activeHours.length >= 3 && !activeHours.includes(hour)) {
    p *= 0.35
  }

  // --- Social motive engine (decide WHY before rolling chance) ---
  if (socialEngine !== false) {
    const wstate =
      world ||
      ({
        now,
        hour,
        silentMs: ownerSilentMs,
        silentH,
        mood,
        energy,
        affinity,
        tier,
        lastword,
        recent,
        openThread: '',
        memoryHook: '',
        upcomingPromise: null,
      })
    const { pick, ranked, reason } = pickMotive(
      wstate,
      {
        weights: policyWeights || DEFAULT_MOTIVE_WEIGHTS,
        preferred: agenda?.preferred,
      },
      { random, minScore: minMotiveScore },
    )
    if (!pick) {
      return { fire: false, reason: reason || 'no_motive', chance: p, ranked, social: true }
    }
    if (agenda && !agendaAllows(agenda, pick.id)) {
      return {
        fire: false,
        reason: 'daily_cap',
        motive: pick.id,
        chance: p,
        ranked,
        social: true,
      }
    }

    // Long silence / promise soft-pad: don't lose the ping to a low dice roll
    const force =
      pick.id === 'promise_soft' ||
      (pick.id === 'miss' && silentH >= forceMissSilentH) ||
      (pick.id === 'continue_thread' && silentH >= forceMissSilentH)
    if (!force && random() > p) {
      return {
        fire: false,
        reason: 'chance',
        chance: p,
        motive: pick.id,
        ranked: ranked?.slice?.(0, 5),
        social: true,
      }
    }

    const form = pickForm(pick, stickerChance, random)
    const fb = fallbackLine(pick.id, wstate, { recent, lastword, random })
    return {
      fire: true,
      intent: pick.id,
      motive: pick.id,
      motiveScore: pick.score,
      hook: pick.hook,
      form,
      line: fb.line,
      lineSource: fb.source,
      stickerKeyword:
        form === 'text' ? '' : motiveToSticker(pick.id) || INTENT_STICKER[pick.id] || '傲娇',
      chance: force ? 1 : p,
      forced: Boolean(force),
      ownerSilentMs,
      ranked: ranked?.slice?.(0, 5),
      social: true,
    }
  }

  // --- Legacy clock pools ---
  if (random() > p) return { fire: false, reason: 'chance', chance: p, social: false }
  const intent = pickIntent({
    hour,
    ownerSilentMs,
    mood,
    energy,
    affinity,
    tier,
    random,
  })
  const line = pickLine(intent, { recent, lastword })
  const wantSticker = random() < (Number.isFinite(stickerChance) ? stickerChance : 0.28)

  return {
    fire: true,
    intent,
    motive: intent,
    form: wantSticker ? 'text_then_sticker' : 'text',
    line,
    lineSource: 'pool',
    stickerKeyword: wantSticker ? INTENT_STICKER[intent] || '傲娇' : '',
    chance: p,
    ownerSilentMs,
    social: false,
  }
}

/**
 * Push line into recent ring buffer.
 * @param {string[]} recent
 * @param {string} line
 * @param {number} [limit]
 */
export function pushRecent(recent, line, limit = DEFAULT_PROACTIVE.recentLimit) {
  const next = [...(recent || []), String(line || '').trim()].filter(Boolean)
  return next.slice(-Math.max(3, limit))
}
