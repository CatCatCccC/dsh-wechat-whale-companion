/**
 * Clear companion state via /whale-reset (DSH command, works in WeChat too).
 */
import { softGet } from '../core/ctx.js'

const HELP = `用法：
/whale-reset memory  — 清空鱼记忆 + 近期对话滚动摘要
/whale-reset mood    — 清空心情/亲密度/睡着/最后一句话（关系档回到刚认识附近）
/whale-reset nurture — 清空日记、约定闹钟、作息统计
/whale-reset all     — 上面全部清空
清完建议再发：/session new`

/**
 * @param {object} runtime
 * @param {'memory'|'mood'|'nurture'|'all'} scope
 */
export function resetCompanion(runtime, scope = 'memory') {
  const cleared = []
  const s = String(scope || 'memory').trim().toLowerCase()

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

  if (!['memory', 'mood', 'nurture', 'all'].includes(s)) {
    return { ok: false, error: 'unknown scope', help: HELP }
  }

  runtime.stats.resetAt = Date.now()
  runtime.stats.resetScope = s
  runtime.stats.resetCleared = cleared
  return { ok: true, scope: s, cleared }
}

/**
 * @param {any} ctx
 * @param {object} runtime
 */
export function applyReset(ctx, runtime) {
  runtime.resetCompanion = (scope) => resetCompanion(runtime, scope)

  const disposers = []
  let registered = false

  const tryRegister = (serviceCtx = ctx) => {
    if (registered) return true
    const commands = softGet(serviceCtx, 'commands') || softGet(ctx, 'commands')
    if (!commands?.register) return false
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
          if (!arg) {
            return { kind: 'success', text: HELP }
          }
          const r = resetCompanion(runtime, arg)
          if (!r.ok) {
            return { kind: 'error', text: `${r.error}\n\n${HELP}` }
          }
          return {
            kind: 'success',
            text: `已清空：${r.cleared.join('、') || '（无）'}（scope=${r.scope}）\n建议再发 /session new 开干净会话。`,
          }
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

  if (!tryRegister(ctx)) {
    if (typeof ctx.inject === 'function') {
      try {
        const inj = ctx.inject(['commands'], (c) => tryRegister(c))
        if (typeof inj === 'function') disposers.push(inj)
      } catch {
        /* optional */
      }
    }
    const timer = setInterval(() => {
      if (tryRegister(ctx)) clearInterval(timer)
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
