/**
 * diary / promise / tier / circadian + wx_* tools
 */
import {
  detectOwnerSleepAt,
  draftDiaryWithLlm,
  filterTurnsForDay,
  formatClock,
  isOwnerSleepText,
  shanghaiDay,
  shouldWriteDaily,
} from '../core/auto-diary.js'
import { alarmFallbackLine, draftProactiveLine } from '../core/proactive-draft.js'
import { parseDueAt } from '../core/parse-due.js'
import { STORE, bootStore, loadStore, saveStore } from '../core/stores.js'
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

  // --- diary (default: after owner 晚安; optional late clock fallback) ---
  if (mods.diary?.enabled) {
    let diary = bootStore(store, STORE.DIARY, {
      entries: [],
      lastWrittenDay: '',
    }).data
    if (!Array.isArray(diary.entries)) diary.entries = []
    const persistDiary = () => saveStore(store, STORE.DIARY, diary, { debounce: true })
    const tz =
      runtime.config.modules.persona?.timeZone ||
      mods.diary?.timeZone ||
      DEFAULT_TIME_ZONE
    /** @type {Promise<any>|null} */
    let writing = null

    runtime.diary = {
      add(text, tags = [], day = '') {
        const entry = {
          at: Date.now(),
          day: day || undefined,
          text: String(text).slice(0, 900),
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
      /**
       * Write today's diary once (LLM summarize).
       * @param {number} [now]
       * @param {{
       *   reason?: 'goodnight'|'fallback'|'clock'|'retry',
       *   ownerText?: string,
       *   sleepAtMs?: number,
       * }} [opts]
       */
      async writeNow(now = Date.now(), opts = {}) {
        const cfg = mods.diary || {}
        if (cfg.auto === false) return { ok: false, skipped: 'disabled' }
        const reason = opts.reason || 'clock'
        const ignoreClock = reason === 'goodnight' || reason === 'retry'
        const writeAt =
          reason === 'fallback' || reason === 'clock'
            ? String(cfg.writeAtFallback || cfg.writeAt || '').trim()
            : ''
        const gate = shouldWriteDaily(now, {
          writeAt,
          lastWrittenDay: diary.lastWrittenDay,
          timeZone: tz,
          ignoreClock,
        })
        if (!gate.ok) return { ok: false, skipped: gate.reason, day: gate.day }

        const journal = loadStore(store, STORE.JOURNAL, { turns: [] }).data
        let turns = filterTurnsForDay(journal.turns || [], gate.day, tz)
        const ownerText = String(opts.ownerText || '').trim()
        const sleepAtMs = Number(opts.sleepAtMs) || 0
        if (
          ownerText &&
          !turns.some((t) => String(t.owner || '').trim() === ownerText)
        ) {
          turns = [
            ...turns,
            {
              at: sleepAtMs || now,
              owner: ownerText.slice(0, 120),
              assistant: '',
            },
          ]
        }
        const snap = runtime.persona?.snapshot?.() || {}
        const shareLog = (() => {
          try {
            return runtime.share?.getShareLog?.() || null
          } catch {
            return null
          }
        })()
        const shareHooks =
          shareLog && shareLog.day === gate.day
            ? (shareLog.entries || [])
                .map((e) => e.hook || e.line || '')
                .filter(Boolean)
                .slice(0, 6)
            : []
        const sleepAt =
          (sleepAtMs ? formatClock(sleepAtMs, tz) : '') ||
          detectOwnerSleepAt(turns, tz)
        const moodW = moodWord(snap.mood)
        const affW = affinityWord(snap.affinity)

        let text = ''
        let source = 'none'
        if (cfg.llm === false) {
          // Do not burn lastWrittenDay — allow later retry.
          return { ok: false, skipped: 'llm_off', day: gate.day, sleepAt }
        }
        const draftOnce = async () =>
          draftDiaryWithLlm({
            ctx: runtime.ctx,
            day: gate.day,
            turns,
            timeZone: tz,
            moodWord: moodW,
            affinityWord: affW,
            shareHooks,
            sleepAt,
            timeoutMs: Number(cfg.llmTimeoutMs) || 20000,
            provider: cfg.llmProvider || undefined,
            model: cfg.llmModel || undefined,
          })
        for (let attempt = 0; attempt < 2 && !text; attempt++) {
          try {
            const drafted = await draftOnce()
            if (drafted?.text) {
              text = drafted.text
              source = drafted.source || 'dsh-llm'
              runtime.stats.diaryDraftRoute = drafted.route || ''
              if (attempt > 0) runtime.stats.diaryDraftRetry = true
            }
          } catch (err) {
            runtime.stats.diaryDraftError = String(err?.message || err).slice(0, 80)
            runtime.log?.warn?.(
              '[whale-companion] diary llm failed',
              runtime.stats.diaryDraftError,
            )
          }
        }
        if (!text) {
          // Keep lastWrittenDay untouched; mark pending for tick retry.
          diary.pendingDay = gate.day
          persistDiary()
          runtime.stats.diaryPendingDay = gate.day
          return { ok: false, skipped: 'diary_llm_empty', day: gate.day, sleepAt }
        }

        diary.entries = diary.entries.filter((e) => e.day !== gate.day)
        const entry = runtime.diary.add(text, ['daily'], gate.day)
        diary.lastWrittenDay = gate.day
        diary.pendingDay = ''
        persistDiary()
        runtime.stats.diaryDaily = (runtime.stats.diaryDaily || 0) + 1
        runtime.stats.diarySource = source
        runtime.stats.diarySleepAt = sleepAt || ''
        runtime.stats.diaryTrigger = reason
        runtime.stats.diaryPendingDay = ''
        runtime.share?.notifyDataChanged?.()
        runtime.log?.info?.(
          `[whale-companion] daily diary written for ${gate.day} source=${source} trigger=${reason}` +
            (sleepAt ? ` sleep=${sleepAt}` : ''),
        )
        return { ok: true, entry, source, sleepAt, reason }
      },
      /** Owner 晚安 → write today's diary (once). */
      maybeWriteOnGoodnight(text, opts = {}) {
        const cfg = mods.diary || {}
        const trigger = String(cfg.trigger || 'goodnight')
        if (trigger !== 'goodnight' && trigger !== 'both') {
          return Promise.resolve({ ok: false, skipped: 'trigger_off' })
        }
        if (!isOwnerSleepText(text)) {
          return Promise.resolve({ ok: false, skipped: 'not_goodnight' })
        }
        const now = Number(opts.now) || Date.now()
        if (writing) return writing
        writing = runtime.diary
          .writeNow(now, {
            reason: 'goodnight',
            ownerText: String(text || '').trim(),
            sleepAtMs: now,
          })
          .finally(() => {
            writing = null
          })
        return writing
      },
      /** Timer tick: retry pending LLM diary; optional late clock fallback. */
      async tickDaily(now = Date.now()) {
        const cfg = mods.diary || {}
        if (cfg.auto === false) return { ok: false, skipped: 'disabled' }
        const pending = String(diary.pendingDay || '').trim()
        if (pending && diary.lastWrittenDay !== pending) {
          const today = shanghaiDay(now, tz)
          if (pending === today) {
            return runtime.diary.writeNow(now, { reason: 'retry' })
          }
          diary.pendingDay = ''
          persistDiary()
          runtime.stats.diaryPendingDay = ''
        }
        const trigger = String(cfg.trigger || 'goodnight')
        const fallbackAt = String(cfg.writeAtFallback || cfg.writeAt || '').trim()
        if (trigger === 'goodnight') {
          if (!fallbackAt) return { ok: false, skipped: 'await_goodnight' }
          return runtime.diary.writeNow(now, { reason: 'fallback' })
        }
        if (trigger === 'clock' || trigger === 'both') {
          return runtime.diary.writeNow(now, { reason: 'clock' })
        }
        return { ok: false, skipped: 'unknown_trigger' }
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
    let promises = bootStore(store, STORE.PROMISES, { items: [] }).data
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
      if (!due.length || typeof runtime.speak !== 'function') return
      const item = due[0]
      const to = runtime.owner?.id || ''
      // Don't push a reminder before a WeChat peer is bound: the tool falls
      // back to the first known user and could message a stranger.
      if (!to) return
      try {
        runtime.wechatSessions?.refresh?.()
        const bound = runtime.wechatSessions?.list?.()?.[0]
        const snap = runtime.persona?.snapshot?.() || {}
        const wake = /起床|叫醒|喊我|闹钟|醒/.test(String(item.text || ''))
        const drafted = await draftProactiveLine({
          motiveId: 'promise_soft',
          world: {
            upcomingPromise: item,
            mood: snap.mood,
            affinity: snap.affinity,
            silentH: 0,
            journalHint: wake ? '这是叫醒/闹钟，到点了要喊醒主人' : '约定到点了，提醒一句',
          },
          ctx: runtime.ctx,
          enabledLlm: true,
          agentId: bound?.sessionId,
          timeoutMs: 12000,
          form: 'text',
          hardFallback: true,
        })
        // Alarm must fire: LLM preferred, then hardFallback inside draft, then local net.
        const line = drafted.line || alarmFallbackLine(item)
        const sendOpts = { to, agentId: bound?.sessionId || undefined }
        const sent = await runtime.speak(line, sendOpts)
        if (!(sent?.sent > 0)) {
          throw new Error(sent?.reason || sent?.skipped || 'speak sent 0')
        }
        // Wake herself too so later proactive isn't stuck asleep after a 晚安 night
        runtime.persona?.setAsleep?.(false)
        runtime.promise.complete(item.id)
        runtime.stats.promiseSent = (runtime.stats.promiseSent || 0) + 1
        runtime.stats.promiseLineSource = drafted.source || 'alarm_fallback'
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
    let circ = bootStore(store, STORE.CIRCADIAN, { buckets: Array(24).fill(0) }).data
    if (!Array.isArray(circ.buckets) || circ.buckets.length !== 24) {
      circ.buckets = Array(24).fill(0)
      saveStore(store, STORE.CIRCADIAN, circ)
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
