/**
 * Fish-style fading memory (inspired by Yuuyuko-uu/dsh-fish-memory).
 * Events fade by half-life; facts stay fresh. Recall by keyword evidence + freshness + importance.
 */

/**
 * @typedef {'event' | 'fact'} MemoryKind
 * @typedef {{
 *   id: string,
 *   text: string,
 *   at: number,
 *   kind: MemoryKind,
 *   importance: number,
 *   factKey?: string,
 *   tags?: string[],
 *   superseded?: boolean,
 * }} MemoryItem
 */

const STOP = new Set('的了吗呢吧啊哦嗯是我你他她在有和就都也与及或'.split(''))

/** Simple CJK bigrams + latin tokens (no jieba). */
export function tokenize(text) {
  const s = String(text || '').toLowerCase()
  const out = new Set()
  for (const m of s.match(/[a-z0-9_]{3,}/g) || []) out.add(m)
  const chars = [...s].filter((ch) => /[\u4e00-\u9fff]/.test(ch))
  for (let i = 0; i < chars.length; i++) {
    const a = chars[i]
    if (!STOP.has(a)) out.add(a)
    if (i + 1 < chars.length) {
      const bi = a + chars[i + 1]
      if (![...bi].every((c) => STOP.has(c))) out.add(bi)
    }
  }
  return [...out]
}

/**
 * Freshness in (0,1]: facts don't fade; events use half-life.
 * @param {MemoryItem} item
 * @param {number} now
 * @param {number} halfLifeDays
 */
export function freshness(item, now = Date.now(), halfLifeDays = 30) {
  if (item.kind === 'fact' || item.superseded) {
    return item.superseded ? 0 : 1
  }
  const ageDays = Math.max(0, (now - (item.at || now)) / 86400000)
  const hl = halfLifeDays > 0 ? halfLifeDays : 30
  return Math.pow(0.5, ageDays / hl)
}

/**
 * @param {string} query
 * @param {MemoryItem} item
 */
export function evidenceHits(query, item) {
  const q = new Set(tokenize(query))
  if (!q.size) return 0
  const hay = new Set([
    ...tokenize(item.text),
    ...tokenize(item.factKey || ''),
    ...(item.tags || []).flatMap((t) => tokenize(t)),
  ])
  let hits = 0
  for (const t of q) {
    if (hay.has(t)) hits += 1
  }
  return hits
}

/** Calendar day key in an IANA zone (for daily quota; avoids UTC Docker off-by-one). */
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

/**
 * @param {string} query
 * @param {MemoryItem[]} items
 * @param {object} [opts]
 */
export function recall(query, items, opts = {}) {
  const now = opts.now || Date.now()
  const halfLifeDays = Number(opts.halfLifeDays) || 30
  const maxInject = Math.max(1, Math.min(20, Number(opts.maxInject) || 6))
  const maxFacts = Math.max(0, Math.min(10, Number(opts.maxFacts) || 3))
  const evidenceMin = Number.isFinite(opts.evidenceMin) ? opts.evidenceMin : 1
  const wFresh = Number(opts.wFresh) ?? 0.35
  const wImp = Number(opts.wImp) ?? 0.35
  const wHit = Number(opts.wHit) ?? 0.3

  const active = (items || []).filter((i) => i && !i.superseded && i.text)

  const facts = active
    .filter((i) => i.kind === 'fact')
    .sort((a, b) => (b.importance || 0) - (a.importance || 0) || b.at - a.at)
    .slice(0, maxFacts)

  const qTokens = tokenize(query)
  // No usable tokens (empty / only stopwords): inject facts only — don't dump random events.
  if (!qTokens.length) {
    return { facts, events: [], scored: [] }
  }

  const factIds = new Set(facts.map((f) => f.id))
  const scored = []
  for (const item of active) {
    if (factIds.has(item.id)) continue
    if (item.kind === 'fact') continue
    const hits = evidenceHits(query, item)
    if (hits < evidenceMin) continue
    const fr = freshness(item, now, halfLifeDays)
    const imp = Math.min(1, Math.max(0, Number(item.importance) || 0.5))
    const hitScore = Math.min(1, hits / 3)
    const score = wFresh * fr + wImp * imp + wHit * hitScore
    scored.push({ item, score, fr, hits })
  }
  scored.sort((a, b) => b.score - a.score || b.item.at - a.item.at)

  const eventSlots = Math.max(0, maxInject - facts.length)
  const events = scored.slice(0, eventSlots).map((s) => s.item)
  return { facts, events, scored: scored.slice(0, 12) }
}

/**
 * @param {number} at
 * @param {number} now
 */
export function formatWhen(at, now = Date.now()) {
  const d = new Date(at)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const thisYear = new Date(now).getFullYear()
  if (y === thisYear) return `${m}-${day}`
  if (y === thisYear - 1) return `去年 ${m}-${day}`
  return `${y}-${m}-${day}`
}

/**
 * @param {{ facts: MemoryItem[], events: MemoryItem[] }} picked
 * @param {object} [opts]
 */
export function formatInjectBlock(picked, opts = {}) {
  const now = opts.now || Date.now()
  const maxChars = Number(opts.maxChars) || 800
  const lines = []
  for (const f of picked.facts || []) {
    lines.push(`- [长期 ${formatWhen(f.at, now)}] ${f.text}`)
  }
  for (const e of picked.events || []) {
    lines.push(`- [${formatWhen(e.at, now)}] ${e.text}`)
  }
  if (!lines.length) return ''
  let body = lines.join('\n')
  if (body.length > maxChars) {
    body = body.slice(0, maxChars - 1) + '…'
  }
  return `【记忆 · 会淡忘；长期事实常在】\n${body}`
}

/**
 * @param {MemoryItem[]} items
 * @param {Partial<MemoryItem> & { text: string }} draft
 * @param {object} [opts]
 */
export function remember(items, draft, opts = {}) {
  const now = opts.now || Date.now()
  const dailyQuota = Math.max(1, Number(opts.dailyQuota) || 8)
  const timeZone = opts.timeZone || 'Asia/Shanghai'
  const list = Array.isArray(items) ? [...items] : []

  const today = dayKey(now, timeZone)
  const addedToday = list.filter(
    (i) => i.kind !== 'fact' && !i.superseded && dayKey(i.at, timeZone) === today,
  ).length

  const kind = draft.kind === 'fact' ? 'fact' : 'event'
  if (kind === 'event' && addedToday >= dailyQuota) {
    return { ok: false, error: `daily quota ${dailyQuota}`, items: list }
  }

  const text = String(draft.text || '').trim().slice(0, 280)
  if (!text) return { ok: false, error: 'text required', items: list }

  const factKey =
    typeof draft.factKey === 'string' && draft.factKey.trim()
      ? draft.factKey.trim().slice(0, 80)
      : undefined

  if (factKey) {
    for (const it of list) {
      if (it.factKey === factKey && !it.superseded) it.superseded = true
    }
  }

  const item = {
    id: `m_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    text,
    at: now,
    kind,
    importance: Math.min(1, Math.max(0, Number(draft.importance) || (kind === 'fact' ? 0.8 : 0.55))),
    factKey,
    tags: Array.isArray(draft.tags) ? draft.tags.map(String).slice(0, 8) : [],
  }
  list.unshift(item)
  // soft cap store size
  const maxStore = Number(opts.maxStore) || 400
  while (list.length > maxStore) list.pop()

  return { ok: true, item, items: list }
}

export function countActive(items) {
  return (items || []).filter((i) => i && !i.superseded).length
}
