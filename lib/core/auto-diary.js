/**
 * Daily diary: read the day's chat → first-person entry (LLM preferred, template fallback).
 */
import { softGet } from './ctx.js'
import { dayKey } from './day-key.js'
import { resolveDshModel } from './proactive-draft.js'

export { dayKey as shanghaiDay } from './day-key.js'

const OWNER_SLEEP_RE =
  /晚安|我睡了|去睡了|先睡了|睡觉了|要睡了|去睡觉|困了去睡|睡了哦|睡啦/
const OWNER_SLEEP_NEG = /不晚安|不睡|别睡|还不睡/

/**
 * Owner said goodnight / going to sleep (for diary trigger).
 * @param {string} text
 */
export function isOwnerSleepText(text) {
  const t = String(text || '').trim()
  if (!t || [...t].length > 40) return false
  if (OWNER_SLEEP_NEG.test(t)) return false
  return OWNER_SLEEP_RE.test(t)
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
 * @param {number} ms
 * @param {string} [timeZone]
 */
export function formatClock(ms, timeZone = 'Asia/Shanghai') {
  const hm = localHm(ms, timeZone)
  return `${String(hm.hour).padStart(2, '0')}:${String(hm.minute).padStart(2, '0')}`
}

/**
 * @param {number} now
 * @param {{
 *   writeAt?: string,
 *   lastWrittenDay?: string,
 *   timeZone?: string,
 *   ignoreClock?: boolean,
 * }} opts
 */
export function shouldWriteDaily(now, opts = {}) {
  const tz = opts.timeZone || 'Asia/Shanghai'
  const day = dayKey(now, tz)
  if (opts.lastWrittenDay === day) return { ok: false, reason: 'done', day }
  if (opts.ignoreClock) return { ok: true, day }
  const writeAt = String(opts.writeAt || '').trim()
  if (!writeAt) return { ok: false, reason: 'no_clock', day }
  const want = parseWriteAt(writeAt)
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
    (t) => dayKey(Number(t?.at) || 0, timeZone) === day,
  )
}

/**
 * Last owner sleep / 晚安 clock that day (HH:MM), or ''.
 * @param {{ at?: number, owner?: string }[]} turns
 * @param {string} [timeZone]
 */
export function detectOwnerSleepAt(turns, timeZone = 'Asia/Shanghai') {
  const chrono = [...(turns || [])].sort(
    (a, b) => (Number(a?.at) || 0) - (Number(b?.at) || 0),
  )
  let at = 0
  for (const t of chrono) {
    const o = String(t?.owner || '').trim()
    if (!o || [...o].length > 40) continue
    if (OWNER_SLEEP_NEG.test(o)) continue
    if (OWNER_SLEEP_RE.test(o)) at = Number(t.at) || at
  }
  return at ? formatClock(at, timeZone) : ''
}

/**
 * Chronological transcript for the model (oldest → newest).
 * @param {{ at?: number, owner?: string, assistant?: string }[]} turns
 * @param {{ timeZone?: string, maxTurns?: number, maxChars?: number }} [opts]
 */
export function formatDayTranscript(turns, opts = {}) {
  const tz = opts.timeZone || 'Asia/Shanghai'
  const maxTurns = Math.max(10, Math.min(80, Number(opts.maxTurns) || 60))
  const maxChars = Math.max(800, Number(opts.maxChars) || 4500)
  const chrono = [...(turns || [])]
    .sort((a, b) => (Number(a?.at) || 0) - (Number(b?.at) || 0))
    .slice(-maxTurns)
  if (!chrono.length) return '（今天几乎没有对话记录）'
  const lines = []
  for (const t of chrono) {
    const hhmm = formatClock(Number(t.at) || 0, tz)
    const o = String(t.owner || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)
    const a = String(t.assistant || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)
    if (o) lines.push(`[${hhmm}] 主人：${o}`)
    if (a) lines.push(`[${hhmm}] 我：${a}`)
  }
  let body = lines.join('\n')
  if (body.length > maxChars) body = `…\n${body.slice(-(maxChars - 2))}`
  return body
}

/** Drop test / tool / meta noise from diary snippets. */
const SNIPPET_BAN =
  /\|\||wx_|token|prompt|部署|报错|代码|systemPrompt|\[\[silent\]\]|作为AI/i

/**
 * @param {string} raw
 * @param {number} [maxLen]
 */
export function cleanDiarySnippet(raw, maxLen = 28) {
  let t = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t || [...t].length < 2) return ''
  if (SNIPPET_BAN.test(t)) return ''
  if (/^(嗯+|哦+|哈+|哈哈+|呵呵|在$|忙$)$/i.test(t)) return ''
  return t.slice(0, maxLen)
}

/**
 * @param {string[]} lines
 * @param {number} limit
 * @param {number} [maxLen]
 */
export function collectDiarySnippets(lines, limit, maxLen = 28) {
  const out = []
  const seen = new Set()
  for (const line of lines || []) {
    const s = cleanDiarySnippet(line, maxLen)
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
    if (out.length >= limit) break
  }
  return out
}

/**
 * Template fallback when LLM unavailable.
 * @param {{
 *   day: string,
 *   turns: { owner?: string, assistant?: string, at?: number }[],
 *   moodWord?: string,
 *   affinityWord?: string,
 *   shareHooks?: string[],
 *   quietDay?: boolean,
 *   busyDay?: boolean,
 *   sleepAt?: string,
 * }} input
 */
export function craftDailyEntry(input) {
  const day = String(input.day || '')
  const turns = Array.isArray(input.turns) ? input.turns : []
  const mood = String(input.moodWord || '').trim()
  const aff = String(input.affinityWord || '').trim()
  const sleepAt = String(input.sleepAt || '').trim()
  const shareHooks = (input.shareHooks || [])
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .slice(0, 6)
  const shareBit = shareHooks.length
    ? `我还主动找主人提过：${shareHooks.join('、')}。`
    : ''
  const heldBack =
    !shareBit && (input.quietDay || input.busyDay) ? '今天忍住没烦主人。' : ''
  const feel = [mood && `心情${mood}`, aff && `跟主人${aff}`].filter(Boolean).join('，')
  const sleepBit = sleepAt ? `主人大约 ${sleepAt} 睡了。` : ''

  if (!turns.length) {
    return (
      `${day}。今天几乎没跟主人说话。` +
      (mood ? `心里${mood}。` : '有点空。') +
      shareBit +
      heldBack +
      sleepBit +
      (shareBit || heldBack || sleepBit ? '' : '希望主人明天还来。')
    ).slice(0, 900)
  }

  const ownerBits = collectDiarySnippets(
    turns.map((t) => String(t?.owner || '')),
    12,
    28,
  )
  const whaleBits = collectDiarySnippets(
    turns.map((t) => String(t?.assistant || '')),
    6,
    24,
  )
  const n = turns.length

  let text = `${day}。今天跟主人聊了大概 ${n} 轮。`
  if (ownerBits.length) text += `主人说过：${ownerBits.join('；')}。`
  else text += '多是短句来回，没留下特别清晰的话。'
  if (whaleBits.length) text += `我也回过：${whaleBits.join('；')}。`
  if (feel) text += `${feel}。`
  text += shareBit
  text += heldBack
  text += sleepBit
  text += '先记到这儿，明天继续黏着主人。'
  return text.slice(0, 900)
}

/**
 * @param {object} input
 * @returns {{ system: string, user: string }}
 */
export function buildDiaryPrompt(input = {}) {
  const day = String(input.day || '')
  const sleepAt = String(input.sleepAt || '').trim()
  const mood = String(input.moodWord || '').trim()
  const aff = String(input.affinityWord || '').trim()
  const shareHooks = (input.shareHooks || [])
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .slice(0, 6)
  const transcript =
    String(input.transcript || '').trim() ||
    formatDayTranscript(input.turns || [], {
      timeZone: input.timeZone || 'Asia/Shanghai',
    })

  const system =
    '你是微信里的陪伴角色「鲸鱼娘/大肥鱼」，用第一人称写今天的日记。' +
    '先通读当天全部对话，再写成真人日记：有重点、有感受，不要流水账罗列原话清单。' +
    '必须称呼对方为「主人」，禁止用「他/她」指代主人。' +
    '尽量覆盖当天主要事情与心情，全面但自然；口语、可略傲娇。' +
    '不要 Markdown、不要列表符号、不要工具名、不要括号动作旁白。' +
    '篇幅大约 120～320 个汉字；只输出日记正文，不要标题或引号。'

  const user = [
    `日期: ${day}`,
    mood ? `此刻心情词: ${mood}` : '',
    aff ? `和主人关系感: ${aff}` : '',
    shareHooks.length ? `我今天主动提过: ${shareHooks.join('、')}` : '',
    sleepAt
      ? `已知：主人大约 ${sleepAt} 说了晚安/去睡——日记里必须写明这个入睡时间。`
      : '若对话里能看出主人何时睡/说晚安，也请写进日记；看不出就别编。',
    '当天对话（按时间）:',
    transcript,
    '现在写出今天的日记正文。',
  ]
    .filter(Boolean)
    .join('\n')

  return { system, user }
}

/**
 * Ensure sleep clock appears if we detected one.
 * @param {string} text
 * @param {string} sleepAt
 */
export function ensureSleepMention(text, sleepAt) {
  const body = String(text || '').trim()
  const clock = String(sleepAt || '').trim()
  if (!body || !clock) return body
  if (body.includes(clock)) return body
  if (/睡了|入睡|说晚安/.test(body) && /\d{1,2}:\d{2}/.test(body)) return body
  return `${body.replace(/[。！？]?$/, '')}。主人大约 ${clock} 睡了。`
}

/**
 * Draft diary via DSH llm; empty string on failure.
 * @param {object} opts
 */
export async function draftDiaryWithLlm(opts = {}) {
  const {
    ctx,
    llm: llmOverride,
    day,
    turns = [],
    timeZone = 'Asia/Shanghai',
    moodWord = '',
    affinityWord = '',
    shareHooks = [],
    sleepAt = '',
    timeoutMs = 20000,
    maxTokens = 420,
    temperature = 0.7,
    provider,
    model,
    reasoningEffort,
    agentId,
  } = opts

  const llm = llmOverride || softGet(ctx, 'llm')
  if (!llm?.stream) throw new Error('ctx.llm unavailable')
  const route = resolveDshModel(ctx, { provider, model, reasoningEffort, agentId })
  if (!route) throw new Error('no provider/model')

  const transcript = formatDayTranscript(turns, { timeZone })
  const { system, user } = buildDiaryPrompt({
    day,
    turns,
    transcript,
    timeZone,
    moodWord,
    affinityWord,
    shareHooks,
    sleepAt,
  })

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer =
    controller &&
    setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 20000)

  try {
    const parts = []
    let finish = null
    const stream = llm.stream({
      provider: route.provider,
      model: route.model,
      ...(route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {}),
      system,
      maxTokens,
      temperature,
      signal: controller?.signal,
      messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
    })
    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta' && chunk.text) parts.push(chunk.text)
      else if (chunk?.type === 'text-delta' && chunk.delta) parts.push(chunk.delta)
      else if (typeof chunk?.text === 'string' && chunk.type !== 'finish') {
        if (chunk.type === 'text' || chunk.kind === 'text') parts.push(chunk.text)
      }
      if (chunk?.type === 'finish') finish = chunk
    }
    if (finish?.kind === 'error' || finish?.kind === 'aborted') {
      throw new Error(`llm ${finish.failure?.code || finish.kind}`)
    }
    let raw = parts
      .join('')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/^["「『]|["」』]$/g, '')
      .trim()
    // Keep first contiguous prose block
    raw = raw
      .split(/\n{2,}/)
      .map((s) => s.trim())
      .filter(Boolean)[0] || raw
    raw = raw.replace(/^#+\s*.+$/m, '').trim()
    if ([...raw].length < 20) throw new Error('diary too short')
    return {
      text: ensureSleepMention(raw.slice(0, 900), sleepAt),
      source: 'dsh-llm',
      route: `${route.provider}/${route.model}`,
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
