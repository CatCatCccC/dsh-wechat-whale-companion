/**
 * Compact owner portrait from factKey memories.
 */

/**
 * @param {unknown} raw
 */
export function normalizeOwnerProfile(raw) {
  const src = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {}
  const traitsIn = src.traits && typeof src.traits === 'object' ? src.traits : {}
  /** @type {Record<string, string>} */
  const traits = {}
  for (const [k, v] of Object.entries(traitsIn)) {
    const key = String(k || '').trim().slice(0, 80)
    const val = String(v || '').trim().slice(0, 120)
    if (key && val) traits[key] = val
  }
  return {
    traits,
    summaryLines: Array.isArray(src.summaryLines)
      ? src.summaryLines.map(String).filter(Boolean).slice(0, 24)
      : rebuildSummary(traits),
    updatedAt: Number(src.updatedAt) || 0,
  }
}

/**
 * @param {Record<string, string>} traits
 */
export function rebuildSummary(traits) {
  return Object.entries(traits || {})
    .map(([k, v]) => `${k.replace(/^主人\./, '')}：${v}`)
    .slice(0, 16)
}

/**
 * @param {object} profile
 * @param {string} factKey
 * @param {string} text
 */
export function upsertTrait(profile, factKey, text) {
  const key = String(factKey || '').trim().slice(0, 80)
  const val = String(text || '').trim().slice(0, 120)
  if (!key || !val) return profile
  const traits = { ...(profile.traits || {}), [key]: val }
  return {
    traits,
    summaryLines: rebuildSummary(traits),
    updatedAt: Date.now(),
  }
}

/**
 * Known factKeys already filled.
 * @param {object} profile
 * @param {Array<{ factKey?: string, kind?: string }>} [memories]
 */
export function filledFactKeys(profile, memories = []) {
  const set = new Set(Object.keys(profile?.traits || {}))
  for (const m of memories || []) {
    if (m?.kind === 'fact' && m.factKey) set.add(String(m.factKey))
  }
  return set
}

/**
 * Prompt block.
 * @param {object} profile
 */
export function formatOwnerProfileBlock(profile) {
  const lines = profile?.summaryLines?.length
    ? profile.summaryLines
    : rebuildSummary(profile?.traits || {})
  if (!lines.length) return ''
  return `【我眼中的主人】\n${lines.map((l) => `- ${l}`).join('\n')}`.slice(0, 600)
}
