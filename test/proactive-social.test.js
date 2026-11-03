import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ensureAgenda, agendaAllows, bumpAgendaUsed } from '../lib/core/proactive-agenda.js'
import { criticDraft, fallbackLine, templateLine } from '../lib/core/proactive-draft.js'
import { pickMotive, scoreMotives } from '../lib/core/proactive-motive.js'
import {
  applyFeedback,
  classifyOwnerReply,
  normalizePolicy,
} from '../lib/core/social-policy.js'
import { buildWorldState, detectOpenThread } from '../lib/core/proactive-world.js'
import { planProactiveTick } from '../lib/modules/proactive.js'

describe('proactive social engine', () => {
  it('detects open threads from owner deferrals', () => {
    assert.ok(detectOpenThread([], '我晚点再说'))
    assert.equal(detectOpenThread([], '哈哈'), '')
  })

  it('scores continue_thread / promise over hydrate', () => {
    const world = buildWorldState({
      hour: 15,
      lastOwnerAt: Date.now() - 3 * 3600 * 1000,
      mood: 60,
      energy: 70,
      affinity: 40,
      lastOwnerText: '晚点聊',
      upcomingPromises: [{ text: '八点喊我', dueAt: Date.now() + 40 * 60 * 1000 }],
    })
    const ranked = scoreMotives(world, {})
    assert.ok(ranked[0].id === 'promise_soft' || ranked[0].id === 'continue_thread')
    assert.ok(!ranked.some((m) => m.id === 'hydrate' && m.score > ranked[0].score))
  })

  it('returns no_motive when nothing social is going on', () => {
    const world = buildWorldState({
      hour: 15,
      lastOwnerAt: Date.now() - 20 * 60 * 1000,
      mood: 60,
      energy: 70,
      affinity: 10,
      lastOwnerText: '嗯',
    })
    const { pick, reason } = pickMotive(world, {}, { minScore: 0.48, random: () => 0.99 })
    assert.equal(pick, null)
    assert.equal(reason, 'no_motive')
  })

  it('critic rejects preachy care scripts', () => {
    assert.equal(criticDraft('记得喝水哦').ok, false)
    assert.equal(criticDraft('喂').ok, true)
  })

  it('templates avoid empty hooks crashing', () => {
    const line = templateLine('miss', { openThread: '', memoryHook: '' })
    assert.ok(line.length >= 1)
    const fb = fallbackLine('soft', { memoryHook: '喜欢猫' }, { lastword: '想你了，就一句' })
    assert.ok(fb.line)
  })

  it('agenda caps non-promise motives', () => {
    let agenda = ensureAgenda(null, { day: '2099-01-01', dailyMax: 1 })
    assert.equal(agendaAllows(agenda, 'miss'), true)
    agenda = bumpAgendaUsed(agenda)
    assert.equal(agendaAllows(agenda, 'miss'), false)
    assert.equal(agendaAllows(agenda, 'promise_soft'), true)
  })

  it('policy learns from annoy feedback', () => {
    let p = normalizePolicy(null)
    const before = p.weights.miss
    p = applyFeedback(p, 'miss', 'annoy')
    assert.ok(p.weights.miss < before)
    assert.ok(p.cooldownBiasMin >= 20)
  })

  it('classifies owner reply within proactive window', () => {
    const now = Date.now()
    assert.equal(
      classifyOwnerReply('别烦我', { lastProactiveAt: now - 5 * 60 * 1000, now }).kind,
      'annoy',
    )
    assert.equal(
      classifyOwnerReply('刚忙完想你了哈哈', {
        lastProactiveAt: now - 5 * 60 * 1000,
        now,
      }).kind,
      'engage',
    )
    assert.equal(
      classifyOwnerReply('你好', { lastProactiveAt: now - 2 * 3600 * 1000, now }).kind,
      'none',
    )
  })

  it('planProactiveTick social path fires on miss silence', () => {
    const noon = Date.parse('2026-10-28T04:30:00Z') // 12:30 Shanghai
    const world = buildWorldState({
      now: noon,
      hour: 12,
      lastOwnerAt: noon - 7 * 3600 * 1000,
      mood: 60,
      energy: 70,
      affinity: 30,
      lastOwnerText: '在忙',
    })
    const plan = planProactiveTick({
      now: noon,
      asleep: false,
      energy: 70,
      mood: 60,
      affinity: 30,
      lastProactiveAt: noon - 40 * 60 * 1000,
      lastOwnerAt: noon - 7 * 3600 * 1000,
      chance: 1,
      cooldownMin: 20,
      minOwnerGapMin: 10,
      stickerChance: 0,
      hasSendText: true,
      hasOwner: true,
      timeZone: 'Asia/Shanghai',
      socialEngine: true,
      world,
      random: () => 0,
    })
    assert.equal(plan.fire, true)
    assert.equal(plan.motive, 'miss')
    assert.ok(plan.line)
  })

  it('forces miss after long silence even if chance dice would fail', () => {
    const noon = Date.parse('2026-10-28T04:30:00Z')
    const world = buildWorldState({
      now: noon,
      hour: 12,
      lastOwnerAt: noon - 7 * 3600 * 1000,
      mood: 60,
      energy: 70,
      affinity: 20,
      lastOwnerText: '在忙',
    })
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
      socialEngine: true,
      forceMissSilentH: 4,
      world,
      // would fail chance if rolled first
      random: () => 0.99,
    })
    assert.equal(plan.fire, true)
    assert.equal(plan.motive, 'miss')
    assert.equal(plan.forced, true)
  })
})
