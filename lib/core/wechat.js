/**
 * Probe dsh-wechat without editing node_modules.
 * Fail-soft: returns capabilities; callers degrade when APIs missing.
 *
 * dsh-wechat 0.13+ exposes no `wechat` Cordis service. It registers a
 * `send_wechat` tool instead, so outbound goes through that tool when the
 * legacy service is absent.
 */
import { softGet } from './ctx.js'

/**
 * @typedef {object} WechatAdapter
 * @property {boolean} present
 * @property {string[]} capabilities
 * @property {(text: string, opts?: object) => Promise<unknown>} [sendText]
 * @property {(filePath: string, opts?: object) => Promise<unknown>} [sendImage]
 * @property {(filePath: string, opts?: object) => Promise<unknown>} [sendVoice]
 * @property {object | null} service
 * @property {boolean} [tool]
 * @property {string} notes
 */

function findSendWechatTool(ctx) {
  const tools = softGet(ctx, 'tools')
  try {
    return tools?.get?.('send_wechat') || undefined
  } catch {
    return undefined
  }
}

/**
 * Build an outbound adapter over dsh-wechat's `send_wechat` tool.
 * Resolves the tool on every call: dsh-wechat may register it after us.
 * @param {any} ctx
 */
function probeSendWechatTool(ctx) {
  const tool = findSendWechatTool(ctx)
  if (typeof tool?.execute !== 'function') return null

  const call = async (args, opts) => {
    const live = findSendWechatTool(ctx)
    if (typeof live?.execute !== 'function') {
      throw new Error('dsh-wechat send_wechat tool disappeared')
    }
    const exec = {}
    if (opts?.agentId != null) exec.agent = { id: String(opts.agentId) }
    const result = await live.execute(args, exec)
    // dsh-wechat reports rate-limit / channel failures as { ok: false, message }.
    // A resolved failure must not be counted as a sent bubble.
    if (result && typeof result === 'object' && result.ok === false) {
      throw new Error(result.message || result.error || 'send_wechat failed')
    }
    return result
  }

  return {
    present: true,
    capabilities: ['send_wechat'],
    service: null,
    tool: true,
    notes: 'bound to dsh-wechat send_wechat tool',
    sendText: (text, opts) => call({ text: String(text ?? '') }, opts),
    sendImage: (filePath, opts) => call({ file_path: String(filePath) }, opts),
  }
}

/**
 * @param {any} ctx Cordis context
 * @returns {WechatAdapter}
 */
export function probeWechat(ctx) {
  const caps = []
  /** @type {WechatAdapter} */
  const adapter = {
    present: false,
    capabilities: caps,
    service: null,
    notes: '',
  }

  const servicesBag = softGet(ctx, 'services')
  const candidates = [
    softGet(ctx, 'wechat'),
    softGet(ctx, 'weixin'),
    softGet(ctx, 'dsh-wechat'),
    servicesBag?.wechat,
    servicesBag?.weixin,
  ].filter(Boolean)

  const service = candidates[0] ?? null
  if (!service) {
    const viaTool = probeSendWechatTool(ctx)
    if (viaTool) return /** @type {WechatAdapter} */ (viaTool)
    adapter.notes =
      'dsh-wechat service/tool not found on ctx (wechat/weixin/send_wechat). Install dsh-wechat and restart. Companion still injects prompts/tools via host hooks.'
    return adapter
  }

  adapter.present = true
  adapter.service = service

  if (typeof service.send === 'function') {
    caps.push('send')
    adapter.sendText = async (text, opts) => service.send({ text, ...opts })
  } else if (typeof service.sendMessage === 'function') {
    caps.push('sendMessage')
    adapter.sendText = async (text, opts) => service.sendMessage(text, opts)
  } else if (typeof service.push === 'function') {
    caps.push('push')
    adapter.sendText = async (text, opts) => service.push(text, opts)
  }

  if (typeof service.sendImage === 'function') {
    caps.push('sendImage')
    adapter.sendImage = (filePath, opts) => service.sendImage(filePath, opts)
  } else if (typeof service.sendMedia === 'function') {
    caps.push('sendMedia')
    adapter.sendImage = (filePath, opts) =>
      service.sendMedia({ type: 'image', path: filePath, ...opts })
  }

  if (typeof service.sendVoice === 'function') {
    caps.push('sendVoice')
    adapter.sendVoice = (filePath, opts) => service.sendVoice(filePath, opts)
  }

  if (typeof service.notify === 'function') caps.push('notify')
  if (service.sendText && !adapter.sendText) {
    adapter.sendText = (text, opts) => service.sendText(text, opts)
    caps.push('sendText')
  }

  adapter.notes = caps.length
    ? `bound to wechat service; caps=${caps.join(',')}`
    : 'wechat service present but no known send* methods; outbound via agent reply path only'

  return adapter
}

/**
 * Best-effort HTTP fallback for community images that expose /wechat/send.
 * @param {string} base
 * @param {string} text
 * @param {Record<string, unknown>} [body]
 */
export async function httpSendText(base, text, body = {}) {
  const url = `${base.replace(/\/$/, '')}/wechat/send`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, ...body }),
  })
  if (!res.ok) {
    throw new Error(`wechat HTTP send failed: ${res.status}`)
  }
  return res.json().catch(() => ({}))
}
