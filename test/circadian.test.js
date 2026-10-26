import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyNurture } from '../lib/modules/nurture.js'
import { StateStore } from '../lib/core/state.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { normalizeConfig } from '../lib/core/config.js'

describe('circadian', () => {
  it('activeHours ignores zero buckets', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-circ-'))
    const runtime = {
      config: normalizeConfig({}),
      store: new StateStore(dir),
      stats: {},
      log: console,
    }
    const dispose = applyNurture({}, runtime)
    // Fresh state: no activity → empty list (must NOT be length 5 of zeros)
    assert.deepEqual(runtime.circadian.activeHours(), [])
    // One real hour
    const at = new Date()
    at.setHours(21, 0, 0, 0)
    runtime.circadian.touch(at.getTime())
    assert.deepEqual(runtime.circadian.activeHours(), [21])
    dispose()
  })
})
