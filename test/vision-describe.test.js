import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  extractImagePaths,
  formatDescription,
  formatFailure,
  isPathAllowed,
  mapMessageText,
  pathsFromMessage,
  replaceImageNotices,
  rewriteMessageWithNativeImages,
  sniffMediaType,
  describeLocalImage,
} from '../lib/core/vision-describe.js'

describe('vision-describe', () => {
  it('extracts wechat path notices', () => {
    const text =
      '[收到图片] 文件已保存到: /root/.dsh-wechat/tempfile/1793328231930-0c6590fb-image.jpg'
    assert.deepEqual(extractImagePaths(text), [
      '/root/.dsh-wechat/tempfile/1793328231930-0c6590fb-image.jpg',
    ])
  })

  it('extracts @ mention style paths', () => {
    const text = '[收到图片] @"/root/.dsh-wechat/tempfile/a.png"'
    const paths = extractImagePaths(text)
    assert.equal(paths.length, 1)
    assert.match(paths[0], /a\.png$/)
  })

  it('replaces notices while keeping caption', () => {
    const raw =
      '看看这个\n[收到图片] 文件已保存到: /root/.dsh-wechat/tempfile/x.jpg'
    const out = replaceImageNotices(raw, formatDescription('一只猫'))
    assert.match(out, /看看这个/)
    assert.match(out, /\[图片描述\]/)
    assert.match(out, /一只猫/)
    assert.doesNotMatch(out, /文件已保存到/)
  })

  it('maps message content arrays', () => {
    const msg = {
      role: 'user',
      source: { kind: 'user' },
      content: [
        { type: 'text', text: '图呢' },
        {
          type: 'text',
          text: '[收到图片] 文件已保存到: /tmp/t/a.jpg',
        },
      ],
    }
    assert.deepEqual(pathsFromMessage(msg), ['/tmp/t/a.jpg'])
    const next = mapMessageText(msg, (t) =>
      pathsFromMessage({ content: t }).length
        ? replaceImageNotices(t, formatFailure('no key'))
        : t,
    )
    assert.equal(next.content[0].text, '图呢')
    assert.match(next.content[1].text, /图片识别失败/)
  })

  it('sniffs png magic', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    assert.equal(sniffMediaType(png), 'image/png')
  })

  it('allowlists tempfile roots', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-vis-'))
    const file = path.join(dir, 'a.jpg')
    fs.writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
    assert.equal(isPathAllowed(file, [dir]), true)
    assert.equal(isPathAllowed(file, [path.join(os.tmpdir(), 'nope')]), false)
  })

  it('rewrites to native image content parts', () => {
    const next = rewriteMessageWithNativeImages(
      { role: 'user', content: '[收到图片] 文件已保存到: /t/a.png' },
      { attachments: [{ attachmentId: 'x', mediaType: 'image/png', bytes: 1 }] },
    )
    assert.equal(next.content.length, 1)
    assert.equal(next.content[0].type, 'image')
  })

  it('describeLocalImage calls vision API with data URL', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-vis-'))
    const file = path.join(dir, 'a.jpg')
    fs.writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
    let body
    const fetchImpl = async (_url, init) => {
      body = JSON.parse(init.body)
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            choices: [{ message: { content: '一只橘猫' } }],
          })
        },
      }
    }
    const desc = await describeLocalImage({
      filePath: file,
      apiKey: 'test-key',
      models: ['glm-4v-flash'],
      retries: 0,
      fetchImpl,
    })
    assert.equal(desc, '一只橘猫')
    assert.equal(body.model, 'glm-4v-flash')
    assert.match(body.messages[0].content[1].image_url.url, /^data:image\/jpeg;base64,/)
  })
})
