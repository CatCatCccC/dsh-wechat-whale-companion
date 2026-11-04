import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assertRuntimePorts } from '../lib/core/runtime-ports.js'
import { buildHealth } from '../lib/modules/http.js'

describe('runtime ports', () => {
  it('reports missing speak and persona', () => {
    const runtime = {
      config: { modules: { persona: { enabled: true }, guard: { enabled: false }, rhythm: { enabled: false }, memory: { enabled: false }, media: { enabled: false }, promise: { enabled: false } } },
      stats: {},
      wechat: { present: false },
    }
    const r = assertRuntimePorts(runtime, { warn() {} })
    assert.equal(r.ok, false)
    assert.ok(r.missing.includes('speak'))
    assert.ok(r.missing.some((m) => m.startsWith('persona')))
    assert.deepEqual(runtime.stats.portMissing, r.missing)
    assert.equal(runtime.stats.portsOk, false)
  })

  it('health surfaces port gaps', () => {
    const h = buildHealth({
      config: {
        modules: { outbound: { deliverAssistant: false } },
        wechatStorageDir: '',
      },
      prompt: { registered: true, source: 'section' },
      wechat: { present: true, notes: 'ok' },
      wechatSessions: { list: () => [{ sessionId: 's1' }] },
      media: { listStickers: () => ['a.png'] },
      stats: {
        promptInjected: 2,
        toolsRegistered: { wx_sticker: true, wx_memory: true },
        portsOk: false,
        portMissing: ['speak'],
      },
    })
    assert.ok(h.checks.some((c) => c.id === 'runtime.ports' && !c.ok))
    assert.ok(h.advice.some((a) => /speak/.test(a)))
  })
})
