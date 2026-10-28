/**
 * Probe dsh-wechat without editing node_modules.
 *
 * dsh-wechat 0.13+ exposes no `wechat` Cordis service. It registers a
 * `send_wechat` tool; outbound goes through that. A thin legacy-service
 * fallback remains for older hosts that still put send* on ctx.
 */
import { softGet } from './ctx.js'

/**
 * @typedef {object} WechatAdapter
 * @property {boolean} present
 * @property {string[]} capabilities
 * @property {(text: string, opts?: object) => Promise<unknown>} [sendText]
 * @property {(filePath: string, opts?: object) => Promise<unknown>} [sendImage]
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
  // Preferred path for dsh-wechat >= 0.13
  const viaTool = probeSendWechatTool(ctx)
  if (viaTool) return /** @type {WechatAdapter} */ (viaTool)

  const servicesBag = softGet(ctx, 'services')
  const service =
    softGet(ctx, 'wechat') ||
    softGet(ctx, 'weixin') ||
    softGet(ctx, 'dsh-wechat') ||
    servicesBag?.wechat ||
    servicesBag?.weixin ||
    null

  /** @type {WechatAdapter} */
  const adapter = {
    present: false,
    capabilities: [],
    service: null,
    notes:
      'dsh-wechat send_wechat tool not found. Install dsh-wechat and restart. Companion still injects prompts/tools via host hooks.',
  }

  if (!service) return adapter

  adapter.present = true
  adapter.service = service
  const caps = adapter.capabilities

  if (typeof service.sendText === 'function') {
    caps.push('sendText')
    adapter.sendText = (text, opts) => service.sendText(text, opts)
  } else if (typeof service.send === 'function') {
    caps.push('send')
    adapter.sendText = async (text, opts) => service.send({ text, ...opts })
  } else if (typeof service.sendMessage === 'function') {
    caps.push('sendMessage')
    adapter.sendText = async (text, opts) => service.sendMessage(text, opts)
  }

  if (typeof service.sendImage === 'function') {
    caps.push('sendImage')
    adapter.sendImage = (filePath, opts) => service.sendImage(filePath, opts)
  }

  adapter.notes = caps.length
    ? `bound to legacy wechat service; caps=${caps.join(',')}`
    : 'wechat service present but no known send* methods; outbound via agent reply path only'

  return adapter
}
