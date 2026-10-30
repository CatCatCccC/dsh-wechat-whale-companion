import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../lib/index.js'
import { rewriteMessageWithNativeImages, stripImageNotices } from '../lib/core/vision-describe.js'

function makeHost(extras = {}) {
  const listeners = new Map()
  const services = new Map()
  if (extras.attachments) services.set('attachments', extras.attachments)
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

describe('vision helpers', () => {
  it('rewrites path notice into native image parts', () => {
    const msg = {
      role: 'user',
      content: '看看这个\n[收到图片] 文件已保存到: /tmp/t/a.jpg',
    }
    const next = rewriteMessageWithNativeImages(msg, {
      attachments: [{ attachmentId: 'att-1', mediaType: 'image/jpeg', bytes: 12 }],
    })
    assert.equal(next.content[0].type, 'text')
    assert.equal(next.content[0].text, '看看这个')
    assert.equal(next.content[1].type, 'image')
    assert.equal(next.content[1].attachment.attachmentId, 'att-1')
    assert.equal(stripImageNotices('[收到图片] 文件已保存到: /x.png'), '')
  })
})

describe('vision agent/pre-step native', () => {
  it('admits WeChat path into attachments.saveImage', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-vis-rt-'))
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-wx-temp-'))
    const img = path.join(tempDir, 'shot.jpg')
    fs.writeFileSync(img, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))

    const saved = []
    const { ctx, listeners, services } = makeHost({
      attachments: {
        async saveImage(input) {
          saved.push(input)
          return {
            attachmentId: 'att-native-1',
            mediaType: input.mediaType,
            bytes: input.data.length,
          }
        },
      },
    })
    const handle = apply(ctx, {
      stateDir,
      modules: {
        http: { enabled: false },
        outbound: { deliverAssistant: false, ensureWechatSilent: false },
        vision: { enabled: true, mode: 'native', tempDir },
      },
    })

    try {
      const hooks = listeners.get('agent/pre-step') || []
      assert.ok(hooks.length >= 1)
      const hook = hooks[hooks.length - 1]
      const decision = await hook({ signal: undefined }, async () => ({
        kind: 'enter',
        messages: [
          {
            role: 'user',
            source: { kind: 'user' },
            content: `[收到图片] 文件已保存到: ${img}`,
          },
        ],
      }))
      const parts = decision.messages[0].content
      assert.ok(Array.isArray(parts))
      const image = parts.find((p) => p.type === 'image')
      assert.ok(image)
      assert.equal(image.attachment.attachmentId, 'att-native-1')
      assert.equal(saved.length, 1)
      assert.equal(saved[0].mediaType, 'image/jpeg')
      const api = services.get('whaleCompanion')
      assert.ok((api.runtime.stats.visionAttached || 0) >= 1)
    } finally {
      handle?.dispose?.()
    }
  })

  it('writes failure text when attachments missing and no describe key', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-vis-rt-'))
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-wx-temp-'))
    const img = path.join(tempDir, 'shot.jpg')
    fs.writeFileSync(img, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
    delete process.env.ZHIPU_API_KEY
    delete process.env.ZHIPUAI_API_KEY
    delete process.env.VISION_API_KEY
    delete process.env.DASHSCOPE_API_KEY

    const { ctx, listeners } = makeHost()
    const handle = apply(ctx, {
      stateDir,
      modules: {
        http: { enabled: false },
        outbound: { deliverAssistant: false, ensureWechatSilent: false },
        vision: { enabled: true, mode: 'describe', tempDir },
      },
    })
    try {
      const hooks = listeners.get('agent/pre-step') || []
      const hook = hooks[hooks.length - 1]
      const decision = await hook({ signal: undefined }, async () => ({
        kind: 'enter',
        messages: [
          {
            role: 'user',
            source: { kind: 'user' },
            content: `[收到图片] 文件已保存到: ${img}`,
          },
        ],
      }))
      assert.match(decision.messages[0].content, /图片识别失败/)
    } finally {
      handle?.dispose?.()
    }
  })
})
