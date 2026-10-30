import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { looksLikeAlarm, parseDueAt } from '../lib/core/parse-due.js'

describe('parseDueAt', () => {
  // 2026-10-30 12:00 Shanghai = 04:00 UTC
  const noon = Date.parse('2026-10-30T04:00:00.000Z')

  it('parses tomorrow morning', () => {
    const r = parseDueAt('明天8点喊我起床', { now: noon, timeZone: 'Asia/Shanghai' })
    assert.ok(r)
    assert.ok(r.dueAt > noon)
    assert.match(r.label, /8:00/)
  })

  it('parses half hour later', () => {
    const r = parseDueAt('半小时后提醒我', { now: noon })
    assert.ok(r)
    assert.equal(r.dueAt, noon + 30 * 60 * 1000)
  })

  it('detects alarm-like lines', () => {
    assert.equal(looksLikeAlarm('明天8点喊我'), true)
    assert.equal(looksLikeAlarm('在吗'), false)
  })
})
