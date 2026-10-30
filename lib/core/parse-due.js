/**
 * Lightweight Chinese reminder time → Unix ms (Asia/Shanghai wall clock).
 */

const TZ = 'Asia/Shanghai'

/**
 * @param {number} ms
 * @param {string} [timeZone]
 */
function zonedParts(ms, timeZone = TZ) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    }).formatToParts(new Date(ms))
    const get = (t) => Number(parts.find((p) => p.type === t)?.value)
    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: get('hour'),
      minute: get('minute'),
    }
  } catch {
    const d = new Date(ms)
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      hour: d.getHours(),
      minute: d.getMinutes(),
    }
  }
}

/**
 * Build UTC ms for a Shanghai wall-clock datetime via iterative offset guess.
 * @param {{ year: number, month: number, day: number, hour: number, minute: number }} wall
 * @param {string} [timeZone]
 */
export function wallClockToUtcMs(wall, timeZone = TZ) {
  // Start from a UTC guess treating wall as UTC+8, then refine.
  let guess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour - 8, wall.minute, 0)
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(guess, timeZone)
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0)
    const want = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0)
    guess += want - asUtc
  }
  return guess
}

/**
 * @param {string} text
 * @param {{ now?: number, timeZone?: string }} [opts]
 * @returns {{ dueAt: number, label: string } | null}
 */
export function parseDueAt(text, opts = {}) {
  const raw = String(text || '').trim()
  if (!raw) return null
  const now = Number.isFinite(opts.now) ? opts.now : Date.now()
  const tz = opts.timeZone || TZ
  const cur = zonedParts(now, tz)

  const half = raw.match(/(\d+)\s*个?半?\s*小时\s*后/) || raw.match(/半\s*小时\s*后/)
  if (half) {
    const n = half[1] ? Number(half[1]) : 0.5
    const hours = Number.isFinite(n) && n > 0 ? n : 0.5
    if (/半/.test(half[0]) && !half[1]) {
      return { dueAt: now + 30 * 60 * 1000, label: '半小时后' }
    }
    return { dueAt: now + hours * 3600 * 1000, label: `${hours}小时后` }
  }
  const mins = raw.match(/(\d+)\s*分钟\s*后/)
  if (mins) {
    const n = Number(mins[1])
    if (Number.isFinite(n) && n > 0) {
      return { dueAt: now + n * 60 * 1000, label: `${n}分钟后` }
    }
  }

  const hm = raw.match(/(\d{1,2})\s*[点:：时]\s*(\d{1,2})?\s*分?/)
  if (!hm) return null
  let hour = Number(hm[1])
  let minute = hm[2] != null && hm[2] !== '' ? Number(hm[2]) : 0
  if (!Number.isFinite(hour) || hour > 23) return null
  if (!Number.isFinite(minute) || minute > 59) minute = 0

  if (/早上|早晨|上午/.test(raw) && hour === 12) hour = 0
  if (/下午|傍晚/.test(raw) && hour < 12) hour += 12
  if (/晚上|今晚|夜里|深夜/.test(raw) && hour < 12) hour += 12
  if (/中午/.test(raw) && hour < 11) hour = 12

  let dayOffset = 0
  if (/后天/.test(raw)) dayOffset = 2
  else if (/明天|明早|明晚/.test(raw)) dayOffset = 1
  else if (/今晚|今天|今日|待会儿|等下/.test(raw)) dayOffset = 0

  // Base day
  const base = new Date(Date.UTC(cur.year, cur.month - 1, cur.day + dayOffset))
  let wall = {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
    hour,
    minute,
  }

  let dueAt = wallClockToUtcMs(wall, tz)
  // If "今天 N点" already passed and no 明天, roll to tomorrow
  if (dayOffset === 0 && dueAt <= now + 60_000 && !/今天|今日|今晚/.test(raw)) {
    // bare "8点喊我" → next occurrence
    wall = { ...wall, day: wall.day + 1 }
    // normalize month overflow via Date.UTC
    const roll = new Date(Date.UTC(wall.year, wall.month - 1, wall.day))
    wall.year = roll.getUTCFullYear()
    wall.month = roll.getUTCMonth() + 1
    wall.day = roll.getUTCDate()
    dueAt = wallClockToUtcMs(wall, tz)
  } else if (dayOffset === 0 && dueAt <= now + 60_000 && /今晚|今天|今日/.test(raw)) {
    // explicitly today but past → still tomorrow as fallback
    const roll = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + 1))
    wall.year = roll.getUTCFullYear()
    wall.month = roll.getUTCMonth() + 1
    wall.day = roll.getUTCDate()
    dueAt = wallClockToUtcMs(wall, tz)
  }

  return {
    dueAt,
    label: `${wall.month}/${wall.day} ${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}`,
  }
}

/** Owner text looks like an alarm / reminder request. */
export function looksLikeAlarm(text) {
  const t = String(text || '')
  return /提醒我|喊我|叫醒|叫我起床|闹钟|到点|定时/.test(t) ||
    (/(\d{1,2})\s*[点:：时]/.test(t) && /(喊|叫|提醒|起床)/.test(t))
}
