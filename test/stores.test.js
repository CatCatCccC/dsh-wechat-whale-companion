import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StateStore } from '../lib/core/state.js'
import { STORE, bootStore, loadStore, saveStore, migrateMood } from '../lib/core/stores.js'

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

  it('bootStore writeback persists upgraded version', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-boot-'))
    const store = new StateStore(dir)
    store.set(STORE.LASTWORD, { text: '喂', at: 1, count: 1 })
    const { upgraded } = bootStore(store, STORE.LASTWORD, { text: '', at: 0, count: 0 })
    assert.equal(upgraded, true)
    const disk = JSON.parse(fs.readFileSync(path.join(dir, STORE.LASTWORD), 'utf8'))
    assert.equal(disk.version, 1)
    assert.equal(disk.text, '喂')
    const again = bootStore(store, STORE.LASTWORD, { text: '', at: 0, count: 0 })
    assert.equal(again.upgraded, false)
  })

  it('migrateMood strips style', () => {
    assert.deepEqual(migrateMood({ mood: 1, style: { shortBias: 1 } }), { mood: 1 })
  })
})
