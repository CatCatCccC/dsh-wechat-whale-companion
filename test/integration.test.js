import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { registerTool } from '../lib/core/tools.js'
import { applyPrompt } from '../lib/modules/prompt.js'
import { probeWechat } from '../lib/core/wechat.js'
import { normalizeConfig } from '../lib/core/config.js'

describe('host integration', () => {
  it('registers a DSH tool definition with the required output contract', async () => {
    const registered = []
    const tools = {
      register(definition) {
        registered.push(definition)
        return () => {}
      },
    }
    const ctx = { get: (name) => (name === 'tools' ? tools : undefined) }

    const off = registerTool(
      ctx,
      'wx_test',
      { description: 'test', parameters: { type: 'object', properties: {} } },
      async () => ({ ok: true }),
    )

    assert.equal(registered.length, 1)
    assert.equal(registered[0].name, 'wx_test')
    assert.equal(registered[0].output.schema.type, 'object')
    assert.equal(typeof registered[0].output.render, 'function')
    assert.equal(typeof registered[0].execute, 'function')
    assert.deepEqual(await registered[0].execute({}), { ok: true })
    assert.equal(typeof off, 'function')
  })

  it('injects the persona through systemPrompt.context, not agent/pre-step', () => {
    const contexts = []
    const ctx = {
      get(name) {
        if (name !== 'systemPrompt') return undefined
        return {
          context(entry) {
            contexts.push(entry)
            return () => {}
          },
        }
      },
    }
    const runtime = {
      config: { modules: { prompt: { enabled: true, scope: 'wechat' } } },
      log: { info() {}, warn() {} },
      persona: { snapshot: () => ({ mood: 60 }), styleHint: () => '偏短句' },
      wechatSessions: { has: (id) => id === 'session-wechat' },
    }

    const dispose = applyPrompt(ctx, runtime)

    assert.equal(contexts.length, 1)
    assert.equal(contexts[0].name, 'whale-companion')
    assert.equal(typeof contexts[0].text, 'function')
    assert.match(contexts[0].text({ agent: { id: 'session-wechat' } }), /微信鲸鱼娘陪伴规则/)
    assert.match(contexts[0].text({ agent: { id: 'session-wechat' } }), /偏短句/)
    assert.equal(contexts[0].text({ agent: { id: 'session-gui' } }), '')
    dispose()
  })

  it('uses dsh-wechat send_wechat when no legacy wechat service exists', async () => {
    const calls = []
    const tool = {
      async execute(args, exec) {
        calls.push({ args, exec })
        if (args.text === 'fail') return { ok: false, message: 'rate limited' }
        return { ok: true }
      },
    }
    const ctx = {
      get(name) {
        if (name === 'tools') {
          return { get: (toolName) => (toolName === 'send_wechat' ? tool : undefined) }
        }
        return undefined
      },
    }

    const adapter = probeWechat(ctx)
    assert.equal(adapter.present, true)
    assert.equal(adapter.tool, true)
    assert.deepEqual(adapter.capabilities, ['send_wechat'])

    await adapter.sendText('你好')
    await adapter.sendImage('C:/tmp/a.png', { agentId: 'session-1' })

    assert.deepEqual(calls[0], { args: { text: '你好' }, exec: {} })
    assert.deepEqual(calls[1].args, { file_path: 'C:/tmp/a.png' })
    assert.deepEqual(calls[1].exec, { agent: { id: 'session-1' } })
    await assert.rejects(adapter.sendText('fail'), /rate limited/)
  })

  it('keeps the global tool guard off by default', () => {
    assert.equal(normalizeConfig({}).modules.toolGuard.enabled, false)
  })
})
