/**
 * Detect owner "I'm busy" / clear-busy phrases → busyUntil timestamp.
 */

const BUSY_RE =
  /开会|会议|答辩|赶\s*ddl|ddl|截止日期|先忙|在忙|忙着|有会|开完会再说|晚点聊|回头聊|别吵我/
const CLEAR_RE = /忙完了|开完会了|好了可以聊|可以聊了|忙完啦|开完了/

/**
 * @param {string} text
 * @param {{ now?: number, defaultMs?: number }} [opts]
 * @returns {{ busyUntil?: number, clear?: boolean }|null}
 */
export function parseBusySignal(text, opts = {}) {
  const t = String(text || '').trim()
  if (!t) return null
  const now = Number(opts.now) || Date.now()
  const defaultMs = Number(opts.defaultMs) || 2.5 * 3600 * 1000

  if (CLEAR_RE.test(t)) return { clear: true, busyUntil: 0 }

  if (!BUSY_RE.test(t)) return null

  // 忙到三点 / 忙到3点 / 忙到15点
  const hourHit = t.match(/忙到\s*(\d{1,2})\s*点/)
  if (hourHit) {
    const h = Number(hourHit[1])
    if (Number.isFinite(h) && h >= 0 && h <= 23) {
      const d = new Date(now)
      d.setHours(h, 0, 0, 0)
      let until = d.getTime()
      if (until <= now) until += 24 * 3600 * 1000
      return { busyUntil: until }
    }
  }

  return { busyUntil: now + defaultMs }
}

/**
 * @param {number} busyUntil
 * @param {number} [now]
 */
export function isBusy(busyUntil, now = Date.now()) {
  const until = Number(busyUntil) || 0
  return until > 0 && now < until
}
