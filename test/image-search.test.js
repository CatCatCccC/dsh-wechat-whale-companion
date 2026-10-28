import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  applySearchStyle,
  querySlug,
  sanitizeQuery,
  searchMemeUrls,
  searchAndCacheImage,
  sniffImageExt,
} from '../lib/core/image-search.js'

describe('image search', () => {
  it('sanitizes query and slug', () => {
    assert.equal(sanitizeQuery('  傲娇/表情  '), '傲娇表情')
    assert.match(querySlug('吃饭'), /^吃饭_/)
  })

  it('applies cute search style bias', () => {
    assert.match(applySearchStyle('傲娇', 'cute'), /傲娇(可爱|软萌|治愈)/)
    assert.equal(applySearchStyle('可爱猫咪', 'cute'), '可爱猫咪')
    assert.equal(applySearchStyle('无语', 'raw'), '无语')
    assert.equal(applySearchStyle('生气', 'cute'), applySearchStyle('生气', 'cute'))
  })

  it('sniffs jpeg magic', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
    assert.equal(sniffImageExt(jpeg), '.jpg')
  })

  it('parses sogou-ruseo nested res list', async () => {
    const payload = {
      code: 0,
      msg: 'success',
      data: {
        code: 200,
        res: [
          'https://img03.sogoucdn.com/a.jpg',
          'https://img03.sogoucdn.com/b.gif',
        ],
      },
    }
    const fetchImpl = async () => ({
      ok: true,
      async text() {
        return JSON.stringify(payload)
      },
    })
    const { urls, provider } = await searchMemeUrls('傲娇', { fetchImpl })
    assert.equal(provider, 'sogou-ruseo')
    assert.deepEqual(urls, [
      'https://img03.sogoucdn.com/a.jpg',
      'https://img03.sogoucdn.com/b.gif',
    ])
  })

  it('falls back to apihz when first provider empty', async () => {
    let n = 0
    const fetchImpl = async (url) => {
      n += 1
      const u = String(url)
      if (u.includes('ruseo')) {
        return { ok: true, async text() { return JSON.stringify({ code: 0, data: { res: [] } }) } }
      }
      if (u.includes('apihzbqbsougou')) {
        return {
          ok: true,
          async text() {
            return JSON.stringify({
              code: 200,
              res: ['https://i01piccdn.sogoucdn.com/x.jpg'],
            })
          },
        }
      }
      return { ok: true, async text() { return '{}' } }
    }
    const { urls, provider } = await searchMemeUrls('干饭', { fetchImpl })
    assert.equal(provider, 'sogou-apihz')
    assert.deepEqual(urls, ['https://i01piccdn.sogoucdn.com/x.jpg'])
    assert.ok(n >= 2)
  })

  it('downloads and caches via searchAndCacheImage', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-img-'))
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      Buffer.alloc(20, 1),
    ])
    const fetchImpl = async (url) => {
      if (String(url).includes('sogou_bqb') || String(url).includes('apihz')) {
        return {
          ok: true,
          async text() {
            return JSON.stringify({
              code: 0,
              data: { code: 200, res: ['https://cdn.example.com/x.jpg'] },
            })
          },
        }
      }
      return {
        ok: true,
        async arrayBuffer() {
          return jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength)
        },
      }
    }
    const r1 = await searchAndCacheImage('测试表情', dir, { fetchImpl })
    assert.equal(r1.ok, true)
    assert.equal(r1.cached, false)
    assert.ok(fs.existsSync(r1.path))
    const r2 = await searchAndCacheImage('测试表情', dir, { fetchImpl })
    assert.equal(r2.ok, true)
    assert.equal(r2.cached, true)
  })

  it('blocks nsfw query', async () => {
    const r = await searchAndCacheImage('色情', os.tmpdir(), {
      fetchImpl: async () => {
        throw new Error('should not fetch')
      },
    })
    assert.equal(r.ok, false)
    assert.match(r.error, /blocked/)
  })
})
