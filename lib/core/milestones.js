/**
 * Relationship milestones: unlock once, later calendar hooks.
 */
import { dayKey } from './day-key.js'

const TECH_BAN = /开会|代码|报错|部署|ddl|会议/
const MAKEUP_RE = /对不起|抱歉|原谅我|和好|别生气/

/**
 * @param {unknown} raw
 */
export function normalizeMilestones(raw) {
  const src = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {}
  const unlockedIn = src.unlocked && typeof src.unlocked === 'object' ? src.unlocked : {}
  /** @type {Record<string, { at: number, text?: string, side?: string }>} */
  const unlocked = {}
  for (const [k, v] of Object.entries(unlockedIn)) {
    if (!v || typeof v !== 'object') continue
    const at = Number(/** @type {any} */ (v).at) || 0
    if (!at) continue
    unlocked[k] = {
      at,
      text: String(/** @type {any} */ (v).text || '').slice(0, 80),
      side: String(/** @type {any} */ (v).side || 'owner'),
    }
  }
  return {
    unlocked,
    usedShareIds: Array.isArray(src.usedShareIds) ? src.usedShareIds.map(String).slice(-40) : [],
  }
}

/**
 * @param {string} text
 */
export function detectGoodnight(text) {
  const t = String(text || '').trim()
  if (!t || [...t].length > 24) return false
  if (TECH_BAN.test(t)) return false
  return /晚安|我睡了|去睡了|先睡了/.test(t) && !/不晚安|不睡/.test(t)
}

/**
 * @param {string} text
 */
export function detectMakeup(text) {
  const t = String(text || '').trim()
  if (!t || [...t].length > 40) return false
  if (TECH_BAN.test(t)) return false
  if (/不想你|不喜欢你|不爱你|不原谅/.test(t)) return false
  return MAKEUP_RE.test(t)
}

/**
 * @param {object} state normalizeMilestones result
 * @param {string} text
 * @param {{ now?: number, recentDismiss?: boolean, affinityDrop?: boolean }} [ctx]
 */
export function tryUnlockMilestone(state, text, ctx = {}) {
  const now = Number(ctx.now) || Date.now()
  const next = normalizeMilestones(state)
  let changed = false
  let unlockedId = ''

  if (!next.unlocked.first_goodnight && detectGoodnight(text)) {
    next.unlocked.first_goodnight = {
      at: now,
      text: String(text).trim().slice(0, 40),
      side: 'owner',
    }
    changed = true
    unlockedId = 'first_goodnight'
  }

  if (
    !next.unlocked.first_makeup &&
    detectMakeup(text) &&
    (ctx.recentDismiss || ctx.affinityDrop)
  ) {
    next.unlocked.first_makeup = {
      at: now,
      text: String(text).trim().slice(0, 40),
      side: 'owner',
    }
    changed = true
    unlockedId = unlockedId || 'first_makeup'
  }

  return { state: next, changed, unlockedId }
}

const LABELS = {
  first_goodnight: '第一次说晚安',
  first_makeup: '第一次和好',
}

/**
 * Hit calendar if unlock age is 7d / 30d / anniversary month-day.
 * @param {object} state
 * @param {number} [ms]
 * @param {{ timeZone?: string, usedIds?: string[] }} [opts]
 */
export function pickMilestoneHook(state, ms = Date.now(), opts = {}) {
  const bag = normalizeMilestones(state)
  const tz = opts.timeZone || 'Asia/Shanghai'
  const used = new Set(opts.usedIds || bag.usedShareIds || [])
  const today = dayKey(ms, tz)
  const md = today.slice(5)

  /** @type {Array<{ id: string, label: string, hook: string, kind: string }>} */
  const hits = []

  for (const [key, info] of Object.entries(bag.unlocked)) {
    const at = Number(info.at) || 0
    if (!at) continue
    const label = LABELS[key] || key
    const unlockDay = dayKey(at, tz)
    const unlockMd = unlockDay.slice(5)
    const ageDays = Math.floor((ms - at) / 86400000)

    const mark = (suffix, hook) => {
      const id = `ms-${key}-${suffix}`
      if (used.has(id)) return
      hits.push({ id, label, hook, kind: 'milestone' })
    }

    if (ageDays === 7) mark('d7', `第一次${label.replace(/^第一次/, '')}满一周了`)
    if (ageDays === 30) mark('d30', `${label}满一个月了`)
    // anniversary of unlock month-day (not same calendar day as unlock)
    if (md === unlockMd && ageDays >= 365) {
      const years = Math.floor(ageDays / 365)
      if (years >= 1) mark(`y${years}`, `${label} ${years} 周年`)
    }
    // also allow exact anniversary when month-day matches and at least 1 year
    if (md === unlockMd && ageDays >= 365 && ageDays % 365 < 2) {
      /* covered above */
    }
  }

  return hits[0] || null
}
