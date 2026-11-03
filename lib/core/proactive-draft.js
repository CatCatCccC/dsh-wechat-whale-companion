/**
 * Proactive line drafting: DSH ctx.llm → critic → slot template → emergency pool.
 * Reuses the profile’s already-configured provider/model (no separate API key).
 */

import { softGet } from './ctx.js'
import { motiveToSticker } from './proactive-motive.js'

function tooSimilar(candidate, last) {
  const a = String(candidate || '').trim()
  const b = String(last || '').trim()
  if (!a || !b) return false
  if (a === b) return true
  if (a.length >= 1 && b.includes(a)) return true
  if (b.length >= 1 && a.includes(b)) return true
  return false
}

const PREACHY =
  /记得喝水|记得吃饭|别熬太晚|再不吃要饿扁|坐太久了|伸个懒腰|去干饭，准了|别光干活，先吃饭|少刷一会/

const META = /【记忆|工具|系统|prompt|token|模型|作为AI|作为人工智能/i

/** Ultra-short emergency lines — never preachy care scripts */
export const EMERGENCY_POOL = ['喂', '在吗', '……', '嗯？', '人呢', '哼']

/**
 * @param {string} line
 * @param {{ recent?: string[], lastword?: string, maxLen?: number }} [opts]
 */
export function criticDraft(line, opts = {}) {
  const text = String(line || '')
    .replace(/^["「『]|["」』]$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return { ok: false, reason: 'empty' }
  const maxLen = Number(opts.maxLen) || 28
  if ([...text].length > maxLen) return { ok: false, reason: 'too_long', text }
  if (PREACHY.test(text)) return { ok: false, reason: 'preachy', text }
  if (META.test(text)) return { ok: false, reason: 'meta', text }
  if (/^[（(].+[）)]$/.test(text)) return { ok: false, reason: 'aside', text }
  if (tooSimilar(text, opts.lastword || '')) return { ok: false, reason: 'lastword', text }
  if ((opts.recent || []).some((r) => tooSimilar(text, r))) {
    return { ok: false, reason: 'recent', text }
  }
  return { ok: true, text }
}

/**
 * Slot templates grounded in hooks (no LLM).
 * @param {string} motiveId
 * @param {object} world
 * @param {{ random?: () => number }} [opts]
 */
export function templateLine(motiveId, world, opts = {}) {
  const random = typeof opts.random === 'function' ? opts.random : Math.random
  const hook = String(
    world?.openThread || world?.upcomingPromise?.text || world?.memoryHook || '',
  ).slice(0, 14)
  const softHook = hook ? `（${hook}）` : ''

  /** @type {Record<string, string[]>} */
  const pools = {
    continue_thread: hook
      ? [`诶，${hook}…咋样了`, `${hook}还算数吗`, `想起你说的${hook}`]
      : ['刚才那事…', '诶，说到一半呢'],
    promise_soft: hook
      ? [`差点忘了，${hook}`, `${hook}还作数吧`, `诶，${hook}`]
      : ['差点忘了跟你说约定'],
    miss: ['……还在吗', '喂，人呢', '消失这么久干什么', '回我一句就行'],
    soft: hook
      ? [`想你了${softHook}`, `今天怎么样`, `有空就回一下`]
      : ['想你了，就一句', '你还好吗', '……有点想听你说话'],
    lazy: ['嗯', '……', '有点困，还是来了', '懒得理你，但又有点想'],
    morning: hook ? [`早，${hook}`, '起来了吗'] : ['早', '起来了吗', '醒了就回我一声'],
    meal: hook ? [`${hook}，吃饭没`] : ['吃饭了吗', '中午了诶'],
    hydrate: ['……', '喂'],
    night: hook ? [`还在？${hook}`] : ['在干嘛', '……还没睡？', '夜深了'],
    generic: ['喂', '在干嘛', '路过看一眼'],
  }
  const list = pools[motiveId] || pools.generic
  return list[Math.floor(random() * list.length)]
}

/**
 * @param {string} motiveId
 * @param {object} world
 * @param {{ recent?: string[], lastword?: string, random?: () => number }} [opts]
 */
export function fallbackLine(motiveId, world, opts = {}) {
  const random = typeof opts.random === 'function' ? opts.random : Math.random
  const candidates = [
    templateLine(motiveId, world, { random }),
    templateLine(motiveId, world, { random }),
    EMERGENCY_POOL[Math.floor(random() * EMERGENCY_POOL.length)],
  ]
  for (const c of candidates) {
    const r = criticDraft(c, opts)
    if (r.ok) return { line: r.text, source: 'template' }
  }
  const emergency = EMERGENCY_POOL.filter(
    (l) => !tooSimilar(l, opts.lastword || '') && !(opts.recent || []).some((r) => tooSimilar(l, r)),
  )
  const line =
    emergency[Math.floor(random() * Math.max(1, emergency.length))] || '喂'
  return { line, source: 'emergency' }
}

/**
 * Resolve provider/model from DSH profile (same route WeChat chat uses).
 * @param {any} ctx
 * @param {{ provider?: string, model?: string, agentId?: string }} [override]
 * @returns {{ provider: string, model: string, reasoningEffort?: string }|null}
 */
export function resolveDshModel(ctx, override = {}) {
  if (override.provider && override.model) {
    return {
      provider: String(override.provider),
      model: String(override.model),
      reasoningEffort: override.reasoningEffort,
    }
  }

  const def = softGet(ctx, 'agentDefaultModel')
  try {
    const sel =
      typeof def?.currentSelection === 'function' ? def.currentSelection() : def?.selection
    if (sel?.provider && sel?.model) {
      return {
        provider: String(sel.provider),
        model: String(sel.model),
        reasoningEffort: sel.reasoningEffort,
      }
    }
  } catch {
    /* ignore */
  }

  const agents = softGet(ctx, 'agents')
  try {
    const list = typeof agents?.list === 'function' ? agents.list() : []
    const preferId = override.agentId
    const agent =
      (preferId && list.find((a) => a?.id === preferId || a?.sessionId === preferId)) ||
      list[0]
    const cur =
      (typeof agent?.model?.current === 'function' ? agent.model.current() : null) ||
      agent?.options ||
      agent?.model
    if (cur?.provider && cur?.model) {
      return {
        provider: String(cur.provider),
        model: String(cur.model),
        reasoningEffort: cur.reasoningEffort,
      }
    }
  } catch {
    /* ignore */
  }

  return null
}

function buildDraftPrompt(motiveId, world) {
  const system =
    '你是微信里的陪伴角色「大肥鱼/鲸鱼娘」。只输出一条主动找主人的短气泡。' +
    '要求：口语、像突然想起才发；≤22个汉字；不要括号动作；不要工具名；' +
    '不要说教（禁止记得喝水/记得吃饭/别熬夜这类）；不要复读刚说过的话；不要解释自己。'

  const user = [
    `动机: ${motiveId}`,
    world?.openThread ? `未闭合话题: ${world.openThread}` : '',
    world?.upcomingPromise?.text ? `临近约定: ${world.upcomingPromise.text}` : '',
    world?.memoryHook ? `可惦记的事: ${world.memoryHook}` : '',
    world?.journalHint ? `近聊: ${world.journalHint}` : '',
    world?.lastword ? `你刚说过(勿复读): ${world.lastword}` : '',
    `心情约${Math.round(world?.mood ?? 55)} 亲密度约${Math.round(world?.affinity ?? 15)} 沉默${(world?.silentH || 0).toFixed(1)}小时`,
    '只输出那一句话，不要引号。',
  ]
    .filter(Boolean)
    .join('\n')

  return { system, user }
}

/**
 * One-shot short completion via DSH llm service.
 * @param {object} opts
 */
export async function draftWithDshLlm(opts) {
  const {
    ctx,
    motiveId,
    world,
    provider,
    model,
    reasoningEffort,
    maxTokens = 64,
    temperature = 0.9,
    timeoutMs = 12000,
    llm: llmOverride,
  } = opts

  const llm = llmOverride || softGet(ctx, 'llm')
  if (!llm?.stream) throw new Error('ctx.llm unavailable')
  if (!provider || !model) throw new Error('no provider/model')

  const { system, user } = buildDraftPrompt(motiveId, world)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const parts = []
    let finish = null
    const stream = llm.stream({
      provider,
      model,
      ...(reasoningEffort ? { reasoningEffort } : {}),
      system,
      maxTokens,
      temperature,
      signal: controller.signal,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: user }],
        },
      ],
    })

    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta' && chunk.text) parts.push(chunk.text)
      else if (chunk?.type === 'text-delta' && chunk.delta) parts.push(chunk.delta)
      else if (typeof chunk?.text === 'string' && chunk.type !== 'finish') {
        // some adapters emit plain text fields
        if (chunk.type === 'text' || chunk.kind === 'text') parts.push(chunk.text)
      }
      if (chunk?.type === 'finish') finish = chunk
    }

    if (finish?.kind === 'error' || finish?.kind === 'aborted') {
      const code = finish.failure?.code || finish.kind
      throw new Error(`llm ${code}`)
    }

    const raw = parts.join('')
    const line = raw
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)[0]
    return String(line || '').trim()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Full draft pipeline — DSH model first, templates if llm missing/fails.
 * @param {object} input
 */
export async function draftProactiveLine(input) {
  const {
    motiveId,
    world,
    recent = [],
    lastword = '',
    ctx,
    enabledLlm = true,
    provider,
    model,
    reasoningEffort,
    agentId,
    timeoutMs,
    llm,
    random = Math.random,
  } = input

  const criticOpts = { recent, lastword }

  if (enabledLlm && ctx) {
    const route = resolveDshModel(ctx, { provider, model, reasoningEffort, agentId })
    const hasLlm = Boolean(llm?.stream || softGet(ctx, 'llm')?.stream)
    if (route && hasLlm) {
      const waitMs = Number.isFinite(timeoutMs) ? timeoutMs : 12000
      try {
        const raw = await Promise.race([
          draftWithDshLlm({
            ctx,
            llm,
            motiveId,
            world,
            provider: route.provider,
            model: route.model,
            reasoningEffort: route.reasoningEffort,
            timeoutMs: waitMs,
          }),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('draft timeout')), waitMs + 500)
          }),
        ])
        const judged = criticDraft(raw, criticOpts)
        if (judged.ok) {
          return {
            line: judged.text,
            source: 'dsh-llm',
            stickerKeyword: motiveToSticker(motiveId),
            critic: 'pass',
            route: `${route.provider}/${route.model}`,
          }
        }
        return {
          ...fallbackLine(motiveId, world, { ...criticOpts, random }),
          stickerKeyword: motiveToSticker(motiveId),
          critic: judged.reason || 'reject',
          route: `${route.provider}/${route.model}`,
        }
      } catch (err) {
        const fb = fallbackLine(motiveId, world, { ...criticOpts, random })
        return {
          ...fb,
          stickerKeyword: motiveToSticker(motiveId),
          critic: 'llm_fail',
          error: String(err?.message || err).slice(0, 80),
        }
      }
    }
  }

  const fb = fallbackLine(motiveId, world, { ...criticOpts, random })
  return {
    ...fb,
    stickerKeyword: motiveToSticker(motiveId),
    critic: enabledLlm ? 'no_dsh_llm' : 'llm_off',
  }
}
