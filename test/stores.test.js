import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StateStore } from '../lib/core/state.js'
import { STORE, loadStore, saveStore, migrateMood } from '../lib/core/stores.js'

describe('stores registry', () => {
  it('stamps version on legacy mood without version', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-stores-'))
    const store = new StateStore(dir)
    store.set(STORE.MOOD, { mood: 40, style: { shortBias: 0.9, samples: 3 } })
    const { data, upgraded } = loadStore(store, STORE.MOOD, { mood: 55 }, {})
    assert.equal(upgraded, true)
    assert.equal(data.version, 1)
    assert.equal(data.mood, 40)
    assert.equal(data.style, undefined)
    saveStore(store, STORE.MOOD, data)
    const disk = JSON.parse(fs.readFileSync(path.join(dir, STORE.MOOD), 'utf8'))
    assert.equal(disk.version, 1)
    assert.equal(disk.style, undefined)
  })

  it('migrateMood strips style', () => {
    assert.deepEqual(migrateMood({ mood: 1, style: { shortBias: 1 } }), { mood: 1 })
  })
})
