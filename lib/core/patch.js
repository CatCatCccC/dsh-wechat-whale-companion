/**
 * Prototype patching with module identity — inspired by dsh-onebot-companion.
 * Later patches wrap earlier ones; priority metadata is stored on the wrapper.
 */

const META = Symbol.for('dsh-wechat-whale-companion.patch')

/**
 * @param {object} proto
 * @param {string} method
 * @param {(original: Function) => Function} factory
 * @param {{ id: string, priority?: number }} meta
 */
export function patchMethod(proto, method, factory, meta) {
  if (!proto || typeof proto[method] !== 'function') {
    return () => {}
  }
  const original = proto[method]
  const wrapped = factory(original)
  if (typeof wrapped !== 'function') {
    throw new Error(`patchMethod(${method}): factory must return a function`)
  }
  wrapped[META] = {
    id: meta.id,
    priority: meta.priority ?? 50,
    previous: original,
  }
  proto[method] = wrapped
  return () => {
    if (proto[method] === wrapped) {
      proto[method] = original
    }
  }
}

export function getPatchMeta(fn) {
  return fn?.[META] ?? null
}

/**
 * Try to resolve a nested export path from a module namespace object.
 * @param {unknown} root
 * @param {string[]} pathParts
 */
export function dig(root, pathParts) {
  let cur = root
  for (const p of pathParts) {
    if (cur == null) return undefined
    cur = cur[p]
  }
  return cur
}
