/**
 * Inject time= and gap= into user message wrappers when possible.
 */

/**
 * @param {number} ms
 */
export function formatGap(ms) {
  if (!Number.isFinite(ms) || ms < 0) return ''
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  if (m < 60) return rs ? `${m}m${rs}s` : `${m}m`
  const h = Math.floor(m / 60)
  const rm = m % 60
  if (h < 48) return rm ? `${h}h${rm}m` : `${h}h`
  const d = Math.floor(h / 24)
  const rh = h % 24
  return rh ? `${d}d${rh}h` : `${d}d`
}

export function formatLocalIso(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const oh = pad(Math.floor(Math.abs(off) / 60))
  const om = pad(Math.abs(off) % 60)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`
}

/**
 * @param {string} content
 * @param {{ time?: string, gap?: string }} attrs
 */
export function injectUserBoundary(content, attrs) {
  const time = (attrs.time || '').replace(/[^0-9T:+-]/g, '')
  const gap = (attrs.gap || '').replace(/[^0-9dhms]/g, '')
  if (/<user_message\b/i.test(content)) {
    return content.replace(/<user_message([^>]*)>/i, (_, rest) => {
      let r = String(rest).replace(/\s(time|gap)="[^"]*"/gi, '')
      if (time) r += ` time="${time}"`
      if (gap) r += ` gap="${gap}"`
      return `<user_message${r}>`
    })
  }
  // Prefix note if no boundary tag exists
  const bits = []
  if (time) bits.push(`time=${time}`)
  if (gap) bits.push(`gap=${gap}`)
  if (!bits.length) return content
  return `[${bits.join(' ')}]\n${content}`
}

/**
 * @param {any} ctx
 * @param {object} runtime
 */
export function applyStamp(ctx, runtime) {
  if (!runtime.config.modules.stamp?.enabled) return () => {}

  const store = runtime.store
  /** @type {Record<string, number>} */
  let baseline = store.get('stamp-state.json', {})
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) baseline = {}

  const api = {
    noteInbound(peer, at = Date.now()) {
      const prev = baseline[peer]
      const gap = prev != null ? formatGap(at - prev) : ''
      const time = formatLocalIso(new Date(at))
      baseline[peer] = at
      // cap keys
      const keys = Object.keys(baseline)
      if (keys.length > 500) {
        keys
          .sort((a, b) => baseline[a] - baseline[b])
          .slice(0, keys.length - 500)
          .forEach((k) => delete baseline[k])
      }
      store.setDebounced('stamp-state.json', baseline)
      return { time, gap }
    },
    wrap(content, peer, at = Date.now()) {
      const { time, gap } = api.noteInbound(peer, at)
      return injectUserBoundary(content, { time, gap })
    },
  }

  runtime.stamp = api
  return () => {}
}
