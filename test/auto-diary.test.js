import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  craftDailyEntry,
  filterTurnsForDay,
  parseWriteAt,
  shanghaiDay,
  shouldWriteDaily,
} from '../lib/core/auto-diary.js'

describe('daily diary', () => {
  it('parses writeAt', () => {
    assert.deepEqual(parseWriteAt('22:00'), { hour: 22, minute: 0 })
    assert.deepEqual(parseWriteAt('9:30'), { hour: 9, minute: 30 })
  })

  it('gates once per day after writeAt', () => {
    // Construct a UTC instant that is 22:05 in Asia/Shanghai (UTC+8) on 2026-10-30
    const at2205 = Date.parse('2026-10-30T14:05:00.000Z')
    const day = shanghaiDay(at2205, 'Asia/Shanghai')
    assert.equal(day, '2026-10-30')
    assert.equal(
      shouldWriteDaily(at2205, {
        writeAt: '22:00',
        lastWrittenDay: '',
        timeZone: 'Asia/Shanghai',
      }).ok,
      true,
    )
    assert.equal(
      shouldWriteDaily(at2205, {
        writeAt: '22:00',
        lastWrittenDay: day,
        timeZone: 'Asia/Shanghai',
      }).ok,
      false,
    )
    const at2100 = Date.parse('2026-10-30T13:00:00.000Z')
    assert.equal(
      shouldWriteDaily(at2100, {
        writeAt: '22:00',
        lastWrittenDay: '',
        timeZone: 'Asia/Shanghai',
      }).reason,
      'too_early',
    )
  })

  it('filters turns for the day and crafts summary', () => {
    const day = '2026-10-30'
    const turns = [
      { at: Date.parse('2026-10-30T04:00:00.000Z'), owner: '今天好累', assistant: '靠一下' },
      { at: Date.parse('2026-10-29T04:00:00.000Z'), owner: '昨天的', assistant: '嗯' },
    ]
    const today = filterTurnsForDay(turns, day, 'Asia/Shanghai')
    assert.equal(today.length, 1)
    const text = craftDailyEntry({
      day,
      turns: today,
      moodWord: '还行',
      affinityWord: '挺熟',
    })
    assert.match(text, /2026-10-30/)
    assert.match(text, /今天好累/)
    assert.match(text, /1 轮/)
  })

  it('writes a lonely day when no turns', () => {
    const text = craftDailyEntry({ day: '2026-10-30', turns: [], moodWord: '偏低落' })
    assert.match(text, /没跟主人说话/)
  })
})
