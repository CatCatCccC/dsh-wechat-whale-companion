/**
 * Runtime port contracts — warn (don't throw) when a required module forgot to mount.
 */

/**
 * @param {object} runtime
 * @param {{ info?: Function, warn?: Function }} [log]
 * @returns {{ ok: boolean, missing: string[] }}
 */
export function assertRuntimePorts(runtime, log = console) {
  const mods = runtime?.config?.modules || {}
  /** @type {string[]} */
  const missing = []

  const need = (cond, label, check) => {
    if (!cond) return
    if (!check()) missing.push(label)
  }

  need(true, 'speak', () => typeof runtime?.speak === 'function')
  need(mods.guard?.enabled !== false, 'guard.filterSend', () =>
    typeof runtime?.guard?.filterSend === 'function',
  )
  need(mods.rhythm?.enabled !== false, 'rhythm.sendPaced', () =>
    typeof runtime?.rhythm?.sendPaced === 'function',
  )
  need(mods.persona?.enabled !== false, 'persona.snapshot', () =>
    typeof runtime?.persona?.snapshot === 'function',
  )
  need(mods.persona?.enabled !== false, 'persona.onOwnerMessage', () =>
    typeof runtime?.persona?.onOwnerMessage === 'function',
  )
  need(mods.memory?.enabled !== false, 'memory.noteOwnerTurn', () =>
    typeof runtime?.memory?.noteOwnerTurn === 'function',
  )
  need(mods.media?.enabled !== false, 'media.sendMoodSticker', () =>
    typeof runtime?.media?.sendMoodSticker === 'function',
  )
  need(mods.promise?.enabled !== false, 'promise.due', () =>
    typeof runtime?.promise?.due === 'function',
  )
  // Only require sendText when the probe already claims the channel is present.
  need(Boolean(runtime?.wechat?.present), 'wechat.sendText', () =>
    typeof runtime?.wechat?.sendText === 'function',
  )

  if (!runtime.stats) runtime.stats = {}
  runtime.stats.portMissing = missing
  runtime.stats.portsOk = missing.length === 0

  if (missing.length) {
    log.warn?.(
      `[whale-companion] runtime ports incomplete: ${missing.join(', ')}`,
    )
  }
  return { ok: missing.length === 0, missing }
}
