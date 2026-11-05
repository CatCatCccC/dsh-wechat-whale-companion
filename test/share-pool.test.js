import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { pickCalendarHook, monthDayInZone } from '../lib/core/share-calendar.js'
import { filledFactKeys, upsertTrait, normalizeOwnerProfile } from '../lib/core/owner-profile.js'
import {
  ensureShareLog,
  prunePending,
  recordShareEntry,
  PENDING_TTL_MS,
} from '../lib/core/share-log.js'
import {
  pickLearnQuestion,
  pickFunBit,
  buildShareCandidates,
} from '../lib/core/share-pool.js'
import { weatherSignal, resolveCoords } from '../lib/core/weather.js'
import { filterHotTitle } from '../lib/core/share-external.js'
import { exportAllNotes } from '../lib/core/notes-export.js'
import { craftDailyEntry } from '../lib/core/auto-diary.js'
import { scoreMotives } from '../lib/core/proactive-motive.js'
import { applyShare } from '../lib/modules/share.js'
import { StateStore } from '../lib/core/state.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

describe('share layer', () => {
  it('defaults weather coords to Wuhan', () => {
    const c = resolveCoords('武汉')
    assert.ok(Math.abs(c.lat - 30.59) < 0.1)
    assert.equal(c.city, '武汉')
  })

  it('weatherSignal flags rain and extreme temp', () => {
    assert.equal(weatherSignal({ precipitation: 1.2, temperature_2m: 20 }).signal, true)
    assert.equal(weatherSignal({ temperature_2m: 3 }).signal, true)
    assert.equal(weatherSignal({ temperature_2m: 22, precipitation: 0 }).signal, false)
  })

  it('picks learn questions avoiding filled factKeys', () => {
    const profile = normalizeOwnerProfile({
      traits: { '主人.口味': '爱吃辣' },
    })
    const q = pickLearnQuestion({
      profile,
      memories: [],
      usedIds: [],
      random: () => 0,
    })
    assert.ok(q)
    assert.notEqual(q.factKey, '主人.口味')
    assert.ok(q.ask)
  })

  it('records share log and pending learn', () => {
    let log = ensureShareLog(null, { day: '2099-01-01' })
    log = recordShareEntry(log, {
      motive: 'learn_owner',
      hook: '问口味',
      line: '爱吃辣吗',
      id: 'taste_spicy',
      isLearn: true,
    })
    assert.equal(log.learnCount, 1)
    assert.ok(log.usedIds.includes('taste_spicy'))
  })

  it('upserts owner profile traits', () => {
    let p = normalizeOwnerProfile({})
    p = upsertTrait(p, '主人.怕冷热', '怕冷')
    assert.equal(p.traits['主人.怕冷热'], '怕冷')
    assert.ok(filledFactKeys(p).has('主人.怕冷热'))
  })

  it('calendar hits anniversary override', () => {
    const md = monthDayInZone(Date.parse('2026-11-04T12:00:00+08:00'))
    const hit = pickCalendarHook(Date.parse('2026-11-04T12:00:00+08:00'), {
      anniversaries: [{ monthDay: md, label: '测试日' }],
    })
    assert.equal(hit?.label, '测试日')
    assert.equal(hit?.kind, 'anniversary')
  })

  it('keeps pending across day roll and prunes after capture window (90m)', () => {
    const now = Date.parse('2099-01-02T10:00:00+08:00')
    const pending = { factKey: '主人.怕冷热', ask: '你怕冷吗', at: now - 60 * 60 * 1000 }
    const rolled = ensureShareLog(
      { day: '2099-01-01', learnCount: 1, shareCount: 1, usedIds: ['x'], entries: [{}], pending },
      { day: '2099-01-02', now },
    )
    assert.equal(rolled.day, '2099-01-02')
    assert.equal(rolled.learnCount, 0)
    assert.equal(rolled.shareCount, 0)
    assert.deepEqual(rolled.usedIds, [])
    assert.equal(rolled.pending?.factKey, '主人.怕冷热')

    const stale = prunePending(
      { ...rolled, pending: { ...pending, at: now - PENDING_TTL_MS - 1000 } },
      now,
    )
    assert.equal(stale.pending, null)
    assert.equal(PENDING_TTL_MS, 90 * 60 * 1000)
  })

  it('weekend calendar needs silence; anniversary does not', () => {
    // 2026-11-06 is Friday
    const fri = Date.parse('2026-11-06T12:00:00+08:00')
    const empty = ensureShareLog(null, { day: '2026-11-06' })
    const quiet = buildShareCandidates({
      now: fri,
      silentH: 0.2,
      timeZone: 'Asia/Shanghai',
      shareLog: empty,
      shareCfg: { learnOwnerDailyMax: 1, shareDailyMax: 2 },
      profile: normalizeOwnerProfile({}),
      memories: [],
      diary: { entries: [] },
      journalTurns: [],
      random: () => 0,
    })
    assert.equal(quiet.calendar, null)

    const loud = buildShareCandidates({
      now: fri,
      silentH: 1.2,
      timeZone: 'Asia/Shanghai',
      shareLog: empty,
      shareCfg: { learnOwnerDailyMax: 1, shareDailyMax: 2 },
      profile: normalizeOwnerProfile({}),
      memories: [],
      diary: { entries: [] },
      journalTurns: [],
      random: () => 0,
    })
    assert.equal(loud.calendar?.kind, 'weekend')

    const md = monthDayInZone(fri)
    const anniv = buildShareCandidates({
      now: fri,
      silentH: 0,
      timeZone: 'Asia/Shanghai',
      shareLog: empty,
      shareCfg: {
        learnOwnerDailyMax: 1,
        shareDailyMax: 2,
        anniversaries: [{ monthDay: md, label: '测试日' }],
      },
      profile: normalizeOwnerProfile({}),
      memories: [],
      diary: { entries: [] },
      journalTurns: [],
      random: () => 0,
    })
    assert.equal(anniv.calendar?.kind, 'anniversary')
  })

  it('captureOwnerReply respects window and topic change', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-share-'))
    const runtime = {
      store: new StateStore(dir),
      config: {
        modules: {
          share: { enabled: true },
          notes: { enabled: false },
          weather: { enabled: false },
          shareExternal: {},
          persona: { timeZone: 'Asia/Shanghai' },
        },
      },
      stats: {},
      log: { warn() {} },
    }
    const dispose = applyShare({}, runtime)
    const now = Date.now()
    runtime.share.getShareLog().pending = {
      factKey: '主人.怕冷热',
      ask: '你怕冷还是怕热',
      at: now - 10 * 60 * 1000,
    }
    const ok = runtime.share.captureOwnerReply('怕冷', { now })
    assert.equal(ok.ok, true)
    assert.equal(ok.text, '怕冷')
    assert.equal(runtime.share.getProfile().traits['主人.怕冷热'], '怕冷')

    runtime.share.getShareLog().pending = {
      factKey: '主人.口味',
      ask: '口味',
      at: now - 10 * 60 * 1000,
    }
    assert.match(runtime.share.profileBlock(), /待主人回答/)
    const topic = runtime.share.captureOwnerReply('帮我写个脚本部署一下报错', { now })
    assert.equal(topic.ok, false)
    assert.equal(topic.skipped, 'topic_change')
    assert.ok(runtime.share.getShareLog().pending)

    // Past 90m TTL: prune clears pending (prompt + capture aligned)
    runtime.share.getShareLog().pending = {
      factKey: '主人.口味',
      ask: '口味',
      at: now - 2 * 60 * 60 * 1000,
    }
    const late = runtime.share.captureOwnerReply('偏辣', { now })
    assert.equal(late.ok, false)
    assert.equal(late.skipped, 'no-pending')
    assert.equal(runtime.share.getShareLog().pending, null)
    assert.doesNotMatch(runtime.share.profileBlock() || '', /待主人回答/)
    dispose()
  })

  it('fun bits load from assets', () => {
    const bit = pickFunBit({ usedIds: [], random: () => 0 })
    assert.ok(bit?.text)
  })

  it('buildShareCandidates exposes learn at silence', () => {
    const c = buildShareCandidates({
      silentH: 1,
      shareLog: ensureShareLog(null, { day: '2099-01-02' }),
      shareCfg: { learnOwnerDailyMax: 1, shareDailyMax: 2 },
      profile: normalizeOwnerProfile({}),
      memories: [],
      diary: { entries: [] },
      journalTurns: [],
      random: () => 0,
    })
    assert.ok(c.learn)
  })

  it('scoreMotives fires learn_owner from world hook', () => {
    const ranked = scoreMotives(
      {
        silentH: 1,
        hour: 15,
        mood: 60,
        energy: 70,
        affinity: 18,
        shareLearn: { ask: '你怕冷吗？', factKey: '主人.怕冷热', id: 'cold_heat' },
      },
      {},
      () => 0,
    )
    assert.ok(ranked.some((m) => m.id === 'learn_owner' && m.score >= 0.48))
  })

  it('filters dangerous hot titles', () => {
    assert.equal(filterHotTitle('可爱猫咪日常'), true)
    assert.equal(filterHotTitle('某地爆炸遇难'), false)
  })

  it('exports notes markdown', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-notes-'))
    exportAllNotes({
      notesDir: dir,
      stateDir: dir,
      profile: { traits: { '主人.口味': '辣' }, summaryLines: ['口味：辣'] },
      diary: { entries: [{ day: '2099-01-01', text: '测试日记' }] },
      memory: { items: [{ kind: 'fact', factKey: '主人.口味', text: '爱辣', superseded: false }] },
      shareLog: { day: '2099-01-01', learnCount: 1, shareCount: 0, entries: [] },
    })
    assert.ok(fs.existsSync(path.join(dir, 'INDEX.md')))
    assert.match(fs.readFileSync(path.join(dir, 'owner-profile.md'), 'utf8'), /口味/)
    assert.match(fs.readFileSync(path.join(dir, 'diary.md'), 'utf8'), /测试日记/)
  })

  it('diary craft includes share hooks', () => {
    const text = craftDailyEntry({
      day: '2099-01-01',
      turns: [],
      moodWord: '还行',
      shareHooks: ['问了怕冷', '周六了'],
    })
    assert.match(text, /问了怕冷/)
  })
})
