/**
 * Per-turn behavior rules + whale persona via a dynamic system-prompt context.
 *
 * DSH's `agent/pre-step` payload is a waterfall decision, not a mutable prompt
 * bag: `next()` builds the decision from its own claimed message list, so
 * assigning `ev.messages` there did nothing. Prompt text belongs in
 * `ctx.systemPrompt.context()` (the same seam dsh-wechat uses for its surface
 * prompt); a context survives a preset's `complete` persona replacement, which
 * a plain section would not.
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
    id: 'time',
    text: '心里有 time/gap 就参考，但不报时钟、不编造隔了多久。',
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
 * @param {any} ctx
 * @param {object} runtime
 */
export function applyPrompt(ctx, runtime) {
  if (!runtime.config.modules.prompt?.enabled) return () => {}

  runtime.prompt = { build: () => buildPromptBlock(runtime), RULES }

  const systemPrompt = softGet(ctx, 'systemPrompt')
  if (!systemPrompt?.context) {
    runtime.log?.warn?.(
      '[whale-companion] systemPrompt service unavailable; persona/rules are not injected',
    )
    return () => {}
  }

  try {
    const scope = runtime.config.modules.prompt?.scope || 'wechat'
    const off = systemPrompt.context({
      name: 'whale-companion',
      order: 60,
      text: (context) => {
        if (scope === 'wechat') {
          const sessionId = context?.agent?.id ?? context?.agent?.session?.id
          // dsh-wechat owns the user→session map; without a binding this is a
          // GUI/coding session and must not receive the companion persona.
          if (!sessionId || !runtime.wechatSessions?.has?.(sessionId)) return ''
        }
        return buildPromptBlock(runtime)
      },
    })
    runtime.log?.warn?.(
      scope === 'wechat'
        ? '[whale-companion] prompt registered for dsh-wechat-bound sessions only'
        : '[whale-companion] prompt registered GLOBALLY (prompt.scope=all): it reaches every agent in this profile.',
    )
    return () => {
      try {
        if (typeof off === 'function') off()
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    runtime.log?.warn?.('[whale-companion] prompt registration failed', err?.message || err)
    return () => {}
  }
}
