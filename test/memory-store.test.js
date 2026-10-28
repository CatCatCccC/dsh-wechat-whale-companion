import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  dayKey,
  formatWhen,
  freshness,
  formatInjectBlock,
  recall,
  remember,
  tokenize,
} from '../lib/core/memory-store.js'

describe('fish memory store', () => {
  it('tokenizes cjk and latin', () => {
    const t = tokenize('主人喜欢白米饭 hello123')
    assert.ok(t.includes('主人'))
    assert.ok(t.includes('米饭') || t.includes('白米'))
    assert.ok(t.includes('hello123'))
  })

  it('facts stay fresh; events fade', () => {
    const now = Date.UTC(2026, 9, 28)
    const fact = { kind: 'fact', at: now - 90 * 86400000, text: 'x' }
    const event = { kind: 'event', at: now - 30 * 86400000, text: 'y' }
    assert.equal(freshness(fact, now, 30), 1)
    assert.ok(Math.abs(freshness(event, now, 30) - 0.5) < 1e-9)
  })

  it('factKey supersedes older same key', () => {
    let items = []
    let r = remember(items, { text: '身高一米七', kind: 'fact', factKey: '主人.身高' })
    items = r.items
    r = remember(items, { text: '身高一米七二', kind: 'fact', factKey: '主人.身高' })
    items = r.items
    const active = items.filter((i) => i.factKey === '主人.身高' && !i.superseded)
    assert.equal(active.length, 1)
    assert.match(active[0].text, /一米七二/)
  })

  it('factKey forces kind=fact even if draft says event', () => {
    let items = []
    let r = remember(items, {
      text: '喜欢米饭',
      kind: 'fact',
      factKey: '主人.喜好',
    })
    items = r.items
    r = remember(items, {
      text: '今天说喜欢面条',
      kind: 'event',
      factKey: '主人.喜好',
    })
    items = r.items
    assert.equal(r.item.kind, 'fact')
    const active = items.filter((i) => i.factKey === '主人.喜好' && !i.superseded)
    assert.equal(active.length, 1)
    assert.match(active[0].text, /面条/)
  })

  it('recalls by evidence and keeps facts', () => {
    const now = Date.now()
    const items = [
      {
        id: '1',
        text: '主人爱吃白米饭',
        kind: 'fact',
        at: now - 86400000,
        importance: 0.9,
      },
      {
        id: '2',
        text: '上周一起熬夜改插件',
        kind: 'event',
        at: now - 2 * 86400000,
        importance: 0.6,
      },
      {
        id: '3',
        text: '随便聊了天气',
        kind: 'event',
        at: now - 10 * 86400000,
        importance: 0.3,
      },
    ]
    const picked = recall('米饭吃了吗', items, { now, maxInject: 4, maxFacts: 2 })
    assert.equal(picked.facts.length, 1)
    assert.match(picked.facts[0].text, /米饭/)
    const block = formatInjectBlock(picked, { now })
    assert.match(block, /记忆/)
    assert.match(block, /米饭/)
  })

  it('enforces daily quota on events', () => {
    let items = []
    const now = Date.now()
    for (let i = 0; i < 8; i++) {
      const r = remember(items, { text: `事${i}`, kind: 'event' }, { dailyQuota: 8, now })
      assert.equal(r.ok, true)
      items = r.items
    }
    const fail = remember(items, { text: '多一条', kind: 'event' }, { dailyQuota: 8, now })
    assert.equal(fail.ok, false)
    const fact = remember(items, { text: '长期偏好', kind: 'fact' }, { dailyQuota: 8, now })
    assert.equal(fact.ok, true)
  })

  it('empty/stopword query injects facts only', () => {
    const now = Date.now()
    const items = [
      { id: 'f', text: '主人爱米饭', kind: 'fact', at: now, importance: 0.9 },
      { id: 'e', text: '上周熬夜', kind: 'event', at: now, importance: 0.8 },
    ]
    const picked = recall('哦', items, { now })
    assert.equal(picked.facts.length, 1)
    assert.equal(picked.events.length, 0)
  })

  it('dayKey and formatWhen use Asia/Shanghai', () => {
    // 2026-09-01 00:30 UTC = 08:30 Shanghai same calendar day
    const now = Date.UTC(2026, 9, 28, 4, 0, 0)
    assert.equal(dayKey(now, 'Asia/Shanghai'), '2026-10-28')
    assert.equal(formatWhen(Date.UTC(2026, 8, 1, 0, 30), now, 'Asia/Shanghai'), '09-01')
    assert.match(formatWhen(Date.UTC(2025, 8, 1, 0, 30), now, 'Asia/Shanghai'), /去年/)
    assert.match(formatWhen(Date.UTC(2024, 8, 1, 0, 30), now, 'Asia/Shanghai'), /^2024-/)
  })
})
