/**
 * Daily diary: one first-person entry per calendar day at a fixed local time.
 */

/**
 * @param {number} ms
 * @param {string} [timeZone]
 */
export function shanghaiDay(ms, timeZone = 'Asia/Shanghai') {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(ms))
  } catch {
    return new Date(ms).toISOString().slice(0, 10)
  }
}

/**
 * @param {string} writeAt  "HH:MM" or "H:MM"
 * @returns {{ hour: number, minute: number } | null}
 */
export function parseWriteAt(writeAt) {
  const m = String(writeAt || '22:00')
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return { hour: 22, minute: 0 }
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return { hour: 22, minute: 0 }
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return { hour: 22, minute: 0 }
  return { hour, minute }
}

/**
 * Local HH:MM parts in a zone.
 * @param {number} ms
 * @param {string} [timeZone]
 */
export function localHm(ms, timeZone = 'Asia/Shanghai') {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(ms))
    const hour = Number(parts.find((p) => p.type === 'hour')?.value)
    const minute = Number(parts.find((p) => p.type === 'minute')?.value)
    return {
      hour: Number.isFinite(hour) ? hour : 0,
      minute: Number.isFinite(minute) ? minute : 0,
    }
  } catch {
    const d = new Date(ms)
    return { hour: d.getHours(), minute: d.getMinutes() }
  }
}

/**
 * @param {number} now
 * @param {{ writeAt?: string, lastWrittenDay?: string, timeZone?: string }} opts
 */
export function shouldWriteDaily(now, opts = {}) {
  const tz = opts.timeZone || 'Asia/Shanghai'
  const day = shanghaiDay(now, tz)
  if (opts.lastWrittenDay === day) return { ok: false, reason: 'done', day }
  const want = parseWriteAt(opts.writeAt)
  const hm = localHm(now, tz)
  const past =
    hm.hour > want.hour || (hm.hour === want.hour && hm.minute >= want.minute)
  if (!past) return { ok: false, reason: 'too_early', day }
  return { ok: true, day }
}

/**
 * @param {{ at?: number }[]} turns
 * @param {string} day
 * @param {string} [timeZone]
 */
export function filterTurnsForDay(turns, day, timeZone = 'Asia/Shanghai') {
  return (Array.isArray(turns) ? turns : []).filter(
    (t) => shanghaiDay(Number(t?.at) || 0, timeZone) === day,
  )
}

/**
 * @param {{ day: string, turns: { owner?: string, assistant?: string }[], moodWord?: string, affinityWord?: string }} input
 */
export function craftDailyEntry(input) {
  const day = String(input.day || '')
  const turns = Array.isArray(input.turns) ? input.turns : []
  const mood = String(input.moodWord || '').trim()
  const aff = String(input.affinityWord || '').trim()
  if (!turns.length) {
    return (
      `${day}。今天几乎没跟主人说话。` +
      (mood ? `心里${mood}。` : '有点空。') +
      '希望他明天还来。'
    ).slice(0, 500)
  }
  const snippets = turns
    .slice(0, 5)
    .map((t) => String(t.owner || '').trim().replace(/\s+/g, ' ').slice(0, 24))
    .filter(Boolean)
  const topics = snippets.length ? snippets.join('、') : '杂七杂八'
  const n = turns.length
  const feel = [mood && `心情${mood}`, aff && `跟他${aff}`].filter(Boolean).join('，')
  return (
    `${day}。今天跟主人聊了大概 ${n} 轮，提到：${topics}。` +
    (feel ? `${feel}。` : '') +
    '先记到这儿，明天继续黏着他。'
  ).slice(0, 500)
}
