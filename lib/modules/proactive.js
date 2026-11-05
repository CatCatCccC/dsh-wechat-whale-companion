/**
 * Proactive ping: social motive engine + gates + optional sticker form.
 * Line text is drafted by LLM in proactive-engine; this module decides WHEN.
 */

import { agendaAllows } from '../core/proactive-agenda.js'
import { pickForm, pickMotive, motiveToSticker } from '../core/proactive-motive.js'
import { tooSimilar } from '../core/proactive-draft.js'
import { weekdayInZone } from '../core/share-calendar.js'
import { DEFAULT_MOTIVE_WEIGHTS } from '../core/social-policy.js'

export { tooSimilar } from '../core/proactive-draft.js'
export { motiveToSticker }

/** @typedef {string} ProactiveIntent */

export const DEFAULT_PROACTIVE = {
  chance: 0.28,
  cooldownMin: 22,
  /** Don't ping if owner messaged within this many minutes */
  minOwnerGapMin: 12,
  stickerChance: 0.32,
  tickMs: 5 * 60 * 1000,
  recentLimit: 8,
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
 * Decide whether this tick should fire + motive/form (sync; LLM draft is separate).
 * Always uses the social motive engine (legacy clock pools removed).
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

  const part = dayPart(hour)
  const weekday = weekdayInZone(now, timeZone)
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
  wstate.dayPart = wstate.dayPart || part
  wstate.weekday = wstate.weekday || weekday
  wstate.busyNow =
    wstate.busyNow ||
    (Number(wstate.busyUntil) > 0 && now < Number(wstate.busyUntil))

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

  // Long silence / promise soft-pad / once-a-day learn: don't lose to low dice
  // busy: never force miss
  const force =
    pick.id === 'promise_soft' ||
    pick.id === 'learn_owner' ||
    (!wstate.busyNow && pick.id === 'miss' && silentH >= forceMissSilentH) ||
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

  const blankForm = input.blankForm !== false
  const form = pickForm(pick, stickerChance, random, { blankForm })
  return {
    fire: true,
    intent: pick.id,
    motive: pick.id,
    motiveScore: pick.score,
    hook: pick.hook,
    form,
    line: '',
    lineSource: 'pending_llm',
    stickerKeyword: form === 'text' || form === 'half_sentence' ? '' : motiveToSticker(pick.id),
    chance: force ? 1 : p,
    forced: Boolean(force),
    ownerSilentMs,
    ranked: ranked?.slice?.(0, 5),
    social: true,
    dayPart: part,
    weekday,
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
