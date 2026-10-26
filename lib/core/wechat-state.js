/**
 * Read dsh-wechat's durable session binding without modifying it.
 *
 * dsh-wechat stores the WeChat user → DSH session mapping in
 * `~/.dsh-wechat/state.json` (`users[*].sessionId`). The companion uses that
 * mapping as the authoritative "this session came from WeChat" signal, so its
 * global system-prompt context and proactive persona do not leak into GUI or
 * coding sessions in the same profile.
 *
 * The file is optional: when dsh-wechat is absent the index is simply empty,
 * and the plugin stays inert (tools still register, prompt context returns '').
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function defaultWechatStorageDir(override = '') {
  if (override) return override
  return path.join(os.homedir(), '.dsh-wechat')
}

export class WechatSessionIndex {
  /**
   * @param {string} [dir]
   */
  constructor(dir = '') {
    this.dir = defaultWechatStorageDir(dir)
    this.file = path.join(this.dir, 'state.json')
    /** @type {Map<string, { userId: string, cwd?: string }>} */
    this.sessions = new Map()
    /** @type {string} */
    this.primaryUserId = ''
    this.mtimeMs = -1
  }

  /** Re-read only when dsh-wechat rewrites the file. */
  refresh() {
    let st
    try {
      st = fs.statSync(this.file)
    } catch {
      // Missing file: clear a previously loaded binding, but keep the last
      // mtime so repeated stat failures stay cheap.
      if (this.sessions.size) {
        this.sessions = new Map()
        this.primaryUserId = ''
      }
      this.mtimeMs = -1
      return
    }
    if (st.mtimeMs === this.mtimeMs) return

    let raw
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
    } catch {
      // A concurrent dsh-wechat save can be observed mid-rename; retry next time.
      return
    }

    const users = raw?.users
    const next = new Map()
    let primary = ''
    if (users && typeof users === 'object' && !Array.isArray(users)) {
      for (const user of Object.values(users)) {
        if (!user || typeof user !== 'object') continue
        const sessionId = typeof user.sessionId === 'string' ? user.sessionId.trim() : ''
        const userId = typeof user.userId === 'string' ? user.userId.trim() : ''
        if (!sessionId) continue
        next.set(sessionId, { userId, cwd: typeof user.cwd === 'string' ? user.cwd : undefined })
        if (!primary && userId) primary = userId
      }
    }
    this.sessions = next
    this.primaryUserId = primary
    this.mtimeMs = st.mtimeMs
  }

  /**
   * @param {string} sessionId
   */
  has(sessionId) {
    if (!sessionId) return false
    this.refresh()
    return this.sessions.has(String(sessionId))
  }

  /**
   * @param {string} sessionId
   */
  userIdForSession(sessionId) {
    this.refresh()
    return this.sessions.get(String(sessionId || ''))?.userId || ''
  }

  /** The single bound WeChat peer (dsh-wechat is single-user in practice). */
  ownerUserId() {
    this.refresh()
    return this.primaryUserId
  }

  list() {
    this.refresh()
    return [...this.sessions.entries()].map(([sessionId, value]) => ({ sessionId, ...value }))
  }
}
