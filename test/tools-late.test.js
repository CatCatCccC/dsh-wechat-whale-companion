import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { registerTool } from '../lib/core/tools.js'

describe('late tools registration', () => {
  it('registers when tools service appears via inject', async () => {
    const registered = []
    let tools
    let injectCb
    const ctx = {
      get(name) {
        return name === 'tools' ? tools : undefined
      },
      inject(deps, cb) {
        assert.deepEqual(deps, ['tools'])
        injectCb = cb
        return () => {}
      },
    }

    const seen = []
    const dispose = registerTool(
      ctx,
      'wx_late',
      { description: 'late', parameters: { type: 'object', properties: {} } },
      async () => ({ ok: true }),
      { onRegistered: (n) => seen.push(n) },
    )

    assert.equal(registered.length, 0)
    assert.equal(typeof injectCb, 'function')

    tools = {
      register(definition) {
        registered.push(definition)
        return () => {}
      },
    }
    injectCb(ctx)

    assert.equal(registered.length, 1)
    assert.equal(registered[0].name, 'wx_late')
    assert.deepEqual(seen, ['wx_late'])
    dispose()
  })
})
