/**
 * Image / optional voice / sticker directory helpers.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STICKER_DIR = path.resolve(__dirname, '../../assets/stickers')

function registerTool(ctx, name, schema, handler) {
  if (!ctx?.tools?.register) return () => {}
  try {
    return ctx.tools.register(name, schema, handler)
  } catch {
    try {
      return ctx.tools.register({ name, ...schema, execute: handler })
    } catch {
      return () => {}
    }
  }
}

/**
 * @param {any} ctx
 * @param {object} runtime
 */
export function applyMedia(ctx, runtime) {
  const mod = runtime.config.modules.media
  if (!mod?.enabled) return () => {}

  const disposers = []

  const allowedRoots = [
    STICKER_DIR,
    path.resolve(process.cwd()),
    runtime.store?.root,
  ].filter(Boolean)

  const underAllowed = (resolved) => {
    const norm = path.resolve(resolved)
    return allowedRoots.some((root) => {
      const r = path.resolve(root)
      const rel = path.relative(r, norm)
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
    })
  }

  runtime.media = {
    async sendImage(filePath, opts) {
      if (!runtime.wechat?.sendImage) {
        return { ok: false, error: 'sendImage not available on dsh-wechat adapter' }
      }
      const resolved = path.resolve(filePath)
      if (!underAllowed(resolved)) {
        return { ok: false, error: 'path outside allowed dirs (cwd / stickers / state)' }
      }
      if (!fs.existsSync(resolved)) return { ok: false, error: 'file not found' }
      const st = fs.statSync(resolved)
      if (!st.isFile()) return { ok: false, error: 'not a file' }
      if (st.size > 20 * 1024 * 1024) return { ok: false, error: 'image too large (>20MB)' }
      if (!/\.(png|jpe?g|gif|webp|bmp)$/i.test(resolved)) {
        return { ok: false, error: 'unsupported image type' }
      }
      await runtime.wechat.sendImage(resolved, opts)
      return { ok: true }
    },
    listStickers() {
      try {
        return fs
          .readdirSync(STICKER_DIR)
          .filter((f) => /\.(png|jpe?g|gif|webp)$/i.test(f))
      } catch {
        return []
      }
    },
    stickerPath(name) {
      const base = path.basename(String(name || ''))
      if (!base || base !== String(name || '').replace(/^.*[/\\]/, '')) return null
      const full = path.resolve(STICKER_DIR, base)
      if (!underAllowed(full)) return null
      return fs.existsSync(full) ? full : null
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
        description: '发送插件 stickers 目录中的表情图',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['list', 'send'] },
            name: { type: 'string' },
          },
          required: ['action'],
        },
      },
      async (args) => {
        if (args.action === 'list') return { stickers: runtime.media.listStickers() }
        const p = runtime.media.stickerPath(args.name)
        if (!p) return { error: 'sticker not found' }
        return runtime.media.sendImage(p)
      },
    ),
  )

  if (mod.voice) {
    disposers.push(
      registerTool(
        ctx,
        'wx_say',
        {
          description: '尝试发语音；通道不支持时降级为文字',
          parameters: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
        },
        async (args) => {
          const text = String(args.text || '').slice(0, 200)
          // No bundled TTS — always degrade to text (sendVoice alone can't synthesize)
          if (runtime.wechat?.sendText) {
            await runtime.wechat.sendText(`（语音降级）${text}`)
            return {
              ok: true,
              degraded: true,
              note: runtime.wechat.sendVoice
                ? 'TTS not bundled; text fallback used'
                : undefined,
            }
          }
          return { ok: false, error: 'no send channel' }
        },
      ),
    )
  }

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
