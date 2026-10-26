/**
 * Single-owner whitelist + tool hard gate.
 */
import { softGet } from '../core/ctx.js'

const DANGEROUS = /^(bash|shell|ops_|terminal|write_file|edit_file|run_terminal)/i // no /g — safe for .test

/**
 * @param {any} ctx
 * @param {object} runtime
 */
export function applyOwnerGate(ctx, runtime) {
  const gate = runtime.config.modules.ownerGate
  const toolGuard = runtime.config.modules.toolGuard
  const disposers = []

  const store = runtime.store
  let locked = store.get('owner-lock.json', { wxid: runtime.config.ownerWxid || '' })

  runtime.owner = {
    get id() {
      return (
        runtime.config.ownerWxid ||
        locked.wxid ||
        runtime.wechatSessions?.ownerUserId?.() ||
        ''
      )
    },
    /**
     * @param {string} peer
     */
    allow(peer) {
      if (!gate?.enabled) return true
      const id = String(peer || '')
      if (!id) return false
      const configured = runtime.config.ownerWxid
      if (configured) return id === configured
      // dsh-wechat already binds the first WeChat user in ~/.dsh-wechat.
      // Trust that binding instead of racing to lock a different first peer.
      const known = runtime.wechatSessions?.ownerUserId?.() || ''
      if (known) return id === known
      if (runtime.config.lockFirstPeer) {
        if (!locked.wxid) {
          locked = { wxid: id, lockedAt: Date.now() }
          store.set('owner-lock.json', locked)
          runtime.log?.info?.(`[whale-companion] locked owner peer=${id}`)
        }
        return id === locked.wxid
      }
      return true
    },
    filterInbound(peer, payload) {
      if (!this.allow(peer)) {
        runtime.stats.ownerRejected = (runtime.stats.ownerRejected || 0) + 1
        return null
      }
      return payload
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
