/**
 * Soft-read Cordis services without inject.
 * Direct `ctx.wechat` throws: cannot get property "wechat" without inject.
 */

/**
 * @param {any} ctx
 * @param {string} name
 */
export function softGet(ctx, name) {
  if (!ctx) return undefined
  try {
    if (typeof ctx.get === 'function') return ctx.get(name)
  } catch {
    /* ignore */
  }
  try {
    return ctx[name]
  } catch {
    return undefined
  }
}
