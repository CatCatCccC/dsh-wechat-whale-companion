/**
 * Outbound guard: [[silent]], strip asides, drop stage directions / repeats.
 */

const SILENT = /\[\s*\[?\s*silent\s*\]?\s*\]/gi
const ASIDE_LINE = /^\s*[（(].+[）)]\s*$/
const STAGE = /(我在等他回话|我已经发了一句|该命令仅管理员|⏳\s*排队|回合进度|正在思考中…)/
const META_AI = /^(作为\s*AI|我是(一个)?(语言模型|人工智能)|有什么可以帮您)/
const MAX_BUBBLES = 4

/**
 * @param {string} text
 * @returns {{ drop: boolean, text: string, reason?: string }}
 */
export function cleanOutbound(text) {
  if (text == null) return { drop: true, text: '', reason: 'null' }
  const original = String(text)
  const stripSilent = () => original.replace(new RegExp(SILENT.source, 'gi'), '').trim()
  const strippedSilent = stripSilent()
  if (!strippedSilent && new RegExp(SILENT.source, 'i').test(original)) {
    return { drop: true, text: '', reason: 'silent' }
  }
  let s = strippedSilent

  const lines = s.split(/\r?\n/)
  const kept = []
  for (const line of lines) {
    if (ASIDE_LINE.test(line)) continue
    if (STAGE.test(line)) continue
    if (META_AI.test(line.trim())) continue
    kept.push(line)
  }

  // Drop near-duplicate consecutive lines (model repeat)
  const dedup = []
  for (const line of kept) {
    const t = line.trim()
    if (!t) continue
    if (dedup.length && dedup[dedup.length - 1] === t) continue
    dedup.push(t)
  }
  s = dedup.join('\n').trim()

  if (!s) return { drop: true, text: '', reason: 'empty-after-clean' }
  return { drop: false, text: s }
}

/**
 * Split into bubbles; cap count to avoid WeChat spam.
 * @param {string} text
 * @param {{ maxBubbles?: number }} [opts]
 */
export function splitBubbles(text, opts = {}) {
  const max = opts.maxBubbles ?? MAX_BUBBLES
  const cleaned = cleanOutbound(text)
  if (cleaned.drop) return []
  const raw = cleaned.text
  let parts
  if (raw.includes('---wx-next---')) {
    parts = raw
      .split(/\n?\s*---wx-next---\s*\n?/)
      .map((p) => p.trim())
      .filter(Boolean)
  } else if (raw.includes('[[next]]')) {
    parts = raw
      .split(/\[\[next\]\]/i)
      .map((p) => p.trim())
      .filter(Boolean)
  } else {
    // Auto-split only for short oral replies (avoid shredding long task answers)
    const sentenceParts = raw.match(/[^。！？!~…]+[。！？!~…]?/g)
    if (sentenceParts && sentenceParts.length > 1 && raw.length <= 80) {
      parts = sentenceParts.map((p) => p.trim()).filter(Boolean)
    } else {
      parts = [raw]
    }
  }
  if (parts.length <= max) return parts
  // Merge overflow into last bubble
  const head = parts.slice(0, max - 1)
  const tail = parts.slice(max - 1).join('')
  return [...head, tail]
}

/**
 * @param {any} ctx
 * @param {object} runtime
 */
export function applyGuard(ctx, runtime) {
  const { config, stats } = runtime
  if (!config.modules.guard?.enabled) return () => {}

  runtime.guard = {
    cleanOutbound,
    splitBubbles,
    filterSend(text) {
      const r = cleanOutbound(text)
      if (r.drop) {
        stats.guardDropped = (stats.guardDropped || 0) + 1
        stats.lastGuardReason = r.reason
      }
      return r
    },
  }

  const dispose = []
  if (ctx?.on) {
    try {
      const off = ctx.on('wechat/outbound', (ev, next) => {
        const text = ev?.text ?? ev?.content
        const r = cleanOutbound(text)
        if (r.drop) return
        if (ev && typeof ev === 'object') {
          ev.text = r.text
          if ('content' in ev) ev.content = r.text
        }
        return typeof next === 'function' ? next() : undefined
      })
      dispose.push(typeof off === 'function' ? off : () => {})
    } catch {
      /* optional event */
    }
  }

  return () => {
    for (const d of dispose) {
      try {
        d?.()
      } catch {
        /* ignore */
      }
    }
  }
}
