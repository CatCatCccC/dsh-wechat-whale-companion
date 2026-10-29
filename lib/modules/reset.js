/**
 * Clear companion state via /whale-reset.
 * Primary: DSH ctx.commands (dsh-wechat native dispatch).
 * Fallback: intercept forwarded `/whale-reset …` on WeChat user/message.
 */
import { softGet } from '../core/ctx.js'

const HELP = `用法：
/whale-reset memory  — 清空鱼记忆 + 近期对话滚动摘要
/whale-reset mood    — 清空心情/亲密度/睡着/最后一句话（关系档回到刚认识附近）
/whale-reset nurture — 清空日记、约定闹钟、作息统计
/whale-reset all     — 上面全部清空
清完建议再发：/session new`

/** @param {string} text */
export function parseWhaleResetLine(text) {
  const raw = String(text || '')
  // Must start at byte 0 with / (same contract as dsh-wechat parseCommandName)
  const m = raw.match(/^\/whale-reset(?:\s+(.*))?$/i)
  if (!m) return null
  const rest = (m[1] || '').trim()
  const scope = rest.split(/\s+/)[0]?.toLowerCase() || ''
  return { scope, rawInput: rest }
}

/**
 * @param {object} runtime
 * @param {'memory'|'mood'|'nurture'|'all'|string} scope
 */
export function resetCompanion(runtime, scope = 'memory') {
  const cleared = []
  const s = String(scope || 'memory').trim().toLowerCase()

  if (!['memory', 'mood', 'nurture', 'all'].includes(s)) {
    return { ok: false, error: 'unknown scope', help: HELP }
  }

  if (s === 'memory' || s === 'all') {
    const r = runtime.memory?.reset?.()
    if (r?.ok) cleared.push('memory', 'journal')
    else if (!runtime.memory?.reset) cleared.push('memory(unavailable)')
  }

  if (s === 'mood' || s === 'all') {
    const r = runtime.persona?.reset?.()
    if (r?.ok) cleared.push('mood', 'lastword', 'affinity')
    else if (!runtime.persona?.reset) cleared.push('mood(unavailable)')
  }

  if (s === 'nurture' || s === 'all') {
    if (runtime.diary?.clear?.()?.ok) cleared.push('diary')
    if (runtime.promise?.clear?.()?.ok) cleared.push('promises')
    if (runtime.circadian?.reset?.()?.ok) cleared.push('circadian')
  }

  runtime.stats.resetAt = Date.now()
  runtime.stats.resetScope = s
  runtime.stats.resetCleared = cleared
  return { ok: true, scope: s, cleared }
}

/**
 * @param {object} runtime
 * @param {string} [scope]
 */
export function formatResetReply(runtime, scope) {
  if (!scope) return HELP
  const r = resetCompanion(runtime, scope)
  if (!r.ok) return `⚠️ ${r.error}\n\n${HELP}`
  return `已清空：${r.cleared.join('、') || '（无）'}（scope=${r.scope}）\n建议再发 /session new 开干净会话。`
}

/**
 * Handle a forwarded `/whale-reset` user line (when native command missed).
 * @param {object} runtime
 * @param {string} text
 * @returns {boolean} true if consumed
 */
export function handleWhaleResetText(runtime, text) {
  const parsed = parseWhaleResetLine(text)
  if (!parsed) return false
  // Dedup: native command may have just cleared + replied
  const last = runtime.stats.resetHandledAt || 0
  if (Date.now() - last < 2500 && runtime.stats.resetHandledLine === text) {
    return true
  }
  const reply = formatResetReply(runtime, parsed.scope || '')
  runtime.stats.resetHandledAt = Date.now()
  runtime.stats.resetHandledLine = text
  runtime.stats.resetVia = 'text-fallback'
  Promise.resolve(runtime.speak?.(reply, { skipObserve: true })).catch((err) => {
    runtime.log?.warn?.(
      '[whale-companion] whale-reset speak failed',
      err?.message || err,
    )
  })
  return true
}

/**
 * @param {any} ctx
 * @param {object} runtime
 */
export function applyReset(ctx, runtime) {
  runtime.resetCompanion = (scope) => resetCompanion(runtime, scope)
  runtime.handleWhaleResetText = (text) => handleWhaleResetText(runtime, text)

  const disposers = []
  let registered = false

  const tryRegister = (commands) => {
    if (registered) return true
    if (!commands || typeof commands.register !== 'function') return false
    try {
      const off = commands.register({
        name: 'whale-reset',
        description: '清空鲸鱼娘陪伴记忆/心情（memory|mood|nurture|all）',
        input: { hint: 'memory|mood|nurture|all' },
        handler: ({ rawInput }) => {
          const arg = String(rawInput || '')
            .trim()
            .split(/\s+/)[0]
            ?.toLowerCase()
          const text = formatResetReply(runtime, arg || '')
          if (!arg) return { kind: 'success', text }
          const r = resetCompanion(runtime, arg)
          runtime.stats.resetHandledAt = Date.now()
          runtime.stats.resetHandledLine = `/whale-reset ${arg}`
          runtime.stats.resetVia = 'commands'
          if (!r.ok) return { kind: 'error', text }
          return { kind: 'success', text }
        },
      })
      disposers.push(typeof off === 'function' ? off : () => {})
      registered = true
      runtime.stats.commandsRegistered = {
        ...(runtime.stats.commandsRegistered || {}),
        'whale-reset': true,
      }
      runtime.log?.info?.('[whale-companion] command registered: /whale-reset')
      return true
    } catch (err) {
      runtime.log?.warn?.(
        '[whale-companion] /whale-reset register failed',
        err?.message || err,
      )
      return false
    }
  }

  // Same pattern as dsh-wechat: inject(['commands'], cmdCtx => cmdCtx.get('commands'))
  if (typeof ctx.inject === 'function') {
    try {
      const inj = ctx.inject(['commands'], (cmdCtx) => {
        const commands = softGet(cmdCtx, 'commands') || softGet(ctx, 'commands')
        tryRegister(commands)
      })
      if (typeof inj === 'function') disposers.push(inj)
    } catch (err) {
      runtime.log?.warn?.(
        '[whale-companion] commands inject failed',
        err?.message || err,
      )
    }
  }

  // Immediate + poll (commands may load after this plugin)
  if (!tryRegister(softGet(ctx, 'commands'))) {
    const timer = setInterval(() => {
      if (tryRegister(softGet(ctx, 'commands'))) clearInterval(timer)
    }, 1000)
    timer.unref?.()
    disposers.push(() => clearInterval(timer))
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
