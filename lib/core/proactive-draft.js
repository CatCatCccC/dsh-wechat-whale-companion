/**
 * Proactive line drafting (tiered):
 * - learn_owner / half_sentence: bank or short pool (no LLM)
 * - material motives: LLM (+1 retry), fail → skip
 * - miss/soft/…: LLM (+1 retry), fail → ultra-short neutral
 * - promise alarm: caller may force hardFallback line
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
 * Proactive-only口癖 prefix. Skip learn / promise / half_sentence.
 * @param {string} line
 * @param {string} motiveId
 * @param {object} [world]
 * @param {{ random?: () => number, proactiveChatter?: boolean }} [opts]
 */
export function prefixChatter(line, motiveId, world = {}, opts = {}) {
  let out = String(line || '')
  if (!out) return out
  if (opts.proactiveChatter === false || world?.proactiveChatter === false) return out
  const ban = new Set(['learn_owner', 'promise_soft', 'half_sentence'])
  if (ban.has(motiveId)) return out
  const random = typeof opts.random === 'function' ? opts.random : Math.random
  if (random() >= 0.35) return out
  const bag = loadShareJson('proactive-chatter.json') || {}
  const banList = Array.isArray(bag.banInMotives) ? bag.banInMotives : []
  if (banList.includes(motiveId)) return out
  const by = bag.byMotive?.[motiveId]
  const tics = Array.isArray(by) && by.length ? by : bag.tics || []
  if (!tics.length) return out
  const tic = String(tics[Math.floor(random() * tics.length)]).slice(0, 6)
  if (tic && !out.startsWith(tic)) out = `${tic} ${out}`.trim()
  return out
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

  /** @type {Record<string, string[]>} LLM-fail fallback only (except learn_owner). */
  const pools = {
    continue_thread: hook
      ? [`诶，${hook}…咋样了`, `${hook}还算数吗`]
      : ['刚才那事…', '诶，说到一半呢'],
    promise_soft: hook
      ? [`差点忘了，${hook}`, `${hook}还作数吧`, `诶，${hook}`]
      : ['差点忘了跟你说约定'],
    learn_owner: learnAsk ? [learnAsk] : ['突然想问你一句，你在吗'],
    memory_flip: flip
      ? [`诶你说过${flip}`, `还记不记得——${flip}`]
      : ['又想起你说过的一句'],
    calendar: cal ? [`${cal}诶`, `对了，${cal}`] : ['今天有点特别'],
    weather: wx ? [`外面${wx}`, `喂，${wx}`] : ['外面天气有点怪'],
    fun_bit: fun ? [fun.slice(0, 22)] : ['跟你说个无聊的'],
    inside_joke: joke
      ? [String(joke).slice(0, 22), '你那句又晃出来了']
      : ['咱俩那个梗又冒出来了'],
    fish_life: fish ? [fish.slice(0, 22)] : ['本鱼今天又摸了一下'],
    mini_theater: theater ? [theater.slice(0, 22)] : ['还想跟你说个没说完的'],
    echo_mood:
      world?.echoMoodTag === 'annoyed'
        ? ['今天也先别硬撑', '烦也正常，我在', '别跟自己较劲']
        : ['今天也先别硬撑', '累就歇一下', '我在这边陪着'],
    share_hot: hot ? [`诶刷到「${hot}」`, `${hot}…你怎么看`] : ['刷到个热闹'],
    share_media: media ? [`想到「${media}」`, `番里那个「${media}」`] : ['想到个片子'],
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
  const line = list[Math.floor(random() * list.length)]
  return prefixChatter(line, motiveId, world, opts)
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
/** Motives whose hooks are material for the LLM (not parrot / template paste). */
const MATERIAL_MOTIVES = new Set([
  'inside_joke',
  'memory_flip',
  'continue_thread',
  'promise_soft',
  'learn_owner',
  'calendar',
  'weather',
  'fun_bit',
  'fish_life',
  'mini_theater',
  'share_hot',
  'share_media',
])

/**
 * @param {string} motiveId
 * @param {object} world
 * @returns {{ label: string, text: string }|null}
 */
export function materialForMotive(motiveId, world) {
  const pick = (...xs) => {
    for (const x of xs) {
      const t = String(x || '').trim()
      if (t) return t
    }
    return ''
  }
  switch (motiveId) {
    case 'inside_joke':
      return {
        label: '主人说过',
        text: pick(world?.shareInsideJoke?.text, world?.shareInsideJoke?.hook),
      }
    case 'memory_flip':
      return {
        label: '主人说过',
        text: pick(world?.shareMemoryFlip?.hook, world?.memoryHook),
      }
    case 'continue_thread':
      return { label: '未闭合话题', text: pick(world?.openThread) }
    case 'promise_soft':
      return { label: '约定', text: pick(world?.upcomingPromise?.text) }
    case 'learn_owner':
      return {
        label: '想问主人的点',
        text: pick(world?.shareLearn?.ask, world?.shareLearn?.hook),
      }
    case 'calendar':
      return { label: '日子', text: pick(world?.shareCalendar?.hook) }
    case 'weather':
      return { label: '天气', text: pick(world?.shareWeather?.hook) }
    case 'fun_bit':
      return {
        label: '趣闻素材',
        text: pick(world?.shareFun?.text, world?.shareFun?.hook),
      }
    case 'fish_life':
      return {
        label: '本鱼生活素材',
        text: pick(world?.shareFishLife?.text, world?.shareFishLife?.hook),
      }
    case 'mini_theater':
      return {
        label: '小剧场素材',
        text: pick(world?.shareMiniTheater?.text, world?.shareMiniTheater?.hook),
      }
    case 'share_hot':
      return {
        label: '热搜',
        text: pick(world?.shareHot?.title, world?.shareHot?.hook),
      }
    case 'share_media':
      return {
        label: '番/片',
        text: pick(world?.shareMedia?.title, world?.shareMedia?.hook),
      }
    default:
      return null
  }
}

export function buildDraftPrompt(motiveId, world, opts = {}) {
  const dayPart = String(world?.dayPart || '')
  const isMon = world?.weekday === 'Mon'
  const half = opts.form === 'half_sentence' || motiveId === 'half_sentence'
  const material = MATERIAL_MOTIVES.has(motiveId) ? materialForMotive(motiveId, world) : null
  const hasMaterial = Boolean(material?.text)
  let tone = ''
  if (dayPart === 'noon' || dayPart === 'evening') tone = '口吻偏摸鱼、懒一点'
  else if (dayPart === 'night') tone = '口吻更短更轻，像夜深小声'
  if (isMon) tone = (tone ? `${tone}；` : '') + '周一可略带怨气，禁止鸡汤加油'
  if (motiveId === 'echo_mood') {
    tone = (tone ? `${tone}；` : '') + '接住疲惫/烦躁，禁止问怎么了/怎么样'
  }

  const maxChars = half ? 6 : 22
  let system =
    '你是微信里的陪伴角色「大肥鱼/鲸鱼娘」。只输出一条主动找主人的短气泡。' +
    `要求：口语、像忽然想到才发；≤${maxChars}个汉字；不要括号动作；不要工具名；` +
    '禁止「突然想起：」「忽然想到：」「看到热搜：」「ACG：」这类公式前缀；' +
    '不要说教（禁止记得喝水/记得吃饭/别熬夜/怎么了/怎么样/周一加油）；不要复读刚说过的话；不要解释自己。'
  if (hasMaterial) {
    system +=
      motiveId === 'learn_owner'
        ? '下面是题库想问的点：用你自己的口吻问同一件事，可改措辞，不要跑题，不要整句复读题库原文。'
        : '下面素材请你自己组织成一句自然气泡：围绕素材说，禁止整段复读，禁止套公式前缀。'
  }
  if (half) system += '这次只要半截短音，像欲言又止。'
  if (tone) system += `时段语气：${tone}。`

  const chatterOn =
    world?.proactiveChatter !== false &&
    !['learn_owner', 'promise_soft', 'half_sentence'].includes(motiveId)

  const user = [
    `动机: ${motiveId}`,
    dayPart ? `时段: ${dayPart}` : '',
    isMon ? '星期: 周一' : '',
    chatterOn ? '可用一点点口癖（哼/喂/……），不要句句本小姐' : '',
    !hasMaterial && world?.openThread ? `未闭合话题: ${world.openThread}` : '',
    !hasMaterial && world?.upcomingPromise?.text
      ? `临近约定: ${world.upcomingPromise.text}`
      : '',
    !hasMaterial && world?.memoryHook ? `可惦记的事: ${world.memoryHook}` : '',
    world?.journalHint ? `近聊: ${world.journalHint}` : '',
    hasMaterial
      ? `${material.label}(素材，请你自己组织成一句气泡，勿整段复读): ${String(material.text).slice(0, 80)}`
      : '',
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
    form = 'text',
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

  const { system, user } = buildDraftPrompt(motiveId, world, { form })
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
      maxTokens: form === 'half_sentence' ? Math.min(maxTokens, 24) : maxTokens,
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

/** Presence / vibe motives: ultra-short neutral OK if LLM fails. */
export const SOFT_FALLBACK_MOTIVES = new Set([
  'miss',
  'soft',
  'lazy',
  'generic',
  'morning',
  'meal',
  'hydrate',
  'night',
  'echo_mood',
])

/**
 * Alarm / due reminder — reliability over style.
 * @param {{ text?: string }|null|undefined} item
 */
export function alarmFallbackLine(item) {
  return /起床|叫醒|喊我|闹钟|醒/.test(String(item?.text || ''))
    ? '喂，到点了||快起来。'
    : '对了，到点了哦'
}

/**
 * Ultra-short neutral line (no formula prefix).
 * @param {{ recent?: string[], lastword?: string, random?: () => number }} [opts]
 */
export function softNeutralLine(opts = {}) {
  const random = typeof opts.random === 'function' ? opts.random : Math.random
  const pool = EMERGENCY_POOL.filter(
    (l) => !tooSimilar(l, opts.lastword || '') && !(opts.recent || []).some((r) => tooSimilar(l, r)),
  )
  const pick = pool.length ? pool : EMERGENCY_POOL
  const line = pick[Math.floor(random() * pick.length)] || '喂'
  const judged = criticDraft(line, { ...opts, maxLen: 10 })
  return judged.ok ? judged.text : '喂'
}

/**
 * Full draft pipeline — tiered LLM + selective safety net.
 * @param {object} input
 * @returns {Promise<{ ok: boolean, line: string, source: string, critic: string, stickerKeyword?: string, route?: string, error?: string }>}
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
    form = 'text',
    /** When true (alarm due), promise_soft gets hardFallback after LLM fail */
    hardFallback = false,
    random = Math.random,
  } = input

  const half = form === 'half_sentence' || motiveId === 'half_sentence'
  const criticOpts = { recent, lastword, maxLen: half ? 10 : undefined }
  const stickerKeyword = motiveToSticker(motiveId)
  const routeLabel = (route) =>
    route ? `${route.provider}/${route.model}` : undefined

  const okResult = (line, source, critic, extra = {}) => ({
    ok: true,
    line,
    source,
    critic,
    stickerKeyword,
    ...extra,
  })
  const fail = (critic, extra = {}) => ({
    ok: false,
    line: '',
    source: 'none',
    critic,
    stickerKeyword,
    ...extra,
  })

  // --- no-LLM paths ---
  if (half) {
    const line = softNeutralLine({ recent, lastword, random })
    return okResult(line, 'half_pool', 'half_sentence')
  }
  if (motiveId === 'learn_owner') {
    const ask = String(world?.shareLearn?.ask || '').trim().slice(0, 40)
    if (!ask) return fail('learn_empty')
    const judged = criticDraft(ask, { ...criticOpts, maxLen: 40 })
    if (!judged.ok) return fail(judged.reason || 'learn_reject')
    return okResult(judged.text, 'learn_bank', 'learn_bank')
  }

  const applySafetyNet = (critic, extra = {}) => {
    if (hardFallback && motiveId === 'promise_soft') {
      return okResult(alarmFallbackLine(world?.upcomingPromise), 'alarm_fallback', critic, extra)
    }
    if (SOFT_FALLBACK_MOTIVES.has(motiveId)) {
      return okResult(softNeutralLine({ recent, lastword, random }), 'soft_fallback', critic, extra)
    }
    return fail(critic, extra)
  }

  if (!enabledLlm) return applySafetyNet('llm_off')
  if (!ctx) return applySafetyNet('no_ctx')

  const route = resolveDshModel(ctx, { provider, model, reasoningEffort, agentId })
  const hasLlm = Boolean(llm?.stream || softGet(ctx, 'llm')?.stream)
  if (!route || !hasLlm) return applySafetyNet('no_dsh_llm')

  const waitMs = Number.isFinite(timeoutMs) ? timeoutMs : 12000
  let lastCritic = 'llm_fail'
  let lastError = ''

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await Promise.race([
        draftWithDshLlm({
          ctx,
          llm,
          motiveId,
          world,
          form,
          provider: route.provider,
          model: route.model,
          reasoningEffort: route.reasoningEffort,
          timeoutMs: waitMs,
          temperature: attempt === 0 ? 0.9 : 0.7,
        }),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('draft timeout')), waitMs + 500)
        }),
      ])
      const judged = criticDraft(raw, criticOpts)
      if (judged.ok) {
        return okResult(judged.text, 'dsh-llm', attempt === 0 ? 'pass' : 'pass_retry', {
          route: routeLabel(route),
        })
      }
      lastCritic = judged.reason || 'reject'
    } catch (err) {
      lastCritic = 'llm_fail'
      lastError = String(err?.message || err).slice(0, 80)
    }
  }

  return applySafetyNet(lastCritic, {
    route: routeLabel(route),
    ...(lastError ? { error: lastError } : {}),
  })
}
