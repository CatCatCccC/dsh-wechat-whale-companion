import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  resetCompanion,
  parseWhaleResetLine,
  handleWhaleResetText,
} from '../lib/modules/reset.js'

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

  it('parses /whale-reset lines', () => {
    assert.deepEqual(parseWhaleResetLine('/whale-reset all'), {
      scope: 'all',
      rawInput: 'all',
    })
    assert.equal(parseWhaleResetLine('whale-reset all'), null)
    assert.equal(parseWhaleResetLine('/help'), null)
  })

  it('text fallback speaks and clears', async () => {
    let spoke = ''
    let mem = 0
    const runtime = {
      stats: {},
      speak: async (t) => {
        spoke = t
      },
      memory: {
        reset() {
          mem++
          return { ok: true }
        },
      },
    }
    assert.equal(handleWhaleResetText(runtime, '/whale-reset memory'), true)
    assert.equal(mem, 1)
    await new Promise((r) => setTimeout(r, 10))
    assert.match(spoke, /已清空/)
  })
})
