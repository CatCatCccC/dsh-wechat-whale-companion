import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sendPacedBubbles } from '../lib/modules/rhythm.js'

describe('rhythm outbound pacing', () => {
  it('sends split bubbles with delay between them', async () => {
    const sent = []
    const adapter = {
      async sendText(text) {
        sent.push(text)
      },
    }
    const t0 = Date.now()
    const result = await sendPacedBubbles(
      adapter,
      '第一句\n---wx-next---\n第二句',
      [20, 20],
    )
    const elapsed = Date.now() - t0
    assert.equal(result.sent, 2)
    assert.deepEqual(sent, ['第一句', '第二句'])
    assert.ok(elapsed >= 15, 'should wait between bubbles')
  })

  it('skips when channel has no sendText', async () => {
    const result = await sendPacedBubbles({}, 'hi', [0, 0])
    assert.equal(result.sent, 0)
    assert.equal(result.skipped, 'no-sendText')
  })
})
