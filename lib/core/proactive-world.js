/**
 * Build a compact WorldState for proactive motive / draft.
 */
import { STORE } from './stores.js'

const OPEN_THREAD_RE =
  /晚点|待会|回头|等下|下班再说|周末|回头聊|回头说|先忙|忙完|再说吧|改天|明天聊|晚上说/

const PREACHY_HOOK_RE = /记得喝水|记得吃饭|别熬|坐太久|伸个懒腰/

/**
 * @param {object} input
 */
export function buildWorldState(input = {}) {
  const now = Number(input.now) || Date.now()
  const lastOwnerAt = Number(input.lastOwnerAt) || 0
  const silentMs = lastOwnerAt ? Math.max(0, now - lastOwnerAt) : 0
  const hour = Number.isFinite(input.hour) ? Number(input.hour) : 12
  const mood = Number(input.mood)
  const energy = Number(input.energy)
  const affinity = Number(input.affinity)
  const tier = String(input.tier || '')
  const lastword = String(input.lastword || '').trim().slice(0, 80)
  const recent = Array.isArray(input.recent) ? input.recent.map(String) : []
  const lastOwnerText = String(input.lastOwnerText || '').trim().slice(0, 120)
  const journal = Array.isArray(input.journalTurns) ? input.journalTurns : []
  const memories = Array.isArray(input.memories) ? input.memories : []
  const promises = Array.isArray(input.upcomingPromises) ? input.upcomingPromises : []

  const openThread = detectOpenThread(journal, lastOwnerText)
  const memoryHook = pickMemoryHook(memories)
  const upcomingPromise = pickUpcomingPromise(promises, now)

  const busyUntil = Number(input.busyUntil) || 0
  const busyNow = busyUntil > 0 && now < busyUntil

  return {
    now,
    hour,
    silentMs,
    silentH: silentMs / 3600000,
    mood: Number.isFinite(mood) ? mood : 55,
    energy: Number.isFinite(energy) ? energy : 70,
    affinity: Number.isFinite(affinity) ? affinity : 15,
    tier,
    lastword,
    recent,
    lastOwnerText,
    openThread,
    memoryHook,
    upcomingPromise,
    journalHint: formatJournalHint(journal),
    personaMode: input.personaMode || 'live',
    busyUntil,
    busyNow,
    dayPart: input.dayPart || '',
    weekday: input.weekday || '',
    echoMoodReady: Boolean(input.echoMoodReady),
    echoMoodTag: input.echoMoodTag || '',
  }
}

/**
 * @param {any[]} journal
 * @param {string} lastOwnerText
 */
export function detectOpenThread(journal, lastOwnerText = '') {
  const fromLast = String(lastOwnerText || '').trim()
  if (fromLast && OPEN_THREAD_RE.test(fromLast) && !PREACHY_HOOK_RE.test(fromLast)) {
    return clipHook(fromLast)
  }
  for (const turn of journal || []) {
    const o = String(turn?.owner || '').trim()
    if (!o) continue
    if (OPEN_THREAD_RE.test(o) && !PREACHY_HOOK_RE.test(o)) return clipHook(o)
  }
  // Unfinished short owner line that expects a beat later
  if (fromLast.length >= 6 && /[？?吗呢]$/.test(fromLast) && fromLast.length <= 40) {
    return clipHook(fromLast)
  }
  return ''
}

/**
 * @param {any[]} memories
 */
export function pickMemoryHook(memories) {
  for (const m of memories || []) {
    const text = String(m?.text || m || '').trim()
    if (text.length < 4) continue
    if (PREACHY_HOOK_RE.test(text)) continue
    return clipHook(text)
  }
  return ''
}

/**
 * @param {any[]} promises
 * @param {number} now
 */
export function pickUpcomingPromise(promises, now = Date.now()) {
  const windowMs = 2.5 * 3600 * 1000
  let best = null
  for (const p of promises || []) {
    if (p?.done) continue
    const due = Number(p.dueAt)
    if (!Number.isFinite(due)) continue
    const delta = due - now
    if (delta < -5 * 60 * 1000 || delta > windowMs) continue
    if (!best || Math.abs(delta) < Math.abs(Number(best.dueAt) - now)) best = p
  }
  if (!best) return null
  return {
    id: best.id || '',
    text: clipHook(String(best.text || '')),
    dueAt: Number(best.dueAt),
  }
}

function formatJournalHint(journal) {
  const slice = (journal || []).slice(0, 4)
  if (!slice.length) return ''
  return slice
    .map((t) => {
      const o = String(t.owner || '').slice(0, 40)
      const a = String(t.assistant || '').slice(0, 40)
      return `主人:${o} / 你:${a}`
    })
    .join('；')
    .slice(0, 220)
}

function clipHook(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 36)
}

/**
 * Collect hooks from a live runtime (best-effort).
 * @param {object} runtime
 * @param {object} snap persona snapshot
 * @param {{ now?: number, hour?: number, lastword?: string, recent?: string[] }} extra
 */
export function worldFromRuntime(runtime, snap, extra = {}) {
  let journalTurns = []
  let memories = []
  let upcomingPromises = []
  try {
    const bag = runtime.store?.get?.(STORE.JOURNAL, { turns: [] })
    journalTurns = Array.isArray(bag?.turns) ? bag.turns : []
  } catch {
    /* ignore */
  }
  try {
    memories = runtime.memory?.list?.(5) || []
  } catch {
    /* ignore */
  }
  try {
    const all = runtime.store?.get?.(STORE.PROMISES, { items: [] })
    upcomingPromises = (all?.items || []).filter((i) => !i.done)
  } catch {
    /* ignore */
  }

  return buildWorldState({
    now: extra.now,
    hour: extra.hour,
    lastOwnerAt: snap?.lastOwnerAt,
    mood: snap?.mood,
    energy: snap?.energy,
    affinity: snap?.affinity,
    tier: runtime.tier?.stage?.()?.id || '',
    lastword: extra.lastword || '',
    recent: extra.recent || snap?.recentProactive || [],
    lastOwnerText: snap?.lastOwnerText || '',
    journalTurns,
    memories,
    upcomingPromises,
    personaMode: Number(snap?.mood) >= 55 ? 'sweet' : 'live',
    busyUntil: snap?.busyUntil || 0,
    dayPart: extra.dayPart || '',
    weekday: extra.weekday || '',
    echoMoodReady: Boolean(snap?.echoMoodReady),
    echoMoodTag: snap?.echoMoodTag || '',
  })
}
