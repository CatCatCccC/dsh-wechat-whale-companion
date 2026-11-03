/**
 * Daily proactive agenda: cap pings and prefer high-signal motives.
 */

/**
 * @param {number} [ms]
 * @param {string} [timeZone]
 */
export function shanghaiDayKey(ms = Date.now(), timeZone = 'Asia/Shanghai') {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(ms))
  } catch {
    return new Date(ms).toISOString().slice(0, 10)
  }
}

/**
 * @param {unknown} raw
 * @param {{ day?: string, dailyMax?: number, preferred?: string[] }} [opts]
 */
export function ensureAgenda(raw, opts = {}) {
  const day = opts.day || shanghaiDayKey()
  const dailyMax = Math.max(1, Math.min(8, Number(opts.dailyMax) || 3))
  const preferred = Array.isArray(opts.preferred) && opts.preferred.length
    ? opts.preferred.map(String)
    : ['continue_thread', 'promise_soft', 'miss', 'soft']
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
