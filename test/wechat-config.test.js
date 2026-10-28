import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ensureWechatSilent, readWechatConfig } from '../lib/core/wechat-config.js'

describe('wechat config silent', () => {
  it('ensures silent=true while keeping other fields', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-wcfg-'))
    fs.writeFileSync(
      path.join(dir, 'config.json'),
      JSON.stringify({ allowedUsers: ['wx_a'], silent: false }),
      'utf8',
    )
    const r = ensureWechatSilent(dir)
    assert.equal(r.ok, true)
    assert.equal(r.already, false)
    const cfg = readWechatConfig(dir)
    assert.equal(cfg.silent, true)
    assert.deepEqual(cfg.raw.allowedUsers, ['wx_a'])

    const again = ensureWechatSilent(dir)
    assert.equal(again.already, true)
  })
})
