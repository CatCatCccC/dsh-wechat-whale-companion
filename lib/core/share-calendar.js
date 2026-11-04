/**
 * Calendar hooks: weekends, solar terms (approx), optional anniversaries.
 */
import { dayKey } from './day-key.js'

/** Approximate solar-term dates (month-day) for Asia/Shanghai vibe; good enough for chat. */
const SOLAR_TERMS = [
  ['01-05', '小寒'],
  ['01-20', '大寒'],
  ['02-03', '立春'],
  ['02-18', '雨水'],
  ['03-05', '惊蛰'],
  ['03-20', '春分'],
  ['04-04', '清明'],
  ['04-20', '谷雨'],
  ['05-05', '立夏'],
  ['05-21', '小满'],
  ['06-05', '芒种'],
  ['06-21', '夏至'],
  ['07-07', '小暑'],
  ['07-22', '大暑'],
  ['08-07', '立秋'],
  ['08-23', '处暑'],
  ['09-07', '白露'],
  ['09-23', '秋分'],
  ['10-08', '寒露'],
  ['10-23', '霜降'],
  ['11-07', '立冬'],
  ['11-22', '小雪'],
  ['12-07', '大雪'],
  ['12-21', '冬至'],
]

/**
 * @param {number} [ms]
 * @param {string} [timeZone]
 */
export function weekdayInZone(ms = Date.now(), timeZone = 'Asia/Shanghai') {
  try {
    const w = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(new Date(ms))
    return w
  } catch {
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(ms).getDay()]
  }
}

/**
 * @param {number} [ms]
 * @param {string} [timeZone]
 */
export function monthDayInZone(ms = Date.now(), timeZone = 'Asia/Shanghai') {
  const key = dayKey(ms, timeZone)
  return key.slice(5)
}

/**
 * @param {number} [ms]
 * @param {{ timeZone?: string, anniversaries?: Array<{ monthDay: string, label: string }> }} [opts]
 * @returns {{ id: string, label: string, hook: string }|null}
 */
export function pickCalendarHook(ms = Date.now(), opts = {}) {
  const tz = opts.timeZone || 'Asia/Shanghai'
  const md = monthDayInZone(ms, tz)
  const day = dayKey(ms, tz)
  const ann = Array.isArray(opts.anniversaries) ? opts.anniversaries : []

  for (const a of ann) {
    const want = String(a.monthDay || '').trim()
    if (want && want === md) {
      const label = String(a.label || '纪念日').slice(0, 24)
      return {
        id: `anniv-${want}`,
        label,
        hook: label,
      }
    }
  }

  for (const [termMd, name] of SOLAR_TERMS) {
    if (termMd === md) {
      return {
        id: `term-${termMd}`,
        label: name,
        hook: `今天${name}`,
      }
    }
  }

  const wd = weekdayInZone(ms, tz)
  if (wd === 'Sat') {
    return { id: `weekend-sat-${day}`, label: '周六', hook: '周六了' }
  }
  if (wd === 'Sun') {
    return { id: `weekend-sun-${day}`, label: '周日', hook: '周日了' }
  }
  if (wd === 'Fri') {
    return { id: `weekend-fri-${day}`, label: '周五', hook: '周五晚上' }
  }

  return null
}
