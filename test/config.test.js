import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeConfig, parseDelayRange } from '../lib/core/config.js'

describe('config', () => {
  it('merges module overrides', () => {
    const c = normalizeConfig({
      ownerWxid: 'wx_a',
      modules: { rhythm: { bubbleDelayMs: '100,300' }, media: { enabled: false } },
    })
    assert.equal(c.ownerWxid, 'wx_a')
    assert.equal(c.modules.rhythm.bubbleDelayMs, '100,300')
    assert.equal(c.modules.rhythm.enabled, true)
    assert.equal(c.modules.media.enabled, false)
    assert.equal(c.modules.prompt.scope, 'wechat')
    assert.equal(c.modules.outbound.deliverAssistant, false)
    assert.equal(c.modules.persona.proactiveChance, 0.18)
    assert.equal(c.modules.persona.proactiveStickerChance, 0.28)
    assert.equal(c.modules.memory.enabled, true)
    assert.equal(c.modules.memory.halfLifeDays, 30)
    assert.equal(c.modules.stamp, undefined)
  })

  it('parses delay range', () => {
    assert.deepEqual(parseDelayRange('100,300'), [100, 300])
  })
})
