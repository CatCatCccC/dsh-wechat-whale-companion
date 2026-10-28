import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildHealth } from '../lib/modules/http.js'
import { normalizeConfig } from '../lib/core/config.js'

describe('physical health', () => {
  it('marks bad when deliverAssistant on but silent off', () => {
    const runtime = {
      config: normalizeConfig({
        modules: { outbound: { deliverAssistant: true, ensureWechatSilent: true } },
      }),
      wechatSilent: false,
      prompt: { registered: true, source: 'section' },
      wechat: { present: true, notes: 'ok' },
      wechatSessions: { list: () => [{ sessionId: 's1' }] },
      media: { listStickers: () => ['happy.jpg'] },
      stats: { promptInjected: 1 },
    }
    const h = buildHealth(runtime)
    assert.equal(h.level, 'bad')
    assert.ok(h.advice.some((a) => /双发|silent/.test(a)))
  })

  it('is ok when silent and registered', () => {
    const runtime = {
      config: normalizeConfig({}),
      wechatSilent: true,
      prompt: { registered: true, source: 'section' },
      wechat: { present: true, notes: 'ok' },
      wechatSessions: { list: () => [{ sessionId: 's1' }] },
      media: { listStickers: () => ['happy.jpg'] },
      stats: { promptInjected: 2 },
    }
    const h = buildHealth(runtime)
    assert.equal(h.level, 'ok')
    assert.equal(h.advice.length, 0)
  })
})
