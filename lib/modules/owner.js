/**
 * Resolve the WeChat owner peer + optional profile-global tool hard gate.
 *
 * Inbound whitelist is owned by dsh-wechat (`allowedUsers`). This module only
 * needs `owner.id` for proactive pings and promise reminders.
 */
import { softGet } from '../core/ctx.js'

const DANGEROUS = /^(bash|shell|ops_|terminal|write_file|edit_file|run_terminal)/i // no /g — safe for .test

/**
 * @param {any} ctx
 * @param {object} runtime
 */
export function applyOwnerGate(ctx, runtime) {
  const toolGuard = runtime.config.modules.toolGuard
  const disposers = []

  runtime.owner = {
    get id() {
      return (
        runtime.config.ownerWxid ||
        runtime.wechatSessions?.ownerUserId?.() ||
        ''
      )
    },
  }

  const tools = softGet(ctx, 'tools')
  if (toolGuard?.enabled && tools?.guard) {
    runtime.log?.warn?.(
      '[whale-companion] toolGuard is profile-global: it denies dangerous tools for EVERY agent in this profile, not only the WeChat session.',
    )
    try {
      const off = tools.guard((execution) => {
        const name = execution?.name || execution?.toolName || ''
        if (toolGuard.allowDangerous) return undefined
        if (DANGEROUS.test(name)) {
          return '陪伴会话默认禁止危险工具；如需开启请设 toolGuard.allowDangerous=true'
        }
        return undefined
      })
      disposers.push(typeof off === 'function' ? off : () => {})
    } catch {
      /* optional */
    }
  }

  return () => {
    for (const d of disposers) {
      try {
        d()
      } catch {
        /* ignore */
      }
    }
  }
}
