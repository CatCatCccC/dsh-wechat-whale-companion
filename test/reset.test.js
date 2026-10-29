import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resetCompanion } from '../lib/modules/reset.js'

describe('resetCompanion', () => {
  it('clears memory via runtime hooks', () => {
    let mem = 0
    let mood = 0
    const runtime = {
      stats: {},
      memory: {
        reset() {
          mem++
          return { ok: true }
        },
      },
      persona: {
        reset() {
          mood++
          return { ok: true }
        },
      },
      diary: { clear: () => ({ ok: true }) },
      promise: { clear: () => ({ ok: true }) },
      circadian: { reset: () => ({ ok: true }) },
    }
    const r = resetCompanion(runtime, 'all')
    assert.equal(r.ok, true)
    assert.equal(mem, 1)
    assert.equal(mood, 1)
    assert.ok(r.cleared.includes('memory'))
    assert.ok(r.cleared.includes('mood'))
  })

  it('rejects unknown scope', () => {
    const r = resetCompanion({ stats: {} }, 'nope')
    assert.equal(r.ok, false)
  })
})
