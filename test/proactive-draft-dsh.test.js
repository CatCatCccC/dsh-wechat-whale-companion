import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDraftPrompt,
  criticDraft,
  draftProactiveLine,
  draftWithDshLlm,
  prefixChatter,
  resolveDshModel,
} from '../lib/core/proactive-draft.js'

describe('proactive draft via DSH llm', () => {
  it('resolves agentDefaultModel selection', () => {
    const ctx = {
      get(name) {
        if (name === 'agentDefaultModel') {
          return {
            currentSelection: () => ({
              provider: 'deepseek-official',
              model: 'deepseek-v4-flash',
            }),
          }
        }
        return undefined
      },
    }
    const route = resolveDshModel(ctx)
    assert.deepEqual(route, {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: undefined,
    })
  })

  it('streams text-delta through ctx.llm', async () => {
    async function* stream() {
      yield { type: 'text-delta', text: '喂，' }
      yield { type: 'text-delta', text: '人呢' }
      yield { type: 'finish', kind: 'stop' }
    }
    const line = await draftWithDshLlm({
      ctx: {},
      llm: { stream: () => stream() },
      motiveId: 'miss',
      world: { mood: 50, affinity: 20, silentH: 6 },
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
    })
    assert.equal(line, '喂，人呢')
  })

  it('draftProactiveLine uses dsh-llm source when stream works', async () => {
    async function* stream() {
      yield { type: 'text-delta', text: '还在吗' }
      yield { type: 'finish', kind: 'stop' }
    }
    const ctx = {
      get(name) {
        if (name === 'llm') return { stream: () => stream() }
        if (name === 'agentDefaultModel') {
          return {
            currentSelection: () => ({
              provider: 'deepseek-official',
              model: 'flash',
            }),
          }
        }
        return undefined
      },
    }
    const r = await draftProactiveLine({
      motiveId: 'miss',
      world: { mood: 55, affinity: 40, silentH: 8 },
      ctx,
      enabledLlm: true,
      random: () => 0.99,
    })
    assert.equal(r.source, 'dsh-llm')
    assert.equal(r.line, '还在吗')
    assert.equal(r.critic, 'pass')

    const noTic = await draftProactiveLine({
      motiveId: 'miss',
      world: { mood: 55, affinity: 40, silentH: 8, proactiveChatter: true },
      ctx,
      enabledLlm: true,
      random: () => 0.01,
    })
    assert.equal(noTic.source, 'dsh-llm')
    assert.equal(noTic.line, '还在吗')
  })

  it('prefixChatter skips learn_owner', () => {
    const ask = '你怕冷还是怕热呀'
    assert.equal(
      prefixChatter(ask, 'learn_owner', { proactiveChatter: true }, { random: () => 0.01 }),
      ask,
    )
  })

  it('miss uses soft fallback when llm missing; material skips', async () => {
    const miss = await draftProactiveLine({
      motiveId: 'miss',
      world: {},
      ctx: { get: () => undefined },
      enabledLlm: true,
      random: () => 0,
    })
    assert.equal(miss.ok, true)
    assert.equal(miss.source, 'soft_fallback')
    assert.ok(miss.line)

    const hot = await draftProactiveLine({
      motiveId: 'share_hot',
      world: { shareHot: { title: '热搜A' } },
      ctx: { get: () => undefined },
      enabledLlm: true,
    })
    assert.equal(hot.ok, false)
    assert.equal(hot.line, '')
    assert.equal(hot.source, 'none')
  })

  it('half_sentence uses short pool without llm', async () => {
    let streamed = 0
    async function* stream() {
      streamed += 1
      yield { type: 'text-delta', text: '不该走到这' }
      yield { type: 'finish', kind: 'stop' }
    }
    const ctx = {
      get(name) {
        if (name === 'llm') return { stream: () => stream() }
        if (name === 'agentDefaultModel') {
          return {
            currentSelection: () => ({
              provider: 'deepseek-official',
              model: 'flash',
            }),
          }
        }
        return undefined
      },
    }
    const r = await draftProactiveLine({
      motiveId: 'lazy',
      form: 'half_sentence',
      world: {},
      ctx,
      enabledLlm: true,
      random: () => 0,
    })
    assert.equal(streamed, 0)
    assert.equal(r.source, 'half_pool')
    assert.ok(r.line)
  })

  it('alarm hardFallback always yields a line', async () => {
    const r = await draftProactiveLine({
      motiveId: 'promise_soft',
      world: { upcomingPromise: { text: '七点闹钟叫醒' } },
      ctx: { get: () => undefined },
      enabledLlm: true,
      hardFallback: true,
    })
    assert.equal(r.ok, true)
    assert.equal(r.source, 'alarm_fallback')
    assert.match(r.line, /到点了/)
  })

  it('critic still rejects preachy llm output', () => {
    assert.equal(criticDraft('记得喝水啦').ok, false)
  })

  it('buildDraftPrompt feeds weather as material for AI', () => {
    const { system, user } = buildDraftPrompt('weather', {
      shareWeather: { hook: '武汉降温' },
      mood: 50,
      affinity: 20,
      silentH: 2,
    })
    assert.match(system, /素材请你自己组织/)
    assert.match(user, /天气\(素材/)
    assert.match(user, /武汉降温/)
    assert.doesNotMatch(user, /分享钩子\(必用\)/)
  })

  it('recall motives feed owner words for AI to rewrite', () => {
    const { system, user } = buildDraftPrompt('inside_joke', {
      shareInsideJoke: { text: '要亲亲才能起床', hook: '亲亲' },
      mood: 50,
      affinity: 20,
      silentH: 2,
    })
    assert.match(system, /素材请你自己组织/)
    assert.match(system, /禁止「突然想起：」/)
    assert.match(user, /主人说过\(素材/)
    assert.match(user, /要亲亲才能起床/)
    assert.doesNotMatch(user, /分享钩子\(必用\)/)
  })

  it('hot / fun / theater also feed material not template paste', () => {
    const hot = buildDraftPrompt('share_hot', {
      shareHot: { title: '某热搜' },
      mood: 50,
      affinity: 10,
      silentH: 3,
    })
    assert.match(hot.user, /热搜\(素材/)
    assert.match(hot.system, /看到热搜：/)
    const fun = buildDraftPrompt('fun_bit', {
      shareFun: { text: '鲸鱼心跳很慢' },
      mood: 50,
      affinity: 10,
      silentH: 3,
    })
    assert.match(fun.user, /趣闻素材\(素材/)
    assert.match(fun.user, /鲸鱼心跳很慢/)
  })

  it('learn_owner uses bank ask without llm', async () => {
    let streamed = 0
    async function* stream() {
      streamed += 1
      yield { type: 'text-delta', text: '编一个无关问题' }
      yield { type: 'finish', kind: 'stop' }
    }
    const ctx = {
      get(name) {
        if (name === 'llm') return { stream: () => stream() }
        if (name === 'agentDefaultModel') {
          return {
            currentSelection: () => ({
              provider: 'deepseek-official',
              model: 'flash',
            }),
          }
        }
        return undefined
      },
    }
    const ask = '你怕冷还是怕热呀'
    const r = await draftProactiveLine({
      motiveId: 'learn_owner',
      world: { shareLearn: { ask, factKey: '主人.怕冷热', id: 'cold' } },
      ctx,
      enabledLlm: true,
      random: () => 0.99,
    })
    assert.equal(streamed, 0)
    assert.equal(r.ok, true)
    assert.equal(r.line, ask)
    assert.equal(r.source, 'learn_bank')
  })
})
