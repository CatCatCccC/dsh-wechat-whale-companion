/**
 * Inbound merge + outbound bubble pacing + deliver batch to agent.
 */
import { parseDelayRange } from '../core/config.js'
import { splitBubbles } from './guard.js'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function randBetween(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1))
}

export class InboundMerger {
  /**
   * @param {{ windowMs: number, onFlush: (batch: {peer:string, texts:string[], at:number}) => void | Promise<void> }} opts
   */
  constructor(opts) {
    this.windowMs = opts.windowMs
    this.onFlush = opts.onFlush
    /** @type {Map<string, { texts: string[], timer: NodeJS.Timeout | null, firstAt: number, lastAt: number }>} */
    this.buckets = new Map()
  }

  push(peer, text) {
    const key = peer || 'default'
    const now = Date.now()
    let b = this.buckets.get(key)
    if (!b) {
      // firstAt = start of burst (for gap stamp); lastAt tracks merge window
      b = { texts: [], timer: null, firstAt: now, lastAt: now }
      this.buckets.set(key, b)
    }
    b.texts.push(String(text ?? ''))
    b.lastAt = now
    if (b.timer) clearTimeout(b.timer)
    b.timer = setTimeout(() => this.flush(key), this.windowMs)
  }

  flush(key) {
    const b = this.buckets.get(key)
    if (!b) return
    this.buckets.delete(key)
    if (b.timer) clearTimeout(b.timer)
    if (!b.texts.length) return
    return this.onFlush({ peer: key, texts: b.texts, at: b.firstAt || b.lastAt })
  }

  flushAll() {
    for (const key of [...this.buckets.keys()]) {
      Promise.resolve(this.flush(key)).catch(() => {})
    }
  }
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
 * Stamp once per merged turn (not per bubble) so the model sees one gap.
 * @param {object} runtime
 * @param {{ peer: string, texts: string[], at: number }} batch
 */
export function joinBatchTexts(runtime, batch) {
  const raw = batch.texts.join('\n')
  if (!runtime.stamp?.wrap) return raw
  return runtime.stamp.wrap(raw, batch.peer, batch.at || Date.now())
}

export async function deliverBatchToAgent(ctx, runtime, batch) {
  const joined = joinBatchTexts(runtime, batch)
  runtime.stats.mergeFlushes = (runtime.stats.mergeFlushes || 0) + 1
  runtime.emit?.('rhythm/inbound-batch', { ...batch, joined })

  if (runtime.config.modules.rhythm?.deliverToAgent === false) {
    return { ok: false, skipped: 'deliverToAgent-disabled', joined }
  }

  // Prefer adopt session + followup / send
  try {
    const session =
      (await runtime.adopt?.openSession?.(batch.peer)) ||
      null
    const agent = session?.agent || session
    if (agent && typeof agent.followup === 'function') {
      await agent.followup(joined)
      runtime.stats.agentFollowups = (runtime.stats.agentFollowups || 0) + 1
      return { ok: true, via: 'followup', joined }
    }
    if (agent && typeof agent.send === 'function') {
      await agent.send(joined)
      runtime.stats.agentFollowups = (runtime.stats.agentFollowups || 0) + 1
      return { ok: true, via: 'send', joined }
    }
    if (ctx?.agents?.followup && runtime.adopt?.get?.(batch.peer)) {
      await ctx.agents.followup(runtime.adopt.get(batch.peer), joined)
      runtime.stats.agentFollowups = (runtime.stats.agentFollowups || 0) + 1
      return { ok: true, via: 'agents.followup', joined }
    }
  } catch (err) {
    runtime.log?.warn?.('[whale-companion] deliverBatchToAgent', err?.message || err)
    return { ok: false, error: String(err?.message || err), joined }
  }

  runtime.stats.agentDeliverSkipped = (runtime.stats.agentDeliverSkipped || 0) + 1
  return { ok: false, skipped: 'no-agent-api', joined }
}

/**
 * @param {any} ctx
 * @param {object} runtime
 */
export function applyRhythm(ctx, runtime) {
  const mod = runtime.config.modules.rhythm
  if (!mod?.enabled) return () => {}

  const delayRange = parseDelayRange(mod.bubbleDelayMs)
  const merger = new InboundMerger({
    windowMs: Number(mod.inboundMergeMs) || 2000,
    onFlush: (batch) => deliverBatchToAgent(ctx, runtime, batch),
  })

  /** Queue outbound so proactive + speak don't interleave bubbles */
  let outChain = Promise.resolve()
  const sendPaced = (text, opts) => {
    const run = () => sendPacedBubbles(runtime.wechat, text, delayRange, opts)
    const done = outChain.then(run, run)
    outChain = done.catch(() => {})
    return done
  }

  runtime.rhythm = {
    merger,
    delayRange,
    sendPaced,
    pushInbound: (peer, text) => merger.push(peer, text),
    deliverBatch: (batch) => deliverBatchToAgent(ctx, runtime, batch),
  }

  return () => merger.flushAll()
}
