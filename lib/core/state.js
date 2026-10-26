/**
 * Atomic JSON state store under ~/.dsh/plugins/dsh-wechat-whale-companion/
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export function defaultStateDir(override = '') {
  if (override) return override
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'plugins', 'dsh-wechat-whale-companion')
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Deep-merge defaults so partial disks don't crash (missing .style etc.).
 * @param {any} base
 * @param {any} over
 */
export function mergeDefaults(base, over) {
  if (over == null || typeof over !== 'object' || Array.isArray(over)) {
    return over === undefined ? structuredClone(base) : over
  }
  const out = structuredClone(base)
  for (const [k, v] of Object.entries(over)) {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      out[k] &&
      typeof out[k] === 'object' &&
      !Array.isArray(out[k])
    ) {
      out[k] = mergeDefaults(out[k], v)
    } else if (v !== undefined) {
      out[k] = v
    }
  }
  return out
}

/**
 * @param {string} filePath
 * @param {unknown} fallback
 */
export function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return structuredClone(fallback)
    const text = fs.readFileSync(filePath, 'utf8')
    return mergeDefaults(fallback, JSON.parse(text))
  } catch {
    return structuredClone(fallback)
  }
}

/**
 * @param {string} filePath
 * @param {unknown} data
 */
export function writeJsonAtomic(filePath, data) {
  ensureDir(path.dirname(filePath))
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  try {
    fs.renameSync(tmp, filePath)
  } catch (err) {
    // Windows cannot rename over an existing file — replace explicitly
    if (err?.code === 'EEXIST' || err?.code === 'EPERM' || process.platform === 'win32') {
      try {
        fs.unlinkSync(filePath)
      } catch {
        /* first write */
      }
      try {
        fs.renameSync(tmp, filePath)
        return
      } catch {
        /* fall through to copy */
      }
      fs.copyFileSync(tmp, filePath)
      try {
        fs.unlinkSync(tmp)
      } catch {
        /* ignore */
      }
      return
    }
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* ignore */
    }
    throw err
  }
}

export class StateStore {
  /**
   * @param {string} root
   */
  constructor(root) {
    this.root = ensureDir(root)
    /** @type {Map<string, { timer: NodeJS.Timeout, data: unknown }>} */
    this._pending = new Map()
  }

  path(name) {
    // basename only — never allow stateDir traversal via crafted keys
    return path.join(this.root, path.basename(String(name)))
  }

  get(name, fallback) {
    return readJson(this.path(name), fallback)
  }

  set(name, data) {
    const p = this._pending.get(name)
    if (p) {
      clearTimeout(p.timer)
      this._pending.delete(name)
    }
    writeJsonAtomic(this.path(name), data)
  }

  /**
   * Debounced write — flush() must persist pending payloads (bugfix).
   */
  setDebounced(name, data, ms = 3000) {
    const prev = this._pending.get(name)
    if (prev) clearTimeout(prev.timer)
    const timer = setTimeout(() => {
      this._pending.delete(name)
      writeJsonAtomic(this.path(name), data)
    }, ms)
    this._pending.set(name, { timer, data })
  }

  flush() {
    for (const [name, { timer, data }] of this._pending) {
      clearTimeout(timer)
      writeJsonAtomic(this.path(name), data)
      this._pending.delete(name)
    }
  }
}
