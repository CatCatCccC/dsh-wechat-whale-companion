/**
 * Daily proactive agenda: optional ping cap + preferred motives.
 * dailyMax / maxPings of 0 means unlimited.
 */
import { dayKey } from './day-key.js'

export { dayKey as shanghaiDayKey } from './day-key.js'

/**
 * @param {unknown} raw
 * @param {{ day?: string, dailyMax?: number, preferred?: string[] }} [opts]
 */
export function ensureAgenda(raw, opts = {}) {
  const day = opts.day || dayKey()
  const preferred = Array.isArray(opts.preferred) && opts.preferred.length
    ? opts.preferred.map(String)
    : ['continue_thread', 'promise_soft', 'learn_owner', 'memory_flip', 'miss', 'soft']

  const rawMax = Number(opts.dailyMax)
  // 0 / negative = unlimited; omit / NaN → legacy default 3 only when restoring without config
  const unlimited = Number.isFinite(rawMax) && rawMax <= 0
  const dailyMax = unlimited
    ? 0
    : Number.isFinite(rawMax) && rawMax > 0
      ? Math.max(1, Math.min(99, Math.round(rawMax)))
      : 3

  if (raw && typeof raw === 'object') {
    const src = /** @type {Record<string, unknown>} */ (raw)
    if (String(src.day) === day) {
      const srcMax = Number(src.maxPings)
      const maxPings = unlimited
        ? 0
        : Number.isFinite(srcMax) && srcMax <= 0
          ? 0
          : Math.max(1, Math.min(99, Number.isFinite(srcMax) ? Math.round(srcMax) : dailyMax))
      return {
        day,
        maxPings,
        used: Math.max(0, Math.round(Number(src.used) || 0)),
        preferred: Array.isArray(src.preferred)
          ? src.preferred.map(String)
          : preferred,
      }
    }
  }
  return { day, maxPings: dailyMax, used: 0, preferred }
}

/**
 * Promise_soft always bypasses daily cap. maxPings <= 0 = unlimited.
 * @param {{ used: number, maxPings: number }} agenda
 * @param {string} motiveId
 */
export function agendaAllows(agenda, motiveId) {
  if (motiveId === 'promise_soft') return true
  const max = Number(agenda?.maxPings)
  if (!Number.isFinite(max) || max <= 0) return true
  return (agenda?.used || 0) < max
}

/**
 * @param {{ used: number }} agenda
 */
export function bumpAgendaUsed(agenda) {
  return { ...agenda, used: (agenda.used || 0) + 1 }
}
