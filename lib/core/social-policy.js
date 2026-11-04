/**
 * Per-owner social policy for proactive pings: motive weights + cooldown bias.
 * Updated from owner replies (dismiss / engage / annoyance).
 */

export const DEFAULT_MOTIVE_WEIGHTS = {
  continue_thread: 1.15,
  promise_soft: 1.25,
  learn_owner: 1.2,
  memory_flip: 1.05,
  calendar: 0.95,
  weather: 0.9,
  fun_bit: 0.75,
  inside_joke: 0.95,
  fish_life: 0.7,
  mini_theater: 0.45,
  echo_mood: 1.05,
  share_hot: 0.7,
  share_media: 0.7,
  miss: 1.0,
  soft: 1.0,
  lazy: 0.85,
  morning: 0.55,
  meal: 0.35,
  hydrate: 0.2,
  night: 0.55,
  generic: 0.3,
}

export const DEFAULT_POLICY = {
  version: 1,
  weights: { ...DEFAULT_MOTIVE_WEIGHTS },
  /** Extra minutes added to proactive cooldown after annoyance */
  cooldownBiasMin: 0,
  /** Soft cap on daily pings (agenda also tracks) */
  dailyMax: 3,
  samples: 0,
  updatedAt: 0,
}

/**
 * @param {unknown} raw
 */
export function normalizePolicy(raw) {
  const base = { ...DEFAULT_POLICY, weights: { ...DEFAULT_MOTIVE_WEIGHTS } }
  if (!raw || typeof raw !== 'object') return base
  const src = /** @type {Record<string, unknown>} */ (raw)
  const weightsIn =
    src.weights && typeof src.weights === 'object'
      ? /** @type {Record<string, number>} */ (src.weights)
      : {}
  const weights = { ...DEFAULT_MOTIVE_WEIGHTS }
  for (const [k, v] of Object.entries(weightsIn)) {
    if (k in weights && Number.isFinite(Number(v))) {
      weights[k] = clamp(Number(v), 0.05, 2.5)
    }
  }
  return {
    version: 1,
    weights,
    cooldownBiasMin: clamp(Number(src.cooldownBiasMin) || 0, 0, 180),
    dailyMax: clamp(Math.round(Number(src.dailyMax) || DEFAULT_POLICY.dailyMax), 1, 8),
    samples: Math.max(0, Math.round(Number(src.samples) || 0)),
    updatedAt: Number(src.updatedAt) || 0,
  }
}

/**
 * @param {ReturnType<typeof normalizePolicy>} policy
 * @param {string} motiveId
 * @param {'engage'|'dismiss'|'annoy'|'ignore'} kind
 */
export function applyFeedback(policy, motiveId, kind) {
  const next = normalizePolicy(policy)
  const id = String(motiveId || 'generic')
  if (!(id in next.weights)) {
    next.weights[id] = DEFAULT_MOTIVE_WEIGHTS.generic
  }
  const w = next.weights[id]
  if (kind === 'engage') {
    next.weights[id] = clamp(w * 1.08 + 0.04, 0.05, 2.5)
    next.cooldownBiasMin = clamp(next.cooldownBiasMin - 2, 0, 180)
  } else if (kind === 'dismiss') {
    next.weights[id] = clamp(w * 0.92 - 0.02, 0.05, 2.5)
  } else if (kind === 'annoy') {
    next.weights[id] = clamp(w * 0.7 - 0.08, 0.05, 2.5)
    next.cooldownBiasMin = clamp(next.cooldownBiasMin + 25, 0, 180)
    next.dailyMax = clamp(next.dailyMax - 1, 1, 8)
  } else if (kind === 'ignore') {
    next.weights[id] = clamp(w * 0.96, 0.05, 2.5)
  }
  next.samples += 1
  next.updatedAt = Date.now()
  return next
}

/**
 * Classify owner reply quality for learning (no LLM).
 * @param {string} text
 * @param {{ lastProactiveAt?: number, now?: number }} [opts]
 */
export function classifyOwnerReply(text, opts = {}) {
  const t = String(text || '').trim()
  const now = Number(opts.now) || Date.now()
  const lastAt = Number(opts.lastProactiveAt) || 0
  if (!lastAt || now - lastAt > 45 * 60 * 1000) {
    return { kind: /** @type {const} */ ('none'), withinWindow: false }
  }
  if (/别烦|少发|别老发|别一直发|吵死了|安静点|别找我|别艾特|别打扰|别催/.test(t)) {
    return { kind: /** @type {const} */ ('annoy'), withinWindow: true }
  }
  if (/^(哦+|嗯+|啊+|呃+|额+|行|好|ok|OK|哦了|嗯嗯|哈哈|呵呵)$/i.test(t) || t.length <= 2) {
    return { kind: /** @type {const} */ ('dismiss'), withinWindow: true }
  }
  if (t.length >= 8 || /想你|在忙|刚才|不好意思|爱你|哈哈[哈啊]/.test(t)) {
    return { kind: /** @type {const} */ ('engage'), withinWindow: true }
  }
  return { kind: /** @type {const} */ ('dismiss'), withinWindow: true }
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n))
}
