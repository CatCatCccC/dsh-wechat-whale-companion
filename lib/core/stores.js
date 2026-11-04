/**
 * Companion JSON state keys + light versioned load.
 */

export const STORE = {
  MOOD: 'mood-state.json',
  LASTWORD: 'lastword.json',
  SOCIAL_POLICY: 'social-policy.json',
  AGENDA: 'proactive-agenda.json',
  TOOL_FORCE: 'tool-force.json',
  PROMISES: 'promises.json',
  DIARY: 'diary.json',
  JOURNAL: 'chat-journal.json',
  FISH_MEMORY: 'fish-memory.json',
  CIRCADIAN: 'circadian.json',
}

export const STORE_VERSION = 1

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
function asObject(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return /** @type {Record<string, unknown>} */ (raw)
  }
  return {}
}

/**
 * Strip dead mood fields from older installs.
 * @param {Record<string, unknown>} raw
 */
export function migrateMood(raw) {
  const next = { ...raw }
  if (next.style != null) delete next.style
  return next
}

/**
 * @param {import('./state.js').StateStore} store
 * @param {string} key
 * @param {object} defaults
 * @param {{ version?: number, migrate?: (raw: Record<string, unknown>) => Record<string, unknown> }} [opts]
 */
export function loadStore(store, key, defaults, opts = {}) {
  const version = opts.version ?? STORE_VERSION
  const got = store.get(key, defaults ?? {})
  const raw = got == null ? {} : asObject(got)
  const base = defaults == null ? {} : asObject(defaults)
  let data = { ...base, ...raw }
  if (typeof opts.migrate === 'function') {
    data = opts.migrate(data)
  }
  if (key === STORE.MOOD) {
    data = migrateMood(data)
  }
  const hadVersion = Number.isFinite(Number(raw.version))
  if (!hadVersion || Number(raw.version) !== version) {
    data = { ...data, version }
  }
  return { data, version, upgraded: !hadVersion || Number(raw.version) !== version }
}

/**
 * Persist with version stamped.
 * @param {import('./state.js').StateStore} store
 * @param {string} key
 * @param {object} data
 * @param {{ debounce?: boolean, version?: number }} [opts]
 */
export function saveStore(store, key, data, opts = {}) {
  const version = opts.version ?? STORE_VERSION
  const payload = { ...data, version }
  if (opts.debounce) store.setDebounced(key, payload)
  else store.set(key, payload)
  return payload
}
