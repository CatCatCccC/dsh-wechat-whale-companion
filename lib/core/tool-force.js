/**
 * Code-side tool forcing: sticker cadence (not prompt-only).
 */

const TRIVIAL =
  /^(在吗|在不在|你好|哈喽|嗨|嗯+|哦+|噢+|好的?|行|ok|OK|哈哈+|嘿嘿+|？+|\.+|…+)$/

/**
 * @param {{ turnsSinceSticker?: number, pendingSticker?: boolean, stickerSentTurn?: boolean }} state
 */
export function createToolForceState(state = {}) {
  return {
    turnsSinceSticker: Number(state.turnsSinceSticker) || 0,
    pendingSticker: Boolean(state.pendingSticker),
    stickerSentTurn: Boolean(state.stickerSentTurn),
  }
}

/**
 * Call at start of owner turn (before model).
 * @param {object} state
 * @param {string} ownerText
 * @param {{ everyN?: number }} [opts]
 */
export function onOwnerTurnForSticker(state, ownerText, opts = {}) {
  const everyN = Math.max(2, Number(opts.everyN) || 4)
  const trivial = TRIVIAL.test(String(ownerText || '').trim())
  state.stickerSentTurn = false
  if (trivial) {
    state.pendingSticker = false
    return state
  }
  state.turnsSinceSticker = (Number(state.turnsSinceSticker) || 0) + 1
  if (state.turnsSinceSticker >= everyN) {
    state.pendingSticker = true
  }
  return state
}

/** Model or fallback successfully sent a sticker this turn. */
export function markStickerSent(state) {
  state.stickerSentTurn = true
  state.pendingSticker = false
  state.turnsSinceSticker = 0
  return state
}

/**
 * After assistant reply: need companion fallback send?
 * @param {object} state
 */
export function needsStickerFallback(state) {
  return Boolean(state.pendingSticker) && !state.stickerSentTurn
}

export function isTrivialOwner(text) {
  return TRIVIAL.test(String(text || '').trim())
}

/** Map numeric mood → meme tag */
export function moodToStickerTag(mood) {
  const n = Number(mood)
  if (!Number.isFinite(n)) return 'daily'
  if (n >= 70) return 'happy'
  if (n >= 50) return 'shy'
  if (n >= 35) return 'confused'
  return 'sad'
}
