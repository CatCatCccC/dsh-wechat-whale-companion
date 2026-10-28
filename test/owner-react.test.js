import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { reactToOwnerText } from '../lib/modules/owner-react.js'

describe('reactToOwnerText', () => {
  it('treats brush-offs as dismiss', () => {
    const r = reactToOwnerText('哦')
    assert.equal(r.kind, 'dismiss')
    assert.equal(r.moodDelta, -1.5)
    assert.ok(r.affinityDelta < 0.1)
  })

  it('boosts on apology / soft', () => {
    const r = reactToOwnerText('对不起啦，刚才没回你')
    assert.equal(r.kind, 'apology')
    assert.equal(r.moodDelta, 2)
    assert.equal(r.affinityDelta, 0.4)
  })

  it('short soft lines are not dismiss (爱你/想你/在吗)', () => {
    for (const t of ['爱你', '想你', '抱抱', '么么']) {
      const r = reactToOwnerText(t)
      assert.equal(r.kind, 'apology', t)
      assert.equal(r.moodDelta, 2, t)
    }
    const ping = reactToOwnerText('在吗')
    assert.equal(ping.kind, 'normal')
    assert.equal(ping.moodDelta, 0)
  })

  it('does not soft-boost 不喜欢你', () => {
    const r = reactToOwnerText('不喜欢你了')
    assert.notEqual(r.kind, 'apology')
  })

  it('boosts on praise', () => {
    const r = reactToOwnerText('你好可爱')
    assert.equal(r.kind, 'praise')
    assert.equal(r.moodDelta, 1.5)
  })

  it('penalizes 大肥鱼', () => {
    const r = reactToOwnerText('大肥鱼出来')
    assert.equal(r.kind, 'fatfish')
    assert.equal(r.fatFish, true)
    assert.equal(r.moodDelta, -2)
  })

  it('stacks fatfish onto dismiss', () => {
    // unlikely but: short + fatfish in longer string
    const r = reactToOwnerText('大肥鱼')
    assert.equal(r.fatFish, true)
    assert.ok(r.moodDelta <= -2)
  })

  it('normal chat keeps mild affinity', () => {
    const r = reactToOwnerText('今天加班好累啊')
    assert.equal(r.kind, 'normal')
    assert.equal(r.affinityDelta, 0.15)
    assert.equal(r.moodDelta, 0)
    assert.equal(r.energyDelta, -1)
  })
})
