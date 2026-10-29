/**
 * diary / promise / tier / circadian + wx_* tools
 */
import { registerTool } from '../core/tools.js'
import { DEFAULT_TIME_ZONE, hourInTimeZone } from './proactive.js'

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
        const lim = Number(n)
        return diary.entries.slice(
          0,
          Number.isFinite(lim) && lim > 0 ? Math.min(50, Math.floor(lim)) : 10,
        )
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
        {
          onRegistered: (n) => {
            runtime.stats.toolsRegistered = { ...(runtime.stats.toolsRegistered || {}), [n]: true }
          },
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
        const due = Number(dueAt)
        const dueMs =
          Number.isFinite(due) && due > 0
            ? due < 1e12
              ? due * 1000
              : due
            : Date.now() + 86400000
        const item = {
          id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          text: body,
          dueAt: dueMs,
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
        if (!it) return null
        it.done = true
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
          description:
          '记下对主人的约定/闹钟，到点主动微信提醒。' +
          '叫醒、提醒务必 action=add 并给 dueAt=到期时刻的 Unix 毫秒（Asia/Shanghai）。' +
          '例：今天 7:40 起床 → 算准当天 07:40 的毫秒时间戳；只口头说「记下了」不算数。' +
          '省略 dueAt 会默认约 24 小时后，闹钟会错。',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['add', 'due', 'complete'] },
              text: { type: 'string' },
              dueAt: {
                type: 'number',
                description: '到期 Unix 毫秒时间戳（必填才准；秒级也会自动×1000）',
              },
              id: { type: 'string' },
            },
            required: ['action'],
          },
        },
        async (args) => {
          if (args.action === 'add') {
            if (args.dueAt == null || args.dueAt === '') {
              return {
                ok: false,
                error:
                  'dueAt required for reliable alarms (Unix ms of the wake time in Asia/Shanghai)',
              }
            }
            return runtime.promise.add(args.text, args.dueAt)
          }
          if (args.action === 'due') return { items: runtime.promise.due() }
          if (args.action === 'complete') {
            const item = runtime.promise.complete(args.id)
            return item ? { ok: true, item } : { ok: false, error: 'promise not found' }
          }
          return { error: 'unknown action' }
        },
        {
          onRegistered: (n) => {
            runtime.stats.toolsRegistered = { ...(runtime.stats.toolsRegistered || {}), [n]: true }
          },
        },
      ),
    )

    // Alarms must fire even when she 「睡着」after 晚安 — asleep only gates chatty proactive.
    const tick = setInterval(async () => {
      const due = runtime.promise?.due?.() || []
      if (!due.length || !runtime.wechat?.sendText) return
      const item = due[0]
      const to = runtime.owner?.id || ''
      // Don't push a reminder before a WeChat peer is bound: the tool falls
      // back to the first known user and could message a stranger.
      if (!to) return
      try {
        runtime.wechatSessions?.refresh?.()
        const bound = runtime.wechatSessions?.list?.()?.[0]
        const line = /起床|叫醒|喊我|闹钟|醒/.test(item.text)
          ? `喂，到点了——「${item.text}」。快起来。`
          : `对了，之前说的「${item.text}」……你还记得吗`
        const sendOpts = { to, agentId: bound?.sessionId || undefined }
        if (typeof runtime.speak === 'function') {
          const sent = await runtime.speak(line, sendOpts)
          if (!(sent?.sent > 0)) {
            throw new Error(sent?.reason || sent?.skipped || 'speak sent 0')
          }
        } else {
          await runtime.wechat.sendText(line, sendOpts)
        }
        // Wake herself too so later proactive isn't stuck asleep after a 晚安 night
        runtime.persona?.setAsleep?.(false)
        runtime.promise.complete(item.id)
        runtime.stats.promiseSent = (runtime.stats.promiseSent || 0) + 1
      } catch {
        /* context_token — push due out 30m so we don't hammer every tick */
        item.dueAt = Date.now() + 30 * 60 * 1000
        store.set('promises.json', promises)
        runtime.stats.promiseSendFail = (runtime.stats.promiseSendFail || 0) + 1
      }
    }, 60 * 1000)
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

  // --- circadian ---
  if (mods.circadian?.enabled) {
    let circ = store.get('circadian.json', { buckets: Array(24).fill(0) })
    if (!Array.isArray(circ.buckets) || circ.buckets.length !== 24) {
      circ.buckets = Array(24).fill(0)
    }
    const tz =
      typeof mods.persona?.timeZone === 'string' && mods.persona.timeZone.trim()
        ? mods.persona.timeZone.trim()
        : DEFAULT_TIME_ZONE
    runtime.circadian = {
      touch(at = Date.now()) {
        const ms = Number(at)
        if (!Number.isFinite(ms) || ms <= 0) return
        const h = hourInTimeZone(ms, tz)
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
