import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectGoodnight,
  detectMakeup,
  tryUnlockMilestone,
  pickMilestoneHook,
  normalizeMilestones,
} from '../lib/core/milestones.js'
import { pickCalendarHook } from '../lib/core/share-calendar.js'
import {
  buildShareCandidates,
  pickMiniTheater,
} from '../lib/core/share-pool.js'
import { ensureShareLog } from '../lib/core/share-log.js'
import { normalizeOwnerProfile } from '../lib/core/owner-profile.js'
import { scoreMotives } from '../lib/core/proactive-motive.js'
import { templateLine, buildDraftPrompt } from '../lib/core/proactive-draft.js'

describe('milestones chatter theater', () => {
  it('detects goodnight and rejects tech false positives', () => {
    assert.equal(detectGoodnight('晚安'), true)
    assert.equal(detectGoodnight('我睡了'), true)
    assert.equal(detectGoodnight('开会晚安顺便改代码报错'), false)
    assert.equal(detectGoodnight('晚安啊这句故意写得很长超过二十四字用来挡误伤的哈哈哈'), false)
  })

  it('unlocks goodnight once and makeup with sulk context', () => {
    let state = normalizeMilestones(null)
    const a = tryUnlockMilestone(state, '晚安', { now: 1000 })
    assert.equal(a.changed, true)
    assert.ok(a.state.unlocked.first_goodnight)
    const again = tryUnlockMilestone(a.state, '晚安', { now: 2000 })
    assert.equal(again.changed, false)

    const noCtx = tryUnlockMilestone(a.state, '对不起', { now: 3000 })
    assert.equal(noCtx.changed, false)
    const makeup = tryUnlockMilestone(a.state, '对不起别生气', {
      now: 3000,
      recentDismiss: true,
    })
    assert.equal(makeup.changed, true)
    assert.ok(makeup.state.unlocked.first_makeup)
  })

  it('milestone calendar beats weekend', () => {
    // 2026-11-06 Friday
    const fri = Date.parse('2026-11-06T12:00:00+08:00')
    const unlockedAt = fri - 7 * 86400000
    const ms = normalizeMilestones({
      unlocked: { first_goodnight: { at: unlockedAt, text: '晚安' } },
    })
    const hook = pickMilestoneHook(ms, fri, { timeZone: 'Asia/Shanghai' })
    assert.ok(hook)
    assert.equal(hook.kind, 'milestone')
    const cal = pickCalendarHook(fri, {
      timeZone: 'Asia/Shanghai',
      milestoneHook: hook,
    })
    assert.equal(cal?.kind, 'milestone')
    assert.match(cal.id, /^ms-/)
  })

  it('chatter can prefix non-learn motives; learn stays bank ask', () => {
    const ask = '你怕冷还是怕热呀'
    const learn = templateLine(
      'learn_owner',
      { shareLearn: { ask }, proactiveChatter: true },
      { random: () => 0.01, proactiveChatter: true },
    )
    assert.equal(learn, ask)

    const miss = templateLine(
      'miss',
      { proactiveChatter: true },
      { random: () => 0.01, proactiveChatter: true },
    )
    assert.ok(miss)
    const { user } = buildDraftPrompt('miss', {
      proactiveChatter: true,
      dayPart: 'night',
      mood: 50,
      affinity: 20,
      silentH: 3,
    })
    assert.match(user, /口癖/)
  })

  it('mini theater advances and is suppressed when learn present', () => {
    const a = pickMiniTheater({
      progress: { chapterId: 'rice_window', beatIndex: 0 },
      usedIds: [],
    })
    assert.ok(a?.id)
    const b = pickMiniTheater({
      progress: { chapterId: a.chapterId, beatIndex: a.nextBeatIndex },
      usedIds: [a.id],
    })
    assert.ok(b)
    assert.notEqual(b.id, a.id)

    const c = buildShareCandidates({
      silentH: 2,
      now: Date.now(),
      shareLog: ensureShareLog(null, { day: '2099-01-02' }),
      shareCfg: { learnOwnerDailyMax: 1, shareDailyMax: 2 },
      profile: normalizeOwnerProfile({}),
      memories: [],
      diary: { entries: [] },
      journalTurns: [],
      relation: { miniTheater: true, miniTheaterDailyP: 1, insideJoke: false, fishLife: false },
      blockMiniTheater: true,
      random: () => 0,
    })
    assert.equal(c.miniTheater, null)
  })

  it('mini_theater scores below learn when both hooked', () => {
    const ranked = scoreMotives(
      {
        silentH: 2,
        hour: 15,
        mood: 55,
        energy: 70,
        affinity: 30,
        shareLearn: { ask: '问一句', factKey: 'k', id: 'q1' },
        shareMiniTheater: { hook: '续一下', text: '窗边白饭', id: 'mt1' },
      },
      {},
      () => 0,
    )
    const learn = ranked.find((m) => m.id === 'learn_owner')
    const theater = ranked.find((m) => m.id === 'mini_theater')
    assert.ok(learn && theater)
    assert.ok(learn.score > theater.score)
    assert.ok(theater.score >= 0.48)
  })

  it('weak shares clear minMotiveScore; weak-only does not crush miss', () => {
    const weak = scoreMotives(
      {
        silentH: 2,
        hour: 15,
        mood: 55,
        energy: 70,
        affinity: 30,
        shareFun: { hook: '趣闻', text: '趣闻', id: 'f1' },
        shareFishLife: { hook: '鱼生', text: '鱼生', id: 'fl1' },
        shareMiniTheater: { hook: '剧场', text: '剧场', id: 'mt1' },
        shareHot: { hook: '热搜', title: '热搜', id: 'h1' },
        shareMedia: { hook: '番', title: '番', id: 'm1' },
      },
      {},
      () => 0,
    )
    for (const id of ['fun_bit', 'fish_life', 'mini_theater', 'share_hot', 'share_media']) {
      const m = weak.find((x) => x.id === id)
      assert.ok(m, id)
      assert.ok(m.score >= 0.48, `${id} score ${m.score}`)
    }

    const withFun = scoreMotives(
      {
        silentH: 6,
        hour: 15,
        mood: 55,
        energy: 70,
        affinity: 40,
        shareFun: { hook: '趣闻', id: 'f1' },
      },
      {},
      () => 0,
    )
    const miss = withFun.find((m) => m.id === 'miss')
    assert.ok(miss)
    assert.ok(miss.score >= 0.48, `miss ${miss.score}`)
  })
})
