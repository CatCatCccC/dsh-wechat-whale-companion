/**
 * Local dsh-meme-compatible packs: memes/<tag>/ + index.json (caption/keywords).
 * Prefer tagged library over web search for WeChat stickers.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const BUNDLED_PACKS_DIR = path.resolve(__dirname, '../../assets/meme-packs')

/** Fine tags → six mood buckets (aligned with dsh-meme) */
export const TAG_BUCKET = {
  happy: 'happy',
  angry: 'angry',
  sad: 'sad',
  shy: 'shy',
  confused: 'confused',
  daily: 'daily',
  like: 'happy',
  meow: 'happy',
  givemoney: 'happy',
  color: 'happy',
  sigh: 'sad',
  surprised: 'confused',
  see: 'confused',
  sleep: 'daily',
  morning: 'daily',
  work: 'daily',
  cpu: 'daily',
  reply: 'daily',
  fool: 'angry',
  baka: 'angry',
}

/** Chinese / casual words → bucket or search text */
export const QUERY_ALIASES = {
  开心: 'happy',
  高兴: 'happy',
  得意: 'happy',
  好耶: 'happy',
  比心: 'happy',
  爱心: 'happy',
  喜欢: 'happy',
  花痴: 'happy',
  生气: 'angry',
  愤怒: 'angry',
  哼: 'angry',
  傲娇: 'shy',
  嫌弃: 'angry',
  拒绝: 'angry',
  不要: 'angry',
  难过: 'sad',
  委屈: 'sad',
  哭: 'sad',
  抱歉: 'sad',
  对不起: 'sad',
  无语: 'sad',
  叹气: 'sad',
  害羞: 'shy',
  脸红: 'shy',
  偷看: 'shy',
  疑惑: 'confused',
  疑问: 'confused',
  问号: 'confused',
  震惊: 'confused',
  惊吓: 'confused',
  干饭: 'daily',
  吃饭: 'daily',
  困: 'daily',
  困了: 'daily',
  睡觉: 'daily',
  晚安: 'daily',
  早安: 'daily',
  加班: 'daily',
  日常: 'daily',
}

/**
 * @param {string} tag
 */
export function toBucket(tag) {
  const t = String(tag || '')
    .trim()
    .toLowerCase()
  return TAG_BUCKET[t] || (['happy', 'angry', 'sad', 'shy', 'confused', 'daily'].includes(t) ? t : '')
}

/**
 * @param {string} dir
 */
function loadPackDir(dir) {
  const id = path.basename(dir)
  let manifest = { id, name: id }
  const manPath = path.join(dir, 'manifest.json')
  try {
    if (fs.existsSync(manPath)) {
      manifest = { ...manifest, ...JSON.parse(fs.readFileSync(manPath, 'utf8')) }
    }
  } catch {
    /* ignore */
  }

  /** @type {Array<{ path: string, absPath: string, tag: string, bucket: string, fileName: string, caption: string, keywords: string, packId: string, packName: string }>} */
  let memes = []

  const indexPath = path.join(dir, 'index.json')
  if (fs.existsSync(indexPath)) {
    try {
      const idx = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
      const list = Array.isArray(idx.memes) ? idx.memes : []
      for (const m of list) {
        const rel = String(m.path || '').replace(/\\/g, '/')
        if (!rel) continue
        const abs = path.join(dir, rel)
        if (!fs.existsSync(abs)) continue
        const tag = String(m.tag || 'daily')
        memes.push({
          path: rel,
          absPath: abs,
          tag,
          bucket: toBucket(tag) || 'daily',
          fileName: m.fileName || path.basename(rel),
          caption: String(m.caption || ''),
          keywords: String(m.keywords || ''),
          packId: id,
          packName: manifest.name || id,
        })
      }
    } catch {
      memes = []
    }
  }

  // Fallback: scan memes/<tag>/*
  if (!memes.length) {
    const memesRoot = path.join(dir, 'memes')
    if (fs.existsSync(memesRoot)) {
      for (const tag of fs.readdirSync(memesRoot)) {
        const tagDir = path.join(memesRoot, tag)
        if (!fs.statSync(tagDir).isDirectory()) continue
        for (const f of fs.readdirSync(tagDir)) {
          if (!/\.(png|jpe?g|gif|webp)$/i.test(f)) continue
          const rel = path.join('memes', tag, f).replace(/\\/g, '/')
          const abs = path.join(dir, rel)
          const stem = f.replace(/\.[^.]+$/, '')
          memes.push({
            path: rel,
            absPath: abs,
            tag,
            bucket: toBucket(tag) || 'daily',
            fileName: f,
            caption: stem,
            keywords: `${stem} ${tag}`,
            packId: id,
            packName: manifest.name || id,
          })
        }
      }
    }
  }

  return {
    id,
    name: manifest.name || id,
    description: manifest.description || '',
    license: manifest.license || '',
    dir,
    memes,
  }
}

/**
 * @param {string[]} roots
 */
export function loadMemeCatalog(roots = [BUNDLED_PACKS_DIR]) {
  /** @type {ReturnType<typeof loadPackDir>[]} */
  const packs = []
  for (const root of roots) {
    const resolved = path.resolve(root)
    if (!fs.existsSync(resolved)) continue
    for (const name of fs.readdirSync(resolved)) {
      const dir = path.join(resolved, name)
      try {
        if (!fs.statSync(dir).isDirectory()) continue
        if (!fs.existsSync(path.join(dir, 'memes')) && !fs.existsSync(path.join(dir, 'index.json'))) {
          continue
        }
        const pack = loadPackDir(dir)
        if (pack.memes.length) packs.push(pack)
      } catch {
        /* skip */
      }
    }
  }
  const all = packs.flatMap((p) => p.memes)
  return { packs, memes: all, count: all.length }
}

/**
 * Score one meme against a query string.
 * @param {object} meme
 * @param {string} query
 */
export function scoreMeme(meme, query) {
  const q = String(query || '')
    .trim()
    .toLowerCase()
  if (!q) return 0
  const alias = QUERY_ALIASES[query.trim()] || QUERY_ALIASES[q]
  const bucketWant = alias && toBucket(alias) ? toBucket(alias) : toBucket(q)
  let score = 0
  if (bucketWant && meme.bucket === bucketWant) score += 50
  if (meme.tag.toLowerCase() === q || meme.tag === alias) score += 40
  const hay = `${meme.caption} ${meme.keywords} ${meme.fileName} ${meme.tag}`.toLowerCase()
  if (hay.includes(q)) score += 30
  // CJK bigrams / token overlap
  const tokens = q.split(/[\s,，、]+/).filter(Boolean)
  for (const t of tokens) {
    if (t.length >= 1 && hay.includes(t.toLowerCase())) score += 8
  }
  if (meme.fileName.replace(/\.[^.]+$/, '').toLowerCase() === q) score += 60
  return score
}

/**
 * @param {object} catalog  from loadMemeCatalog
 * @param {{ tag?: string, query?: string, random?: () => number }} opts
 */
export function findMeme(catalog, opts = {}) {
  const memes = catalog?.memes || []
  if (!memes.length) return { ok: false, error: 'no meme packs loaded' }

  const random = typeof opts.random === 'function' ? opts.random : Math.random
  const tagRaw = String(opts.tag || '').trim()
  const queryRaw = String(opts.query || opts.name || '').trim()

  if (tagRaw) {
    const bucket = toBucket(tagRaw) || tagRaw.toLowerCase()
    const pool = memes.filter((m) => m.bucket === bucket || m.tag.toLowerCase() === tagRaw.toLowerCase())
    if (!pool.length) {
      return {
        ok: false,
        error: `no meme for tag=${tagRaw}`,
        buckets: summarizeBuckets(memes),
      }
    }
    const pick = pool[Math.floor(random() * pool.length)]
    return { ok: true, meme: pick, source: 'pack-tag', matched: tagRaw }
  }

  if (!queryRaw) {
    return { ok: false, error: 'tag or query required', buckets: summarizeBuckets(memes) }
  }

  // Exact alias → bucket random
  const aliasBucket = toBucket(QUERY_ALIASES[queryRaw] || '')
  if (aliasBucket) {
    const pool = memes.filter((m) => m.bucket === aliasBucket)
    if (pool.length) {
      const pick = pool[Math.floor(random() * pool.length)]
      return { ok: true, meme: pick, source: 'pack-alias', matched: queryRaw }
    }
  }

  const scored = memes
    .map((m) => ({ m, s: scoreMeme(m, queryRaw) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)

  if (!scored.length) {
    return {
      ok: false,
      error: `no meme match for query=${queryRaw}`,
      buckets: summarizeBuckets(memes),
    }
  }

  // Random among top ties / near-top
  const top = scored[0].s
  const near = scored.filter((x) => x.s >= top - 10)
  const pick = near[Math.floor(random() * near.length)].m
  return { ok: true, meme: pick, source: 'pack-query', matched: queryRaw, score: top }
}

/**
 * @param {object[]} memes
 */
export function summarizeBuckets(memes) {
  /** @type {Record<string, number>} */
  const out = {}
  for (const m of memes) {
    out[m.bucket] = (out[m.bucket] || 0) + 1
  }
  return out
}

const BUCKET_ZH = {
  happy: '开心',
  angry: '生气',
  sad: '难过',
  shy: '害羞',
  confused: '疑惑',
  daily: '日常',
}

/**
 * Short inventory line for prompts.
 * @param {object} catalog
 * @param {number} [limit]
 */
export function inventoryLine(catalog, limit = 8) {
  const n = catalog?.count || 0
  if (!n) return ''
  const names = (catalog.packs || []).map((p) => `${p.name}${p.memes.length}`).join('、')
  const buckets = summarizeBuckets(catalog.memes || [])
  const order = ['happy', 'angry', 'sad', 'shy', 'confused', 'daily']
  const parts = order
    .filter((k) => buckets[k])
    .map((k) => `${BUCKET_ZH[k] || k}${buckets[k]}`)
    .slice(0, limit)
  return `【表情库】共${n}张（${names}）；已按情绪分类：${parts.join('、')}。发图用 wx_sticker tag=happy|angry|sad|shy|confused|daily 或中文词（开心/傲娇/干饭）`
}
