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
    text: '多句用单独一行 ---wx-next--- 拆气泡；不想回只输出 [[silent]]（不要解释沉默）。',
  },
  {
    id: 'ability',
    text: '能发文字；wx_sticker 可按中文关键词自动搜表情并缓存后发送；发本地图用 wx_send_image，严禁编造路径。看不到主人屏幕。',
  },
  {
    id: 'tools',
    text: '值得记的小事用 wx_diary；约定用 wx_promise；情绪到位时偶发 wx_sticker（name 用「傲娇」「困了」等词），别刷屏、别搜涩图。',
  },
  {
    id: 'emoji',
    text: '也可直接打颜文字/emoji；搜图失败就用文字表情，别反复空搜。',
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
export function buildPromptBlock(runtime) {
  const soul = readAsset(runtime, 'SOUL.md')
  const style = readAsset(runtime, 'STYLE.md')
  const rules = RULES.map((r) => `- [${r.id}] ${r.text}`).join('\n')
  const moodLine =
    runtime.persona?.moodLine?.() ||
    '【此刻】心情还行 精力一般 关系熟人 睡眠=醒'
  const styleHint = runtime.persona?.styleHint?.() ?? ''
  return [
    '【微信鲸鱼娘陪伴规则 · 本轮】',
    soul,
    style,
    moodLine,
    styleHint ? `【风格偏好】${styleHint}` : '',
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
