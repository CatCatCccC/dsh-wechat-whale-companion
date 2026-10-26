/**
 * diary / promise / tier / temper / circadian / solitude / focus + wx_* tools
 */
import { softGet } from '../core/ctx.js'

function registerTool(ctx, name, schema, handler) {
  const tools = softGet(ctx, 'tools')
  if (!tools?.register) return () => {}
  try {
    return tools.register(name, schema, handler)
  } catch {
    try {
      return tools.register({ name, ...schema, execute: handler })
    } catch {
      return () => {}
    }
  }
}

/**
 * @param {any} ctx
 * @param {object} runtime
 */
export function applyNurture(ctx, runtime) {
  const mods = runtime.config.modules
  const store = runtime.store
  const disposers = []

  // --- diary ---
  if (mods.diary?.enabled) {
    let diary = store.get('diary.json', { entries: [] })
    if (!Array.isArray(diary.entries)) diary.entries = []
    runtime.diary = {
      add(text, tags = []) {
        diary.entries.unshift({
          at: Date.now(),
          text: String(text).slice(0, 500),
          tags,
        })
        diary.entries = diary.entries.slice(0, 200)
        store.setDebounced('diary.json', diary)
        return diary.entries[0]
      },
      list(n = 10) {
        return diary.entries.slice(0, n)
      },
    }
    disposers.push(
      registerTool(
        ctx,
        'wx_diary',
        {
          description: '写下或查看小鲸鱼的日记（短句事实，不写任务进度）',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['add', 'list'] },
              text: { type: 'string' },
              limit: { type: 'number' },
            },
            required: ['action'],
          },
        },
        async (args) => {
          if (args.action === 'list') return { entries: runtime.diary.list(args.limit || 10) }
          if (!args.text) return { error: 'text required' }
          return { ok: true, entry: runtime.diary.add(args.text) }
        },
      ),
    )
  }

  // --- promise ---
  if (mods.promise?.enabled) {
    let promises = store.get('promises.json', { items: [] })
    if (!Array.isArray(promises.items)) promises.items = []
    const prunePromises = () => {
      const open = promises.items.filter((i) => !i.done)
      const done = promises.items.filter((i) => i.done).slice(-50)
      promises.items = [...open, ...done]
    }
    runtime.promise = {
      add(text, dueAt) {
        const body = String(text || '').trim().slice(0, 300)
        if (!body) return { error: 'text required' }
        const item = {
          id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          text: body,
          dueAt: dueAt || Date.now() + 86400000,
          done: false,
        }
        promises.items.push(item)
        prunePromises()
        store.set('promises.json', promises)
        return item
      },
      due(now = Date.now()) {
        return promises.items.filter((i) => !i.done && i.dueAt <= now)
      },
      complete(id) {
        const it = promises.items.find((i) => i.id === id)
        if (it) it.done = true
        prunePromises()
        store.set('promises.json', promises)
        return it
      },
    }
    disposers.push(
      registerTool(
        ctx,
        'wx_promise',
        {
          description: '记下对主人的约定，到点提醒自己提起',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['add', 'due', 'complete'] },
              text: { type: 'string' },
              dueAt: { type: 'number' },
              id: { type: 'string' },
            },
            required: ['action'],
          },
        },
        async (args) => {
          if (args.action === 'add') return runtime.promise.add(args.text, args.dueAt)
          if (args.action === 'due') return { items: runtime.promise.due() }
          if (args.action === 'complete') return runtime.promise.complete(args.id)
          return { error: 'unknown action' }
        },
      ),
    )

    const tick = setInterval(async () => {
      if (runtime.persona?.snapshot?.()?.asleep) return
      if (runtime.focus?.isBusy?.()) return
      const due = runtime.promise?.due?.() || []
      if (!due.length || !runtime.wechat?.sendText) return
      const item = due[0]
      const to = runtime.owner?.id || undefined
      try {
        await runtime.wechat.sendText(`对了，之前说的「${item.text}」……你还记得吗`, {
          to,
        })
        runtime.promise.complete(item.id)
      } catch {
        /* context_token — push due out 30m so we don't hammer every tick */
        item.dueAt = Date.now() + 30 * 60 * 1000
        store.set('promises.json', promises)
        runtime.stats.promiseSendFail = (runtime.stats.promiseSendFail || 0) + 1
      }
    }, 10 * 60 * 1000)
    tick.unref?.()
    disposers.push(() => clearInterval(tick))
  }

  // --- tier (affinity stages) ---
  if (mods.tier?.enabled) {
    runtime.tier = {
      stage() {
        const a = runtime.persona?.snapshot?.()?.affinity ?? 0
        if (a < 10) return { id: 'stranger', label: '刚认识' }
        if (a < 30) return { id: 'acquaintance', label: '熟人' }
        if (a < 60) return { id: 'friend', label: '损友' }
        if (a < 85) return { id: 'close', label: '很熟' }
        return { id: 'bond', label: '羁绊' }
      },
    }
  }

  // --- temper (daily facts → mood weight) ---
  if (mods.temper?.enabled) {
    let temper = store.get('temper.json', { days: {} })
    if (!temper.days || typeof temper.days !== 'object') temper.days = {}
    runtime.temper = {
      note(fact) {
        const day = new Date().toISOString().slice(0, 10)
        temper.days[day] = temper.days[day] || []
        temper.days[day].push({ at: Date.now(), fact: String(fact).slice(0, 120) })
        // Keep ~14 days
        const keys = Object.keys(temper.days).sort()
        for (const k of keys.slice(0, Math.max(0, keys.length - 14))) {
          delete temper.days[k]
        }
        store.setDebounced('temper.json', temper)
      },
      today() {
        const day = new Date().toISOString().slice(0, 10)
        return temper.days[day] || []
      },
    }
  }

  // --- circadian ---
  if (mods.circadian?.enabled) {
    let circ = store.get('circadian.json', { buckets: Array(24).fill(0) })
    if (!Array.isArray(circ.buckets) || circ.buckets.length !== 24) {
      circ.buckets = Array(24).fill(0)
    }
    runtime.circadian = {
      touch(at = Date.now()) {
        const h = new Date(at).getHours()
        circ.buckets[h] = (circ.buckets[h] || 0) + 1
        store.setDebounced('circadian.json', circ)
      },
      /** Only hours with real activity — empty buckets must not gate proactive. */
      activeHours() {
        return circ.buckets
          .map((c, h) => ({ h, c }))
          .filter((x) => x.c > 0)
          .sort((a, b) => b.c - a.c)
          .slice(0, 5)
          .map((x) => x.h)
      },
    }
  }

  // --- solitude ---
  if (mods.solitude?.enabled) {
    let sol = store.get('solitude.json', { notes: [] })
    if (!Array.isArray(sol.notes)) sol.notes = []
    runtime.solitude = {
      muse(text) {
        sol.notes.unshift({ at: Date.now(), text: String(text).slice(0, 200) })
        sol.notes = sol.notes.slice(0, 50)
        store.setDebounced('solitude.json', sol)
      },
      recent(n = 5) {
        return sol.notes.slice(0, n)
      },
    }
  }

  // --- focus ---
  if (mods.focus?.enabled) {
    let focus = store.get('focus.json', { busyUntil: 0, activity: '' })
    runtime.focus = {
      setBusy(activity, minutes = 30) {
        focus = {
          activity: String(activity).slice(0, 40),
          busyUntil: Date.now() + minutes * 60 * 1000,
        }
        store.set('focus.json', focus)
      },
      isBusy(now = Date.now()) {
        return focus.busyUntil > now
      },
      get: () => ({ ...focus }),
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
