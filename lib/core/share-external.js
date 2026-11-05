/**
 * Optional external share sources (ACG / music / hot). Default off.
 */

const HOT_BLOCK =
  /政治|选举|战争|爆炸|遇难|身亡|色情|赌博|彩票|代购|兼职|加微信|习近平|党内/

/**
 * @param {string} title
 */
export function filterHotTitle(title) {
  const t = String(title || '').trim()
  if (t.length < 4 || t.length > 40) return false
  if (HOT_BLOCK.test(t)) return false
  return true
}

/**
 * Fetch a light hot list. Best-effort; failures return empty.
 * Uses a public weibo mobile hotspot mirror pattern when available.
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<{ ok: boolean, items: Array<{ title: string, hook: string }>, error?: string }>}
 */
export async function fetchHotCandidates(opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') return { ok: false, items: [], error: 'no fetch' }

  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer =
    ac &&
    setTimeout(() => ac.abort(), Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 8000)

  try {
    // Official side hotSearch — needs mobile-ish UA + Referer (bare bot UA → 403).
    const url = 'https://weibo.com/ajax/side/hotSearch'
    const res = await fetchImpl(url, {
      signal: ac?.signal,
      headers: {
        'user-agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
        accept: 'application/json',
        referer: 'https://weibo.com/',
      },
    })
    if (!res.ok) return { ok: false, items: [], error: `http ${res.status}` }
    const data = await res.json()
    const list = data?.data?.realtime || data?.data?.hotgov || []
    const items = []
    for (const row of Array.isArray(list) ? list : []) {
      const title = String(row?.word || row?.note || row?.title || '').trim()
      if (!filterHotTitle(title)) continue
      items.push({ title, hook: title.slice(0, 18) })
      if (items.length >= 8) break
    }
    return { ok: true, items }
  } catch (err) {
    return { ok: false, items: [], error: String(err?.message || err) }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Bangumi / ACG-ish daily: use a static-friendly public endpoint if possible.
 * Falls back to empty (fun-bits cover the gap).
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 */
export async function fetchMediaCandidates(opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') return { ok: false, items: [], error: 'no fetch' }

  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer =
    ac &&
    setTimeout(() => ac.abort(), Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 8000)

  try {
    // Bangumi calendar (public)
    const url = 'https://api.bgm.tv/calendar'
    const res = await fetchImpl(url, {
      signal: ac?.signal,
      headers: { 'user-agent': 'whale-companion/0.2', accept: 'application/json' },
    })
    if (!res.ok) return { ok: false, items: [], error: `http ${res.status}` }
    const data = await res.json()
    const today = new Date().getDay() // 0 Sun
    const weekday = today === 0 ? 7 : today
    const block = Array.isArray(data) ? data.find((d) => Number(d?.weekday?.id) === weekday) : null
    const items = []
    for (const item of block?.items || []) {
      const title = String(item?.name_cn || item?.name || '').trim()
      if (title.length < 2) continue
      items.push({ title: title.slice(0, 30), hook: title.slice(0, 16) })
      if (items.length >= 5) break
    }
    return { ok: Boolean(items.length), items }
  } catch (err) {
    return { ok: false, items: [], error: String(err?.message || err) }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
