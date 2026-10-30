import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  moodWord,
  energyWord,
  affinityWord,
  formatMoodLine,
  lengthVoice,
  moodMode,
  FEELING_BY_KIND,
} from '../lib/modules/mood-words.js'

describe('mood words', () => {
  it('maps bands', () => {
    assert.equal(moodWord(80), '偏开心')
    assert.equal(moodWord(60), '还行')
    assert.equal(moodWord(40), '偏低落')
    assert.equal(moodWord(20), '闷闷的')
    assert.equal(energyWord(75), '精力足')
    assert.equal(affinityWord(90), '很亲')
  })

  it('moodMode splits at 55', () => {
    assert.equal(moodMode(80), 'naughty')
    assert.equal(moodMode(55), 'naughty')
    assert.equal(moodMode(54), 'live')
    assert.equal(moodMode(20), 'live')
  })

  it('lengthVoice bands (kept for back-compat)', () => {
    assert.equal(lengthVoice(0.7), '偏短句')
    assert.equal(lengthVoice(0.3), '可稍长')
    assert.equal(lengthVoice(0.5), '中等句长')
  })

  it('formats low mood as 活人版', () => {
    const line = formatMoodLine({
      mood: 20,
      energy: 50,
      affinity: 70,
      asleep: false,
      fatFishHits: 2,
      lastwordHint: '在干嘛',
      tierLabel: '损友',
      lastFeeling: FEELING_BY_KIND.dismiss,
    })
    assert.match(line, /心情闷闷的/)
    assert.match(line, /关系损友/)
    assert.match(line, /刚才：被敷衍/)
    assert.match(line, /本轮模式：活人版/)
    assert.match(line, /别主动自称大肥鱼/)
    assert.match(line, /刚说过「在干嘛」/)
    assert.doesNotMatch(line, /涩涩版/)
  })

  it('formats happy as 涩涩版', () => {
    const line = formatMoodLine({
      mood: 80,
      energy: 80,
      affinity: 90,
      asleep: false,
      tierLabel: '羁绊',
    })
    assert.match(line, /偏开心/)
    assert.match(line, /羁绊/)
    assert.match(line, /本轮模式：涩涩版/)
    assert.doesNotMatch(line, /刚才：/)
    assert.doesNotMatch(line, /活人版/)
  })
})
