/**
 * Motive scoring: only fire proactive when there is a real social reason.
 */

import { DEFAULT_MOTIVE_WEIGHTS } from './social-policy.js'

/** Motives that may fire without a personal hook (still need silence / mood). */
const WEAK_RHYTHM = new Set(['morning', 'meal', 'hydrate', 'night', 'generic', 'fun_bit'])

/**
 * @typedef {{ id: string, score: number, hook: string, formBias: string }} MotiveCandidate
 */

/**
 * @param {object} world from buildWorldState
 * @param {{ weights?: Record<string, number>, preferred?: string[] }} [policy]
 * @param {{ random?: () => number, minScore?: number }} [opts]
 * @returns {{ pick: MotiveCandidate|null, ranked: MotiveCandidate[], reason?: string }}
 */
export function pickMotive(world, policy = {}, opts = {}) {
  const random = typeof opts.random === 'function' ? opts.random : Math.random
  const minScore = Number.isFinite(opts.minScore) ? opts.minScore : 0.48
  const weights = { ...DEFAULT_MOTIVE_WEIGHTS, ...(policy.weights || {}) }
  const preferred = new Set(policy.preferred || [])
  const ranked = scoreMotives(world, weights, random)

  for (const m of ranked) {
    if (preferred.has(m.id)) m.score *= 1.12
  }
  ranked.sort((a, b) => b.score - a.score)

  const viable = ranked.filter((m) => m.score >= minScore)
  if (!viable.length) {
    return { pick: null, ranked, reason: 'no_motive' }
  }

  // Prefer hooked motives strongly over weak rhythm care scripts
  const hooked = viable.filter((m) => m.hook && !WEAK_RHYTHM.has(m.id))
  const pool = hooked.length ? hooked : viable.filter((m) => !WEAK_RHYTHM.has(m.id))
  const use = pool.length ? pool : viable

  // Soft random among top 2 to avoid always same motive
  const top = use.slice(0, 2)
  const pick = top.length > 1 && random() < 0.35 ? top[1] : top[0]
  return { pick, ranked }
}

/**
 * @param {object} world
 * @param {Record<string, number>} weights
 * @param {() => number} random
 * @returns {MotiveCandidate[]}
 */
export function scoreMotives(world, weights, random = Math.random) {
  const w = { ...DEFAULT_MOTIVE_WEIGHTS, ...weights }
  const silentH = Number(world.silentH) || 0
  const hour = Number(world.hour)
  const mood = Number(world.mood)
  const energy = Number(world.energy)
  const affinity = Number(world.affinity)
  const tier = String(world.tier || '')
  /** @type {MotiveCandidate[]} */
  const out = []

  const push = (id, raw, hook = '', formBias = 'text') => {
    const ww = Number.isFinite(w[id]) ? w[id] : 1
    const score = raw * ww
    if (score <= 0.05) return
    out.push({ id, score, hook: String(hook || '').slice(0, 36), formBias })
  }

  if (world.openThread) {
    push('continue_thread', 0.88 + Math.min(0.1, silentH / 20), world.openThread, 'text')
  }

  if (world.upcomingPromise?.text) {
    push('promise_soft', 0.92, world.upcomingPromise.text, 'text')
  }

  // Share layer (learn / flip / calendar / weather / fun / external)
  if (world.shareLearn?.ask && silentH >= 0.75) {
    push('learn_owner', 0.82, world.shareLearn.ask, 'text')
  }
  if (world.shareMemoryFlip?.hook && silentH >= 1) {
    push('memory_flip', 0.72, world.shareMemoryFlip.hook, 'text')
  }
  if (world.shareCalendar?.hook) {
    push('calendar', 0.7, world.shareCalendar.hook, 'text_then_sticker')
  }
  if (world.shareWeather?.hook && silentH >= 0.5) {
    push('weather', 0.68, world.shareWeather.hook, 'text')
  }
  if (world.shareFun?.hook && silentH >= 0.5) {
    push('fun_bit', 0.55, world.shareFun.hook, 'text')
  }
  if (world.shareHot?.hook && silentH >= 1) {
    push('share_hot', 0.58, world.shareHot.hook, 'text')
  }
  if (world.shareMedia?.hook && silentH >= 1) {
    push('share_media', 0.58, world.shareMedia.hook, 'text')
  }

  const hasShare =
    world.shareLearn ||
    world.shareMemoryFlip ||
    world.shareCalendar ||
    world.shareWeather ||
    world.shareFun ||
    world.shareHot ||
    world.shareMedia

  if (silentH >= 5) {
    push(
      'miss',
      hasShare ? 0.42 : Math.min(0.95, 0.5 + silentH / 18),
      world.memoryHook || world.openThread || '',
      silentH >= 10 ? 'text_then_sticker' : 'text',
    )
  } else if (silentH >= 2.5 && affinity >= 50) {
    push('miss', hasShare ? 0.35 : 0.52, world.memoryHook || '', 'text')
  }

  if ((tier === 'bond' || tier === 'close' || affinity >= 58) && silentH >= 1.2) {
    push('soft', 0.55 + Math.min(0.2, affinity / 400), world.memoryHook || '', 'text_then_sticker')
  }

  if ((energy < 38 || mood < 42) && silentH >= 1.5) {
    push('lazy', 0.58, '', random() < 0.4 ? 'sticker_only' : 'text')
  }

  // Weak rhythm — only with silence + optional personal hook; hydrate nearly off
  if (hour >= 6 && hour < 10 && silentH >= 1.5) {
    push('morning', world.memoryHook ? 0.5 : 0.38, world.memoryHook || '', 'text_then_sticker')
  }
  if (((hour >= 11 && hour < 13) || (hour >= 17 && hour < 19)) && silentH >= 2) {
    // meal only if we have a hook or long silence — avoid "记得吃饭" spam
    const mealRaw = world.memoryHook || silentH >= 4 ? 0.42 : 0.22
    push('meal', mealRaw, world.memoryHook || '', 'text')
  }
  if (hour >= 14 && hour < 17 && silentH >= 3.5 && w.hydrate > 0.35) {
    push('hydrate', 0.28, '', 'sticker_only')
  }
  if ((hour >= 22 || hour < 1) && silentH >= 1.5) {
    push('night', world.openThread ? 0.5 : 0.4, world.openThread || '', 'text')
  }

  if (silentH >= 3 && out.every((m) => m.score < 0.5)) {
    push('generic', 0.36, '', 'text')
  }

  out.sort((a, b) => b.score - a.score)
  return out
}

/**
 * Map motive → sticker keyword / emergency pool intent.
 * @param {string} motiveId
 */
export function motiveToSticker(motiveId) {
  const map = {
    continue_thread: '疑惑',
    promise_soft: '比心',
    learn_owner: '疑惑',
    memory_flip: '想你',
    calendar: '开心',
    weather: '日常',
    fun_bit: '傲娇',
    share_hot: '疑惑',
    share_media: '开心',
    miss: '想你',
    soft: '比心',
    lazy: '困了',
    morning: '早安',
    meal: '干饭',
    hydrate: '喝水',
    night: '晚安',
    generic: '傲娇',
  }
  return map[motiveId] || '傲娇'
}

/**
 * Decide send form from motive + sticker chance.
 * @param {MotiveCandidate} motive
 * @param {number} stickerChance
 * @param {() => number} [random]
 * @returns {'text'|'sticker_only'|'text_then_sticker'|'sticker_then_text'}
 */
export function pickForm(motive, stickerChance = 0.28, random = Math.random) {
  const bias = motive?.formBias || 'text'
  if (bias === 'sticker_only') return 'sticker_only'
  const want = random() < (Number.isFinite(stickerChance) ? stickerChance : 0.28)
  if (!want) return 'text'
  if (bias === 'text_then_sticker') return 'text_then_sticker'
  if (bias === 'sticker_then_text') return 'sticker_then_text'
  return random() < 0.5 ? 'text_then_sticker' : 'text'
}
