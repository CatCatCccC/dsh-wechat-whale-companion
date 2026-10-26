import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../lib/index.js'

function makeHost() {
  const listeners = new Map()
  const services = new Map()
  const target = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    get(name) {
      return services.get(name)
    },
    on(name, listener) {
      if (!listeners.has(name)) listeners.set(name, [])
      listeners.get(name).push(listener)
      return () => {}
    },
    effect() {
      return () => {}
    },
    emit() {},
    provide(name, value) {
      services.set(name, value)
      target[name] = value
    },
  }
  return { ctx: target, listeners, services }
}

describe('dsh-wechat session observation', () => {
  it('feeds persona / sleep / lastword only for bound sessions', () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-events-'))
    const wechatDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-wechat-'))
    fs.writeFileSync(
      path.join(wechatDir, 'state.json'),
      JSON.stringify({
        users: { wx_owner: { userId: 'wx_owner', sessionId: 'session-wechat' } },
      }),
      'utf8',
    )

    const { ctx, listeners } = makeHost()
    const handle = apply(ctx, {
      stateDir,
      wechatStorageDir: wechatDir,
      modules: { http: { enabled: false } },
    })
    const runtime = ctx.whaleCompanion.runtime
    const listener = listeners.get('session/event')?.[0]
    assert.equal(typeof listener, 'function')

    const before = runtime.persona.snapshot()
    listener({ id: 'session-wechat' }, {
      type: 'user/message',
      message: { content: [{ type: 'text', text: '在吗' }] },
    })
    const after = runtime.persona.snapshot()
    assert.ok(after.lastOwnerAt > (before.lastOwnerAt || 0))

    const guiBefore = runtime.persona.snapshot().lastOwnerAt
    listener({ id: 'session-gui' }, {
      type: 'user/message',
      message: { content: [{ type: 'text', text: '写代码' }] },
    })
    assert.equal(runtime.persona.snapshot().lastOwnerAt, guiBefore)

    listener({ id: 'session-wechat' }, {
      type: 'assistant/message',
      message: { content: [{ type: 'text', text: '晚安' }] },
    })
    assert.equal(runtime.lastword.get().text, '晚安')
    assert.equal(runtime.persona.snapshot().asleep, true)

    handle.dispose()
  })
})
