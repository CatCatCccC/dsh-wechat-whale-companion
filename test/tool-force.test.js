import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createToolForceState,
  markStickerSent,
  needsStickerFallback,
  onOwnerTurnForSticker,
} from '../lib/core/tool-force.js'

describe('tool force sticker cadence', () => {
  it('pending after everyN non-trivial turns', () => {
    let s = createToolForceState()
    for (let i = 0; i < 3; i++) {
      s = onOwnerTurnForSticker(s, `消息${i}`, { everyN: 4 })
      assert.equal(s.pendingSticker, false)
    }
    s = onOwnerTurnForSticker(s, '第四轮正经聊', { everyN: 4 })
    assert.equal(s.pendingSticker, true)
    assert.equal(needsStickerFallback(s), true)
    s = markStickerSent(s)
    assert.equal(s.pendingSticker, false)
    assert.equal(s.turnsSinceSticker, 0)
    assert.equal(needsStickerFallback(s), false)
  })

  it('ignores trivial hi', () => {
    let s = createToolForceState({ turnsSinceSticker: 3 })
    s = onOwnerTurnForSticker(s, '在吗', { everyN: 4 })
    assert.equal(s.pendingSticker, false)
    assert.equal(s.turnsSinceSticker, 3)
  })
})
