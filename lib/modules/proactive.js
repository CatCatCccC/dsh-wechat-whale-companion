/**
 * Proactive ping: intent pick, silence-weighted chance, line pools, optional sticker.
 * Pure helpers + one tick runner used by persona.
 */

/** @typedef {'morning'|'meal'|'hydrate'|'miss'|'soft'|'lazy'|'night'|'generic'} ProactiveIntent */

export const DEFAULT_PROACTIVE = {
  chance: 0.18,
  cooldownMin: 22,
  /** Don't ping if owner messaged within this many minutes */
  minOwnerGapMin: 12,
  stickerChance: 0.28,
  tickMs: 5 * 60 * 1000,
  recentLimit: 8,
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

/** @type {Record<ProactiveIntent, string[]>} */
export const INTENT_POOLS = {
  morning: [
    '早',
    '起来了吗',
    '记得吃早饭',
    '哼，本小姐也醒了',
    '太阳都晒屁股了诶',
    '醒了就回我一声',
  ],
  meal: [
    '吃饭了吗',
    '别光干活，先吃饭',
    '中午了诶',
    '晚饭吃了没',
    '再不吃要饿扁了',
    '本小姐允许你去干饭',
  ],
  hydrate: [
    '记得喝水',
    '坐太久了，起来走走',
    '别一直盯屏幕',
    '伸个懒腰嘛',
  ],
  miss: [
    '……还在吗',
    '喂，人呢',
    '消失这么久干什么',
    '想你了，就一句',
    '回我一句就行',
    '你是不是把本小姐忘了',
    '哼，本小姐才没有在等你',
  ],
  soft: [
    '你还好吗',
    '想你了，就一句',
    '今天怎么样',
    '有空就回一下',
    '……有点想听你说话',
  ],
  lazy: [
    '嗯',
    '……',
    '懒得理你，但又有点想',
    '随便问问，你在不在',
    '本小姐有点困，但还是来了',
  ],
  night: [
    '别熬太晚',
    '在干嘛',
    '……还没睡？',
    '早点休息啦',
    '夜深了，少刷一会',
    '喂，该睡了吧',
  ],
  generic: [
    '喂',
    '在干嘛',
    '哼，偶尔关心你一下',
    '今天累不累',
    '下班了吗',
    '本小姐巡视一下',
  ],
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
 * @param {string} candidate
 * @param {string} last
 */
export function tooSimilar(candidate, last) {
  const a = String(candidate || '').trim()
  const b = String(last || '').trim()
  if (!a || !b) return false
  if (a === b) return true
  // Single-char Chinese pings like「喂」should still dedupe
  if (a.length >= 1 && b.includes(a)) return true
  if (b.length >= 1 && a.includes(b)) return true
  return false
}

/**
 * @param {object} ctx
 * @param {number} ctx.hour
 * @param {number} ctx.ownerSilentMs
 * @param {number} ctx.mood
 * @param {number} ctx.energy
 * @param {number} ctx.affinity
 * @param {string} [ctx.tier]
 * @param {() => number} [ctx.random]
 * @returns {ProactiveIntent}
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
 * Decide whether this tick should fire + what to send (no I/O).
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
    hasSendText = true,
    hasOwner = true,
    timeZone = DEFAULT_TIME_ZONE,
    random = Math.random,
  } = input

  if (asleep) return { fire: false, reason: 'asleep' }
  if (inQuietHours(now, timeZone)) return { fire: false, reason: 'quiet_hours' }
  if (energy < 20) return { fire: false, reason: 'low_energy' }
  if (!hasSendText) return { fire: false, reason: 'no_sendText' }
  if (!hasOwner) return { fire: false, reason: 'no_owner' }
  if (!lastOwnerAt) return { fire: false, reason: 'never_chatted' }

  const cooldownMs = (Number.isFinite(cooldownMin) ? cooldownMin : 22) * 60 * 1000
  const gapMs = (Number.isFinite(minOwnerGapMin) ? minOwnerGapMin : 12) * 60 * 1000
  if (now - lastProactiveAt < cooldownMs) return { fire: false, reason: 'cooldown' }
  if (now - lastOwnerAt < gapMs) return { fire: false, reason: 'owner_recent' }

  const hour = hourInTimeZone(now, timeZone)
  if (Array.isArray(activeHours) && activeHours.length >= 3 && !activeHours.includes(hour)) {
    return { fire: false, reason: 'circadian' }
  }

  const ownerSilentMs = now - lastOwnerAt
  const p = effectiveChance(chance, ownerSilentMs)
  if (random() > p) return { fire: false, reason: 'chance', chance: p }

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
    line,
    stickerKeyword: wantSticker ? INTENT_STICKER[intent] || '傲娇' : '',
    chance: p,
    ownerSilentMs,
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
