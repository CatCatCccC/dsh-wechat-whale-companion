import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  bridgeModuleCandidates,
  patchWechatBubbleSplit,
} from '../lib/core/patch-wechat-split.js'

describe('patch-wechat-split', () => {
  it('lists sibling and cwd candidates', () => {
    const list = bridgeModuleCandidates({ cwd: '/tmp' })
    assert.ok(list.some((p) => p.includes('dsh-wechat') && p.endsWith('bridge.js')))
  })

  it('patches sendReply to split || into paced calls', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-bridge-'))
    const bridgeFile = path.join(dir, 'bridge.js')
    fs.writeFileSync(
      bridgeFile,
      `
export class WeChatDSHBridge {
  constructor() {
    this.silentBuffers = new Map()
    this.sent = []
  }
  isSilent() { return true }
  userForAgent() { return { userId: 'u1' } }
  handleSessionEvent(sessionId, event) {
    if (event?.type === 'assistant/message') {
      const text = event.data.message.content[0].text
      this.silentBuffers.set(sessionId, [text])
    }
  }
  async sendReply(userId, text) {
    this.sent.push([userId, text])
  }
}
`,
      'utf8',
    )

    const r = await patchWechatBubbleSplit({
      bridgePath: bridgeFile,
      delayRange: [0, 0],
    })
    assert.equal(r.ok, true)

    // Same URL as the patch import so we share the patched module instance.
    const { WeChatDSHBridge } = await import(pathToFileURL(bridgeFile).href)
    const b = new WeChatDSHBridge()
    await b.sendReply('u1', '嘿 拆成两条就是这感觉||你到底起来没有呀')
    assert.deepEqual(b.sent, [
      ['u1', '嘿 拆成两条就是这感觉'],
      ['u1', '你到底起来没有呀'],
    ])

    b.sent = []
    b.handleSessionEvent('s1', {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '先这样||你呢' }] } },
    })
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(b.silentBuffers.has('s1'), false)
    assert.deepEqual(b.sent, [
      ['u1', '先这样'],
      ['u1', '你呢'],
    ])
  })

  it('blank replace works when text props are frozen', async () => {
    const { blankAssistantTextBlocks } = await import('../lib/modules/guard.js')
    const block = Object.freeze({ type: 'text', text: 'a||b' })
    const message = Object.freeze({ content: [block] })
    const event = { data: { message } }
    assert.equal(blankAssistantTextBlocks(event), true)
    assert.equal(event.data.message.content[0].text, '')
  })
})
