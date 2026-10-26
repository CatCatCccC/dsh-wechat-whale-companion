import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { WechatSessionIndex } from '../lib/core/wechat-state.js'

function writeState(dir, users) {
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ users }), 'utf8')
}

describe('dsh-wechat session index', () => {
  it('reads the bound session map and ignores GUI sessions', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-wx-'))
    writeState(dir, {
      wx_owner: { userId: 'wx_owner', sessionId: 'session-wechat', cwd: 'C:/work' },
    })
    const index = new WechatSessionIndex(dir)

    assert.equal(index.has('session-wechat'), true)
    assert.equal(index.has('session-gui'), false)
    assert.equal(index.ownerUserId(), 'wx_owner')
    assert.equal(index.userIdForSession('session-wechat'), 'wx_owner')
  })

  it('re-reads the file after dsh-wechat rewrites it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-wx-'))
    writeState(dir, {
      wx_owner: { userId: 'wx_owner', sessionId: 'session-old' },
    })
    const index = new WechatSessionIndex(dir)
    assert.equal(index.has('session-old'), true)

    writeState(dir, {
      wx_owner: { userId: 'wx_owner', sessionId: 'session-new' },
    })
    const future = new Date(Date.now() + 2000)
    fs.utimesSync(path.join(dir, 'state.json'), future, future)

    assert.equal(index.has('session-new'), true)
    assert.equal(index.has('session-old'), false)
  })

  it('is empty when dsh-wechat is not installed', () => {
    const dir = path.join(os.tmpdir(), `whale-missing-${process.pid}-${Date.now()}`)
    const index = new WechatSessionIndex(dir)
    assert.equal(index.has('session-anything'), false)
    assert.equal(index.ownerUserId(), '')
  })
})
