import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildHealth } from '../lib/modules/http.js'

describe('physical health', () => {
  it('marks bad when deliverAssistant on (double-send with dsh-wechat)', () => {
    const h = buildHealth({
      config: {
        modules: { outbound: { deliverAssistant: true, ensureWechatSilent: true } },
        wechatStorageDir: '',
      },
      wechatSilent: true,
      prompt: { registered: true, source: 'section' },
      wechat: { present: true, notes: 'ok' },
      wechatSessions: { list: () => [{ sessionId: 's1' }] },
      stats: {},
    })
    assert.equal(h.level, 'bad')
    assert.ok(h.checks.some((c) => c.id === 'outbound.noDouble' && !c.ok))
    assert.ok(h.advice.some((a) => /双发|deliverAssistant/.test(a)))
  })

  it('is ok when deliverAssistant off and prompt registered', () => {
    const h = buildHealth({
      config: {
        modules: { outbound: { deliverAssistant: false } },
        wechatStorageDir: '',
      },
      wechatSilent: false,
      prompt: { registered: true, source: 'section' },
      wechat: { present: true, notes: 'ok' },
      wechatSessions: { list: () => [{ sessionId: 's1' }] },
      media: { listStickers: () => ['a.png'] },
      stats: {
        promptInjected: 2,
        toolsRegistered: { wx_sticker: true, wx_memory: true },
      },
    })
    assert.equal(h.level, 'ok')
    assert.ok(h.checks.every((c) => c.ok))
  })

  it('warns when wx_sticker never registered', () => {
    const h = buildHealth({
      config: {
        modules: { outbound: { deliverAssistant: false } },
        wechatStorageDir: '',
      },
      prompt: { registered: true, source: 'section' },
      wechat: { present: true, notes: 'ok' },
      wechatSessions: { list: () => [{ sessionId: 's1' }] },
      media: { listStickers: () => ['a.png'] },
      stats: { promptInjected: 1 },
    })
    assert.ok(h.checks.some((c) => c.id === 'tools.wx_sticker' && !c.ok))
    assert.ok(h.advice.some((a) => /wx_sticker 未注册/.test(a)))
  })
})
