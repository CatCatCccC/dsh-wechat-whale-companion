/**
 * Build share candidates for proactive world enrichment.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { filledFactKeys } from './owner-profile.js'
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

  const calRaw =
    (shareLog.shareCount || 0) < shareMax
      ? pickCalendarHook(input.now, {
          timeZone: input.timeZone,
          anniversaries: shareCfg.anniversaries,
        })
      : null
  const calendar =
    calRaw && !usedIds.includes(calRaw.id)
      ? calRaw
      : null

  const fun =
    (shareLog.shareCount || 0) < shareMax && silentH >= 0.5
      ? pickFunBit({ usedIds, random: input.random })
      : null

  return {
    learn,
    memoryFlip,
    calendar,
    fun,
    weather: input.weatherCache || null,
    hot: input.hotCache || null,
    media: input.mediaCache || null,
    learnCount: shareLog.learnCount || 0,
    shareCount: shareLog.shareCount || 0,
    learnMax,
    shareMax,
  }
}
