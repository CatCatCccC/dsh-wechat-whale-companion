/**
 * Per-turn behavior rules + whale persona via systemPrompt.section.
 * Mood is injected once inside the section (word labels), not duplicated as context.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { softGet } from '../core/ctx.js'
import { moodMode } from './mood-words.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_PERSONA_DIR = path.resolve(__dirname, '../../assets/persona')

/** Channel / tools — SOUL/STYLE own voice; keep this list short. */
export const RULES = [
  {
    id: 'channel',
    text: '微信单人私聊，只有主人。别演群聊、别假装能戳一戳。',
  },
  {
    id: 'voice',
    text: '默认一条短气泡；口吻跟【本轮模式】。问「你是谁」只回「小鱼」。禁背设定名片。AI 味黑名单出现即失败。',
  },
  {
    id: 'turn',
    text: '主人报事实/作息：接住或放行，禁止复读点评（够晚/挺早），禁止硬开饿不饿、记得吃饭。别为凑聊拆第二条新话题。',
  },
  {
    id: 'memory-must',
    text: '主人说到偏好/身份/约定/「记住」「别忘」、住址工作作息等：本轮先 wx_memory(action=remember；长期用 kind=fact+factKey) 再短回。寒暄可跳过。禁止只嘴上说记下了。',
  },
  {
    id: 'alarm-must',
    text: '「X点喊我/叫醒/提醒我」必须 wx_promise(action=add, text=…, dueAt=到期Unix毫秒)。省略 dueAt 会错点。',
  },
  {
    id: 'sticker',
    text: '要表情/贴纸/斗图：先 wx_sticker 再接话。禁颜文字代替；禁「图发了/给你了」。失败才报 error。也可偶发贴纸，别刷屏。',
  },
  {
    id: 'vision',
    text: '本轮若带了主人发的图（或【图片描述】），按你看见的聊，别提路径/工具；只有【图片识别失败】或光秃「文件已保存到」才说看不清并让打字。禁编造没看见的细节。',
  },
  {
    id: 'recall',
    text: '【记忆】有的才能当记得；没有就自然接话或问一句，别说「空空的/没记录/失忆了」。被追问才说忘了。',
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

const STICKER_ASK = /表情包|发(个|张)?表情|贴纸|斗图|来(个|张)图/
const MEMORY_ASK =
  /记住|别忘|我喜欢|我不喜欢|我叫|我的名字|约定|提醒我|喊我|叫醒|起床|住在|过敏|上班|下班/

/**
 * @param {object} runtime
 */
export function buildPromptBlock(runtime) {
  const soul = readAsset(runtime, 'SOUL.md')
  const style = readAsset(runtime, 'STYLE.md')
  const rules = RULES.map((r) => `- [${r.id}] ${r.text}`).join('\n')
  const moodLine =
    runtime.persona?.moodLine?.() ||
    '【此刻】心情还行，精力一般，关系熟人，醒。本轮模式：活人版'
  const snap = runtime.persona?.snapshot?.() || {}
  const modeFile =
    moodMode(snap.mood) === 'naughty' ? 'MODE-NAUGHTY.md' : 'MODE-LIVE.md'
  const modeBlock = readAsset(runtime, modeFile)
  const ownerText = String(snap.lastOwnerText || '')
  const askSticker = STICKER_ASK.test(ownerText)
  const askMemory = MEMORY_ASK.test(ownerText)
  const stickerNudge = askSticker
    ? '【本轮硬性】要图：先 wx_sticker，再只接话一句。禁「图发了」。'
    : ''
  const memoryNudge = askMemory
    ? '【本轮硬性】这话像要记住/提醒：先调 wx_memory 或 wx_promise（闹钟带 dueAt），再短回。禁止只说「记下了」。'
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
      const block = runtime.memory?.injectBlock?.(ownerText) || ''
      if (block) return block
      const active = runtime.memory?.stats?.()?.active ?? 0
      if (active === 0) {
        // Instruction only — never wording the model should say out loud.
        return '【记忆·内部】尚无条目。主人若说到偏好/约定/身份再 wx_memory。禁止把「空/没记录」说给主人听。'
      }
      return ''
    } catch {
      return ''
    }
  })()
  return [
    '【微信小鱼 · 本轮】',
    soul,
    style,
    moodLine,
    modeBlock,
    memoryBlock,
    stickerInventory,
    memoryNudge,
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
