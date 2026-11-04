/**
 * Daily proactive agenda: cap pings and prefer high-signal motives.
 */
import { dayKey } from './day-key.js'

export { dayKey as shanghaiDayKey } from './day-key.js'

/**
 * @param {unknown} raw
 * @param {{ day?: string, dailyMax?: number, preferred?: string[] }} [opts]
 */
export function ensureAgenda(raw, opts = {}) {
  const day = opts.day || dayKey()
  const dailyMax = Math.max(1, Math.min(8, Number(opts.dailyMax) || 3))
  const preferred = Array.isArray(opts.preferred) && opts.preferred.length
    ? opts.preferred.map(String)
    : ['continue_thread', 'promise_soft', 'learn_owner', 'memory_flip', 'miss', 'soft']
  if (raw && typeof raw === 'object') {
    const src = /** @type {Record<string, unknown>} */ (raw)
    if (String(src.day) === day) {
      return {
        day,
        maxPings: Math.max(1, Math.min(8, Number(src.maxPings) || dailyMax)),
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
 * Promise_soft always bypasses daily cap.
 * @param {{ used: number, maxPings: number }} agenda
 * @param {string} motiveId
 */
export function agendaAllows(agenda, motiveId) {
  if (motiveId === 'promise_soft') return true
  return (agenda?.used || 0) < (agenda?.maxPings || 3)
}

/**
 * @param {{ used: number }} agenda
 */
export function bumpAgendaUsed(agenda) {
  return { ...agenda, used: (agenda.used || 0) + 1 }
}
