/**
 * Rolling chat journal (whale-loli 活人版 style): every WeChat turn leaves a trace.
 * Auto-written by the companion — model does not have to call a tool.
 */

/**
 * @typedef {{ at: number, owner: string, assistant: string, n: number }} JournalTurn
 */

/**
 * @param {JournalTurn[]} turns
 * @param {{ owner: string, assistant: string, at?: number, limit?: number }} draft
 */
export function pushTurn(turns, draft) {
  const list = Array.isArray(turns) ? [...turns] : []
  const owner = String(draft.owner || '').trim().slice(0, 120)
  const assistant = String(draft.assistant || '').trim().slice(0, 160)
  if (!owner && !assistant) return list
  const at = Number(draft.at) || Date.now()
  const n = (list[0]?.n || 0) + 1
  list.unshift({ at, owner, assistant, n })
  const limit = Math.max(5, Math.min(200, Number(draft.limit) || 80))
  while (list.length > limit) list.pop()
  return list
}

/**
 * @param {number} ms
 * @param {string} [timeZone]
 */
function clock(ms, timeZone = 'Asia/Shanghai') {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(ms))
  } catch {
    return ''
  }
}

/**
 * Inject block for system prompt — recent turns only.
 * @param {JournalTurn[]} turns
 * @param {{ maxLines?: number, maxChars?: number, timeZone?: string }} [opts]
 */
export function formatJournalBlock(turns, opts = {}) {
  const maxLines = Math.max(3, Math.min(40, Number(opts.maxLines) || 16))
  const maxChars = Math.max(200, Number(opts.maxChars) || 900)
  const tz = opts.timeZone || 'Asia/Shanghai'
  const slice = (turns || []).slice(0, maxLines)
  if (!slice.length) {
    return '【近期对话】还没有记录。聊起来之后这里会自动滚一条摘要。'
  }
  const lines = ['【近期对话 · 自动滚动】（开口前先扫一眼，别装失忆）']
  for (const t of slice) {
    const hhmm = clock(t.at, tz)
    const id = String(t.n || 0).padStart(4, '0')
    const o = t.owner || '…'
    const a = t.assistant || '…'
    lines.push(`- R${id} [${hhmm}] 主人：${o} ｜ 你：${a}`)
  }
  let body = lines.join('\n')
  if (body.length > maxChars) body = body.slice(0, maxChars - 1) + '…'
  return body
}
