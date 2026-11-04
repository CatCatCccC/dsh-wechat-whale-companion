/**
 * Daily share / learn counters + pending question.
 */
import { dayKey } from './day-key.js'

/** Pending learn answers expire after this many ms (24h). */
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000

/** Capture owner reply only within this window after ask (90 min). */
export const PENDING_CAPTURE_WINDOW_MS = 90 * 60 * 1000

/**
 * Keep pending across day rolls; drop if missing `at` or older than TTL.
 * @param {object} log
 * @param {number} [now]
 */
export function prunePending(log, now = Date.now()) {
  const pending = log?.pending
  if (!pending || typeof pending !== 'object') {
    return { ...log, pending: null }
  }
  const at = Number(pending.at) || 0
  if (!at || now - at > PENDING_TTL_MS) {
    return { ...log, pending: null }
  }
  return log
}

/**
 * @param {unknown} raw
 * @param {{ day?: string, now?: number }} [opts]
 */
export function ensureShareLog(raw, opts = {}) {
  const day = opts.day || dayKey()
  const now = Number(opts.now) || Date.now()
  const src = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {}
  const carriedPending =
    src.pending && typeof src.pending === 'object'
      ? /** @type {object} */ (src.pending)
      : null

  if (String(src.day) !== day) {
    return prunePending(
      {
        day,
        learnCount: 0,
        shareCount: 0,
        usedIds: [],
        entries: [],
        pending: carriedPending,
      },
      now,
    )
  }
  return prunePending(
    {
      day,
      learnCount: Math.max(0, Math.round(Number(src.learnCount) || 0)),
      shareCount: Math.max(0, Math.round(Number(src.shareCount) || 0)),
      usedIds: Array.isArray(src.usedIds) ? src.usedIds.map(String).slice(-40) : [],
      entries: Array.isArray(src.entries) ? src.entries.slice(0, 40) : [],
      pending: carriedPending,
    },
    now,
  )
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
  'inside_joke',
  'fish_life',
  'mini_theater',
  'share_hot',
  'share_media',
])
