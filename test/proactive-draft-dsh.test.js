import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  criticDraft,
  draftProactiveLine,
  draftWithDshLlm,
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
    })
    assert.equal(r.source, 'dsh-llm')
    assert.equal(r.line, '还在吗')
    assert.equal(r.critic, 'pass')
  })

  it('falls back to template when llm missing', async () => {
    const r = await draftProactiveLine({
      motiveId: 'miss',
      world: {},
      ctx: { get: () => undefined },
      enabledLlm: true,
    })
    assert.ok(r.line)
    assert.ok(r.source === 'template' || r.source === 'emergency')
    assert.equal(r.critic, 'no_dsh_llm')
  })

  it('critic still rejects preachy llm output', () => {
    assert.equal(criticDraft('记得喝水啦').ok, false)
  })
})
