/**
 * Patch dsh-wechat so persona `||` / wx-next become real multi-bubble WeChat sends.
 *
 * Silent mode copies assistant text into `silentBuffers`, then `turn/end` →
 * `pushOutput` → `sendReply`. Blanking frozen session events never reaches that
 * buffer. We patch the live Bridge prototype (same module instance the host
 * loaded) and also clear+re-send when a split marker hits the silent buffer.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseDelayRange } from './config.js'
import { hasSplitMarkers, splitBubbles } from '../modules/guard.js'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function randBetween(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1))
}

/** @returns {string[]} */
export function bridgeModuleCandidates(opts = {}) {
  const out = []
  const push = (p) => {
    if (p && !out.includes(p)) out.push(p)
  }
  if (opts.explicit) push(path.resolve(String(opts.explicit)))

  // Same resolve graph the host used for bundle `dsh-wechat`.
  for (const base of [opts.cwd || process.cwd(), process.cwd()]) {
    try {
      const req = createRequire(path.join(base, 'package.json'))
      const main = req.resolve('dsh-wechat')
      push(path.join(path.dirname(main), 'bridge', 'bridge.js'))
    } catch {
      /* not installed here */
    }
  }

  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    push(path.resolve(here, '../../../dsh-wechat/dist/bridge/bridge.js'))
  } catch {
    /* ignore */
  }

  let dir = opts.cwd || process.cwd()
  for (let i = 0; i < 8; i++) {
    push(path.join(dir, 'node_modules/dsh-wechat/dist/bridge/bridge.js'))
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return out
}

/**
 * @param {object} Proto
 * @param {[number, number]} delayRange
 */
function installSplitHooks(Proto, delayRange) {
  if (Proto.__whaleBubbleSplitPatched) return false

  const originalSendReply = Proto.sendReply
  Proto.sendReply = async function whaleSplitSendReply(userId, text, sendOpts) {
    const raw = String(text ?? '')
    if (!hasSplitMarkers(raw)) {
      return originalSendReply.call(this, userId, text, sendOpts)
    }
    const parts = splitBubbles(raw)
    if (parts.length <= 1) {
      return originalSendReply.call(this, userId, parts[0] ?? raw, sendOpts)
    }
    for (let i = 0; i < parts.length; i++) {
      await originalSendReply.call(this, userId, parts[i], sendOpts)
      if (i < parts.length - 1) {
        await sleep(randBetween(delayRange[0], delayRange[1]))
      }
    }
  }

  if (typeof Proto.handleSessionEvent === 'function') {
    const originalHandle = Proto.handleSessionEvent
    Proto.handleSessionEvent = function whaleSplitHandleSessionEvent(sessionId, event) {
      const out = originalHandle.apply(this, arguments)
      try {
        if (event?.type !== 'assistant/message') return out
        if (typeof this.isSilent === 'function' && !this.isSilent()) return out
        const buf = this.silentBuffers?.get?.(sessionId)
        const raw = buf?.length ? String(buf[buf.length - 1] || '') : ''
        if (!raw || !hasSplitMarkers(raw)) return out
        const parts = splitBubbles(raw)
        if (parts.length <= 1) return out
        this.silentBuffers.delete(sessionId)
        const user = this.userForAgent?.(sessionId)
        if (!user?.userId) return out
        void (async () => {
          for (let i = 0; i < parts.length; i++) {
            // parts have no markers → original sendReply (or our wrapper) sends one each
            await this.sendReply(user.userId, parts[i])
            if (i < parts.length - 1) {
              await sleep(randBetween(delayRange[0], delayRange[1]))
            }
          }
        })().catch((err) => {
          console.warn(
            '[whale-companion] || silent-buffer split send failed',
            err?.message || err,
          )
        })
      } catch (err) {
        console.warn('[whale-companion] || silent-buffer hook error', err?.message || err)
      }
      return out
    }
  }

  Proto.__whaleBubbleSplitPatched = true
  return true
}

/**
 * @param {{ delayRange?: [number, number], log?: { info?: Function, warn?: Function }, bridgePath?: string }} [opts]
 * @returns {Promise<{ ok: boolean, reason?: string, path?: string }>}
 */
export async function patchWechatBubbleSplit(opts = {}) {
  const delayRange = opts.delayRange || parseDelayRange('600,1800')
  const candidates = bridgeModuleCandidates({ explicit: opts.bridgePath })
  const hit = candidates.find((p) => {
    try {
      return fs.existsSync(p)
    } catch {
      return false
    }
  })
  if (!hit) {
    opts.log?.warn?.('[whale-companion] dsh-wechat bridge.js not found; || split patch skipped')
    console.warn('[whale-companion] dsh-wechat bridge.js not found; || split patch skipped')
    return { ok: false, reason: 'bridge-missing' }
  }

  const paths = [hit]
  try {
    const real = fs.realpathSync(hit)
    if (real !== hit) paths.push(real)
  } catch {
    /* keep hit */
  }

  /** @type {{ path: string, Proto: object }[]} */
  const targets = []
  for (const p of paths) {
    try {
      const mod = await import(pathToFileURL(p).href)
      const Proto = mod?.WeChatDSHBridge?.prototype
      if (Proto && typeof Proto.sendReply === 'function') {
        targets.push({ path: p, Proto })
      }
    } catch (err) {
      opts.log?.warn?.(
        '[whale-companion] failed to import dsh-wechat bridge for || patch',
        p,
        err?.message || err,
      )
    }
  }
  if (!targets.length) {
    return { ok: false, reason: 'import-failed', path: hit }
  }

  let patched = 0
  for (const { path: p, Proto } of targets) {
    if (installSplitHooks(Proto, delayRange)) {
      patched++
      const msg = `[whale-companion] patched dsh-wechat Bridge for || split (${p})`
      opts.log?.info?.(msg)
      console.log(msg)
    } else {
      patched++
    }
  }
  return { ok: patched > 0, path: targets.map((t) => t.path).join(' | ') }
}

/**
 * Retry patch while plugins finish loading (companion may boot before dsh-wechat).
 * @param {{ delayRange?: [number, number], log?: object, delaysMs?: number[], onResult?: Function }} [opts]
 */
export function scheduleWechatBubbleSplitPatch(opts = {}) {
  const delays = opts.delaysMs || [0, 800, 2500, 6000]
  /** @type {ReturnType<typeof setTimeout>[]} */
  const timers = []
  let done = false
  const run = (ms) => {
    const t = setTimeout(() => {
      if (done) return
      void patchWechatBubbleSplit(opts).then((r) => {
        if (r?.ok) done = true
        opts.onResult?.(r)
      })
    }, ms)
    t.unref?.()
    timers.push(t)
  }
  for (const ms of delays) run(ms)
  return () => {
    done = true
    for (const t of timers) clearTimeout(t)
  }
}
