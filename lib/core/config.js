/**
 * Config merge + defaults for dsh-wechat-whale-companion.
 */

const DEFAULT_MODULES = {
  guard: { enabled: true },
  // speakOnAgentEnd: only when host does NOT already push assistant text to WeChat
  // deliverToAgent: set false if host already forwards inbound to the agent (avoid double)
  // autoIngest: listen for common wechat inbound events
  rhythm: {
    enabled: true,
    inboundMergeMs: 2000,
    bubbleDelayMs: '600,1800',
    speakOnAgentEnd: false,
    deliverToAgent: true,
    autoIngest: true,
  },
  prompt: { enabled: true },
  persona: { enabled: true, proactiveChance: 0.08, proactiveCooldownMin: 45 },
  stamp: { enabled: true },
  adopt: { enabled: true },
  sleep: { enabled: true },
  lastword: { enabled: true },
  diary: { enabled: true },
  promise: { enabled: true },
  tier: { enabled: true },
  temper: { enabled: true },
  circadian: { enabled: true },
  solitude: { enabled: true },
  focus: { enabled: true },
  media: { enabled: true, voice: false },
  ownerGate: { enabled: true },
  toolGuard: { enabled: true, allowDangerous: false },
  http: { enabled: true, port: 3199 },
  isolation: { enabled: false },
  mention: { enabled: false },
  poke: { enabled: false },
  hands: { enabled: false },
  linkcard: { enabled: false },
}

/**
 * @param {Record<string, unknown>} raw
 */
export function normalizeConfig(raw = {}) {
  const modulesIn = raw.modules && typeof raw.modules === 'object' ? raw.modules : {}
  const modules = { ...DEFAULT_MODULES }
  for (const [key, def] of Object.entries(DEFAULT_MODULES)) {
    const override = modulesIn[key]
    if (override && typeof override === 'object') {
      modules[key] = { ...def, ...override }
    }
  }
  return {
    enabled: raw.enabled !== false,
    ownerWxid: typeof raw.ownerWxid === 'string' ? raw.ownerWxid.trim() : '',
    lockFirstPeer: raw.lockFirstPeer !== false,
    stateDir: typeof raw.stateDir === 'string' ? raw.stateDir : '',
    modules,
  }
}

export function parseDelayRange(spec, fallback = [600, 1800]) {
  if (typeof spec !== 'string') return fallback
  const parts = spec.split(',').map((s) => Number(s.trim()))
  if (parts.length === 2 && parts.every((n) => Number.isFinite(n) && n >= 0)) {
    return [Math.min(parts[0], parts[1]), Math.max(parts[0], parts[1])]
  }
  return fallback
}

export function moduleEnabled(config, name) {
  return Boolean(config?.modules?.[name]?.enabled)
}

export { DEFAULT_MODULES }
