import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BUNDLED_PACKS_DIR,
  findMeme,
  inventoryLine,
  loadMemeCatalog,
  scoreMeme,
  toBucket,
} from '../lib/core/meme-pack.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('meme packs', () => {
  it('maps fine tags to buckets', () => {
    assert.equal(toBucket('like'), 'happy')
    assert.equal(toBucket('baka'), 'angry')
    assert.equal(toBucket('sigh'), 'sad')
    assert.equal(toBucket('sleep'), 'daily')
  })

  it('loads bundled dafeiyu + whale-girl', () => {
    assert.equal(BUNDLED_PACKS_DIR, path.join(root, 'assets', 'meme-packs'))
    const cat = loadMemeCatalog([BUNDLED_PACKS_DIR])
    assert.ok(cat.count >= 300, `expected >=300 memes, got ${cat.count}`)
    assert.ok(cat.packs.length >= 5)
    assert.ok(cat.packs.some((p) => p.id === 'dafeiyu-001'))
    assert.ok(cat.packs.some((p) => p.id === 'whale-girl-emoji'))
    assert.match(inventoryLine(cat), /表情库/)
    assert.match(inventoryLine(cat), /开心|生气|日常/)
  })

  it('finds by tag and Chinese alias', () => {
    const cat = loadMemeCatalog([BUNDLED_PACKS_DIR])
    const byTag = findMeme(cat, { tag: 'happy', random: () => 0 })
    assert.equal(byTag.ok, true)
    assert.equal(byTag.meme.bucket, 'happy')
    assert.ok(byTag.meme.absPath)

    const byAlias = findMeme(cat, { query: '干饭', random: () => 0 })
    assert.equal(byAlias.ok, true)
    assert.equal(byAlias.meme.bucket, 'daily')
    assert.match(
      `${byAlias.meme.caption} ${byAlias.meme.keywords} ${byAlias.meme.fileName}`,
      /干饭|吃饭|饭/,
    )

    const byKw = findMeme(cat, { query: '比心', random: () => 0 })
    assert.equal(byKw.ok, true)
    assert.match(
      `${byKw.meme.caption} ${byKw.meme.keywords} ${byKw.meme.fileName}`,
      /比心|爱心/,
    )

    const miss = findMeme(cat, { query: '想你', random: () => 0 })
    assert.equal(miss.ok, true)
    assert.equal(miss.meme.bucket, 'happy')

    const drink = findMeme(cat, { query: '喝水', random: () => 0 })
    assert.equal(drink.ok, true)
    assert.equal(drink.source, 'pack-alias')
    assert.match(
      `${drink.meme.caption} ${drink.meme.keywords}`,
      /喝水|杯子|喝/,
    )

    // name wins over conflicting tag
    const both = findMeme(cat, { tag: 'sad', query: '比心', random: () => 0 })
    assert.equal(both.ok, true)
    assert.equal(both.source, 'pack-alias')
    assert.notEqual(both.meme.bucket, 'sad')
    assert.match(
      `${both.meme.caption} ${both.meme.keywords} ${both.meme.fileName}`,
      /比心|爱心/,
    )
  })

  it('scores caption hits', () => {
    const m = {
      bucket: 'happy',
      tag: 'like',
      caption: '比心爱心',
      keywords: '比心 爱心',
      fileName: 'bixin.jpg',
    }
    assert.ok(scoreMeme(m, '比心') > scoreMeme(m, '加班'))
  })
})
