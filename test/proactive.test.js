import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  dayPart,
  effectiveChance,
  hourInTimeZone,
  inQuietHours,
  pickIntent,
  pickLine,
  planProactiveTick,
  pushRecent,
  tooSimilar,
} from '../lib/modules/proactive.js'

describe('proactive', () => {
  it('maps day parts and quiet hours', () => {
    assert.equal(dayPart(7), 'morning')
    assert.equal(dayPart(12), 'noon')
    assert.equal(dayPart(18), 'evening')
    assert.equal(dayPart(23), 'night')
    // 03:00 UTC = 11:00 Asia/Shanghai → not quiet
    const utcDawn = Date.parse('2026-10-28T03:00:00Z')
    assert.equal(inQuietHours(utcDawn, 'Asia/Shanghai'), false)
    assert.equal(hourInTimeZone(utcDawn, 'Asia/Shanghai'), 11)
    // 18:00 UTC = 02:00 Asia/Shanghai → quiet
    const utcEvening = Date.parse('2026-10-28T18:00:00Z')
    assert.equal(inQuietHours(utcEvening, 'Asia/Shanghai'), true)
  })

  it('boosts chance when owner silent longer', () => {
    const base = 0.2
    assert.ok(effectiveChance(base, 30 * 60 * 1000) < effectiveChance(base, 10 * 3600 * 1000))
    assert.ok(effectiveChance(base, 25 * 3600 * 1000) <= 0.85)
  })

  it('picks miss after long silence', () => {
    assert.equal(
      pickIntent({
        hour: 15,
        ownerSilentMs: 8 * 3600 * 1000,
        mood: 60,
        energy: 70,
        affinity: 20,
        random: () => 0.99,
      }),
      'miss',
    )
  })

  it('picks meal around lunch', () => {
    assert.equal(
      pickIntent({
        hour: 12,
        ownerSilentMs: 60 * 60 * 1000,
        mood: 60,
        energy: 70,
        affinity: 20,
        random: () => 0.99,
      }),
      'meal',
    )
  })

  it('avoids recent and lastword lines', () => {
    const line = pickLine('miss', {
      lastword: '……还在吗',
      recent: ['喂，人呢', '想你了，就一句'],
    })
    assert.ok(line)
    assert.notEqual(line, '……还在吗')
  })

  it('plans a fire with injected random', () => {
    // 04:30 UTC = 12:30 Shanghai → meal
    const noon = Date.parse('2026-10-28T04:30:00Z')
    const plan = planProactiveTick({
      now: noon,
      asleep: false,
      energy: 70,
      mood: 60,
      affinity: 20,
      lastProactiveAt: noon - 40 * 60 * 1000,
      lastOwnerAt: noon - 30 * 60 * 1000,
      chance: 1,
      cooldownMin: 20,
      minOwnerGapMin: 10,
      stickerChance: 1,
      hasSendText: true,
      hasOwner: true,
      timeZone: 'Asia/Shanghai',
      random: () => 0,
    })
    assert.equal(plan.fire, true)
    assert.equal(plan.intent, 'meal')
    assert.ok(plan.line)
    assert.ok(plan.stickerKeyword)
  })

  it('skips quiet hours and cooldown', () => {
    // 18:30 UTC → 02:30 Shanghai → quiet
    const night = Date.parse('2026-10-28T18:30:00Z')
    assert.equal(
      planProactiveTick({
        now: night,
        asleep: false,
        energy: 70,
        lastOwnerAt: night - 60 * 60 * 1000,
        lastProactiveAt: 0,
        hasSendText: true,
        hasOwner: true,
        chance: 1,
        timeZone: 'Asia/Shanghai',
        random: () => 0,
      }).reason,
      'quiet_hours',
    )

    // 07:00 UTC → 15:00 Shanghai → not quiet; cooldown wins
    const day = Date.parse('2026-10-28T07:00:00Z')
    assert.equal(
      planProactiveTick({
        now: day,
        asleep: false,
        energy: 70,
        lastOwnerAt: day - 60 * 60 * 1000,
        lastProactiveAt: day - 5 * 60 * 1000,
        cooldownMin: 22,
        hasSendText: true,
        hasOwner: true,
        chance: 1,
        timeZone: 'Asia/Shanghai',
        random: () => 0,
      }).reason,
      'cooldown',
    )
  })

  it('pushRecent caps buffer', () => {
    let r = []
    for (let i = 0; i < 12; i++) r = pushRecent(r, `line${i}`, 5)
    assert.equal(r.length, 5)
    assert.equal(r[0], 'line7')
  })

  it('tooSimilar catches substrings', () => {
    assert.equal(tooSimilar('喂', '喂，人呢'), true)
    assert.equal(tooSimilar('早啊', '记得喝水'), false)
  })
})
