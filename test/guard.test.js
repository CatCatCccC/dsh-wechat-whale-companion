import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cleanOutbound, splitBubbles } from '../lib/modules/guard.js'

describe('guard', () => {
  it('drops [[silent]]', () => {
    const r = cleanOutbound('[[silent]]')
    assert.equal(r.drop, true)
    assert.equal(r.reason, 'silent')
  })

  it('strips asides and stage lines', () => {
    const r = cleanOutbound('嗯\n（内心独白）\n我在等他回话')
    assert.equal(r.drop, false)
    assert.equal(r.text, '嗯')
  })

  it('splits wx-next bubbles', () => {
    const parts = splitBubbles('先这样\n---wx-next---\n你呢')
    assert.deepEqual(parts, ['先这样', '你呢'])
  })

  it('caps bubble count', () => {
    const parts = splitBubbles(
      'a\n---wx-next---\nb\n---wx-next---\nc\n---wx-next---\nd\n---wx-next---\ne',
      { maxBubbles: 3 },
    )
    assert.equal(parts.length, 3)
    assert.equal(parts[2], 'cde')
  })

  it('dedupes consecutive lines', () => {
    const r = cleanOutbound('哈\n哈\n哈')
    assert.equal(r.text, '哈')
  })
})
