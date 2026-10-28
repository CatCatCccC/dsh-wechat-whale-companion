import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../lib/index.js'

function makeHost(tools) {
  const services = new Map()
  if (tools) services.set('tools', tools)
  const target = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    get(name) {
      return services.get(name)
    },
    on() {
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
  return { ctx: target, services }
}

describe('media staging for send_wechat', () => {
  it('copies sticker into session cwd before sendImage', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-media-'))
    const wechatDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-wx-'))
    const sessionCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-cwd-'))
    fs.writeFileSync(
      path.join(wechatDir, 'state.json'),
      JSON.stringify({
        users: {
          wx_owner: {
            userId: 'wx_owner',
            sessionId: 'session-wechat',
            cwd: sessionCwd,
          },
        },
      }),
      'utf8',
    )

    const sent = []
    const tools = {
      get(name) {
        if (name !== 'send_wechat') return undefined
        return {
          async execute(args) {
            sent.push(args)
            return { ok: true }
          },
        }
      },
      register() {
        return () => {}
      },
    }

    const { ctx } = makeHost(tools)
    const handle = apply(ctx, {
      stateDir,
      wechatStorageDir: wechatDir,
      modules: {
        http: { enabled: false },
        outbound: { deliverAssistant: false, ensureWechatSilent: false },
      },
    })

    const src = path.join(stateDir, 'src-sticker.png')
    // minimal PNG header + padding so sniff isn't required here
    fs.writeFileSync(
      src,
      Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0,
      ]),
    )

    // Bypass resolveOrSearch: call sendImage directly with a path under stateDir (allowed)
    const runtime = ctx.whaleCompanion.runtime
    // allow stateDir root via store.root — src is under stateDir
    const r = await runtime.media.sendImage(src)
    assert.equal(r.ok, true)
    assert.ok(String(r.path).includes('.whale-stickers'))
    assert.ok(fs.existsSync(r.path))
    assert.equal(sent.length, 1)
    assert.ok(String(sent[0].file_path).includes('.whale-stickers'))
    handle.dispose()
  })
})
