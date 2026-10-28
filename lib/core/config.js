/**
 * Config merge + defaults for dsh-wechat-whale-companion (WeChat DM only).
 */

const DEFAULT_MODULES = {
  guard: { enabled: true },
  // Outbound bubble pacing for speak() / proactive / promise.
  // Inbound is owned by dsh-wechat — this plugin does not re-bridge messages.
  rhythm: {
    enabled: true,
    bubbleDelayMs: '600,1800',
  },
  prompt: { enabled: true, scope: 'wechat' },
  persona: { enabled: true, proactiveChance: 0.08, proactiveCooldownMin: 45 },
  sleep: { enabled: true },
  lastword: { enabled: true },
  diary: { enabled: true },
  promise: { enabled: true },
  tier: { enabled: true },
  circadian: { enabled: true },
  media: { enabled: true },
  ownerGate: { enabled: true },
  // tools.guard() registered from this plugin is GLOBAL: it would deny the
  // listed tools for every agent in the profile, including coding sessions.
  // Off by default; enable only in a dedicated companion profile.
  toolGuard: { enabled: false, allowDangerous: false },
  // host: omit = 127.0.0.1 bare-metal, 0.0.0.0 inside Docker (see http.js)
  http: { enabled: true, port: 3199, host: '' },
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
    // dsh-wechat's storage dir (default ~/.dsh-wechat); read-only session map.
    wechatStorageDir:
      typeof raw.wechatStorageDir === 'string' ? raw.wechatStorageDir.trim() : '',
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

export { DEFAULT_MODULES }
