/**
 * Proactive ping timer: motive plan → draft → speak / sticker.
 * Mood state mutations go through runtime.persona narrow APIs.
 */
import { bumpAgendaUsed } from '../core/proactive-agenda.js'
import { draftProactiveLine } from '../core/proactive-draft.js'
import { worldFromRuntime } from '../core/proactive-world.js'
import { weekdayInZone } from '../core/share-calendar.js'
import {
  DEFAULT_PROACTIVE,
  DEFAULT_TIME_ZONE,
  dayPart,
  hourInTimeZone,
  planProactiveTick,
} from './proactive.js'

/**
 * @param {any} _ctx
 * @param {object} runtime
 */
export function applyProactiveEngine(_ctx, runtime) {
  const mod = runtime.config.modules.persona
  if (!mod?.enabled) return () => {}
  if (!runtime.persona) {
    runtime.log?.warn?.('[whale-companion] proactive-engine: persona missing')
    return () => {}
  }

  const chance = Number(mod.proactiveChance)
  const cooldownMin = Number(mod.proactiveCooldownMin)
  const minOwnerGapMin = Number(mod.proactiveMinOwnerGapMin)
  const stickerChance = Number(mod.proactiveStickerChance)
  const tickMs = Number(mod.proactiveTickMs)
  const tick = Number.isFinite(tickMs) && tickMs >= 60_000 ? tickMs : DEFAULT_PROACTIVE.tickMs
  const cooldownMs =
    (Number.isFinite(cooldownMin) ? cooldownMin : DEFAULT_PROACTIVE.cooldownMin) * 60 * 1000
  const llmDraft = mod.proactiveLlmDraft !== false
  const minMotiveScore = Number(mod.proactiveMinMotiveScore)
  const timeZone =
    typeof mod.timeZone === 'string' && mod.timeZone.trim()
      ? mod.timeZone.trim()
      : runtime.persona.timeZone || DEFAULT_TIME_ZONE

  const sendSticker = async (keyword, opts) => {
    if (!keyword || !runtime.media?.findSticker || !runtime.media?.sendImage) return false
    try {
      const found = await runtime.media.findSticker(keyword)
      if (found?.ok && found.path) {
        const stickerSent = await runtime.media.sendImage(found.path, opts)
        if (stickerSent?.ok) {
          runtime.stats.proactiveSticker = (runtime.stats.proactiveSticker || 0) + 1
          return true
        }
      }
    } catch (stickerErr) {
      runtime.log?.warn?.(
        '[whale-companion] proactive sticker',
        stickerErr?.message || stickerErr,
      )
    }
    return false
  }

  const sendTextLine = async (line, opts) => {
    if (!line) return { sent: 0, skipped: 'empty' }
    if (typeof runtime.speak !== 'function') {
      throw new Error('no_speak')
    }
    const sent = await runtime.speak(line, opts)
    if (!(sent?.sent > 0)) {
      throw new Error(sent?.reason || sent?.skipped || 'speak sent 0')
    }
    return sent
  }

  /** One tick — exported for tests via runtime.proactiveEngine.runTick */
  const runTick = async () => {
    const persona = runtime.persona
    if (!persona) return { skipped: 'no-persona' }

    persona.regen?.()
    try {
      runtime.diary?.tickDaily?.(Date.now())
    } catch (err) {
      runtime.log?.warn?.(
        '[whale-companion] daily diary tick failed',
        err?.message || err,
      )
    }
    if (persona.shouldSuppressProactive?.()) return { skipped: 'asleep' }

    const now = Date.now()
    const agenda = persona.rollAgendaDay?.(now) || persona.getAgenda?.()
    const policy = persona.getSocialPolicy?.() || {}
    const snap = persona.snapshot()
    const lastword = persona.getLastword?.()?.text || ''
    const to = runtime.owner?.id || ''

    const hour = hourInTimeZone(now, timeZone)
    const world = worldFromRuntime(runtime, snap, {
      now,
      hour,
      lastword,
      recent: snap.recentProactive || [],
      dayPart: dayPart(hour),
      weekday: weekdayInZone(now, timeZone),
    })
    const rel = runtime.config.modules.relation || {}
    try {
      await runtime.share?.enrichWorld?.(world, snap)
    } catch (err) {
      runtime.log?.warn?.(
        '[whale-companion] share enrich',
        err?.message || err,
      )
    }
    world.proactiveChatter = rel.proactiveChatter !== false

    const plan = planProactiveTick({
      now,
      asleep: snap.asleep,
      energy: snap.energy,
      mood: snap.mood,
      affinity: snap.affinity,
      lastProactiveAt: snap.lastProactiveAt,
      lastOwnerAt: snap.lastOwnerAt,
      tier: runtime.tier?.stage?.()?.id || '',
      lastword,
      recent: snap.recentProactive || [],
      activeHours: runtime.circadian?.activeHours?.() || [],
      chance: Number.isFinite(chance) ? chance : DEFAULT_PROACTIVE.chance,
      cooldownMin: Number.isFinite(cooldownMin) ? cooldownMin : DEFAULT_PROACTIVE.cooldownMin,
      minOwnerGapMin: Number.isFinite(minOwnerGapMin)
        ? minOwnerGapMin
        : DEFAULT_PROACTIVE.minOwnerGapMin,
      stickerChance: Number.isFinite(stickerChance)
        ? stickerChance
        : DEFAULT_PROACTIVE.stickerChance,
      cooldownBiasMin: policy.cooldownBiasMin || 0,
      hasSendText: typeof runtime.speak === 'function',
      hasOwner: Boolean(to),
      timeZone,
      minMotiveScore: Number.isFinite(minMotiveScore)
        ? minMotiveScore
        : DEFAULT_PROACTIVE.minMotiveScore,
      world,
      policyWeights: policy.weights,
      agenda,
      blankForm: rel.blankForm !== false,
    })

    runtime.stats.proactiveTimeZone = timeZone
    runtime.stats.proactiveLastSkip = plan.fire ? '' : plan.reason || ''
    runtime.stats.proactiveLastSkipMotive = plan.motive || ''
    runtime.stats.proactiveSocial = plan.social !== false
    runtime.stats.proactiveForced = Boolean(plan.forced)
    if (!plan.fire) return { skipped: plan.reason || 'no-fire' }

    try {
      runtime.wechatSessions?.refresh?.()
      const bound = runtime.wechatSessions?.list?.()?.[0]
      const opts = {
        to,
        proactive: true,
        agentId: bound?.sessionId || undefined,
      }

      let line = plan.line
      let lineSource = plan.lineSource || 'template'
      let stickerKeyword = plan.stickerKeyword || ''
      let critic = ''

      const form = plan.form || 'text'
      if (form !== 'sticker_only' && form !== 'half_sentence') {
        const drafted = await draftProactiveLine({
          motiveId: plan.motive || plan.intent,
          world,
          recent: snap.recentProactive || [],
          lastword,
          ctx: runtime.ctx,
          enabledLlm: llmDraft,
          provider: mod.proactiveDraftProvider || undefined,
          model: mod.proactiveDraftModel || undefined,
          agentId: bound?.sessionId,
          timeoutMs: Number(mod.proactiveDraftTimeoutMs) || 12000,
        })
        line = drafted.line || line
        lineSource = drafted.source || lineSource
        critic = drafted.critic || ''
        if (drafted.stickerKeyword && form !== 'text') {
          stickerKeyword = drafted.stickerKeyword
        }
        if (drafted.route) runtime.stats.proactiveDraftRoute = drafted.route
        if (drafted.error) runtime.stats.proactiveDraftError = drafted.error
      } else if (form === 'half_sentence') {
        // keep ultra-short template from plan; skip LLM
        lineSource = 'half_sentence'
      }

      if (form === 'sticker_only') {
        const ok = await sendSticker(stickerKeyword || '傲娇', opts)
        if (!ok) await sendTextLine(line || '喂', opts)
      } else if (form === 'sticker_then_text') {
        await sendSticker(stickerKeyword, opts)
        await sendTextLine(line, opts)
      } else {
        await sendTextLine(line, opts)
        if (form === 'text_then_sticker' && stickerKeyword) {
          await sendSticker(stickerKeyword, opts)
        }
      }

      const agendaNext = bumpAgendaUsed(agenda)
      persona.commitProactiveSuccess?.(
        {
          intent: plan.intent,
          motive: plan.motive || plan.intent,
          line: line || '',
          form,
        },
        agendaNext,
      )

      if ((plan.motive || plan.intent) === 'echo_mood') {
        try {
          persona.markEchoConsumed?.(now)
        } catch {
          /* ignore */
        }
      }

      try {
        runtime.share?.onProactiveSent?.(
          {
            motive: plan.motive || plan.intent,
            hook: plan.hook || '',
            line: line || '',
          },
          world,
        )
      } catch {
        /* ignore */
      }

      runtime.stats.proactiveSent = (runtime.stats.proactiveSent || 0) + 1
      runtime.stats.proactiveIntent = plan.intent
      runtime.stats.proactiveMotive = plan.motive || plan.intent
      runtime.stats.proactiveMotiveScore = plan.motiveScore || 0
      runtime.stats.proactiveHook = plan.hook || ''
      runtime.stats.proactiveForm = form
      runtime.stats.proactiveLineSource = lineSource
      runtime.stats.proactiveCritic = critic
      runtime.stats.proactiveAgendaUsed = agendaNext.used
      runtime.stats.proactiveFailReason = ''
      runtime.log?.info?.(
        `[whale-companion] proactive sent motive=${plan.motive || plan.intent} line=${String(line || '').slice(0, 40)}`,
      )
      return { ok: true, line, form }
    } catch (err) {
      persona.softFailProactive?.(cooldownMs)
      const msg = String(err?.message || err)
      runtime.stats.proactiveFailReason = /token|context/i.test(msg)
        ? 'context_token'
        : msg.slice(0, 120)
      runtime.log?.warn?.(
        '[whale-companion] proactive failed',
        runtime.stats.proactiveFailReason,
      )
      return { ok: false, error: runtime.stats.proactiveFailReason }
    }
  }

  const timer = setInterval(() => {
    void runTick().catch((err) => {
      runtime.log?.warn?.('[whale-companion] proactive tick', err?.message || err)
    })
  }, tick)
  timer.unref?.()

  runtime.proactiveEngine = { runTick, tickMs: tick }

  return () => clearInterval(timer)
}
