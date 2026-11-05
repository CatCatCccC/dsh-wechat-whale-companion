import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../lib/index.js'

function makeHost(tools) {
  const listeners = new Map()
  const services = new Map()
  if (tools) services.set('tools', tools)
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
  it('wires runtime.speak for proactive / promise', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-speak-'))
    const { ctx, services } = makeHost()
    const handle = apply(ctx, {
      stateDir,
      modules: {
        http: { enabled: false },
        outbound: { deliverAssistant: false, ensureWechatSilent: false },
      },
    })
    const api = services.get('whaleCompanion')
    assert.equal(typeof api.speak, 'function')
    assert.equal(typeof api.runtime.speak, 'function')
    // No wechat channel → speak reports skipped, not throw
    const r = await api.runtime.speak('喂')
    assert.ok(r.skipped === 'no-channel' || r.silent || (r.sent ?? 0) === 0)
    handle.dispose()
  })

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
      modules: {
        http: { enabled: false },
        // Observation-only for this test (no send_wechat mock)
        outbound: { deliverAssistant: false, ensureWechatSilent: false },
      },
    })
    const runtime = ctx.whaleCompanion.runtime
    const listener = listeners.get('session/event')?.[0]
    assert.equal(typeof listener, 'function')

    const before = runtime.persona.snapshot()
    listener({ id: 'session-wechat' }, {
      type: 'user/message',
      time: Date.now(),
      data: {
        source: { kind: 'user' },
        message: { content: [{ type: 'text', text: '在吗' }] },
      },
    })
    const after = runtime.persona.snapshot()
    assert.ok(after.lastOwnerAt > (before.lastOwnerAt || 0))

    listener({ id: 'session-wechat' }, {
      type: 'user/message',
      data: {
        source: { kind: 'time-context' },
        message: { content: [{ type: 'text', text: 'time snapshot' }] },
      },
    })
    assert.equal(runtime.persona.snapshot().lastOwnerAt, after.lastOwnerAt)

    const guiBefore = runtime.persona.snapshot().lastOwnerAt
    listener({ id: 'session-gui' }, {
      type: 'user/message',
      data: {
        source: { kind: 'user' },
        message: { content: [{ type: 'text', text: '写代码' }] },
      },
    })
    assert.equal(runtime.persona.snapshot().lastOwnerAt, guiBefore)

    // Proactive-style night ping must not self-sleep (「该睡了吧」contains 睡了)
    runtime.persona.setAsleep(false)
    runtime.persona.observeOutbound('喂，该睡了吧')
    assert.equal(runtime.persona.snapshot().asleep, false)

    listener({ id: 'session-wechat' }, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '晚安' }] } },
    })
    assert.equal(runtime.lastword.get().text, '晚安')
    assert.equal(runtime.persona.snapshot().asleep, true)

    handle.dispose()
  })

  it('default deliverAssistant off: observes without re-sending', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-nodeliver-'))
    const wechatDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-wechat-'))
    fs.writeFileSync(
      path.join(wechatDir, 'state.json'),
      JSON.stringify({
        users: { wx_owner: { userId: 'wx_owner', sessionId: 'session-wechat' } },
      }),
      'utf8',
    )

    const sent = []
    const tools = {
      get(name) {
        if (name !== 'send_wechat') return undefined
        return {
          async execute(args) {
            sent.push(args.text)
            return { ok: true }
          },
        }
      },
    }

    const { ctx, listeners } = makeHost(tools)
    const handle = apply(ctx, {
      stateDir,
      wechatStorageDir: wechatDir,
      modules: {
        http: { enabled: false },
        outbound: { deliverAssistant: false, ensureWechatSilent: false },
      },
    })

    const listener = listeners.get('session/event')?.[0]
    listener({ id: 'session-wechat' }, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '算你识相……' }] } },
    })
    await new Promise((r) => setTimeout(r, 50))
    assert.deepEqual(sent, [])
    assert.equal(ctx.whaleCompanion.runtime.lastword.get().text, '算你识相……')
    handle.dispose()
  })

  it('opt-in deliverAssistant sends paced bubbles and skips double observe', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-deliver-'))
    const wechatDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-wechat-'))
    fs.writeFileSync(
      path.join(wechatDir, 'state.json'),
      JSON.stringify({
        users: { wx_owner: { userId: 'wx_owner', sessionId: 'session-wechat' } },
      }),
      'utf8',
    )
    fs.writeFileSync(
      path.join(wechatDir, 'config.json'),
      JSON.stringify({ silent: true }),
      'utf8',
    )

    const sent = []
    const tools = {
      get(name) {
        if (name !== 'send_wechat') return undefined
        return {
          async execute(args) {
            sent.push(args.text)
            return { ok: true }
          },
        }
      },
    }

    const { ctx, listeners } = makeHost(tools)
    const handle = apply(ctx, {
      stateDir,
      wechatStorageDir: wechatDir,
      modules: {
        http: { enabled: false },
        outbound: { deliverAssistant: true, ensureWechatSilent: false },
        rhythm: { bubbleDelayMs: '0,0' },
      },
    })

    const listener = listeners.get('session/event')?.[0]
    listener({ id: 'session-wechat' }, {
      type: 'assistant/message',
      data: {
        message: {
          content: [{ type: 'text', text: '第一句\n---wx-next---\n第二句' }],
        },
      },
    })

    // deliverAssistant fires speak async
    await new Promise((r) => setTimeout(r, 80))
    assert.deepEqual(sent, ['第一句', '第二句'])

    const repliesBefore = ctx.whaleCompanion.runtime.stats.wechatAssistantMessages || 0
    // Same text within fingerprint window → observeDeduped, no second send path from observe
    ctx.whaleCompanion.runtime._spokeFingerprint = {
      text: '第一句\n---wx-next---\n第二句',
      at: Date.now(),
    }
    // Actually fingerprint matches cleaned text from speak. Use cleaned joined form.
    // speak stores filtered.text which is still with wx-next markers before split... 
    // Looking at speak: fingerprint is filtered.text after cleanOutbound, before split.
    ctx.whaleCompanion.runtime._spokeFingerprint = {
      text: '第一句\n---wx-next---\n第二句',
      at: Date.now(),
    }
    const dedupeBefore = ctx.whaleCompanion.runtime.stats.observeDeduped || 0
    listener({ id: 'session-wechat' }, {
      type: 'assistant/message',
      data: {
        message: {
          content: [{ type: 'text', text: '第一句\n---wx-next---\n第二句' }],
        },
      },
    })
    assert.ok((ctx.whaleCompanion.runtime.stats.observeDeduped || 0) > dedupeBefore)
    assert.equal(ctx.whaleCompanion.runtime.stats.wechatAssistantMessages, repliesBefore)

    // [[silent]] drops
    const silentBefore = sent.length
    listener({ id: 'session-wechat' }, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '[[silent]]' }] } },
    })
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(sent.length, silentBefore)

    handle.dispose()
  })

  it('owner turns advance tool-force; fingerprint dedupes assistant', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-force-'))
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
      modules: {
        http: { enabled: false },
        outbound: { deliverAssistant: false, ensureWechatSilent: false },
        toolForce: { enabled: true, stickerEveryN: 2 },
      },
    })
    const runtime = ctx.whaleCompanion.runtime
    const listener = listeners.get('session/event')?.[0]
    listener({ id: 'session-wechat' }, {
      type: 'user/message',
      data: {
        source: { kind: 'user' },
        message: { content: [{ type: 'text', text: '今天加班好累' }] },
      },
    })
    assert.equal(runtime.toolForce.pendingSticker(), false)
    listener({ id: 'session-wechat' }, {
      type: 'user/message',
      data: {
        source: { kind: 'user' },
        message: { content: [{ type: 'text', text: '还在写代码' }] },
      },
    })
    assert.equal(runtime.toolForce.pendingSticker(), true)

    listener({ id: 'session-wechat' }, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '行吧' }] } },
    })
    const before = runtime.stats.observeDeduped || 0
    runtime._spokeFingerprint = { text: '行吧', at: Date.now() }
    listener({ id: 'session-wechat' }, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '行吧' }] } },
    })
    assert.ok((runtime.stats.observeDeduped || 0) > before)
    handle.dispose()
  })

  it('alarm owner text triggers promise auto speak after assistant reply', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-alarm-'))
    const wechatDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-wechat-'))
    fs.writeFileSync(
      path.join(wechatDir, 'state.json'),
      JSON.stringify({
        users: { wx_owner: { userId: 'wx_owner', sessionId: 'session-wechat' } },
      }),
      'utf8',
    )
    const sent = []
    const { ctx, listeners, services } = makeHost({
      get(name) {
        if (name !== 'send_wechat') return undefined
        return {
          async execute(args) {
            sent.push(args.text)
            return { ok: true }
          },
        }
      },
    })
    async function* stream() {
      yield { type: 'text-delta', text: '行 到点喊你' }
      yield { type: 'finish', kind: 'stop' }
    }
    services.set('llm', { stream: () => stream() })
    services.set('agentDefaultModel', {
      currentSelection: () => ({ provider: 'deepseek-official', model: 'flash' }),
    })
    const handle = apply(ctx, {
      stateDir,
      wechatStorageDir: wechatDir,
      modules: {
        http: { enabled: false },
        outbound: { deliverAssistant: false, ensureWechatSilent: false },
        rhythm: { bubbleDelayMs: '0,0' },
        toolForce: { enabled: false },
      },
    })
    const runtime = ctx.whaleCompanion.runtime
    let autoCalls = 0
    runtime.promise = {
      due: () => [],
      maybeAutoFromOwner(text) {
        autoCalls += 1
        assert.match(String(text), /闹钟|叫我|提醒/)
        return { ok: true, item: { id: '1', text: '明天早上7点' }, label: '明天早上' }
      },
    }
    const listener = listeners.get('session/event')?.[0]
    listener({ id: 'session-wechat' }, {
      type: 'user/message',
      data: {
        source: { kind: 'user' },
        message: { content: [{ type: 'text', text: '明天早上7点闹钟叫我' }] },
      },
    })
    listener({ id: 'session-wechat' }, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '好' }] } },
    })
    await new Promise((r) => setTimeout(r, 120))
    assert.equal(autoCalls, 1)
    assert.ok(sent.some((t) => /到点喊你|记下了/.test(t)))
    handle.dispose()
  })
})
