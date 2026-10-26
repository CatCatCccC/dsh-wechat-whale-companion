import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mergeDefaults, StateStore } from '../lib/core/state.js'

describe('state', () => {
  it('mergeDefaults fills nested holes', () => {
    const m = mergeDefaults(
      { mood: 55, style: { shortBias: 0.7, samples: 0 } },
      { mood: 10, style: { samples: 3 } },
    )
    assert.equal(m.mood, 10)
    assert.equal(m.style.shortBias, 0.7)
    assert.equal(m.style.samples, 3)
  })

  it('flush persists debounced writes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-state-'))
    const store = new StateStore(dir)
    store.setDebounced('x.json', { a: 1 }, 60_000)
    store.flush()
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'x.json'), 'utf8'))
    assert.deepEqual(raw, { a: 1 })
  })

  it('overwrites existing file on Windows-safe path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-state-'))
    const store = new StateStore(dir)
    store.set('y.json', { n: 1 })
    store.set('y.json', { n: 2 })
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'y.json'), 'utf8'))
    assert.equal(raw.n, 2)
  })

  it('rejects path traversal in state keys', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-state-'))
    const store = new StateStore(dir)
    store.set('../escape.json', { ok: true })
    assert.ok(fs.existsSync(path.join(dir, 'escape.json')))
    assert.equal(fs.existsSync(path.join(dir, '..', 'escape.json')), false)
  })
})
