import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { InboundMerger, joinBatchTexts } from '../lib/modules/rhythm.js'

describe('rhythm inbound merge', () => {
  it('flushes batched texts', async () => {
    /** @type {any} */
    let batch = null
    const m = new InboundMerger({
      windowMs: 30,
      onFlush: (b) => {
        batch = b
      },
    })
    m.push('peer1', 'a')
    m.push('peer1', 'b')
    await new Promise((r) => setTimeout(r, 50))
    assert.ok(batch)
    assert.deepEqual(batch.texts, ['a', 'b'])
  })

  it('stamps once per batch not per line', () => {
    let wraps = 0
    const runtime = {
      stamp: {
        wrap(content) {
          wraps += 1
          return `[stamp]\n${content}`
        },
      },
    }
    const out = joinBatchTexts(runtime, {
      peer: 'p',
      texts: ['hi', 'there'],
      at: Date.now(),
    })
    assert.equal(wraps, 1)
    assert.equal(out, '[stamp]\nhi\nthere')
  })

  it('flush uses firstAt of the burst', async () => {
    /** @type {any} */
    let batch = null
    const m = new InboundMerger({
      windowMs: 40,
      onFlush: (b) => {
        batch = b
      },
    })
    const t0 = Date.now()
    m.push('p', 'a')
    await new Promise((r) => setTimeout(r, 15))
    m.push('p', 'b')
    await new Promise((r) => setTimeout(r, 60))
    assert.ok(batch)
    assert.ok(batch.at >= t0 - 5)
    assert.ok(batch.at <= t0 + 30, 'at should be near first push, not last')
  })
})
