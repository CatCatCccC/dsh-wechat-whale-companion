import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatGap, injectUserBoundary } from '../lib/modules/stamp.js'

describe('stamp', () => {
  it('formats gaps', () => {
    assert.equal(formatGap(45000), '45s')
    assert.equal(formatGap(125000), '2m5s')
  })

  it('injects into user_message tag', () => {
    const out = injectUserBoundary('<user_message>hi</user_message>', {
      time: '2026-10-26T15:00:00+08:00',
      gap: '3m',
    })
    assert.match(out, /time="2026-10-26T15:00:00\+08:00"/)
    assert.match(out, /gap="3m"/)
  })
})
