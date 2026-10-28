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
  比心: 'like',
  爱心: 'like',
  喜欢: 'like',
  想你: 'like',
  想念: 'like',
  想我: 'like',
  花痴: 'color',
  生气: 'angry',
  愤怒: 'angry',
  哼: 'angry',
  傲娇: 'shy',
  嫌弃: 'baka',
  拒绝: 'fool',
  不要: 'fool',
  难过: 'sad',
  委屈: 'sad',
  哭: 'sad',
  抱歉: 'sad',
  对不起: 'sad',
  无语: 'sigh',
  叹气: 'sigh',
  害羞: 'shy',
  脸红: 'shy',
  偷看: 'shy',
  疑惑: 'confused',
  疑问: 'confused',
  问号: 'confused',
  震惊: 'surprised',
  惊吓: 'surprised',
  干饭: 'daily',
  吃饭: 'daily',
  喝水: 'happy', // proactive hydrate；库内喝水图在 happy
  喝一口: 'happy',
  困: 'sleep',
  困了: 'sleep',
  睡觉: 'sleep',
  晚安: 'sleep',
  早安: 'morning',
  加班: 'cpu',
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
const BUCKET_IDS = new Set(['happy', 'angry', 'sad', 'shy', 'confused', 'daily'])

export function scoreMeme(meme, query) {
  const raw = String(query || '').trim()
  const q = raw.toLowerCase()
  if (!q) return 0
  const alias = QUERY_ALIASES[raw] || QUERY_ALIASES[q]
  const bucketWant = alias && toBucket(alias) ? toBucket(alias) : toBucket(q)
  let score = 0
  if (bucketWant && meme.bucket === bucketWant) score += 50
  // Exact fine-tag match only — do NOT boost tag===bucket when alias is happy/daily
  // (that made every happy-tagged meme beat「比心」keyword hits).
  if (meme.tag.toLowerCase() === q) score += 40
  else if (alias && !BUCKET_IDS.has(alias) && meme.tag === alias) score += 40
  const hay = `${meme.caption} ${meme.keywords} ${meme.fileName} ${meme.tag}`.toLowerCase()
  if (hay.includes(q) || (raw && hay.includes(raw))) score += 30
  // CJK bigrams / token overlap (skip 1-char noise for CJK)
  const tokens = raw.split(/[\s,，、]+/).filter(Boolean)
  for (const t of tokens) {
    if (t.length >= 2 && hay.includes(t.toLowerCase())) score += 12
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

  // Prefer name/query over tag when both set (model often passes tag=happy + name=比心).
  if (queryRaw) {
    const aliasBucket = toBucket(QUERY_ALIASES[queryRaw] || '')
    if (aliasBucket) {
      const pool = memes.filter((m) => m.bucket === aliasBucket)
      if (pool.length) {
        const scoredIn = pool
          .map((m) => ({ m, s: scoreMeme(m, queryRaw) }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s)
        if (scoredIn.length) {
          const top = scoredIn[0].s
          const near = scoredIn.filter((x) => x.s >= top - 10)
          const pick = near[Math.floor(random() * near.length)].m
          return {
            ok: true,
            meme: pick,
            source: 'pack-alias',
            matched: queryRaw,
            score: top,
          }
        }
        const pick = pool[Math.floor(random() * pool.length)]
        return { ok: true, meme: pick, source: 'pack-alias', matched: queryRaw }
      }
    }

    const scored = memes
      .map((m) => ({ m, s: scoreMeme(m, queryRaw) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)

    if (scored.length) {
      const top = scored[0].s
      const near = scored.filter((x) => x.s >= top - 10)
      const pick = near[Math.floor(random() * near.length)].m
      return { ok: true, meme: pick, source: 'pack-query', matched: queryRaw, score: top }
    }

    if (!tagRaw) {
      return {
        ok: false,
        error: `no meme match for query=${queryRaw}`,
        buckets: summarizeBuckets(memes),
      }
    }
    // query miss + tag present → fall through to tag pool
  }

  if (tagRaw) {
    const bucket = toBucket(tagRaw) || tagRaw.toLowerCase()
    const pool = memes.filter(
      (m) => m.bucket === bucket || m.tag.toLowerCase() === tagRaw.toLowerCase(),
    )
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

  return { ok: false, error: 'tag or query required', buckets: summarizeBuckets(memes) }
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
