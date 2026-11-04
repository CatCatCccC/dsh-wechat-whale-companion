/**
 * Patch dsh-wechat Bridge.sendReply so persona `||` / wx-next become real
 * multi-bubble WeChat sends. Silent mode buffers the raw string, then
 * turn/end → pushOutput → sendReply; splitting here is the reliable choke point.
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
function installSplitHook(Proto, delayRange) {
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
  Proto.__whaleBubbleSplitPatched = true
  return true
}

/**
 * Read installed dsh-wechat version next to bridge.js; compare to peer floor.
 * @param {string} bridgePath
 * @param {{ log?: { warn?: Function }, peerFloor?: string }} [opts]
 */
export function readPeerWechatVersion(bridgePath, opts = {}) {
  const floor = opts.peerFloor || '0.13.0'
  try {
    const pkgPath = path.join(path.dirname(bridgePath), '..', '..', 'package.json')
    // bridge at dist/bridge/bridge.js → package.json two levels up from bridge dir = dist's parent
    const alt = path.join(path.dirname(bridgePath), '..', '..', 'package.json')
    const candidates = [
      path.resolve(path.dirname(bridgePath), '../../package.json'),
      alt,
    ]
    let ver = ''
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'))
        if (j?.name === 'dsh-wechat' && typeof j.version === 'string') {
          ver = j.version
          break
        }
      }
    }
    if (!ver) return { peerVersion: '', peerOk: true, peerFloor: floor }
    const peerOk = compareSemverFloor(ver, floor)
    if (!peerOk) {
      opts.log?.warn?.(
        `[whale-companion] dsh-wechat ${ver} < peer floor ${floor}; || split may break`,
      )
    }
    return { peerVersion: ver, peerOk, peerFloor: floor }
  } catch {
    return { peerVersion: '', peerOk: true, peerFloor: floor }
  }
}

/** @param {string} ver @param {string} floor */
function compareSemverFloor(ver, floor) {
  const parse = (s) =>
    String(s)
      .replace(/^v/, '')
      .split('.')
      .map((x) => parseInt(x, 10) || 0)
  const a = parse(ver)
  const b = parse(floor)
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true
    if ((a[i] || 0) < (b[i] || 0)) return false
  }
  return true
}

/**
 * @param {{ delayRange?: [number, number], log?: { info?: Function, warn?: Function }, bridgePath?: string }} [opts]
 * @returns {Promise<{ ok: boolean, reason?: string, path?: string, peerVersion?: string, peerOk?: boolean }>}
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
  const peer = readPeerWechatVersion(hit, { log: opts.log })

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
    if (installSplitHook(Proto, delayRange)) {
      patched++
      const msg = `[whale-companion] patched dsh-wechat sendReply for || split (${p})`
      opts.log?.info?.(msg)
      console.log(msg)
    } else {
      patched++
    }
  }
  return {
    ok: patched > 0,
    path: targets.map((t) => t.path).join(' | '),
    peerVersion: peer.peerVersion,
    peerOk: peer.peerOk,
  }
}

/**
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
