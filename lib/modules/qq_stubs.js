/**
 * QQ-only modules kept as config stubs (disabled by default).
 */

const STUBS = ['isolation', 'mention', 'poke', 'hands', 'linkcard']

/**
 * @param {any} _ctx
 * @param {object} runtime
 */
export function applyQqStubs(_ctx, runtime) {
  for (const name of STUBS) {
    const mod = runtime.config.modules[name]
    if (mod?.enabled) {
      runtime.log?.warn?.(
        `[whale-companion] module ${name} has no WeChat equivalent; leaving disabled semantics`,
      )
      mod.enabled = false
    }
  }
  runtime.qqStubs = { unavailable: STUBS }
  return () => {}
}
