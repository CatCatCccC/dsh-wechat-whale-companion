import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseBusySignal, isBusy } from '../lib/core/busy-gate.js'
import { craftDailyEntry } from '../lib/core/auto-diary.js'
import {
  harvestInsideJokes,
  pickInsideJoke,
  pickFishLife,
  buildShareCandidates,
} from '../lib/core/share-pool.js'
import { ensureShareLog } from '../lib/core/share-log.js'
import { normalizeOwnerProfile } from '../lib/core/owner-profile.js'
import { scoreMotives, pickForm } from '../lib/core/proactive-motive.js'
import { buildDraftPrompt, criticDraft, templateLine } from '../lib/core/proactive-draft.js'
import { planProactiveTick } from '../lib/modules/proactive.js'
import { buildWorldState } from '../lib/core/proactive-world.js'
import { reactToOwnerText } from '../lib/modules/owner-react.js'

describe('relation layer soft', () => {
  it('parseBusySignal sets and clears busyUntil', () => {
    const now = Date.parse('2026-11-04T10:00:00+08:00')
    const busy = parseBusySignal('我在开会，晚点聊', { now })
    assert.ok(busy?.busyUntil > now)
    assert.equal(isBusy(busy.busyUntil, now), true)
    const clear = parseBusySignal('忙完了', { now })
    assert.equal(clear?.clear, true)
  })

  it('reactToOwnerText tags tired/annoyed', () => {
    assert.equal(reactToOwnerText('今天加班好累').dayTag, 'tired')
    assert.equal(reactToOwnerText('烦死了崩溃').dayTag, 'annoyed')
    assert.equal(reactToOwnerText('吃了吗').dayTag, '')
  })

  it('picks inside jokes from seed and harvest', () => {
    const harvested = harvestInsideJokes({
      journalTurns: [{ owner: '大白饭真香' }],
      memories: [],
      ledger: [],
    })
    assert.ok(harvested.some((j) => j.text.includes('大白饭')))
    const pick = pickInsideJoke({ usedIds: [], random: () => 0 })
    assert.ok(pick?.text)
  })

  it('fish_life advances beat pointer', () => {
    const a = pickFishLife({ progress: { chapterId: 'rice_war', beatIndex: 0 }, usedIds: [] })
    assert.ok(a?.id)
    assert.equal(a.nextBeatIndex, 1)
    const b = pickFishLife({
      progress: { chapterId: a.chapterId, beatIndex: a.nextBeatIndex },
      usedIds: [a.id],
    })
    assert.ok(b)
    assert.notEqual(b.id, a.id)
  })

  it('busy suppresses miss soft motives', () => {
    const ranked = scoreMotives(
      {
        silentH: 6,
        hour: 15,
        mood: 60,
        energy: 70,
        affinity: 60,
        busyNow: true,
      },
      {},
      () => 0,
    )
    assert.ok(!ranked.some((m) => m.id === 'miss' || m.id === 'soft'))
  })

  it('echo_mood and inside_joke score when ready', () => {
    const ranked = scoreMotives(
      {
        silentH: 1,
        hour: 15,
        mood: 55,
        energy: 70,
        affinity: 40,
        echoMoodReady: true,
        echoMoodTag: 'tired',
        shareInsideJoke: { hook: '大白饭', text: '大白饭又晃了一下', id: 'ij1' },
      },
      {},
      () => 0,
    )
    assert.ok(ranked.some((m) => m.id === 'echo_mood' && m.score >= 0.48))
    assert.ok(ranked.some((m) => m.id === 'inside_joke' && m.score >= 0.48))
  })

  it('pickForm can blank on miss', () => {
    const form = pickForm({ id: 'miss', formBias: 'text' }, 0, () => 0.1, {
      blankForm: true,
    })
    assert.ok(form === 'sticker_only' || form === 'half_sentence')
  })

  it('buildDraftPrompt includes dayPart and bans 怎么了', () => {
    const { system, user } = buildDraftPrompt('soft', {
      dayPart: 'night',
      weekday: 'Mon',
      mood: 50,
      affinity: 20,
      silentH: 2,
    })
    assert.match(user, /时段: night/)
    assert.match(system, /怎么了/)
    assert.equal(criticDraft('你怎么了').ok, false)
  })

  it('echo_mood template avoids 怎么了', () => {
    const line = templateLine('echo_mood', { echoMoodTag: 'tired' }, { random: () => 0 })
    assert.ok(line)
    assert.doesNotMatch(line, /怎么了|怎么样/)
  })

  it('planProactiveTick does not force miss while busy', () => {
    const noon = Date.parse('2026-10-28T04:30:00Z')
    const world = buildWorldState({
      now: noon,
      hour: 12,
      lastOwnerAt: noon - 7 * 3600 * 1000,
      mood: 60,
      energy: 70,
      affinity: 20,
      lastOwnerText: '在忙',
      busyUntil: noon + 3600 * 1000,
    })
    assert.equal(world.busyNow, true)
    const plan = planProactiveTick({
      now: noon,
      asleep: false,
      energy: 70,
      mood: 60,
      affinity: 20,
      lastProactiveAt: noon - 40 * 60 * 1000,
      lastOwnerAt: noon - 7 * 3600 * 1000,
      chance: 0.01,
      cooldownMin: 20,
      minOwnerGapMin: 10,
      stickerChance: 0,
      hasSendText: true,
      hasOwner: true,
      timeZone: 'Asia/Shanghai',
      forceMissSilentH: 4,
      world,
      random: () => 0.99,
    })
    // miss should not be forced; either no fire or non-miss
    if (plan.fire) assert.notEqual(plan.motive, 'miss')
  })

  it('diary quiet/busy appends 忍住没烦你', () => {
    const quiet = craftDailyEntry({
      day: '2099-01-01',
      turns: [],
      moodWord: '还行',
      quietDay: true,
    })
    assert.match(quiet, /今天忍住没烦你/)
    const withShare = craftDailyEntry({
      day: '2099-01-01',
      turns: [],
      quietDay: true,
      shareHooks: ['问了怕冷'],
    })
    assert.doesNotMatch(withShare, /忍住没烦你/)
  })

  it('buildShareCandidates exposes insideJoke and fishLife', () => {
    const c = buildShareCandidates({
      silentH: 1,
      shareLog: ensureShareLog(null, { day: '2099-01-02' }),
      shareCfg: { learnOwnerDailyMax: 1, shareDailyMax: 2 },
      profile: normalizeOwnerProfile({}),
      memories: [],
      diary: { entries: [] },
      journalTurns: [{ owner: '流线型身材' }],
      fishLifeProgress: { chapterId: 'rice_war', beatIndex: 0 },
      relation: { insideJoke: true, fishLife: true },
      random: () => 0,
    })
    assert.ok(c.insideJoke || c.fishLife || c.fun)
  })
})
