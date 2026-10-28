/**
 * Per-turn behavior rules + whale persona via systemPrompt.section (+ mood context).
 *
 * Why section (not only context):
 * - `systemPrompt.context()` lands as a sourced *user-role* snapshot — easy for the
 *   model to ignore when a coding/default persona already owns the system prompt.
 * - `systemPrompt.section()` is real system-prompt text, which is what we need for
 *   "说话像鲸鱼娘".
 *
 * Gate: only inject for dsh-wechat-bound sessions (see WechatSessionIndex.matches).
 * Opt into every agent with `modules.prompt.scope: all`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { softGet } from '../core/ctx.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PERSONA_DIR = path.resolve(__dirname, '../../assets/persona')

export const RULES = [
  {
    id: 'silent',
    text: '沉默只用 [[silent]]，禁止用括号或文字表示沉默。',
  },
  {
    id: 'tone',
    text: '短句口语，别写文档；中位约 6～12 字，想多说就用 ---wx-next--- 分条发。',
  },
  {
    id: 'aside',
    text: '正文只写要说的话；禁止「我在等他回话」这类回合报幕。',
  },
  {
    id: 'batch',
    text: '主人连发几句要合起来回，别一句回一次。',
  },
  {
    id: 'channel',
    text: '这是微信单人私聊；只有主人。别提群聊、别假装能戳一戳。',
  },
  {
    id: 'ability',
    text: '你能发文字/图片（若通道允许）；看不到主人屏幕；不会操作微信客户端。做不到就直说。',
  },
  {
    id: 'image',
    text: '发图用工具/通道能力，严禁编造本地路径。',
  },
  {
    id: 'whale',
    text: '保持鲸鱼娘口吻；被叫大肥鱼可嘴硬；别每句卖萌。',
  },
  {
    id: 'speak',
    text: '被问到、有情绪、有兴趣时自然接；绝不硬接无关话题——可 [[silent]]。',
  },
]

/** @type {Map<string, { mtime: number, text: string }>} */
const assetCache = new Map()

function readAsset(name) {
  const file = path.join(PERSONA_DIR, name)
  try {
    const st = fs.statSync(file)
    const hit = assetCache.get(name)
    if (hit && hit.mtime === st.mtimeMs) return hit.text
    const text = fs.readFileSync(file, 'utf8').trim()
    assetCache.set(name, { mtime: st.mtimeMs, text })
    return text
  } catch {
    return ''
  }
}

/**
 * @param {object} runtime
 */
export function buildPromptBlock(runtime) {
  const soul = readAsset('SOUL.md')
  const style = readAsset('STYLE.md')
  const mood = runtime.persona?.snapshot?.() ?? {}
  const rules = RULES.map((r) => `- [${r.id}] ${r.text}`).join('\n')
  const moodLine = `【此刻状态】心情=${mood.mood ?? 50} 精力=${mood.energy ?? 50} 亲和=${mood.affinity ?? 20} 睡眠=${mood.asleep ? '睡' : '醒'}`
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

  /**
   * Register on whichever context can already see `systemPrompt`.
   *
   * `systemPrompt` is not guaranteed to exist when the profile bundle is
   * applied (dsh-wechat waits for it with `ctx.inject` for the same reason),
   * so a single `ctx.get` at apply time silently loses the persona.
   * @param {any} serviceCtx
   * @returns {boolean} whether registration succeeded
   */
  const register = (serviceCtx = ctx) => {
    if (registered || disposed) return registered
    const systemPrompt = softGet(serviceCtx, 'systemPrompt')
    if (!systemPrompt?.section && !systemPrompt?.context) return false

    try {
      // Primary: system section — the model treats this as instructions.
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
        // Fallback for older hosts that only expose context().
        disposers.push(
          systemPrompt.context({
            name: 'whale-companion',
            order: 60,
            text: (context) => textFor(context),
          }),
        )
        runtime.prompt.source = 'context'
        runtime.log?.warn?.(
          '[whale-companion] systemPrompt.section missing; fell back to context() (weaker persona)',
        )
      }

      // Live mood line as dynamic context (survives complete persona presets).
      if (typeof systemPrompt.context === 'function') {
        disposers.push(
          systemPrompt.context({
            name: 'whale-companion-mood',
            order: 61,
            text: (context) => {
              if (!shouldInjectPersona(runtime, context)) return ''
              const mood = runtime.persona?.snapshot?.() ?? {}
              const hint = runtime.persona?.styleHint?.() || ''
              return `【鲸鱼娘此刻】心情=${mood.mood ?? 50} 精力=${mood.energy ?? 50} 亲和=${mood.affinity ?? 20} 睡眠=${mood.asleep ? '睡' : '醒'}${hint ? ` 风格=${hint}` : ''}`
            },
          }),
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

  // Fast path: the service is already mounted.
  if (!register(ctx)) {
    // Wait for the service with the host's own injection primitive, then fall
    // back to a short poll for hosts where the injected child never settles.
    if (typeof ctx.inject === 'function') {
      try {
        ctx.inject(['systemPrompt'], () => {
          register(ctx)
        })
      } catch {
        /* optional host */
      }
    }
    const timer = setInterval(() => {
      if (register(ctx)) clearInterval(timer)
    }, 1000)
    timer.unref?.()
    disposers.push(() => clearInterval(timer))
    runtime.log?.warn?.(
      '[whale-companion] systemPrompt not ready at apply; waiting for it before injecting persona',
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
