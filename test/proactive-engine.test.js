import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyProactiveEngine } from '../lib/modules/proactive-engine.js'

describe('proactive-engine', () => {
  it('runTick skips when persona suppresses', async () => {
    const runtime = {
      config: {
        modules: {
          persona: {
            enabled: true,
            proactiveTickMs: 60_000,
            proactiveChance: 1,
          },
        },
      },
      stats: {},
      log: { info() {}, warn() {} },
      speak: async () => ({ sent: 1 }),
      owner: { id: 'wx' },
      persona: {
        timeZone: 'Asia/Shanghai',
        regen() {},
        shouldSuppressProactive: () => true,
        snapshot: () => ({
          asleep: true,
          energy: 50,
          mood: 50,
          affinity: 20,
          lastProactiveAt: 0,
          lastOwnerAt: 0,
          recentProactive: [],
        }),
        getLastword: () => ({ text: '' }),
        getSocialPolicy: () => ({ weights: {}, cooldownBiasMin: 0 }),
        rollAgendaDay: () => ({ day: '2099-01-01', used: 0, maxPings: 3, preferred: [] }),
        getAgenda: () => ({ day: '2099-01-01', used: 0, maxPings: 3, preferred: [] }),
      },
    }
    const dispose = applyProactiveEngine({}, runtime)
    assert.equal(typeof runtime.proactiveEngine.runTick, 'function')
    const r = await runtime.proactiveEngine.runTick()
    assert.equal(r.skipped, 'asleep')
    dispose()
  })
})
