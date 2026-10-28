/**
 * Local stickers + optional auto 表情包 search (Sogou / APIHZ, free) with cache.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerTool } from '../core/tools.js'
import {
  applySearchStyle,
  pruneCache,
  querySlug,
  sanitizeQuery,
  searchAndCacheImage,
} from '../core/image-search.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STICKER_DIR = path.resolve(__dirname, '../../assets/stickers')

/**
 * @param {any} ctx
 * @param {object} runtime
 */
export function applyMedia(ctx, runtime) {
  const mod = runtime.config.modules.media
  if (!mod?.enabled) return () => {}

  const disposers = []
  const searchOn = mod.search !== false
  const cacheDir = path.join(runtime.store.root, 'stickers-cache')
  const maxCache = Number(mod.searchCacheMax) || 80

  /** Simple cooldown so we don't hammer meme APIs */
  let lastSearchAt = 0
  const searchCooldownMs = Number(mod.searchCooldownMs) || 8000

  const allowedRoots = [STICKER_DIR, cacheDir, path.resolve(process.cwd()), runtime.store?.root]
    .filter(Boolean)
    .map((root) => {
      try {
        return fs.realpathSync(root)
      } catch {
        return path.resolve(root)
      }
    })

  const underAllowed = (resolved) => {
    const norm = path.resolve(resolved)
    return allowedRoots.some((root) => {
      const rel = path.relative(root, norm)
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
    })
  }

  const listBundled = () => {
    try {
      return fs
        .readdirSync(STICKER_DIR)
        .filter((f) => /\.(png|jpe?g|gif|webp)$/i.test(f))
    } catch {
      return []
    }
  }

  const listCached = () => {
    try {
      return fs
        .readdirSync(cacheDir)
        .filter((f) => /\.(png|jpe?g|gif|webp)$/i.test(f))
    } catch {
      return []
    }
  }

  const resolveLocal = (name) => {
    const base = path.basename(String(name || ''))
    if (!base || base !== String(name || '').replace(/^.*[/\\]/, '')) return null
    for (const dir of [STICKER_DIR, cacheDir]) {
      const full = path.resolve(dir, base)
      if (!underAllowed(full)) continue
      if (fs.existsSync(full)) return full
    }
    // cache slug prefix match
    const slug = querySlug(sanitizeQuery(name))
    const hit = listCached().find((f) => f.startsWith(slug + '.'))
    return hit ? path.join(cacheDir, hit) : null
  }

  /**
   * Prefer bundled sticker; else search+cache when enabled.
   * @param {string} query
   */
  const resolveOrSearch = async (query) => {
    const q = sanitizeQuery(query)
    if (!q) return { ok: false, error: 'name/query required' }

    const local = resolveLocal(q) || resolveLocal(`${q}.jpg`) || resolveLocal(`${q}.png`)
    if (local) return { ok: true, path: local, source: 'local' }

    // Exact filename in bundled list (happy.jpg etc.)
    const bundled = listBundled().find(
      (f) => f === q || f.replace(/\.[^.]+$/, '') === q,
    )
    if (bundled) {
      const p = path.join(STICKER_DIR, bundled)
      if (fs.existsSync(p)) return { ok: true, path: p, source: 'bundled' }
    }

    if (!searchOn) {
      return { ok: false, error: 'not found (web search disabled)' }
    }

    const now = Date.now()
    if (now - lastSearchAt < searchCooldownMs) {
      return { ok: false, error: 'search cooldown; try again shortly or use text emoji' }
    }
    lastSearchAt = now

    // cute style biases toward prettier results (同一池，靠关键词拉开)
    const searchQ = applySearchStyle(q, mod.searchStyle || 'cute')
    runtime.stats.stickerSearch = (runtime.stats.stickerSearch || 0) + 1
    const result = await searchAndCacheImage(searchQ, cacheDir, {
      fetchImpl: runtime.fetchImpl,
      timeoutMs: Number(mod.searchTimeoutMs) || 12000,
    })
    if (!result.ok) {
      runtime.stats.stickerSearchFail = (runtime.stats.stickerSearchFail || 0) + 1
      return result
    }
    pruneCache(cacheDir, maxCache)
    runtime.stats.stickerCached = (runtime.stats.stickerCached || 0) + (result.cached ? 0 : 1)
    return {
      ok: true,
      path: result.path,
      source: result.cached ? 'cache' : 'search',
      query: searchQ,
      style: mod.searchStyle || 'cute',
    }
  }

  runtime.media = {
    cacheDir,
    listStickers() {
      return [...new Set([...listBundled(), ...listCached()])]
    },
    stickerPath(name) {
      return resolveLocal(name)
    },
    async findSticker(query) {
      return resolveOrSearch(query)
    },
    async sendImage(filePath, opts) {
      if (!runtime.wechat?.sendImage) {
        return { ok: false, error: 'sendImage not available on dsh-wechat adapter' }
      }
      const resolved = path.resolve(filePath)
      if (!fs.existsSync(resolved)) return { ok: false, error: 'file not found' }
      let real
      try {
        real = fs.realpathSync(resolved)
      } catch {
        return { ok: false, error: 'file not readable' }
      }
      if (!underAllowed(real)) {
        return { ok: false, error: 'path outside allowed dirs (cwd / stickers / cache / state)' }
      }
      const st = fs.statSync(real)
      if (!st.isFile()) return { ok: false, error: 'not a file' }
      if (st.size > 20 * 1024 * 1024) return { ok: false, error: 'image too large (>20MB)' }
      if (!/\.(png|jpe?g|gif|webp|bmp)$/i.test(real)) {
        return { ok: false, error: 'unsupported image type' }
      }
      await runtime.wechat.sendImage(real, opts)
      return { ok: true, path: real }
    },
  }

  disposers.push(
    registerTool(
      ctx,
      'wx_send_image',
      {
        description: '向主人微信发送一张本地图片（须为真实存在的路径）',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
      async (args) => runtime.media.sendImage(args.path),
    ),
  )

  disposers.push(
    registerTool(
      ctx,
      'wx_sticker',
      {
        description:
          '向主人微信发送表情包图片。主人要表情/贴纸时必须用本工具。action=send，name 填中文关键词（傲娇/开心/干饭/比心/困了）或本地文件名；没有本地文件会自动搜索并缓存后发送。',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['list', 'send', 'search'] },
            name: { type: 'string' },
          },
          required: ['action'],
        },
      },
      async (args) => {
        if (args.action === 'list') {
          const stickers = runtime.media.listStickers()
          return {
            stickers,
            bundled: listBundled(),
            cached: listCached(),
            search: searchOn,
            note: searchOn
              ? `send/search 自动搜表情包并缓存（style=${mod.searchStyle || 'cute'}）`
              : 'web search off',
            searchStyle: mod.searchStyle || 'cute',
          }
        }

        const name = String(args.name || '').trim()
        if (!name) return { error: 'name required' }

        const found = await resolveOrSearch(name)
        if (!found.ok) {
          return {
            error: found.error,
            hint: '可改用颜文字，或换个关键词再试',
          }
        }

        if (args.action === 'search') {
          return {
            ok: true,
            path: found.path,
            source: found.source,
            query: found.query,
            note: '已缓存；可用 action=send 同关键词发送',
          }
        }

        // send
        const sent = await runtime.media.sendImage(found.path)
        return { ...sent, source: found.source, query: found.query }
      },
    ),
  )

  return () => {
    for (const d of disposers) {
      try {
        typeof d === 'function' && d()
      } catch {
        /* ignore */
      }
    }
  }
}
