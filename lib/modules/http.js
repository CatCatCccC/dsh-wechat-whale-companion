/**
 * Status /physical endpoint.
 * Default bind 127.0.0.1; in Docker listen 0.0.0.0 so host `-p 127.0.0.1:3199:3199` works.
 */
import fs from 'node:fs'
import http from 'node:http'

function defaultBindHost(override) {
  if (typeof override === 'string' && override) return override
  try {
    if (fs.existsSync('/.dockerenv')) return '0.0.0.0'
  } catch {
    /* ignore */
  }
  return '127.0.0.1'
}

/**
 * @param {any} ctx
 * @param {object} runtime
 */
export function applyHttp(ctx, runtime) {
  const mod = runtime.config.modules.http
  if (!mod?.enabled) return () => {}

  const port = Number(mod.port) || 3199
  const host = defaultBindHost(mod.host)

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/health' || url.pathname === '/physical') {
      const bindings = runtime.wechatSessions?.list?.() || []
      const body = {
        ok: true,
        plugin: 'dsh-wechat-whale-companion',
        wechat: {
          present: runtime.wechat?.present,
          capabilities: runtime.wechat?.capabilities,
          notes: runtime.wechat?.notes,
        },
        // Empty bindings => persona never injects (looks like a generic assistant)
        wechatSessions: {
          file: runtime.wechatSessions?.file || '',
          count: bindings.length,
          bindings,
        },
        prompt: {
          scope: runtime.config.modules.prompt?.scope || 'wechat',
          injected: runtime.stats?.promptInjected || 0,
          skipped: runtime.stats?.promptSkipped || 0,
          lastSessionId: runtime.stats?.lastPromptSessionId || '',
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

  server.listen(port, host, () => {
    runtime.log?.info?.(
      `[whale-companion] status http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/physical (bind ${host})`,
    )
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
