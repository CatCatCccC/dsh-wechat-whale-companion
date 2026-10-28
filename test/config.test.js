import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeConfig, parseDelayRange } from '../lib/core/config.js'

describe('config', () => {
  it('merges module overrides', () => {
    const c = normalizeConfig({
      ownerWxid: 'wx_a',
      modules: { rhythm: { bubbleDelayMs: '100,300' }, media: { voice: true } },
    })
    assert.equal(c.ownerWxid, 'wx_a')
    assert.equal(c.modules.rhythm.bubbleDelayMs, '100,300')
    assert.equal(c.modules.rhythm.enabled, true)
    assert.equal(c.modules.media.voice, true)
    assert.equal(c.modules.prompt.scope, 'wechat')
    assert.equal(c.modules.stamp, undefined)
    assert.equal(c.modules.mention, undefined)
  })

  it('parses delay range', () => {
    assert.deepEqual(parseDelayRange('100,300'), [100, 300])
  })
})
