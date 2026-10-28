/**
 * Read / optionally force dsh-wechat config.json (silent flag for outbound takeover).
 */
import fs from 'node:fs'
import path from 'node:path'
import { defaultWechatStorageDir } from './wechat-state.js'

/**
 * @param {string} [storageDir]
 */
export function wechatConfigPath(storageDir = '') {
  return path.join(defaultWechatStorageDir(storageDir), 'config.json')
}

/**
 * @param {string} [storageDir]
 * @returns {{ silent: boolean, raw: Record<string, unknown> | null, path: string }}
 */
export function readWechatConfig(storageDir = '') {
  const file = wechatConfigPath(storageDir)
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { silent: false, raw: null, path: file }
    }
    return { silent: Boolean(raw.silent), raw, path: file }
  } catch {
    return { silent: false, raw: null, path: file }
  }
}

/**
 * Ensure dsh-wechat silent mode so companion can own assistant delivery.
 * @param {string} [storageDir]
 * @param {{ log?: { info?: Function, warn?: Function } }} [opts]
 * @returns {{ ok: boolean, already: boolean, path: string, error?: string }}
 */
export function ensureWechatSilent(storageDir = '', opts = {}) {
  const file = wechatConfigPath(storageDir)
  let raw = {}
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed
    }
  } catch (err) {
    return { ok: false, already: false, path: file, error: String(err?.message || err) }
  }

  if (raw.silent === true) {
    return { ok: true, already: true, path: file }
  }

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const next = { ...raw, silent: true }
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
    try {
      fs.renameSync(tmp, file)
    } catch {
      try {
        fs.unlinkSync(file)
      } catch {
        /* first write */
      }
      fs.renameSync(tmp, file)
    }
    opts.log?.info?.(`[whale-companion] set dsh-wechat silent=true (${file})`)
    return { ok: true, already: false, path: file }
  } catch (err) {
    opts.log?.warn?.(
      '[whale-companion] failed to set dsh-wechat silent',
      err?.message || err,
    )
    return { ok: false, already: false, path: file, error: String(err?.message || err) }
  }
}
