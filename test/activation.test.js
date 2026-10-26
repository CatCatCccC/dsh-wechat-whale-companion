import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../lib/index.js'
import { DEFAULT_MODULES } from '../lib/core/config.js'

/**
 * Minimal stand-in for Cordis 4's context proxy: assigning an undeclared
 * property throws exactly like `cannot set property "x" without provide`.
 * @param {Map<string, unknown>} provided
 */
function createContext(provided) {
  const effects = []
  const target = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    on() {
      return () => {}
    },
    effect(fn) {
      effects.push(fn)
      return () => {}
    },
    get(name) {
      return provided.get(name)
    },
    emit() {},
    provide(name, value) {
      provided.set(name, value)
      Object.defineProperty(target, name, {
        value,
        configurable: true,
        enumerable: true,
        writable: true,
      })
      return () => {}
    },
  }
  return {
    ctx: new Proxy(target, {
      set(obj, prop, value) {
        if (!provided.has(prop)) {
          throw new Error(`cannot set property "${String(prop)}" without provide`)
        }
        obj[prop] = value
        return true
      },
    }),
    effects,
  }
}

describe('plugin activation', () => {
  it('provides ctx.whaleCompanion instead of assigning it', () => {
    const modules = Object.fromEntries(
      Object.keys(DEFAULT_MODULES).map((name) => [name, { enabled: false }]),
    )
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-boot-'))
    const provided = new Map()
    const { ctx } = createContext(provided)

    const handle = apply(ctx, { stateDir, modules })

    assert.equal(provided.has('whaleCompanion'), true)
    assert.equal(ctx.whaleCompanion, provided.get('whaleCompanion'))
    assert.equal(typeof ctx.whaleCompanion.ingest, 'function')
    assert.equal(typeof ctx.whaleCompanion.speak, 'function')
    handle.dispose()
  })
})
