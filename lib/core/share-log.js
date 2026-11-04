/**
 * Daily share / learn counters + pending question.
 */
import { dayKey } from './day-key.js'

/**
 * @param {unknown} raw
 * @param {{ day?: string }} [opts]
 */
export function ensureShareLog(raw, opts = {}) {
  const day = opts.day || dayKey()
  const src = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {}
  if (String(src.day) !== day) {
    return {
      day,
      learnCount: 0,
      shareCount: 0,
      usedIds: [],
      entries: [],
      pending: null,
    }
  }
  return {
    day,
    learnCount: Math.max(0, Math.round(Number(src.learnCount) || 0)),
    shareCount: Math.max(0, Math.round(Number(src.shareCount) || 0)),
    usedIds: Array.isArray(src.usedIds) ? src.usedIds.map(String).slice(-40) : [],
    entries: Array.isArray(src.entries) ? src.entries.slice(0, 40) : [],
    pending:
      src.pending && typeof src.pending === 'object'
        ? /** @type {object} */ (src.pending)
        : null,
  }
}

/**
 * @param {object} log
 * @param {{ motive: string, hook?: string, line?: string, id?: string, isLearn?: boolean }} entry
 */
export function recordShareEntry(log, entry) {
  const next = {
    ...log,
    usedIds: [...(log.usedIds || [])],
    entries: [...(log.entries || [])],
  }
  if (entry.id) next.usedIds = [...next.usedIds.filter((x) => x !== entry.id), entry.id].slice(-40)
  next.entries.unshift({
    at: Date.now(),
    motive: entry.motive,
    hook: String(entry.hook || '').slice(0, 80),
    line: String(entry.line || '').slice(0, 120),
    id: entry.id || '',
  })
  next.entries = next.entries.slice(0, 40)
  if (entry.isLearn) next.learnCount = (next.learnCount || 0) + 1
  else next.shareCount = (next.shareCount || 0) + 1
  return next
}

/**
 * Motives that count toward shareDailyMax (not promises / miss).
 */
export const SHARE_MOTIVES = new Set([
  'learn_owner',
  'memory_flip',
  'calendar',
  'weather',
  'fun_bit',
  'share_hot',
  'share_media',
])
