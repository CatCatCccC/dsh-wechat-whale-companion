/**
 * Calendar day key in an IANA zone (avoids UTC Docker off-by-one).
 * @param {number} [ms]
 * @param {string} [timeZone]
 */
export function dayKey(ms = Date.now(), timeZone = 'Asia/Shanghai') {
  const tz = String(timeZone || 'Asia/Shanghai').trim() || 'Asia/Shanghai'
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(ms))
  } catch {
    return new Date(ms).toISOString().slice(0, 10)
  }
}

/** @deprecated alias — prefer dayKey */
export const shanghaiDayKey = dayKey
/** @deprecated alias — prefer dayKey */
export const shanghaiDay = dayKey
