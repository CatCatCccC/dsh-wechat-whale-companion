import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { moodWord, energyWord, affinityWord, formatMoodLine } from '../lib/modules/mood-words.js'

describe('mood words', () => {
  it('maps bands', () => {
    assert.equal(moodWord(80), '偏开心')
    assert.equal(moodWord(60), '还行')
    assert.equal(moodWord(40), '偏低落')
    assert.equal(moodWord(20), '闷闷的')
    assert.equal(energyWord(75), '精力足')
    assert.equal(affinityWord(90), '很亲')
  })

  it('formats mood line with quiet and fat-fish hints', () => {
    const line = formatMoodLine({
      mood: 60,
      energy: 50,
      affinity: 70,
      asleep: false,
      fatFishHits: 2,
      lastwordHint: '在干嘛',
    })
    assert.match(line, /心情还行/)
    assert.match(line, /熟人可少话/)
    assert.match(line, /大肥鱼×2/)
    assert.match(line, /刚说过「在干嘛」/)
  })
})
