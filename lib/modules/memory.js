/**
 * WeChat fish-memory: fading recall injected into persona prompt + wx_memory tool.
 * Inspired by github:Yuuyuko-uu/dsh-fish-memory (half-life / facts / quota) — lean port.
 */
import { registerTool } from '../core/tools.js'
import {
  countActive,
  formatInjectBlock,
  recall,
  remember,
} from '../core/memory-store.js'

/**
 * @param {any} ctx
 * @param {object} runtime
 */
export function applyMemory(ctx, runtime) {
  const mod = runtime.config.modules.memory
  if (!mod?.enabled) return () => {}

  const store = runtime.store
  const disposers = []
  let bag = store.get('fish-memory.json', { items: [] })
  if (!Array.isArray(bag.items)) bag.items = []

  const persist = () => store.setDebounced('fish-memory.json', bag)

  const cfg = () => ({
    halfLifeDays: Number(mod.halfLifeDays) || 30,
    maxInject: Number(mod.maxInject) || 6,
    maxFacts: Number(mod.maxFacts) || 3,
    maxChars: Number(mod.maxChars) || 800,
    dailyQuota: Number(mod.dailyQuota) || 8,
    evidenceMin: Number(mod.evidenceMin) || 1,
    timeZone:
      mod.timeZone ||
      runtime.config.modules.persona?.timeZone ||
      'Asia/Shanghai',
  })

  runtime.memory = {
    list(limit = 20) {
      const lim = Math.min(50, Math.max(1, Number(limit) || 20))
      return bag.items.filter((i) => !i.superseded).slice(0, lim)
    },
    injectBlock(query) {
      const c = cfg()
      const q = String(query || runtime.persona?.snapshot?.()?.lastOwnerText || '')
      const picked = recall(q, bag.items, c)
      runtime.stats.memoryRecall = (runtime.stats.memoryRecall || 0) + 1
      runtime.stats.memoryLastInject =
        (picked.facts?.length || 0) + (picked.events?.length || 0)
      return formatInjectBlock(picked, { maxChars: c.maxChars })
    },
    remember(text, opts = {}) {
      const c = cfg()
      const r = remember(
        bag.items,
        {
          text,
          kind: opts.kind === 'fact' ? 'fact' : 'event',
          importance: opts.importance,
          factKey: opts.factKey,
          tags: opts.tags,
        },
        { dailyQuota: c.dailyQuota, timeZone: c.timeZone },
      )
      if (!r.ok) return r
      bag.items = r.items
      persist()
      runtime.stats.memoryRemember = (runtime.stats.memoryRemember || 0) + 1
      return { ok: true, item: r.item }
    },
    forget(id) {
      const it = bag.items.find((i) => i.id === id)
      if (!it) return { ok: false, error: 'not found' }
      it.superseded = true
      persist()
      return { ok: true, id }
    },
    stats() {
      return {
        active: countActive(bag.items),
        total: bag.items.length,
        halfLifeDays: cfg().halfLifeDays,
      }
    },
  }

  disposers.push(
    registerTool(
      ctx,
      'wx_memory',
      {
        description:
          '鱼的记忆：记下/想起对主人有意义的事。action=remember|recall|list|forget。' +
          '长期事实 kind=fact（喜好/约定/身份）不淡忘；普通事件会随时间变淡。' +
          '同一件事用 factKey（如 主人.喜好）只留最新。每天有条数上限。',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['remember', 'recall', 'list', 'forget'],
            },
            text: { type: 'string' },
            kind: { type: 'string', enum: ['event', 'fact'] },
            importance: { type: 'number' },
            factKey: { type: 'string' },
            query: { type: 'string' },
            id: { type: 'string' },
            limit: { type: 'number' },
          },
          required: ['action'],
        },
      },
      async (args) => {
        const action = String(args.action || '')
        if (action === 'list') {
          return { items: runtime.memory.list(args.limit || 15), ...runtime.memory.stats() }
        }
        if (action === 'forget') {
          return runtime.memory.forget(String(args.id || ''))
        }
        if (action === 'recall') {
          const c = cfg()
          const q = String(args.query || args.text || runtime.persona?.snapshot?.()?.lastOwnerText || '')
          const picked = recall(q, bag.items, c)
          return {
            ok: true,
            query: q,
            facts: picked.facts,
            events: picked.events,
            block: formatInjectBlock(picked, { maxChars: c.maxChars }),
          }
        }
        if (action === 'remember') {
          return runtime.memory.remember(args.text, {
            kind: args.kind,
            importance: args.importance,
            factKey: args.factKey,
          })
        }
        return { error: 'unknown action' }
      },
      {
        onRegistered: (n) => {
          runtime.stats.toolsRegistered = {
            ...(runtime.stats.toolsRegistered || {}),
            [n]: true,
          }
          runtime.log?.info?.(`[whale-companion] tool registered: ${n}`)
        },
      },
    ),
  )

  // Bridge: diary notes also land as soft event memories (same quota)
  const prevDiary = runtime.diary
  if (prevDiary?.add && mod.bridgeDiary !== false) {
    const orig = prevDiary.add.bind(prevDiary)
    prevDiary.add = (text, tags = []) => {
      const entry = orig(text, tags)
      try {
        const tagList = Array.isArray(tags) ? tags : []
        runtime.memory.remember(String(text || ''), {
          kind: 'event',
          importance: 0.5,
          tags: ['diary', ...tagList],
        })
      } catch {
        /* ignore */
      }
      return entry
    }
  }

  return () => {
    for (const d of disposers) {
      try {
        typeof d === 'function' && d()
      } catch {
        /* ignore */
      }
    }
  }
}
