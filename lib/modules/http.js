/**
 * Loopback status / physical endpoint (127.0.0.1 only).
 */
import http from 'node:http'

/**
 * @param {any} ctx
 * @param {object} runtime
 */
export function applyHttp(ctx, runtime) {
  const mod = runtime.config.modules.http
  if (!mod?.enabled) return () => {}

  const port = Number(mod.port) || 3199

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/health' || url.pathname === '/physical') {
      const body = {
        ok: true,
        plugin: 'dsh-wechat-whale-companion',
        wechat: {
          present: runtime.wechat?.present,
          capabilities: runtime.wechat?.capabilities,
          notes: runtime.wechat?.notes,
        },
        owner: runtime.owner?.id || '',
        persona: runtime.persona?.snapshot?.() || null,
        lastword: runtime.lastword?.get?.() || null,
        tier: runtime.tier?.stage?.() || null,
        stats: runtime.stats,
        modules: Object.fromEntries(
          Object.entries(runtime.config.modules).map(([k, v]) => [k, Boolean(v?.enabled)]),
        ),
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(body, null, 2))
      return
    }
    res.writeHead(404)
    res.end('not found')
  })

  server.listen(port, '127.0.0.1', () => {
    runtime.log?.info?.(`[whale-companion] status http://127.0.0.1:${port}/physical`)
  })

  server.on('error', (err) => {
    runtime.log?.warn?.('[whale-companion] http listen failed', err?.message || err)
  })

  return () => {
    try {
      server.close()
    } catch {
      /* ignore */
    }
  }
}
