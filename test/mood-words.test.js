import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  moodWord,
  energyWord,
  affinityWord,
  formatMoodLine,
  lengthVoice,
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

  it('lengthVoice bands', () => {
    assert.equal(lengthVoice(0.7), '偏短句')
    assert.equal(lengthVoice(0.3), '可稍长')
    assert.equal(lengthVoice(0.5), '中等句长')
  })

  it('formats mood line with tier, mood voice, day part', () => {
    const line = formatMoodLine({
      mood: 20,
      energy: 50,
      affinity: 70,
      asleep: false,
      fatFishHits: 2,
      lastwordHint: '在干嘛',
      tierId: 'friend',
      tierLabel: '损友',
      dayPart: 'night',
      shortBias: 0.7,
    })
    assert.match(line, /心情闷闷的/)
    assert.match(line, /关系损友/)
    assert.match(line, /损友可怼/)
    assert.match(line, /更短更冲/)
    assert.match(line, /深夜更懒/)
    assert.match(line, /偏短句/)
    assert.match(line, /大肥鱼×2/)
    assert.match(line, /刚说过「在干嘛」/)
  })

  it('formats happy morning with bond tier', () => {
    const line = formatMoodLine({
      mood: 80,
      energy: 80,
      affinity: 90,
      asleep: false,
      tierId: 'bond',
      tierLabel: '羁绊',
      dayPart: 'morning',
      shortBias: 0.5,
    })
    assert.match(line, /偏开心/)
    assert.match(line, /羁绊/)
    assert.match(line, /可俏皮/)
    assert.match(line, /上午可稍精神/)
  })
})
