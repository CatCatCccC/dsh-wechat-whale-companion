/**
 * Track last real utterance.
 */

/**
 * @param {any} ctx
 * @param {object} runtime
 */
export function applyLastword(ctx, runtime) {
  if (!runtime.config.modules.lastword?.enabled) return () => {}

  const store = runtime.store
  let state = store.get('lastword.json', { text: '', at: 0, count: 0 })

  runtime.lastword = {
    record(text) {
      const t = String(text || '').trim()
      if (!t) return
      state = {
        text: t.slice(0, 200),
        at: Date.now(),
        count: (state.count || 0) + 1,
      }
      store.setDebounced('lastword.json', state)
    },
    get: () => ({ ...state }),
  }

  return () => {}
}
