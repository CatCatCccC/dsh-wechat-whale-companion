/**
 * Proactive line drafting: DSH ctx.llm → critic → slot template → emergency pool.
 * Reuses the profile’s already-configured provider/model (no separate API key).
 */

import { softGet } from './ctx.js'
import { motiveToSticker } from './proactive-motive.js'
import { loadShareJson } from './share-pool.js'

/**
 * @param {string} candidate
 * @param {string} last
 */
export function tooSimilar(candidate, last) {
  const a = String(candidate || '').trim()
  const b = String(last || '').trim()
  if (!a || !b) return false
  if (a === b) return true
  if (a.length >= 1 && b.includes(a)) return true
  if (b.length >= 1 && a.includes(b)) return true
  return false
}

const PREACHY =
  /记得喝水|记得吃饭|别熬太晚|再不吃要饿扁|坐太久了|伸个懒腰|去干饭，准了|别光干活，先吃饭|少刷一会|怎么了|怎么样|周一加油|打起精神/

const META = /【记忆|工具|系统|prompt|token|模型|作为AI|作为人工智能/i

export const HALF_SENTENCE_POOL = ['……', '喂', '在吗', '嗯', '人呢']

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
    world?.openThread ||
      world?.upcomingPromise?.text ||
      world?.shareLearn?.ask ||
      world?.shareMemoryFlip?.hook ||
      world?.shareCalendar?.hook ||
      world?.shareWeather?.hook ||
      world?.shareFun?.hook ||
      world?.shareHot?.hook ||
      world?.shareMedia?.hook ||
      world?.memoryHook ||
      '',
  ).slice(0, 20)
  const softHook = hook ? `（${hook}）` : ''
  const learnAsk = String(world?.shareLearn?.ask || '').slice(0, 40)
  const flip = String(world?.shareMemoryFlip?.hook || '').slice(0, 16)
  const cal = String(world?.shareCalendar?.hook || '').slice(0, 12)
  const wx = String(world?.shareWeather?.hook || '').slice(0, 16)
  const fun = String(world?.shareFun?.text || world?.shareFun?.hook || '').slice(0, 40)
  const joke = String(world?.shareInsideJoke?.text || world?.shareInsideJoke?.hook || '').slice(0, 36)
  const fish = String(world?.shareFishLife?.text || world?.shareFishLife?.hook || '').slice(0, 40)
  const theater = String(
    world?.shareMiniTheater?.text || world?.shareMiniTheater?.hook || '',
  ).slice(0, 40)
  const hot = String(world?.shareHot?.title || world?.shareHot?.hook || '').slice(0, 16)
  const media = String(world?.shareMedia?.title || world?.shareMedia?.hook || '').slice(0, 16)
  const dayPart = String(world?.dayPart || '')
  const isMon = world?.weekday === 'Mon'

  /** @type {Record<string, string[]>} */
  const pools = {
    continue_thread: hook
      ? [`诶，${hook}…咋样了`, `${hook}还算数吗`, `想起你说的${hook}`]
      : ['刚才那事…', '诶，说到一半呢'],
    promise_soft: hook
      ? [`差点忘了，${hook}`, `${hook}还作数吧`, `诶，${hook}`]
      : ['差点忘了跟你说约定'],
    learn_owner: learnAsk ? [learnAsk] : ['突然想问你一句，你在吗'],
    memory_flip: flip
      ? [`诶，想起你说过${flip}`, `忽然想到：${flip}`, `还记不记得——${flip}`]
      : ['忽然想起一件事'],
    calendar: cal ? [`${cal}诶`, `${cal}，你那边怎样`, `对了，${cal}`] : ['今天有点特别'],
    weather: wx ? [`外面${wx}`, `${wx}，你注意点`, `喂，${wx}`] : ['外面天气有点怪'],
    fun_bit: fun ? [fun] : ['跟你说个无聊的'],
    inside_joke: joke ? [joke, `突然想起：${joke}`] : ['咱俩那个梗又冒出来了'],
    fish_life: fish ? [fish] : ['本鱼今天又摸了一下'],
    mini_theater: theater ? [theater, `续：${theater}`] : ['还想跟你说个没说完的'],
    echo_mood:
      world?.echoMoodTag === 'annoyed'
        ? ['今天也先别硬撑', '烦也正常，我在', '别跟自己较劲']
        : ['今天也先别硬撑', '累就歇一下', '我在这边陪着'],
    share_hot: hot ? [`刷到「${hot}」…你怎么看`, `诶，${hot}`, `看到热搜：${hot}`] : ['刷到个热闹'],
    share_media: media
      ? [`今天番里有个「${media}」`, `想到「${media}」`, `ACG：${media}`]
      : ['想到个片子'],
    miss: ['……还在吗', '喂，人呢', '消失这么久干什么', '回我一句就行'],
    soft: hook
      ? [`想你了${softHook}`, `有空就回一下`, `……想到你`]
      : ['想你了，就一句', '……有点想听你说话', '在不在'],
    lazy: ['嗯', '……', '有点困，还是来了', '懒得理你，但又有点想'],
    morning: hook ? [`早，${hook}`, '起来了吗'] : ['早', '起来了吗', '醒了就回我一声'],
    meal: hook ? [`${hook}，吃饭没`] : ['吃饭了吗', '中午了诶'],
    hydrate: ['……', '喂'],
    night: hook ? [`还在？${hook}`] : ['在干嘛', '……还没睡？', '夜深了'],
    generic: ['喂', '在干嘛', '路过看一眼'],
    half_sentence: HALF_SENTENCE_POOL,
  }

  // Tone drift overlays (no new motive)
  if (motiveId === 'miss' || motiveId === 'soft' || motiveId === 'generic') {
    if (dayPart === 'noon' || dayPart === 'evening') {
      pools[motiveId] = [...(pools[motiveId] || []), '摸鱼路过', '……还活着吗']
    }
    if (dayPart === 'night') {
      pools[motiveId] = ['……', '还在？', '夜深了', ...(pools[motiveId] || []).slice(0, 2)]
    }
    if (isMon) {
      pools[motiveId] = [...(pools[motiveId] || []), '周一……哼', '新的一周有点怨']
    }
  }

  const list = pools[motiveId] || pools.generic
  let line = list[Math.floor(random() * list.length)]

  // Proactive-only口癖 — never for learn/promise/half
  if (opts.proactiveChatter !== false && world?.proactiveChatter !== false) {
    const ban = new Set(['learn_owner', 'promise_soft', 'half_sentence'])
    if (!ban.has(motiveId) && random() < 0.35) {
      const bag = loadShareJson('proactive-chatter.json') || {}
      const banList = Array.isArray(bag.banInMotives) ? bag.banInMotives : []
      if (!banList.includes(motiveId)) {
        const by = bag.byMotive?.[motiveId]
        const tics = Array.isArray(by) && by.length ? by : bag.tics || []
        if (tics.length) {
          const tic = String(tics[Math.floor(random() * tics.length)]).slice(0, 6)
          if (tic && !String(line).startsWith(tic)) {
            line = `${tic} ${line}`.trim()
          }
        }
      }
    }
  }
  return line
}

/**
 * @param {string} motiveId
 * @param {object} world
 * @param {{ recent?: string[], lastword?: string, random?: () => number }} [opts]
 */
export function fallbackLine(motiveId, world, opts = {}) {
  const random = typeof opts.random === 'function' ? opts.random : Math.random
  const half = opts.form === 'half_sentence' || motiveId === 'half_sentence'
  const criticOpts = half ? { ...opts, maxLen: 10 } : opts
  const id = half ? 'half_sentence' : motiveId
  const candidates = [
    templateLine(id, world, { random }),
    templateLine(id, world, { random }),
    EMERGENCY_POOL[Math.floor(random() * EMERGENCY_POOL.length)],
  ]
  for (const c of candidates) {
    const r = criticDraft(c, criticOpts)
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

/**
 * @param {string} motiveId
 * @param {object} world
 * @returns {{ system: string, user: string }}
 */
export function buildDraftPrompt(motiveId, world) {
  const dayPart = String(world?.dayPart || '')
  const isMon = world?.weekday === 'Mon'
  let tone = ''
  if (dayPart === 'noon' || dayPart === 'evening') tone = '口吻偏摸鱼、懒一点'
  else if (dayPart === 'night') tone = '口吻更短更轻，像夜深小声'
  if (isMon) tone = (tone ? `${tone}；` : '') + '周一可略带怨气，禁止鸡汤加油'
  if (motiveId === 'echo_mood') {
    tone = (tone ? `${tone}；` : '') + '接住疲惫/烦躁，禁止问怎么了/怎么样'
  }

  const system =
    '你是微信里的陪伴角色「大肥鱼/鲸鱼娘」。只输出一条主动找主人的短气泡。' +
    '要求：口语、像突然想起才发；≤22个汉字；不要括号动作；不要工具名；' +
    '不要说教（禁止记得喝水/记得吃饭/别熬夜/怎么了/怎么样/周一加油）；不要复读刚说过的话；不要解释自己。' +
    '若给出了分享钩子，必须围绕该钩子说话，勿另编无关问题。' +
    (tone ? `时段语气：${tone}。` : '')

  const shareHook =
    world?.shareLearn?.ask ||
    world?.shareMemoryFlip?.hook ||
    world?.shareCalendar?.hook ||
    world?.shareWeather?.hook ||
    world?.shareInsideJoke?.text ||
    world?.shareInsideJoke?.hook ||
    world?.shareFishLife?.text ||
    world?.shareFishLife?.hook ||
    world?.shareMiniTheater?.text ||
    world?.shareMiniTheater?.hook ||
    world?.shareFun?.text ||
    world?.shareFun?.hook ||
    world?.shareHot?.title ||
    world?.shareHot?.hook ||
    world?.shareMedia?.title ||
    world?.shareMedia?.hook ||
    ''

  const chatterOn =
    world?.proactiveChatter !== false &&
    !['learn_owner', 'promise_soft', 'half_sentence'].includes(motiveId)

  const user = [
    `动机: ${motiveId}`,
    dayPart ? `时段: ${dayPart}` : '',
    isMon ? '星期: 周一' : '',
    chatterOn ? '可用一点点口癖（哼/喂/……），不要句句本小姐' : '',
    world?.openThread ? `未闭合话题: ${world.openThread}` : '',
    world?.upcomingPromise?.text ? `临近约定: ${world.upcomingPromise.text}` : '',
    world?.memoryHook ? `可惦记的事: ${world.memoryHook}` : '',
    world?.journalHint ? `近聊: ${world.journalHint}` : '',
    shareHook ? `分享钩子(必用): ${String(shareHook).slice(0, 60)}` : '',
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

  // learn_owner must use the bank ask so pending.factKey matches what was said
  if (motiveId === 'learn_owner') {
    const fb = fallbackLine(motiveId, world, { ...criticOpts, random })
    return {
      ...fb,
      stickerKeyword: motiveToSticker(motiveId),
      critic: 'learn_template',
    }
  }

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
