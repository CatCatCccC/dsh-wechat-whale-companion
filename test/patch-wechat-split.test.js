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
  constructor() { this.sent = [] }
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

    const { WeChatDSHBridge } = await import(pathToFileURL(bridgeFile).href)
    const b = new WeChatDSHBridge()
    await b.sendReply('u1', '嘿 拆成两条就是这感觉||你到底起来没有呀')
    assert.deepEqual(b.sent, [
      ['u1', '嘿 拆成两条就是这感觉'],
      ['u1', '你到底起来没有呀'],
    ])

    await b.sendReply('u1', '单句没有分隔')
    assert.equal(b.sent.length, 3)
    assert.equal(b.sent[2][1], '单句没有分隔')

    b.sent = []
    await b.sendReply('u1', '甲\n---wx-next---\n乙')
    assert.deepEqual(b.sent, [
      ['u1', '甲'],
      ['u1', '乙'],
    ])
    b.sent = []
    await b.sendReply('u1', '一[[next]]二')
    assert.deepEqual(b.sent, [
      ['u1', '一'],
      ['u1', '二'],
    ])
  })
})
