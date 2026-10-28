/**
 * Free China-reachable 表情包 search (not generic image search).
 *
 * Providers (no paid key):
 * 1. 澄曜 搜狗表情 — https://api.ruseo.cn/api/sogou_bqb
 * 2. 接口盒子 搜狗表情（公共 id/key，共享限频）— apihzbqbsougou
 * 3. 接口盒子 官方表情库 — apihzbqb
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { ensureDir } from './state.js'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const BLOCK =
  /色情|裸体|裸露|性爱|黄图|成人|av女|porn|nsfw|xxx|nude|hentai|r18/i

const APIHZ_ID = '88888888'
const APIHZ_KEY = '88888888'

/** Already cute / soft — don't double-suffix */
const CUTE_MARK =
  /可爱|软萌|治愈|甜美|萌|卡哇伊|kawaii|猫咪|小猫|兔子|卡通|动漫|小动物|比心|亲亲/i

const CUTE_SUFFIXES = ['可爱', '软萌', '治愈']

/**
 * @param {string} query
 */
export function sanitizeQuery(query) {
  return String(query || '')
    .trim()
    .slice(0, 40)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
}

/**
 * Bias search keywords toward prettier stickers.
 * style: cute|soft|pretty (default bias) | raw|none|meme (no bias)
 * @param {string} query
 * @param {string} [style]
 */
export function applySearchStyle(query, style = 'cute') {
  const q = sanitizeQuery(query)
  if (!q) return q
  const mode = String(style || 'cute').toLowerCase().trim()
  if (!mode || mode === 'raw' || mode === 'none' || mode === 'meme' || mode === 'off') {
    return q
  }
  if (mode === 'cute' || mode === 'soft' || mode === 'pretty' || mode === 'kawaii') {
    if (CUTE_MARK.test(q)) return q
    // Stable pick from query so same keyword always hits same cache key
    let sum = 0
    for (let i = 0; i < q.length; i++) sum += q.charCodeAt(i)
    const suffix = CUTE_SUFFIXES[sum % CUTE_SUFFIXES.length]
    return sanitizeQuery(`${q}${suffix}`)
  }
  return q
}

/**
 * @param {string} query
 */
export function querySlug(query) {
  const q = sanitizeQuery(query)
  const hash = crypto.createHash('sha1').update(q).digest('hex').slice(0, 8)
  const safe = q.replace(/\s+/g, '_').slice(0, 24) || 'img'
  return `${safe}_${hash}`
}

/**
 * @param {unknown} data
 * @returns {string[]}
 */
function extractUrlList(data) {
  const urls = []
  const push = (u) => {
    if (typeof u === 'string' && /^https?:\/\//i.test(u)) urls.push(u)
  }

  if (!data || typeof data !== 'object') return urls
  const root = /** @type {any} */ (data)

  // ruseo: { code:0, data:{ code:200, res:[...] } }
  const nested = root.data && typeof root.data === 'object' ? root.data : null
  const res =
    (Array.isArray(root.res) && root.res) ||
    (nested && Array.isArray(nested.res) && nested.res) ||
    (Array.isArray(root.data) && root.data) ||
    []

  for (const item of res) {
    if (typeof item === 'string') push(item)
    else if (item && typeof item === 'object') {
      push(item.url || item.image_url || item.thumbURL || item.path)
    }
  }
  return [...new Set(urls)]
}

/**
 * @param {string} url
 * @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal, referer?: string }} opts
 */
async function fetchJson(url, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch
  const res = await fetchImpl(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json,*/*',
      Referer: opts.referer || 'https://pic.sogou.com/',
    },
    signal: opts.signal,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('invalid json')
  }
}

/**
 * 搜狗表情（澄曜，无需 key）
 * @param {string} query
 * @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal }} [opts]
 */
export async function searchSogouRuseo(query, opts = {}) {
  const word = sanitizeQuery(query)
  if (!word || BLOCK.test(word)) return []
  const url = `https://api.ruseo.cn/api/sogou_bqb?words=${encodeURIComponent(word)}&page=1`
  const data = await fetchJson(url, opts)
  return extractUrlList(data).slice(0, 12)
}

/**
 * 搜狗表情（接口盒子公共账号）
 * @param {string} query
 * @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal }} [opts]
 */
export async function searchSogouApihz(query, opts = {}) {
  const word = sanitizeQuery(query)
  if (!word || BLOCK.test(word)) return []
  const url =
    `https://cn.apihz.cn/api/img/apihzbqbsougou.php?id=${APIHZ_ID}&key=${APIHZ_KEY}` +
    `&page=1&words=${encodeURIComponent(word)}`
  const data = await fetchJson(url, opts)
  if (Number(data?.code) !== 200) return []
  return extractUrlList(data).slice(0, 12)
}

/**
 * 接口盒子官方表情库
 * @param {string} query
 * @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal }} [opts]
 */
export async function searchApihzLibrary(query, opts = {}) {
  const word = sanitizeQuery(query)
  if (!word || BLOCK.test(word)) return []
  const url =
    `https://cn.apihz.cn/api/img/apihzbqb.php?id=${APIHZ_ID}&key=${APIHZ_KEY}` +
    `&type=2&limit=10&page=1&words=${encodeURIComponent(word)}`
  const data = await fetchJson(url, opts)
  if (Number(data?.code) !== 200) return []
  return extractUrlList(data).slice(0, 12)
}

/**
 * Try meme providers in order.
 * @param {string} query
 * @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal }} [opts]
 * @returns {Promise<{ urls: string[], provider: string }>}
 */
export async function searchMemeUrls(query, opts = {}) {
  const providers = [
    ['sogou-ruseo', searchSogouRuseo],
    ['sogou-apihz', searchSogouApihz],
    ['apihz-library', searchApihzLibrary],
  ]
  let lastErr = ''
  for (const [name, fn] of providers) {
    try {
      const urls = await fn(query, opts)
      if (urls.length) return { urls, provider: name }
    } catch (err) {
      lastErr = String(err?.message || err)
    }
  }
  if (lastErr) throw new Error(lastErr)
  return { urls: [], provider: '' }
}

/** @deprecated use searchMemeUrls — kept for older tests/callers */
export async function searchBaiduImageUrls(query, opts = {}) {
  const { urls } = await searchMemeUrls(query, opts)
  return urls
}

/**
 * @param {Buffer} buf
 */
export function sniffImageExt(buf) {
  if (!buf || buf.length < 12) return ''
  if (buf[0] === 0xff && buf[1] === 0xd8) return '.jpg'
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return '.png'
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return '.gif'
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return '.webp'
  }
  return ''
}

/**
 * @param {string} imageUrl
 * @param {string} destPathNoExt
 * @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal, maxBytes?: number, referer?: string }} [opts]
 */
export async function downloadImage(imageUrl, destPathNoExt, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024
  const res = await fetchImpl(imageUrl, {
    headers: {
      'User-Agent': UA,
      Referer: opts.referer || 'https://pic.sogou.com/',
    },
    signal: opts.signal,
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`download HTTP ${res.status}`)
  const ab = await res.arrayBuffer()
  const buf = Buffer.from(ab)
  if (buf.length > maxBytes) throw new Error('image too large')
  const ext = sniffImageExt(buf)
  if (!ext) throw new Error('unsupported image bytes')
  const finalPath = `${destPathNoExt}${ext}`
  ensureDir(path.dirname(finalPath))
  fs.writeFileSync(finalPath, buf)
  return finalPath
}

/**
 * @param {string} query
 * @param {string} cacheDir
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 */
export async function searchAndCacheImage(query, cacheDir, opts = {}) {
  const q = sanitizeQuery(query)
  if (!q) return { ok: false, error: 'empty query' }
  if (BLOCK.test(q)) return { ok: false, error: 'query blocked' }

  ensureDir(cacheDir)
  const slug = querySlug(q)
  const existing = fs
    .readdirSync(cacheDir)
    .find((f) => f.startsWith(slug + '.') && /\.(png|jpe?g|gif|webp)$/i.test(f))
  if (existing) {
    return { ok: true, path: path.join(cacheDir, existing), query: q, cached: true }
  }

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs || 12000)
  try {
    const { urls, provider } = await searchMemeUrls(q, {
      fetchImpl: opts.fetchImpl,
      signal: ac.signal,
    })
    if (!urls.length) return { ok: false, error: 'no results' }

    let lastErr = 'download failed'
    for (const u of urls.slice(0, 5)) {
      try {
        const dest = path.join(cacheDir, slug)
        const file = await downloadImage(u, dest, {
          fetchImpl: opts.fetchImpl,
          signal: ac.signal,
        })
        return { ok: true, path: file, query: q, cached: false, provider }
      } catch (err) {
        lastErr = String(err?.message || err)
      }
    }
    return { ok: false, error: lastErr }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * @param {string} cacheDir
 * @param {number} maxFiles
 */
export function pruneCache(cacheDir, maxFiles = 80) {
  try {
    const files = fs
      .readdirSync(cacheDir)
      .filter((f) => /\.(png|jpe?g|gif|webp)$/i.test(f))
      .map((f) => {
        const p = path.join(cacheDir, f)
        return { f, p, mtime: fs.statSync(p).mtimeMs }
      })
      .sort((a, b) => b.mtime - a.mtime)
    for (const row of files.slice(Math.max(0, maxFiles))) {
      try {
        fs.unlinkSync(row.p)
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}
