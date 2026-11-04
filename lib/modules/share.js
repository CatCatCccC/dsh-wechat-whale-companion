/**
 * Share layer: learn_owner / memory_flip / calendar / weather / fun / external + notes.
 */
import path from 'node:path'
import { dayKey } from '../core/day-key.js'
import { exportAllNotes } from '../core/notes-export.js'
import {
  formatOwnerProfileBlock,
  normalizeOwnerProfile,
  upsertTrait,
} from '../core/owner-profile.js'
import {
  ensureShareLog,
  recordShareEntry,
  SHARE_MOTIVES,
} from '../core/share-log.js'
import { buildShareCandidates } from '../core/share-pool.js'
import { fetchHotCandidates, fetchMediaCandidates } from '../core/share-external.js'
import { fetchWeather, resolveCoords } from '../core/weather.js'
import { STORE, bootStore, loadStore, saveStore } from '../core/stores.js'
import { DEFAULT_TIME_ZONE } from './proactive.js'

/**
 * @param {any} _ctx
 * @param {object} runtime
 */
export function applyShare(_ctx, runtime) {
  const shareCfg = runtime.config.modules.share || {}
  const notesCfg = runtime.config.modules.notes || {}
  const weatherCfg = runtime.config.modules.weather || {}
  const externalCfg = runtime.config.modules.shareExternal || {}
  if (shareCfg.enabled === false) return () => {}

  const store = runtime.store
  const timeZone =
    runtime.config.modules.persona?.timeZone || DEFAULT_TIME_ZONE

  let profile = normalizeOwnerProfile(
    bootStore(store, STORE.OWNER_PROFILE, { traits: {}, summaryLines: [], updatedAt: 0 }).data,
  )
  let shareLog = ensureShareLog(
    bootStore(store, STORE.SHARE_LOG, null).data,
    { day: dayKey(Date.now(), timeZone) },
  )
  saveStore(store, STORE.SHARE_LOG, shareLog)

  /** @type {{ at: number, data: object|null }} */
  let weatherCache = { at: 0, data: null }
  /** @type {{ at: number, items: object[] }} */
  let hotCache = { at: 0, items: [] }
  /** @type {{ at: number, items: object[] }} */
  let mediaCache = { at: 0, items: [] }

  const notesDir = path.join(store.root, 'notes')
  let notesTimer = null

  const persistProfile = () => saveStore(store, STORE.OWNER_PROFILE, profile)
  const persistLog = () => saveStore(store, STORE.SHARE_LOG, shareLog)

  const flushNotes = () => {
    if (notesCfg.enabled === false) return
    try {
      const diary = loadStore(store, STORE.DIARY, { entries: [] }).data
      const memory = loadStore(store, STORE.FISH_MEMORY, { items: [] }).data
      exportAllNotes({
        notesDir,
        stateDir: store.root,
        profile,
        diary,
        memory,
        shareLog,
      })
      runtime.stats.notesDir = notesDir
    } catch (err) {
      runtime.log?.warn?.('[whale-companion] notes export', err?.message || err)
    }
  }

  const scheduleNotes = () => {
    if (notesCfg.enabled === false) return
    if (notesTimer) clearTimeout(notesTimer)
    notesTimer = setTimeout(() => {
      notesTimer = null
      flushNotes()
    }, 800)
    notesTimer.unref?.()
  }

  const rollDay = (now = Date.now()) => {
    shareLog = ensureShareLog(shareLog, { day: dayKey(now, timeZone) })
    persistLog()
  }

  const refreshWeather = async () => {
    if (weatherCfg.enabled === false) return null
    const now = Date.now()
    if (weatherCache.data && now - weatherCache.at < 90 * 60 * 1000) {
      return weatherCache.data
    }
    const coords = resolveCoords(weatherCfg.city || '武汉', {
      lat: weatherCfg.lat,
      lon: weatherCfg.lon,
    })
    const r = await fetchWeather(coords, {
      fetchImpl: runtime.fetchImpl,
      timeoutMs: Number(weatherCfg.timeoutMs) || 8000,
    })
    if (!r.ok || !r.signal) {
      weatherCache = { at: now, data: null }
      return null
    }
    const data = {
      id: `weather-${dayKey(now, timeZone)}-${r.hook}`,
      hook: `${coords.city}${r.hook}`,
      summary: r.summary,
      city: coords.city,
      temp: r.temp,
    }
    weatherCache = { at: now, data }
    return data
  }

  const refreshExternal = async () => {
    const now = Date.now()
    if (externalCfg.hot === true) {
      if (now - hotCache.at > 3 * 3600 * 1000) {
        const r = await fetchHotCandidates({ fetchImpl: runtime.fetchImpl })
        hotCache = { at: now, items: r.items || [] }
      }
    }
    if (externalCfg.media === true) {
      if (now - mediaCache.at > 6 * 3600 * 1000) {
        const r = await fetchMediaCandidates({ fetchImpl: runtime.fetchImpl })
        mediaCache = { at: now, items: r.items || [] }
      }
    }
  }

  runtime.share = {
    notesDir,
    getProfile: () => profile,
    getShareLog: () => shareLog,
    profileBlock: () => formatOwnerProfileBlock(profile),
    flushNotes,
    /**
     * Enrich world with share candidates (async weather/external).
     * @param {object} world
     * @param {object} snap
     */
    async enrichWorld(world, snap) {
      rollDay(world.now || Date.now())
      try {
        await refreshWeather()
      } catch {
        /* ignore */
      }
      try {
        await refreshExternal()
      } catch {
        /* ignore */
      }

      let memories = []
      let diary = { entries: [] }
      let journalTurns = []
      try {
        memories = runtime.memory?.list?.(12) || []
      } catch {
        /* ignore */
      }
      try {
        diary = loadStore(store, STORE.DIARY, { entries: [] }).data
      } catch {
        /* ignore */
      }
      try {
        journalTurns = loadStore(store, STORE.JOURNAL, { turns: [] }).data?.turns || []
      } catch {
        /* ignore */
      }

      const shareMax = Number(shareCfg.shareDailyMax) || 2
      const canShare = (shareLog.shareCount || 0) < shareMax

      let hot = null
      let media = null
      if (canShare && externalCfg.hot === true && hotCache.items.length) {
        const pick = hotCache.items[Math.floor(Math.random() * hotCache.items.length)]
        const id = `hot-${pick.title}`
        if (!shareLog.usedIds?.includes(id)) {
          hot = { id, hook: pick.hook || pick.title, title: pick.title }
        }
      }
      if (canShare && externalCfg.media === true && mediaCache.items.length) {
        const pick = mediaCache.items[Math.floor(Math.random() * mediaCache.items.length)]
        const id = `media-${pick.title}`
        if (!shareLog.usedIds?.includes(id)) {
          media = { id, hook: pick.hook || pick.title, title: pick.title }
        }
      }

      const c = buildShareCandidates({
        now: world.now,
        silentH: world.silentH,
        timeZone,
        shareLog,
        shareCfg: { ...shareCfg, anniversaries: shareCfg.anniversaries },
        profile,
        memories,
        diary,
        journalTurns,
        weatherCache: canShare ? weatherCache.data : null,
      })

      world.shareLearn = c.learn
      world.shareMemoryFlip = c.memoryFlip
      world.shareCalendar = c.calendar
      world.shareFun = c.fun
      world.shareWeather = c.weather
      world.shareHot = hot
      world.shareMedia = media
      world.shareLearnCount = c.learnCount
      world.shareShareCount = c.shareCount
      world.shareLearnMax = c.learnMax
      world.shareShareMax = c.shareMax
      return world
    },

    /**
     * After a successful proactive send.
     * @param {{ motive: string, hook?: string, line?: string }} info
     * @param {object} world
     */
    onProactiveSent(info, world) {
      rollDay()
      const motive = info.motive || ''
      if (!SHARE_MOTIVES.has(motive) && motive !== 'learn_owner') return

      let id = ''
      let isLearn = false
      if (motive === 'learn_owner' && world.shareLearn) {
        id = world.shareLearn.id
        isLearn = true
        shareLog.pending = {
          factKey: world.shareLearn.factKey,
          questionId: world.shareLearn.id,
          ask: world.shareLearn.ask,
          at: Date.now(),
        }
      } else if (motive === 'memory_flip' && world.shareMemoryFlip) {
        id = world.shareMemoryFlip.id
      } else if (motive === 'calendar' && world.shareCalendar) {
        id = world.shareCalendar.id
      } else if (motive === 'fun_bit' && world.shareFun) {
        id = world.shareFun.id
      } else if (motive === 'weather' && world.shareWeather) {
        id = world.shareWeather.id
      } else if (motive === 'share_hot' && world.shareHot) {
        id = world.shareHot.id
      } else if (motive === 'share_media' && world.shareMedia) {
        id = world.shareMedia.id
      }

      shareLog = recordShareEntry(shareLog, {
        motive,
        hook: info.hook || '',
        line: info.line || '',
        id,
        isLearn,
      })
      persistLog()
      scheduleNotes()
    },

    /**
     * Capture owner reply to pending learn question.
     * @param {string} text
     */
    captureOwnerReply(text) {
      rollDay()
      const pending = shareLog.pending
      if (!pending?.factKey) return { ok: false, skipped: 'no-pending' }
      const body = String(text || '').trim()
      if (body.length < 1) return { ok: false, skipped: 'empty' }
      // Ignore ultra-short brush-offs without content
      if (/^(嗯+|哦+|哈+|哈哈+|在$|忙$)$/.test(body) && body.length <= 4) {
        return { ok: false, skipped: 'trivial' }
      }

      const factText = body.slice(0, 120)
      try {
        runtime.memory?.remember?.(factText, {
          kind: 'fact',
          factKey: pending.factKey,
          importance: 0.9,
        })
      } catch {
        /* ignore */
      }
      profile = upsertTrait(profile, pending.factKey, factText)
      persistProfile()
      shareLog.pending = null
      persistLog()
      scheduleNotes()
      runtime.stats.learnCaptured = (runtime.stats.learnCaptured || 0) + 1
      return { ok: true, factKey: pending.factKey, text: factText }
    },

    notifyDataChanged() {
      scheduleNotes()
    },
  }

  flushNotes()

  return () => {
    if (notesTimer) clearTimeout(notesTimer)
  }
}
