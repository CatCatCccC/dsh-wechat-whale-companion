/**
 * Stable session resume mapping for WeChat peers.
 */

/**
 * @param {any} ctx
 * @param {object} runtime
 */
export function applyAdopt(ctx, runtime) {
  if (!runtime.config.modules.adopt?.enabled) return () => {}

  const store = runtime.store
  /** @type {Record<string, string>} */
  let map = store.get('session-map.json', {})
  if (!map || typeof map !== 'object' || Array.isArray(map)) map = {}

  runtime.adopt = {
    /**
     * @param {string} peer
     * @param {string} [sessionId]
     */
    bind(peer, sessionId) {
      if (!peer) return
      if (sessionId) {
        map[peer] = sessionId
        store.setDebounced('session-map.json', map)
      }
      return map[peer] || null
    },
    get(peer) {
      return map[peer] || null
    },
    /** Prefer resume over create when host APIs exist */
    async openSession(peer) {
      const existing = map[peer]
      const agents = ctx?.agents
      if (!agents) return null
      if (existing && typeof agents.resume === 'function') {
        try {
          return await agents.resume(existing)
        } catch (err) {
          runtime.log?.warn?.(
            '[whale-companion] adopt resume failed, will create',
            err?.message || err,
          )
        }
      }
      try {
        if (typeof agents.create === 'function') {
          const session = await agents.create({
            title: `微信·${peer.slice(0, 8)}`,
          })
          const id = session?.id || session?.sessionId
          if (id) {
            map[peer] = id
            store.set('session-map.json', map)
          }
          return session
        }
      } catch (err) {
        runtime.log?.warn?.('[whale-companion] adopt openSession', err?.message || err)
      }
      return null
    },
  }

  return () => {}
}
