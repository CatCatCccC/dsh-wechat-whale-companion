/**
 * Local dsh-meme packs (tag/caption) + legacy stickers + optional Sogou search cache.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerTool } from '../core/tools.js'
import {
  BUNDLED_PACKS_DIR,
  findMeme,
  inventoryLine,
  loadMemeCatalog,
  summarizeBuckets,
} from '../core/meme-pack.js'
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
  const extraPacks =
    typeof mod.memePacksDir === 'string' && mod.memePacksDir.trim()
      ? [path.resolve(mod.memePacksDir.trim())]
      : []
  const memeCatalog = loadMemeCatalog([BUNDLED_PACKS_DIR, ...extraPacks])

  /** Simple cooldown so we don't hammer meme APIs */
  let lastSearchAt = 0
  const searchCooldownMs = Number(mod.searchCooldownMs) || 8000

  const packRoots = memeCatalog.packs.map((p) => p.dir)
  const allowedRoots = [
    STICKER_DIR,
    BUNDLED_PACKS_DIR,
    ...packRoots,
    ...extraPacks,
    cacheDir,
    path.resolve(process.cwd()),
    runtime.store?.root,
  ]
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
   * Prefer meme packs → legacy local → web search+cache.
   * @param {string} query
   * @param {{ tag?: string }} [extra]
   */
  const resolveOrSearch = async (query, extra = {}) => {
    const tag = String(extra.tag || '').trim()
    if (tag || query) {
      const hit = findMeme(memeCatalog, { tag, query: query || tag })
      if (hit.ok && hit.meme?.absPath) {
        return {
          ok: true,
          path: hit.meme.absPath,
          source: hit.source,
          query: hit.matched || query || tag,
          caption: hit.meme.caption,
          pack: hit.meme.packName,
          tag: hit.meme.tag,
          bucket: hit.meme.bucket,
        }
      }
    }

    const q = sanitizeQuery(query)
    if (!q && !tag) return { ok: false, error: 'name/query/tag required' }

    if (q) {
      const local = resolveLocal(q) || resolveLocal(`${q}.jpg`) || resolveLocal(`${q}.png`)
      if (local) return { ok: true, path: local, source: 'local' }

      const bundled = listBundled().find(
        (f) => f === q || f.replace(/\.[^.]+$/, '') === q,
      )
      if (bundled) {
        const p = path.join(STICKER_DIR, bundled)
        if (fs.existsSync(p)) return { ok: true, path: p, source: 'bundled' }
      }
    }

    if (!searchOn) {
      return {
        ok: false,
        error: 'not found in meme packs (web search disabled)',
        buckets: memeCatalog.count
          ? Object.fromEntries(
              Object.entries(
                memeCatalog.memes.reduce((a, m) => {
                  a[m.bucket] = (a[m.bucket] || 0) + 1
                  return a
                }, {}),
              ),
            )
          : {},
      }
    }
    if (!q) return { ok: false, error: 'query required for web search' }

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

  /**
   * dsh-wechat guards files against the CALLING session (agentId), not the
   * recipient. Empty agentId → roots = registered workspaces only (session
   * cwd dropped) → staged stickers still refused. Always resolve binding.
   * @param {object} [opts]
   */
  const resolveSendContext = (opts = {}) => {
    runtime.wechatSessions?.refresh?.()
    const bindings = runtime.wechatSessions?.list?.() || []
    const agentId = String(
      opts.agentId || opts.sessionId || bindings[0]?.sessionId || '',
    ).trim()
    const matched = agentId
      ? bindings.find((b) => b.sessionId === agentId)
      : undefined
    const cwdRaw =
      (matched?.cwd && String(matched.cwd).trim()) ||
      bindings.map((b) => b.cwd).find((c) => typeof c === 'string' && c.trim()) ||
      process.cwd()
    return { agentId, cwd: path.resolve(cwdRaw) }
  }

  /**
   * Copy into `<sessionCwd>/.whale-stickers/` before send_wechat.
   * @param {string} realPath
   * @param {{ cwd: string }} ctx
   */
  const stageIntoSessionCwd = (realPath, ctx) => {
    const stageDir = path.join(ctx.cwd, '.whale-stickers')
    fs.mkdirSync(stageDir, { recursive: true })
    try {
      fs.writeFileSync(path.join(stageDir, '.gitignore'), '*\n', 'utf8')
    } catch {
      /* ignore */
    }
    const dest = path.join(stageDir, path.basename(realPath))
    const destReal = path.resolve(dest)
    if (destReal !== path.resolve(realPath)) {
      fs.copyFileSync(realPath, dest)
    }
    return fs.realpathSync(dest)
  }

  runtime.media = {
    cacheDir,
    memeCatalog,
    listStickers() {
      const packNames = memeCatalog.memes.map(
        (m) => `${m.bucket}/${m.fileName.replace(/\.[^.]+$/, '')}`,
      )
      return [...new Set([...packNames, ...listBundled(), ...listCached()])]
    },
    stickerPath(name) {
      return resolveLocal(name)
    },
    async findSticker(query, extra) {
      return resolveOrSearch(query, extra)
    },
    inventoryLine() {
      return inventoryLine(memeCatalog)
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
      const sendCtx = resolveSendContext(opts)
      let staged = real
      try {
        staged = stageIntoSessionCwd(real, sendCtx)
      } catch (err) {
        return {
          ok: false,
          error: `stage failed: ${err?.message || err}`,
          hint: '无法写入会话目录；可在 dsh-wechat 设置里打开 allowAnyFilePath',
        }
      }
      try {
        await runtime.wechat.sendImage(staged, {
          ...opts,
          agentId: sendCtx.agentId || opts?.agentId,
        })
        runtime.stats.stickerSent = (runtime.stats.stickerSent || 0) + 1
        return {
          ok: true,
          path: staged,
          stagedFrom: real,
          agentId: sendCtx.agentId || undefined,
        }
      } catch (err) {
        const msg = String(err?.message || err)
        runtime.stats.stickerSendFail = (runtime.stats.stickerSendFail || 0) + 1
        return {
          ok: false,
          error: msg,
          agentId: sendCtx.agentId || undefined,
          hint: /outside|refused|allowAnyFilePath/i.test(msg)
            ? 'dsh-wechat 拒绝了工作区外路径；已尝试拷贝到会话目录并带上 agentId。仍失败可开 allowAnyFilePath'
            : '发送失败，可换关键词再试，不要谎称图库罢工',
        }
      }
    },
  }

  /** Prefer the live tool-caller's session; fall back to WeChat binding. */
  const agentOptsFromExec = (exec) => {
    const id =
      exec?.agent?.id ||
      exec?.agent?.session?.id ||
      exec?.session?.id ||
      ''
    return id ? { agentId: String(id) } : {}
  }

  const markTool = (toolName) => {
    runtime.stats.toolsRegistered = {
      ...(runtime.stats.toolsRegistered || {}),
      [toolName]: true,
    }
    runtime.log?.info?.(`[whale-companion] tool registered: ${toolName}`)
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
      async (args, exec) => runtime.media.sendImage(args.path, agentOptsFromExec(exec)),
      { onRegistered: markTool },
    ),
  )

  disposers.push(
    registerTool(
      ctx,
      'wx_sticker',
      {
        description:
          '向主人微信发送表情包。优先用本地图库（大肥鱼/鲸鱼娘）。action=send；tag=happy|angry|sad|shy|confused|daily 按情绪抽；或 name=中文词（开心/傲娇/干饭/比心/困了）。库没有再搜网缓存。',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['list', 'send', 'search'] },
            name: { type: 'string' },
            tag: {
              type: 'string',
              enum: ['happy', 'angry', 'sad', 'shy', 'confused', 'daily'],
            },
          },
          required: ['action'],
        },
      },
      async (args, exec) => {
        if (args.action === 'list') {
          return {
            packs: (memeCatalog.packs || []).map((p) => ({
              id: p.id,
              name: p.name,
              count: p.memes.length,
              license: p.license,
            })),
            buckets: summarizeBuckets(memeCatalog.memes),
            samples: runtime.media.listStickers().slice(0, 20),
            bundledLegacy: listBundled(),
            cached: listCached(),
            search: searchOn,
            note: '优先 tag/中文词命中本地库；未命中才搜网',
            searchStyle: mod.searchStyle || 'cute',
          }
        }

        const name = String(args.name || '').trim()
        const tag = String(args.tag || '').trim()
        if (!name && !tag) return { error: 'name or tag required' }

        const found = await resolveOrSearch(name, { tag })
        if (!found.ok) {
          return {
            ok: false,
            error: found.error,
            buckets: found.buckets,
            hint: '可换 tag=happy/shy/daily 或「开心」「傲娇」「干饭」；不要编造「图库罢工」',
          }
        }

        if (args.action === 'search') {
          return {
            ok: true,
            path: found.path,
            source: found.source,
            query: found.query,
            caption: found.caption,
            pack: found.pack,
            note: '已解析；可用 action=send 同参数发送',
          }
        }

        // send — must pass calling session so dsh-wechat includes its cwd in roots
        const sent = await runtime.media.sendImage(found.path, agentOptsFromExec(exec))
        if (!sent?.ok) {
          return {
            ok: false,
            ...sent,
            source: found.source,
            query: found.query,
            caption: found.caption,
            hint: sent?.hint || '发送失败；可再调一次 wx_sticker，不要用颜文字冒充表情包',
          }
        }
        return {
          ...sent,
          source: found.source,
          query: found.query,
          caption: found.caption,
          pack: found.pack,
        }
      },
      { onRegistered: markTool },
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
