/**
 * Per-turn behavior rules + whale STYLE injection via agent/pre-step.
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

  const disposers = []

  // Cordis / DSH host: agent/pre-step waterfall
  if (typeof ctx?.on === 'function') {
    try {
      const off = ctx.on('agent/pre-step', async (ev, next) => {
        try {
          const block = buildPromptBlock(runtime)
          if (ev && typeof ev === 'object') {
            ev.companionPrompt = block
            if (Array.isArray(ev.messages)) {
              ev.messages = [
                { role: 'system', content: block },
                ...ev.messages.filter((m) => m?.role !== 'system' || !String(m.content || '').includes('微信鲸鱼娘陪伴规则')),
              ]
            } else if (typeof ev.appendSystem === 'function') {
              ev.appendSystem(block)
            } else if (ev.systemPrompt != null) {
              ev.systemPrompt = `${block}\n\n${ev.systemPrompt}`
            }
          }
        } catch (err) {
          runtime.log?.warn?.('[whale-companion] prompt inject failed', err)
        }
        return next ? next() : ev
      })
      disposers.push(typeof off === 'function' ? off : () => {})
    } catch {
      /* host may not expose this event name */
    }
  }

  // systemPrompt variable registration if available
  const systemPrompt = softGet(ctx, 'systemPrompt')
  if (systemPrompt?.variable) {
    try {
      disposers.push(
        systemPrompt.variable('whale_companion_rules', () => buildPromptBlock(runtime)),
      )
    } catch {
      /* optional */
    }
  }

  return () => {
    for (const d of disposers) {
      try {
        d()
      } catch {
        /* ignore */
      }
    }
  }
}
