import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MEMORY_ASK, STICKER_ASK } from '../lib/modules/prompt.js'

describe('prompt tool triggers', () => {
  it('catches sticker asks without bare「表情」false positives', () => {
    for (const t of ['我想要表情', '发个表情', '贴纸', '给我张图', '斗图', '来个表情']) {
      assert.equal(STICKER_ASK.test(t), true, t)
    }
    assert.equal(STICKER_ASK.test('在吗'), false)
    assert.equal(STICKER_ASK.test('你表情好狂啊'), false)
  })

  it('nudges memory on soft remember lines', () => {
    for (const t of ['记一下我喜欢吃鱼', '以后叫我主人', '别再提那个']) {
      assert.equal(MEMORY_ASK.test(t), true, t)
    }
  })
})
