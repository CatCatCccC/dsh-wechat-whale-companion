import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeConfig, parseDelayRange } from '../lib/core/config.js'

describe('config', () => {
  it('merges module overrides', () => {
    const c = normalizeConfig({
      ownerWxid: 'wx_a',
      modules: { rhythm: { inboundMergeMs: 1500 }, mention: { enabled: true } },
    })
    assert.equal(c.ownerWxid, 'wx_a')
    assert.equal(c.modules.rhythm.inboundMergeMs, 1500)
    assert.equal(c.modules.rhythm.enabled, true)
    assert.equal(c.modules.mention.enabled, true)
  })

  it('parses delay range', () => {
    assert.deepEqual(parseDelayRange('100,300'), [100, 300])
  })
})
