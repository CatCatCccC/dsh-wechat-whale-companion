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
  PENDING_CAPTURE_WINDOW_MS,
  prunePending,
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

  const relationCfg = runtime.config.modules.relation || {}

  let profile = normalizeOwnerProfile(
    bootStore(store, STORE.OWNER_PROFILE, { traits: {}, summaryLines: [], updatedAt: 0 }).data,
  )
  let shareLog = ensureShareLog(
    bootStore(store, STORE.SHARE_LOG, null).data,
    { day: dayKey(Date.now(), timeZone) },
  )
  saveStore(store, STORE.SHARE_LOG, shareLog)

  let insideJokeLedger = bootStore(store, STORE.INSIDE_JOKES, { jokes: [] }).data
  let fishLifeProgress = bootStore(store, STORE.FISH_LIFE, {
    chapterId: '',
    beatIndex: 0,
  }).data
  let milestones = bootStore(store, STORE.MILESTONES, {
    unlocked: {},
    usedShareIds: [],
  }).data
  let miniTheaterProgress = bootStore(store, STORE.MINI_THEATER, {
    chapterId: '',
    beatIndex: 0,
    firedDay: '',
  }).data

  /** @type {{ at: number, data: object|null, ok?: boolean }} */
  let weatherCache = { at: 0, data: null, ok: true }
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
    shareLog = ensureShareLog(shareLog, { day: dayKey(now, timeZone), now })
    shareLog = prunePending(shareLog, now)
    persistLog()
  }

  const refreshWeather = async () => {
    if (weatherCfg.enabled === false) return null
    const now = Date.now()
    const age = now - (weatherCache.at || 0)
    if (weatherCache.ok !== false && weatherCache.data && age < 90 * 60 * 1000) {
      return weatherCache.data
    }
    // Negative cache: don't hammer Open-Meteo after failures / no-signal
    if (weatherCache.ok === false && age < 20 * 60 * 1000) {
      return null
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
      weatherCache = { at: now, data: null, ok: false }
      return null
    }
    const data = {
      id: `weather-${dayKey(now, timeZone)}-${r.hook}`,
      hook: `${coords.city}${r.hook}`,
      summary: r.summary,
      city: coords.city,
      temp: r.temp,
    }
    weatherCache = { at: now, data, ok: true }
    return data
  }

  const refreshExternal = async () => {
    const now = Date.now()
    if (externalCfg.hot === true) {
      if (now - hotCache.at > 3 * 3600 * 1000) {
        const r = await fetchHotCandidates({ fetchImpl: runtime.fetchImpl })
        hotCache = { at: now, items: Array.isArray(r.items) ? r.items : [] }
      }
    }
    if (externalCfg.media === true) {
      if (now - mediaCache.at > 6 * 3600 * 1000) {
        const r = await fetchMediaCandidates({ fetchImpl: runtime.fetchImpl })
        mediaCache = { at: now, items: r.items || [] }
      }
    }
  }

  const hasPendingLearn = (now = Date.now()) => {
    shareLog = prunePending(shareLog, now)
    return Boolean(shareLog.pending?.factKey)
  }

  runtime.share = {
    notesDir,
    getProfile: () => profile,
    getShareLog: () => shareLog,
    hasPendingLearn,
    profileBlock: () => {
      const base = formatOwnerProfileBlock(profile)
      shareLog = prunePending(shareLog, Date.now())
      const ask = String(shareLog.pending?.ask || '').trim().slice(0, 40)
      if (!ask) return base
      const pendingLine = `【待主人回答】刚问过「${ask}」，等答；别复读同一问。`
      return base ? `${base}\n${pendingLine}` : pendingLine
    },
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
      // Hot has its own daily slot (1× via usedIds hot-*), not gated by shareDailyMax
      const hotUsedToday = (shareLog.usedIds || []).some((id) =>
        String(id).startsWith('hot-'),
      )
      if (externalCfg.hot === true && hotCache.items.length && !hotUsedToday) {
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

      const day = dayKey(world.now || Date.now(), timeZone)
      const blockMiniTheater = Boolean(
        world.upcomingPromise?.text || world.shareLearn,
      )
      const c = buildShareCandidates({
        now: world.now,
        silentH: world.silentH,
        timeZone,
        dayKey: day,
        shareLog,
        shareCfg: { ...shareCfg, anniversaries: shareCfg.anniversaries },
        profile,
        memories,
        diary,
        journalTurns,
        weatherCache: canShare ? weatherCache.data : null,
        insideJokeLedger: insideJokeLedger?.jokes || [],
        fishLifeProgress,
        milestones,
        miniTheaterProgress,
        upcomingPromise: world.upcomingPromise,
        blockMiniTheater,
        relation: relationCfg,
      })

      world.shareLearn = c.learn
      world.shareMemoryFlip = c.memoryFlip
      world.shareCalendar = c.calendar
      world.shareInsideJoke = c.insideJoke
      world.shareFun = c.fun
      world.shareFishLife = c.fishLife
      // Hard suppress theater when learn also won the pool this enrich
      world.shareMiniTheater = c.learn ? null : c.miniTheater
      world.shareWeather = c.weather
      world.shareHot = hot
      world.shareMedia = media
      world.shareLearnCount = c.learnCount
      world.shareShareCount = c.shareCount
      world.shareLearnMax = c.learnMax
      world.shareShareMax = c.shareMax
      return world
    },

    getMilestones: () => milestones,
    setMilestones(next) {
      milestones = next
      saveStore(store, STORE.MILESTONES, milestones)
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
        if (world.shareCalendar.kind === 'milestone') {
          const used = Array.isArray(milestones.usedShareIds) ? milestones.usedShareIds : []
          milestones = {
            ...milestones,
            usedShareIds: [...used.filter((x) => x !== id), id].slice(-40),
          }
          saveStore(store, STORE.MILESTONES, milestones)
        }
      } else if (motive === 'fun_bit' && world.shareFun) {
        id = world.shareFun.id
      } else if (motive === 'inside_joke' && world.shareInsideJoke) {
        id = world.shareInsideJoke.id
        const jokes = Array.isArray(insideJokeLedger.jokes) ? insideJokeLedger.jokes : []
        if (world.shareInsideJoke.from !== 'seed' && !jokes.some((j) => j.id === id)) {
          insideJokeLedger = {
            jokes: [
              {
                id,
                hook: world.shareInsideJoke.hook,
                text: world.shareInsideJoke.text,
                from: world.shareInsideJoke.from || 'harvest',
                at: Date.now(),
              },
              ...jokes,
            ].slice(0, 40),
          }
          saveStore(store, STORE.INSIDE_JOKES, insideJokeLedger)
        }
      } else if (motive === 'fish_life' && world.shareFishLife) {
        id = world.shareFishLife.id
        fishLifeProgress = {
          chapterId: world.shareFishLife.chapterId,
          beatIndex: world.shareFishLife.nextBeatIndex || 0,
        }
        saveStore(store, STORE.FISH_LIFE, fishLifeProgress)
      } else if (motive === 'mini_theater' && world.shareMiniTheater) {
        id = world.shareMiniTheater.id
        miniTheaterProgress = {
          chapterId: world.shareMiniTheater.chapterId,
          beatIndex: world.shareMiniTheater.nextBeatIndex || 0,
          firedDay: dayKey(Date.now(), timeZone),
        }
        saveStore(store, STORE.MINI_THEATER, miniTheaterProgress)
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
     * @param {{ now?: number }} [opts]
     */
    captureOwnerReply(text, opts = {}) {
      const now = Number(opts.now) || Date.now()
      rollDay(now)
      const pending = shareLog.pending
      if (!pending?.factKey) return { ok: false, skipped: 'no-pending' }
      const at = Number(pending.at) || 0
      if (!at || now - at > PENDING_CAPTURE_WINDOW_MS) {
        return { ok: false, skipped: 'window' }
      }
      const body = String(text || '').trim()
      if (body.length < 1) return { ok: false, skipped: 'empty' }
      if ([...body].length < 2) return { ok: false, skipped: 'too_short' }
      // Ignore ultra-short brush-offs without content
      if (/^(嗯+|哦+|哈+|哈哈+|在$|忙$)$/.test(body) && body.length <= 4) {
        return { ok: false, skipped: 'trivial' }
      }
      if (/^(对了|另外|顺便|帮我|写个|改一下)/.test(body)) {
        return { ok: false, skipped: 'topic_change' }
      }
      if ((/代码|报错|部署/.test(body) && [...body].length >= 12)) {
        return { ok: false, skipped: 'topic_change' }
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
