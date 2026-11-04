/**
 * Build share candidates for proactive world enrichment.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { filledFactKeys } from './owner-profile.js'
import { pickMilestoneHook } from './milestones.js'
import { pickCalendarHook } from './share-calendar.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const SHARE_ASSETS_DIR = path.resolve(__dirname, '../../assets/share')

/**
 * @param {string} file
 */
export function loadShareJson(file) {
  const p = path.join(SHARE_ASSETS_DIR, file)
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

/**
 * @param {object} opts
 * @param {object} opts.profile
 * @param {object[]} [opts.memories]
 * @param {string[]} [opts.usedIds]
 * @param {() => number} [opts.random]
 */
export function pickLearnQuestion(opts) {
  const bag = loadShareJson('learn-questions.json')
  const list = Array.isArray(bag?.questions) ? bag.questions : []
  const filled = filledFactKeys(opts.profile, opts.memories || [])
  const used = new Set(opts.usedIds || [])
  const open = list.filter((q) => q?.factKey && !filled.has(q.factKey) && !used.has(q.id))
  if (!open.length) return null
  const random = typeof opts.random === 'function' ? opts.random : Math.random
  return open[Math.floor(random() * open.length)]
}

/**
 * @param {object} opts
 * @param {object[]} [opts.memories]
 * @param {object} [opts.diary]
 * @param {object[]} [opts.journalTurns]
 * @param {string[]} [opts.usedIds]
 * @param {() => number} [opts.random]
 */
export function pickMemoryFlip(opts) {
  const used = new Set(opts.usedIds || [])
  const random = typeof opts.random === 'function' ? opts.random : Math.random
  /** @type {Array<{ id: string, hook: string, source: string }>} */
  const pool = []

  for (const m of opts.memories || []) {
    if (m?.superseded) continue
    const text = String(m.text || '').trim()
    if (text.length < 4) continue
    const id = `mem-${m.id || m.factKey || text.slice(0, 12)}`
    if (used.has(id)) continue
    pool.push({ id, hook: text.slice(0, 28), source: m.kind === 'fact' ? 'fact' : 'event' })
  }

  for (const e of opts.diary?.entries || []) {
    const text = String(e.text || '').trim()
    if (text.length < 8) continue
    const id = `diary-${e.day || e.at || text.slice(0, 8)}`
    if (used.has(id)) continue
    pool.push({ id, hook: text.slice(0, 28), source: 'diary' })
  }

  for (const t of (opts.journalTurns || []).slice(0, 12)) {
    const o = String(t.owner || '').trim()
    if (o.length < 4) continue
    const id = `j-${o.slice(0, 16)}`
    if (used.has(id)) continue
    pool.push({ id, hook: o.slice(0, 28), source: 'journal' })
  }

  if (!pool.length) return null
  return pool[Math.floor(random() * pool.length)]
}

/**
 * @param {object} opts
 * @param {string[]} [opts.usedIds]
 * @param {() => number} [opts.random]
 */
export function pickFunBit(opts) {
  const bag = loadShareJson('fun-bits.json')
  const list = Array.isArray(bag?.bits) ? bag.bits : []
  const used = new Set(opts.usedIds || [])
  const open = list.filter((b) => b?.id && b?.text && !used.has(b.id))
  if (!open.length) return null
  const random = typeof opts.random === 'function' ? opts.random : Math.random
  const bit = open[Math.floor(random() * open.length)]
  return { id: bit.id, hook: String(bit.text).slice(0, 36), text: String(bit.text), kind: bit.kind }
}

const JOKE_BAN =
  /记得喝水|记得吃饭|别熬|工具|系统|prompt|token余额|作为AI|wx_|代码|报错|部署|开会|ddl/i

/**
 * Pull short private-ish lines from journal/memory into joke candidates.
 * @param {object} opts
 * @param {object[]} [opts.memories]
 * @param {object[]} [opts.journalTurns]
 * @param {object[]} [opts.ledger] existing stored jokes
 */
export function harvestInsideJokes(opts = {}) {
  /** @type {Array<{ id: string, hook: string, text: string, from: string }>} */
  const out = []
  const seen = new Set()

  const push = (text, from, idBase) => {
    const raw = String(text || '').replace(/\s+/g, ' ').trim()
    if ([...raw].length < 4 || [...raw].length > 16) return
    if (JOKE_BAN.test(raw)) return
    const id = `ij-${idBase || raw.slice(0, 12)}`
    if (seen.has(id)) return
    seen.add(id)
    out.push({ id, hook: raw.slice(0, 12), text: raw, from })
  }

  for (const m of opts.memories || []) {
    if (m?.superseded) continue
    push(m.text, 'memory', m.factKey || m.id)
  }
  for (const t of (opts.journalTurns || []).slice(0, 20)) {
    push(t.owner, 'journal', String(t.owner || '').slice(0, 12))
  }
  for (const j of opts.ledger || []) {
    if (j?.id && j?.text) {
      seen.add(j.id)
      out.push({
        id: String(j.id),
        hook: String(j.hook || j.text).slice(0, 12),
        text: String(j.text).slice(0, 40),
        from: String(j.from || 'ledger'),
      })
    }
  }
  return out.slice(0, 40)
}

/**
 * @param {object} opts
 * @param {object[]} [opts.pool]
 * @param {string[]} [opts.usedIds]
 * @param {() => number} [opts.random]
 */
export function pickInsideJoke(opts = {}) {
  const seed = loadShareJson('inside-jokes.json')
  const seeds = Array.isArray(seed?.jokes) ? seed.jokes : []
  const pool = [...(opts.pool || []), ...seeds]
  const used = new Set(opts.usedIds || [])
  const open = pool.filter((j) => j?.id && j?.text && !used.has(j.id))
  if (!open.length) return null
  const random = typeof opts.random === 'function' ? opts.random : Math.random
  const bit = open[Math.floor(random() * open.length)]
  return {
    id: bit.id,
    hook: String(bit.hook || bit.text).slice(0, 16),
    text: String(bit.text).slice(0, 40),
    from: bit.from || 'seed',
  }
}

/**
 * @param {object} opts
 * @param {{ chapterId?: string, beatIndex?: number }} [opts.progress]
 * @param {string[]} [opts.usedIds]
 */
export function pickFishLife(opts = {}) {
  const bag = loadShareJson('fish-life.json')
  const chapters = Array.isArray(bag?.chapters) ? bag.chapters : []
  if (!chapters.length) return null
  const used = new Set(opts.usedIds || [])
  let chapterId = String(opts.progress?.chapterId || chapters[0].id)
  let beatIndex = Math.max(0, Math.round(Number(opts.progress?.beatIndex) || 0))
  let chap = chapters.find((c) => c.id === chapterId) || chapters[0]
  let beats = Array.isArray(chap.beats) ? chap.beats : []

  // Advance past used beats; wrap to next chapter
  for (let guard = 0; guard < 64; guard++) {
    if (beatIndex >= beats.length) {
      const idx = chapters.findIndex((c) => c.id === chap.id)
      chap = chapters[(idx + 1) % chapters.length]
      chapterId = chap.id
      beatIndex = 0
      beats = Array.isArray(chap.beats) ? chap.beats : []
    }
    const beat = beats[beatIndex]
    if (!beat) return null
    const id = `fish-${chap.id}-${beat.id || beatIndex}`
    if (!used.has(id)) {
      return {
        id,
        hook: String(beat.text).slice(0, 20),
        text: String(beat.text).slice(0, 48),
        chapterId: chap.id,
        beatIndex,
        nextBeatIndex: beatIndex + 1,
      }
    }
    beatIndex += 1
  }
  return null
}

/**
 * Assemble world.share* fields (sync parts). Weather/external filled by applyShare cache.
 * @param {object} input
 */
export function buildShareCandidates(input = {}) {
  const shareLog = input.shareLog || {}
  const shareCfg = input.shareCfg || {}
  const learnMax = Number(shareCfg.learnOwnerDailyMax) || 1
  const shareMax = Number(shareCfg.shareDailyMax) || 2
  const silentH = Number(input.silentH) || 0
  const usedIds = shareLog.usedIds || []

  const learn =
    (shareLog.learnCount || 0) < learnMax && silentH >= 0.75
      ? pickLearnQuestion({
          profile: input.profile,
          memories: input.memories,
          usedIds,
          random: input.random,
        })
      : null

  const memoryFlip =
    (shareLog.shareCount || 0) < shareMax && silentH >= 1
      ? pickMemoryFlip({
          memories: input.memories,
          diary: input.diary,
          journalTurns: input.journalTurns,
          usedIds,
          random: input.random,
        })
      : null

  const canShare = (shareLog.shareCount || 0) < shareMax
  const random = typeof input.random === 'function' ? input.random : Math.random

  const milestoneHook =
    canShare && input.relation?.milestones !== false
      ? pickMilestoneHook(input.milestones, input.now, {
          timeZone: input.timeZone,
          usedIds,
        })
      : null

  const calRaw = canShare
    ? pickCalendarHook(input.now, {
        timeZone: input.timeZone,
        anniversaries: shareCfg.anniversaries,
        milestoneHook,
      })
    : null
  const calendar =
    calRaw &&
    !usedIds.includes(calRaw.id) &&
    (calRaw.kind !== 'weekend' || silentH >= 1)
      ? calRaw
      : null

  const insideJoke =
    canShare && silentH >= 0.5 && input.relation?.insideJoke !== false
      ? pickInsideJoke({
          pool: harvestInsideJokes({
            memories: input.memories,
            journalTurns: input.journalTurns,
            ledger: input.insideJokeLedger,
          }),
          usedIds,
          random,
        })
      : null

  const fun =
    canShare && silentH >= 0.5 ? pickFunBit({ usedIds, random }) : null

  const fishLife =
    canShare && silentH >= 0.5 && input.relation?.fishLife !== false
      ? pickFishLife({
          progress: input.fishLifeProgress,
          usedIds,
        })
      : null

  const dailyP = Number(input.relation?.miniTheaterDailyP)
  const theaterP = Number.isFinite(dailyP) ? dailyP : 0.08
  const blockTheater = Boolean(input.blockMiniTheater || learn || input.upcomingPromise)
  const miniTheater =
    canShare &&
    !blockTheater &&
    silentH >= 1 &&
    input.relation?.miniTheater !== false &&
    random() < theaterP
      ? pickMiniTheater({
          progress: input.miniTheaterProgress,
          usedIds,
          firedDay: input.miniTheaterProgress?.firedDay,
          day: input.dayKey,
        })
      : null

  return {
    learn,
    memoryFlip,
    calendar,
    insideJoke,
    fun,
    fishLife,
    miniTheater,
    weather: input.weatherCache || null,
    hot: input.hotCache || null,
    media: input.mediaCache || null,
    learnCount: shareLog.learnCount || 0,
    shareCount: shareLog.shareCount || 0,
    learnMax,
    shareMax,
  }
}

/**
 * @param {object} opts
 * @param {{ chapterId?: string, beatIndex?: number, firedDay?: string }} [opts.progress]
 * @param {string[]} [opts.usedIds]
 * @param {string} [opts.day]
 * @param {string} [opts.firedDay]
 */
export function pickMiniTheater(opts = {}) {
  const bag = loadShareJson('mini-theater.json')
  const arcs = Array.isArray(bag?.arcs) ? bag.arcs : []
  if (!arcs.length) return null
  const used = new Set(opts.usedIds || [])
  const day = String(opts.day || '')
  if (day && opts.progress?.firedDay === day) return null

  let chapterId = String(opts.progress?.chapterId || arcs[0].id)
  let beatIndex = Math.max(0, Math.round(Number(opts.progress?.beatIndex) || 0))
  let chap = arcs.find((c) => c.id === chapterId) || arcs[0]
  let beats = Array.isArray(chap.beats) ? chap.beats : []

  for (let guard = 0; guard < 64; guard++) {
    if (beatIndex >= beats.length) {
      const idx = arcs.findIndex((c) => c.id === chap.id)
      chap = arcs[(idx + 1) % arcs.length]
      chapterId = chap.id
      beatIndex = 0
      beats = Array.isArray(chap.beats) ? chap.beats : []
    }
    const beat = beats[beatIndex]
    if (!beat) return null
    const id = `mt-${chap.id}-${beat.id || beatIndex}`
    if (!used.has(id)) {
      return {
        id,
        hook: String(beat.text).slice(0, 20),
        text: String(beat.text).slice(0, 48),
        chapterId: chap.id,
        beatIndex,
        nextBeatIndex: beatIndex + 1,
      }
    }
    beatIndex += 1
  }
  return null
}
