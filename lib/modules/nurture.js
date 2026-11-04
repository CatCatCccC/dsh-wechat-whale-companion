/**
 * diary / promise / tier / circadian + wx_* tools
 */
import {
  craftDailyEntry,
  filterTurnsForDay,
  shouldWriteDaily,
} from '../core/auto-diary.js'
import { parseDueAt } from '../core/parse-due.js'
import { STORE, loadStore, saveStore } from '../core/stores.js'
import { registerTool } from '../core/tools.js'
import { affinityWord, moodWord } from './mood-words.js'
import { DEFAULT_TIME_ZONE, hourInTimeZone } from './proactive.js'

/**
 * @param {any} ctx
 * @param {object} runtime
 */
export function applyNurture(ctx, runtime) {
  const mods = runtime.config.modules
  const store = runtime.store
  const disposers = []

  // --- diary (one entry per calendar day at writeAt) ---
  if (mods.diary?.enabled) {
    let diary = loadStore(store, STORE.DIARY, {
      entries: [],
      lastWrittenDay: '',
    }).data
    if (!Array.isArray(diary.entries)) diary.entries = []
    const persistDiary = () => saveStore(store, STORE.DIARY, diary, { debounce: true })
    const tz =
      runtime.config.modules.persona?.timeZone ||
      mods.diary?.timeZone ||
      DEFAULT_TIME_ZONE

    runtime.diary = {
      add(text, tags = [], day = '') {
        const entry = {
          at: Date.now(),
          day: day || undefined,
          text: String(text).slice(0, 500),
          tags,
        }
        diary.entries.unshift(entry)
        diary.entries = diary.entries.slice(0, 200)
        persistDiary()
        return diary.entries[0]
      },
      list(n = 10) {
        const lim = Number(n)
        return diary.entries.slice(
          0,
          Number.isFinite(lim) && lim > 0 ? Math.min(50, Math.floor(lim)) : 10,
        )
      },
      clear() {
        diary = { entries: [], lastWrittenDay: '' }
        saveStore(store, STORE.DIARY, diary)
        return { ok: true }
      },
      /** Persona tick: write today's diary once past writeAt. */
      tickDaily(now = Date.now()) {
        const cfg = mods.diary || {}
        if (cfg.auto === false) return { ok: false, skipped: 'disabled' }
        const gate = shouldWriteDaily(now, {
          writeAt: cfg.writeAt || '22:00',
          lastWrittenDay: diary.lastWrittenDay,
          timeZone: tz,
        })
        if (!gate.ok) return { ok: false, skipped: gate.reason, day: gate.day }
        // Replace same-day entry if any leftover from old schema
        diary.entries = diary.entries.filter((e) => e.day !== gate.day)
        const journal = loadStore(store, STORE.JOURNAL, { turns: [] }).data
        const turns = filterTurnsForDay(journal.turns || [], gate.day, tz)
        const snap = runtime.persona?.snapshot?.() || {}
        const text = craftDailyEntry({
          day: gate.day,
          turns,
          moodWord: moodWord(snap.mood),
          affinityWord: affinityWord(snap.affinity),
        })
        const entry = runtime.diary.add(text, ['daily'], gate.day)
        diary.lastWrittenDay = gate.day
        persistDiary()
        runtime.stats.diaryDaily = (runtime.stats.diaryDaily || 0) + 1
        runtime.log?.info?.(`[whale-companion] daily diary written for ${gate.day}`)
        return { ok: true, entry }
      },
    }
    disposers.push(
      registerTool(
        ctx,
        'wx_diary',
        {
          description:
            '小鲸鱼的日记本（系统每天定点自动写一篇当日总结）。主人要看时用 action=list；一般不要 add。',
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
          return { ok: true, entry: runtime.diary.add(args.text, ['manual']) }
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
    let promises = loadStore(store, STORE.PROMISES, { items: [] }).data
    if (!Array.isArray(promises.items)) promises.items = []
    const prunePromises = () => {
      const open = promises.items.filter((i) => !i.done)
      const done = promises.items.filter((i) => i.done).slice(-50)
      promises.items = [...open, ...done]
    }
    runtime.promise = {
      add(text, dueAt, extra = {}) {
        const body = String(text || '').trim().slice(0, 300)
        if (!body) return { error: 'text required' }
        let dueMs = Number(dueAt)
        if (!(Number.isFinite(dueMs) && dueMs > 0)) {
          const parsed = parseDueAt(body, {
            timeZone:
              runtime.config.modules.persona?.timeZone || DEFAULT_TIME_ZONE,
          })
          if (parsed?.dueAt) dueMs = parsed.dueAt
        }
        if (Number.isFinite(dueMs) && dueMs > 0 && dueMs < 1e12) dueMs *= 1000
        if (!(Number.isFinite(dueMs) && dueMs > Date.now() - 60_000)) {
          return { error: 'dueAt required or unparseable time in text' }
        }
        const item = {
          id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          text: body,
          dueAt: dueMs,
          done: false,
          ...extra,
        }
        promises.items.push(item)
        prunePromises()
        saveStore(store, STORE.PROMISES, promises)
        return item
      },
      /** Code fallback when owner asks for an alarm but model skipped the tool. */
      maybeAutoFromOwner(text) {
        const parsed = parseDueAt(text, {
          timeZone:
            runtime.config.modules.persona?.timeZone || DEFAULT_TIME_ZONE,
        })
        if (!parsed?.dueAt) return { ok: false, skipped: 'unparseable' }
        const item = runtime.promise.add(String(text).trim().slice(0, 300), parsed.dueAt, {
          auto: true,
        })
        if (item?.error) return { ok: false, error: item.error }
        runtime.stats.promiseAuto = (runtime.stats.promiseAuto || 0) + 1
        return { ok: true, item, label: parsed.label }
      },
      due(now = Date.now()) {
        return promises.items.filter((i) => !i.done && i.dueAt <= now)
      },
      complete(id) {
        const it = promises.items.find((i) => i.id === id)
        if (!it) return null
        it.done = true
        prunePromises()
        saveStore(store, STORE.PROMISES, promises)
        return it
      },
      clear() {
        promises = { items: [] }
        saveStore(store, STORE.PROMISES, promises)
        return { ok: true }
      },
    }
    disposers.push(
      registerTool(
        ctx,
        'wx_promise',
        {
          description:
            '记下对主人的约定/闹钟，到点主动微信提醒。action=add；优先 dueAt=Unix毫秒，' +
            '也可在 text 里写「明天8点喊我」由宿主解析。只口头说记下了不算数。',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['add', 'due', 'complete'] },
              text: { type: 'string' },
              dueAt: {
                type: 'number',
                description: '到期 Unix 毫秒；也可用 text 里的自然语言时间',
              },
              id: { type: 'string' },
            },
            required: ['action'],
          },
        },
        async (args) => {
          if (args.action === 'add') {
            const r = runtime.promise.add(args.text, args.dueAt)
            if (r?.error) return { ok: false, error: r.error }
            return { ok: true, item: r }
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
        // Don't echo the raw promise text — reads like a system ticket.
        // `||` = dual WeChat bubbles (same marker as persona STYLE).
        const line = /起床|叫醒|喊我|闹钟|醒/.test(String(item.text || ''))
          ? '喂，到点了||快起来。'
          : '对了，到点了哦'
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
        saveStore(store, STORE.PROMISES, promises)
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
    let circ = loadStore(store, STORE.CIRCADIAN, { buckets: Array(24).fill(0) }).data
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
        saveStore(store, STORE.CIRCADIAN, circ, { debounce: true })
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
      reset() {
        circ = { buckets: Array(24).fill(0) }
        saveStore(store, STORE.CIRCADIAN, circ)
        return { ok: true }
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
