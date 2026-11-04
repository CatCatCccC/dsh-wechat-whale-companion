import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  dayPart,
  effectiveChance,
  hourInTimeZone,
  inQuietHours,
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

  it('plans a fire via social motive (long silence → miss)', () => {
    // 04:30 UTC = 12:30 Shanghai
    const noon = Date.parse('2026-10-28T04:30:00Z')
    const plan = planProactiveTick({
      now: noon,
      asleep: false,
      energy: 70,
      mood: 60,
      affinity: 40,
      lastProactiveAt: noon - 40 * 60 * 1000,
      lastOwnerAt: noon - 6 * 3600 * 1000,
      chance: 1,
      cooldownMin: 20,
      minOwnerGapMin: 10,
      stickerChance: 0,
      hasSendText: true,
      hasOwner: true,
      timeZone: 'Asia/Shanghai',
      minMotiveScore: 0.3,
      random: () => 0,
      world: {
        now: noon,
        hour: 12,
        silentMs: 6 * 3600 * 1000,
        silentH: 6,
        mood: 60,
        energy: 70,
        affinity: 40,
        tier: 'friend',
        lastword: '',
        recent: [],
        openThread: '',
        memoryHook: '',
        upcomingPromise: null,
      },
    })
    assert.equal(plan.fire, true)
    assert.equal(plan.social, true)
    assert.ok(plan.motive)
    assert.ok(plan.line)
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

  it('softens chance outside circadian hours instead of hard skip', () => {
    // 07:00 UTC → 15:00 Shanghai; active hours only morning/noon
    const day = Date.parse('2026-10-28T07:00:00Z')
    const world = {
      now: day,
      hour: 15,
      silentMs: 5 * 3600 * 1000,
      silentH: 5,
      mood: 60,
      energy: 70,
      affinity: 40,
      tier: 'friend',
      lastword: '',
      recent: [],
      openThread: '晚点聊',
      memoryHook: '',
      upcomingPromise: null,
    }
    const base = {
      now: day,
      asleep: false,
      energy: 70,
      mood: 60,
      affinity: 40,
      lastProactiveAt: day - 40 * 60 * 1000,
      lastOwnerAt: day - 5 * 3600 * 1000,
      chance: 1,
      cooldownMin: 20,
      minOwnerGapMin: 10,
      stickerChance: 0,
      hasSendText: true,
      hasOwner: true,
      timeZone: 'Asia/Shanghai',
      minMotiveScore: 0.3,
      activeHours: [8, 9, 12],
      world,
    }
    // random 0 → always fire even with reduced p
    assert.equal(planProactiveTick({ ...base, random: () => 0 }).fire, true)
    // random just above 0.35 → would fail soft gate (p*=0.35 with chance 1 → 0.35)
    // unless force (miss / continue_thread at long silence) — use short silence world
    const soft = {
      ...base,
      lastOwnerAt: day - 30 * 60 * 1000,
      world: { ...world, silentMs: 30 * 60 * 1000, silentH: 0.5, openThread: '晚点聊' },
    }
    const miss = planProactiveTick({ ...soft, random: () => 0.4 })
    // With short silence, continue_thread may still score; if it fires via force only when silentH high.
    // Soften gate: chance path should skip when random > p and not forced.
    if (miss.fire) {
      assert.ok(miss.forced || miss.chance >= 0.4)
    } else {
      assert.equal(miss.reason, 'chance')
    }
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
