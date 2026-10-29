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
import { formatJournalBlock, pushTurn } from '../core/chat-journal.js'

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
  let journal = store.get('chat-journal.json', { turns: [] })
  if (!Array.isArray(journal.turns)) journal.turns = []

  const persist = () => store.setDebounced('fish-memory.json', bag)
  const persistJournal = () => store.setDebounced('chat-journal.json', journal)

  const cfg = () => ({
    halfLifeDays: Number(mod.halfLifeDays) || 30,
    maxInject: Number(mod.maxInject) || 6,
    maxFacts: Number(mod.maxFacts) || 3,
    maxChars: Number(mod.maxChars) || 800,
    dailyQuota: Number(mod.dailyQuota) || 8,
    evidenceMin: Number(mod.evidenceMin) || 1,
    journalLimit: Number(mod.journalLimit) || 80,
    journalInject: Number(mod.journalInject) || 16,
    timeZone:
      mod.timeZone ||
      runtime.config.modules.persona?.timeZone ||
      'Asia/Shanghai',
  })

  /** Clear owner lines that should land in memory even if the model forgets the tool. */
  const AUTO_FACT =
    /我喜欢|我不喜欢|我爱吃|我叫|我的名字是|我住|我家在|我对.+过敏|我是.+血型/
  const AUTO_EVENT =
    /记住|别忘了|约定|明天|后天|每周|上班|下班|开会/

  let lastAutoKey = ''
  let pendingOwner = ''

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
      const facts = formatInjectBlock(picked, {
        maxChars: c.maxChars,
        timeZone: c.timeZone,
      })
      const recent = formatJournalBlock(journal.turns, {
        maxLines: c.journalInject,
        maxChars: 900,
        timeZone: c.timeZone,
      })
      return [recent, facts].filter(Boolean).join('\n\n')
    },
    /** Stash owner line until assistant replies, then commit one journal turn. */
    noteOwnerTurn(text) {
      pendingOwner = String(text || '').trim().slice(0, 120)
    },
    noteAssistantTurn(text) {
      if (mod.journal === false) return { ok: false, skipped: 'disabled' }
      const assistant = String(text || '').trim().slice(0, 160)
      if (!pendingOwner && !assistant) return { ok: false, skipped: 'empty' }
      const c = cfg()
      journal.turns = pushTurn(journal.turns, {
        owner: pendingOwner,
        assistant,
        limit: c.journalLimit,
      })
      pendingOwner = ''
      persistJournal()
      runtime.stats.journalTurns = journal.turns.length
      return { ok: true, n: journal.turns[0]?.n }
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
    /**
     * Best-effort capture from owner text (whale-loli-style “must leave a trace”).
     * Skips pure alarm lines (those belong to wx_promise).
     */
    autoCaptureOwner(text) {
      if (mod.autoCapture === false) return { ok: false, skipped: 'disabled' }
      const t = String(text || '').trim().slice(0, 200)
      if (t.length < 4) return { ok: false, skipped: 'short' }
      if (/喊我|叫醒|起床|提醒我/.test(t) && /\d\s*[点:：时]/.test(t)) {
        return { ok: false, skipped: 'alarm' }
      }
      const isFact = AUTO_FACT.test(t)
      const isEvent = AUTO_EVENT.test(t)
      if (!isFact && !isEvent) return { ok: false, skipped: 'no-match' }
      const key = t.slice(0, 80)
      if (key === lastAutoKey) return { ok: false, skipped: 'dup' }
      lastAutoKey = key
      let factKey
      if (/喜欢|爱吃|不喜欢/.test(t)) factKey = '主人.喜好'
      else if (/我叫|名字/.test(t)) factKey = '主人.名字'
      else if (/住|家在/.test(t)) factKey = '主人.住址'
      else if (/过敏/.test(t)) factKey = '主人.过敏'
      const r = runtime.memory.remember(t, {
        kind: isFact || factKey ? 'fact' : 'event',
        factKey,
        importance: isFact || factKey ? 0.85 : 0.55,
        tags: ['auto'],
      })
      if (r?.ok) runtime.stats.memoryAuto = (runtime.stats.memoryAuto || 0) + 1
      return r
    },
    forget(id) {
      const it = bag.items.find((i) => i.id === id)
      if (!it) return { ok: false, error: 'not found' }
      it.superseded = true
      persist()
      return { ok: true, id }
    },
    /** Wipe facts/events + rolling journal (/whale-reset memory|all) */
    reset() {
      bag = { items: [] }
      journal = { turns: [] }
      pendingOwner = ''
      lastAutoKey = ''
      persist()
      persistJournal()
      runtime.stats.memoryRemember = 0
      runtime.stats.memoryAuto = 0
      runtime.stats.journalTurns = 0
      return { ok: true }
    },
    stats() {
      return {
        active: countActive(bag.items),
        total: bag.items.length,
        halfLifeDays: cfg().halfLifeDays,
        journal: journal.turns.length,
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
              enum: ['remember', 'recall', 'list', 'forget', 'reset', 'clear'],
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
            block: formatInjectBlock(picked, {
              maxChars: c.maxChars,
              timeZone: c.timeZone,
            }),
          }
        }
        if (action === 'remember') {
          return runtime.memory.remember(args.text, {
            kind: args.kind,
            importance: args.importance,
            factKey: args.factKey,
          })
        }
        if (action === 'reset' || action === 'clear') {
          return runtime.memory.reset()
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
