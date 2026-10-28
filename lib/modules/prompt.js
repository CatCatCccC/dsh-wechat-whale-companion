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
    text: '默认 1 句短话，情绪或接话需要时可 2～3 句。日常由微信通道直推，不要依赖 ---wx-next--- / [[silent]]（那两样只有主动发言路径才会处理）。',
  },
  {
    id: 'ability',
    text: '能发文字和表情图。发图必须调工具：wx_sticker（优先 tag=happy|angry|sad|shy|confused|daily，或 name=开心/傲娇/干饭/比心）或 wx_send_image。本地有大肥鱼/鲸鱼娘图库。严禁编造路径、严禁嘴上说「没有表情」。看不到主人屏幕。',
  },
  {
    id: 'tools',
    text: '值得记的小事用 wx_memory(action=remember)：喜好/约定用 kind=fact + factKey；普通事用 event。也可 wx_diary。约定提醒用 wx_promise。情绪到位或主人要表情时 wx_sticker。别刷屏、别搜涩图。',
  },
  {
    id: 'memory',
    text: '记忆会淡忘：越久越难想起，长期事实常在。相关时会自动出现在【记忆】里；也可 wx_memory recall。只用已注入的【记忆】细节，没有的别演成一直记得。',
  },
  {
    id: 'sticker-ask',
    text: '主人说「发个表情/表情包/贴纸/斗图」时：本轮必须先调用 wx_sticker 再短回。禁止只用颜文字敷衍；禁止说「没那玩意儿」「不给」「工具没挂着」。发完仍可嘴硬/冲/懒，不必秒变甜妹。调失败把工具 error 原样告诉主人。',
  },
  {
    id: 'emoji',
    text: '闲聊可夹颜文字；但主人点名要图时不能用颜文字代替工具。搜图/发送失败再改用颜文字，且只试一次。',
  },
  {
    id: 'flex',
    text: '允许有脾气起伏：敷衍可怼、道歉可嘴硬收下、冷场可少回。跟【此刻】口吻走。别每句同一模板，也别写成客服关怀长文。',
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
  const snap = runtime.persona?.snapshot?.() || {}
  const askSticker = STICKER_ASK.test(String(snap.lastOwnerText || ''))
  const stickerNudge = askSticker
    ? '【本轮硬性】主人在要表情图：先调用 wx_sticker(action=send, tag=happy 或 name=傲娇/开心/比心)，成功后再回一句短话（可冲可懒）。禁止说没有/不给/工具没挂着。'
    : ''
  const stickerInventory = (() => {
    try {
      const packLine = runtime.media?.inventoryLine?.() || ''
      if (packLine) return packLine
      const names = runtime.media?.listStickers?.() || []
      if (!names.length) {
        return '【贴纸】本地暂无图库；wx_sticker 仍可用中文词搜索并发送。'
      }
      return `【贴纸】可用示例：${names.slice(0, 12).join('、')}`
    } catch {
      return ''
    }
  })()
  const memoryBlock = (() => {
    try {
      return runtime.memory?.injectBlock?.(String(snap.lastOwnerText || '')) || ''
    } catch {
      return ''
    }
  })()
  return [
    '【微信鲸鱼娘陪伴规则 · 本轮】',
    soul,
    style,
    moodLine,
    memoryBlock,
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
