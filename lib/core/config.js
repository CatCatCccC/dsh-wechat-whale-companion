/**
 * Config merge + defaults for dsh-wechat-whale-companion (WeChat DM only).
 */

const DEFAULT_MODULES = {
  guard: { enabled: true },
  // Outbound bubble pacing for speak() / proactive / promise.
  rhythm: {
    enabled: true,
    bubbleDelayMs: '600,1800',
  },
  // IMPORTANT: dsh-wechat `silent` only means "final reply only" — it STILL
  // pushes that reply to WeChat. Re-sending via deliverAssistant = identical doubles.
  // Keep deliverAssistant false; companion speak() is for proactive / promise / tools.
  outbound: {
    enabled: true,
    deliverAssistant: false,
    ensureWechatSilent: true,
  },
  prompt: { enabled: true, scope: 'wechat', personaDir: '' },
  persona: {
    enabled: true,
    // Quiet hours / meal intents use this zone (Docker often UTC).
    timeZone: 'Asia/Shanghai',
    proactiveChance: 0.18,
    proactiveCooldownMin: 22,
    proactiveMinOwnerGapMin: 12,
    proactiveStickerChance: 0.28,
    // tick interval ms (min 60000)
    proactiveTickMs: 300000,
  },
  sleep: { enabled: true },
  lastword: { enabled: true },
  diary: { enabled: true },
  // Fish-style fading memory (对标 Yuuyuko-uu/dsh-fish-memory 的淡忘/事实/配额)
  memory: {
    enabled: true,
    halfLifeDays: 30,
    maxInject: 10,
    maxFacts: 8,
    maxChars: 1200,
    dailyQuota: 24,
    evidenceMin: 1,
    bridgeDiary: true,
    // Capture clear owner facts/events even if the model skips wx_memory
    autoCapture: true,
    // QQ/whale-loli style: every turn → rolling journal injected as 【近期对话】
    journal: true,
    journalLimit: 80,
    journalInject: 16,
  },
  promise: { enabled: true },
  tier: { enabled: true },
  circadian: { enabled: true },
  // search: Sogou/APIHZ 表情包 APIs (free, China). Cache under stateDir.
  // searchStyle: cute = bias keywords (可爱/软萌/治愈); raw = exact keyword
  media: {
    enabled: true,
    // dsh-meme-compatible packs under assets/meme-packs (tag/caption first)
    memePacksDir: '',
    search: true,
    searchStyle: 'cute',
    searchCacheMax: 80,
    searchCooldownMs: 8000,
    searchTimeoutMs: 12000,
  },
  ownerGate: { enabled: true },
  // tools.guard() is profile-global — off by default.
  toolGuard: { enabled: false, allowDangerous: false },
  // host: omit = 127.0.0.1 bare-metal, 0.0.0.0 inside Docker
  http: { enabled: true, port: 3199, host: '', token: '' },
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
