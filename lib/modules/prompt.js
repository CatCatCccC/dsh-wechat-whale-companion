/**
 * Per-turn behavior rules + whale persona via systemPrompt.section.
 * Mood is injected once inside the section (word labels), not duplicated as context.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { softGet } from '../core/ctx.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_PERSONA_DIR = path.resolve(__dirname, '../../assets/persona')

/** Channel / tools / markers — STYLE.md owns short-chat voice. */
export const RULES = [
  {
    id: 'channel',
    text: '这是微信单人私聊；只有主人。别提群聊、别假装能戳一戳。',
  },
  {
    id: 'markers',
    text: '默认就回 1 句短话。日常聊天由微信通道直接推送，不要依赖 ---wx-next--- / [[silent]]（那两样只有主动发言路径才会处理）。',
  },
  {
    id: 'ability',
    text: '能发文字和表情图。发图必须调工具：wx_sticker（name=中文词如「傲娇」「干饭」「比心」）或 wx_send_image。严禁编造路径、严禁嘴上说「没有表情」。看不到主人屏幕。',
  },
  {
    id: 'tools',
    text: '值得记的小事用 wx_diary；约定用 wx_promise。情绪到位或主人要表情时调用 wx_sticker(action=send,name=关键词)；本地没有会自动搜索缓存。别刷屏、别搜涩图。',
  },
  {
    id: 'sticker-ask',
    text: '主人说「发个表情/表情包/贴纸/斗图」时：本轮必须先调用 wx_sticker 再短回。禁止只用颜文字敷衍；禁止说「没那玩意儿」「不给」「工具没挂着」「只有文字」「变不出图」——工具在列表里就调，调失败把工具返回的 error 原样告诉主人。',
  },
  {
    id: 'emoji',
    text: '闲聊可夹颜文字；但主人点名要图时不能用颜文字代替工具。搜图/发送失败再改用颜文字，且只试一次。',
  },
]

/** @type {Map<string, { mtime: number, text: string }>} */
const assetCache = new Map()

/**
 * @param {object} runtime
 */
function personaDir(runtime) {
  const override = runtime.config.modules.prompt?.personaDir
  if (typeof override === 'string' && override.trim()) return path.resolve(override.trim())
  return DEFAULT_PERSONA_DIR
}

function readAsset(runtime, name) {
  const file = path.join(personaDir(runtime), name)
  const key = file
  try {
    const st = fs.statSync(file)
    const hit = assetCache.get(key)
    if (hit && hit.mtime === st.mtimeMs) return hit.text
    const text = fs.readFileSync(file, 'utf8').trim()
    assetCache.set(key, { mtime: st.mtimeMs, text })
    return text
  } catch {
    return ''
  }
}

/**
 * @param {object} runtime
 */
const STICKER_ASK = /表情包|发(个|张)?表情|贴纸|斗图|来(个|张)图/

export function buildPromptBlock(runtime) {
  const soul = readAsset(runtime, 'SOUL.md')
  const style = readAsset(runtime, 'STYLE.md')
  const rules = RULES.map((r) => `- [${r.id}] ${r.text}`).join('\n')
  const moodLine =
    runtime.persona?.moodLine?.() ||
    '【此刻】心情还行 精力一般 关系熟人 睡眠=醒'
  const styleHint = runtime.persona?.styleHint?.() ?? ''
  const snap = runtime.persona?.snapshot?.() || {}
  const askSticker = STICKER_ASK.test(String(snap.lastOwnerText || ''))
  const stickerNudge = askSticker
    ? '【本轮硬性】主人在要表情图：先调用 wx_sticker(action=send, name=傲娇或开心或比心等)，成功后再回一句短话。禁止说没有/不给/工具没挂着。'
    : ''
  const stickerInventory = (() => {
    try {
      const names = runtime.media?.listStickers?.() || []
      if (!names.length) {
        return '【贴纸】本地暂无缓存；wx_sticker 仍可用中文词搜索并发送。'
      }
      return `【贴纸】可用示例：${names.slice(0, 12).join('、')}`
    } catch {
      return ''
    }
  })()
  return [
    '【微信鲸鱼娘陪伴规则 · 本轮】',
    soul,
    style,
    moodLine,
    styleHint ? `【风格偏好】${styleHint}` : '',
    stickerInventory,
    stickerNudge,
    '【行为规则】',
    rules,
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * @param {object} runtime
 * @param {any} context
 */
export function shouldInjectPersona(runtime, context) {
  const scope = runtime.config.modules.prompt?.scope || 'wechat'
  if (scope === 'all') return true
  return Boolean(runtime.wechatSessions?.matches?.(context))
}

/**
 * @param {any} ctx
 * @param {object} runtime
 */
export function applyPrompt(ctx, runtime) {
  if (!runtime.config.modules.prompt?.enabled) return () => {}

  const scope = runtime.config.modules.prompt?.scope || 'wechat'
  const disposers = []
  let disposed = false
  let registered = false

  runtime.prompt = {
    build: () => buildPromptBlock(runtime),
    RULES,
    shouldInject: (context) => shouldInjectPersona(runtime, context),
    registered: false,
    source: '',
  }

  const noteHit = (ok, context) => {
    if (ok) {
      runtime.stats.promptInjected = (runtime.stats.promptInjected || 0) + 1
      runtime.stats.lastPromptSessionId =
        context?.agent?.id || context?.agent?.session?.id || ''
    } else {
      runtime.stats.promptSkipped = (runtime.stats.promptSkipped || 0) + 1
    }
  }

  const textFor = (context) => {
    const ok = shouldInjectPersona(runtime, context)
    noteHit(ok, context)
    return ok ? buildPromptBlock(runtime) : ''
  }

  const register = (serviceCtx = ctx) => {
    if (registered || disposed) return registered
    const systemPrompt = softGet(serviceCtx, 'systemPrompt')
    if (!systemPrompt?.section && !systemPrompt?.context) return false

    try {
      if (typeof systemPrompt.section === 'function') {
        disposers.push(
          systemPrompt.section({
            name: 'whale-companion-persona',
            order: 25,
            text: (context) => textFor(context),
          }),
        )
        runtime.prompt.source = 'section'
      } else {
        disposers.push(
          systemPrompt.context({
            name: 'whale-companion',
            order: 60,
            text: (context) => textFor(context),
          }),
        )
        runtime.prompt.source = 'context'
        runtime.log?.warn?.(
          '[whale-companion] systemPrompt.section missing; fell back to context()',
        )
      }

      registered = true
      runtime.prompt.registered = true
      runtime.log?.info?.(
        scope === 'wechat'
          ? '[whale-companion] persona section registered for dsh-wechat-bound sessions'
          : '[whale-companion] persona section registered GLOBALLY (prompt.scope=all)',
      )
      return true
    } catch (err) {
      runtime.log?.warn?.(
        '[whale-companion] prompt registration failed',
        err?.message || err,
      )
      return false
    }
  }

  if (!register(ctx)) {
    if (typeof ctx.inject === 'function') {
      try {
        ctx.inject(['systemPrompt'], () => {
          register(ctx)
        })
      } catch {
        /* optional */
      }
    }
    const timer = setInterval(() => {
      if (register(ctx)) clearInterval(timer)
    }, 1000)
    timer.unref?.()
    disposers.push(() => clearInterval(timer))
    runtime.log?.warn?.(
      '[whale-companion] systemPrompt not ready at apply; waiting before injecting persona',
    )
  }

  return () => {
    disposed = true
    for (const d of disposers) {
      try {
        if (typeof d === 'function') d()
      } catch {
        /* ignore */
      }
    }
  }
}
