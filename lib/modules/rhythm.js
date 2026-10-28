/**
 * Outbound bubble pacing for companion-initiated sends (speak / proactive / promise).
 * Inbound merge is not used: dsh-wechat already bridges WeChat → agent.
 */
import { parseDelayRange } from '../core/config.js'
import { splitBubbles } from './guard.js'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function randBetween(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1))
}

/**
 * @param {import('../core/wechat.js').WechatAdapter} adapter
 * @param {string} text
 * @param {[number, number]} delayRange
 * @param {object} [opts]
 */
export async function sendPacedBubbles(adapter, text, delayRange, opts = {}) {
  const bubbles = splitBubbles(text)
  if (!bubbles.length) return { sent: 0, bubbles: [] }
  if (!adapter?.sendText) {
    return { sent: 0, bubbles, skipped: 'no-sendText' }
  }
  let sent = 0
  for (let i = 0; i < bubbles.length; i++) {
    await adapter.sendText(bubbles[i], opts)
    sent++
    if (i < bubbles.length - 1) {
      await sleep(randBetween(delayRange[0], delayRange[1]))
    }
  }
  return { sent, bubbles }
}

/**
 * @param {any} ctx
 * @param {object} runtime
 */
export function applyRhythm(_ctx, runtime) {
  const mod = runtime.config.modules.rhythm
  if (!mod?.enabled) return () => {}

  const delayRange = parseDelayRange(mod.bubbleDelayMs)

  /** Queue outbound so proactive + speak don't interleave bubbles */
  let outChain = Promise.resolve()
  const sendPaced = (text, opts) => {
    const run = () => sendPacedBubbles(runtime.wechat, text, delayRange, opts)
    const done = outChain.then(run, run)
    outChain = done.catch(() => {})
    return done
  }

  runtime.rhythm = {
    delayRange,
    sendPaced,
  }

  return () => {}
}
