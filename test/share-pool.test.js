import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { pickCalendarHook, monthDayInZone } from '../lib/core/share-calendar.js'
import { filledFactKeys, upsertTrait, normalizeOwnerProfile } from '../lib/core/owner-profile.js'
import { ensureShareLog, recordShareEntry } from '../lib/core/share-log.js'
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
