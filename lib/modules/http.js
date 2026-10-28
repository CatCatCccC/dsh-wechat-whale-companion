/**
 * Status /physical endpoint with health diagnostics.
 */
import fs from 'node:fs'
import http from 'node:http'
import { readWechatConfig } from '../core/wechat-config.js'

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
 * @param {object} runtime
 */
export function buildHealth(runtime) {
  const checks = []
  const advice = []
  const outbound = runtime.config.modules.outbound || {}
  // silent = "final only" in dsh-wechat — still pushes. deliverAssistant re-push = doubles.
  const deliver = outbound.enabled !== false && outbound.deliverAssistant === true
  const silent = Boolean(
    runtime.wechatSilent ?? readWechatConfig(runtime.config.wechatStorageDir).silent,
  )
  const bindings = runtime.wechatSessions?.list?.() || []
  const stickers = runtime.media?.listStickers?.() || []

  const push = (id, ok, detail) => {
    checks.push({ id, ok, detail })
  }

  push('prompt.registered', Boolean(runtime.prompt?.registered), runtime.prompt?.source || '')
  push('wechat.present', Boolean(runtime.wechat?.present), runtime.wechat?.notes || '')
  push('wechatSessions', bindings.length > 0, `count=${bindings.length}`)
  push('outbound.noDouble', !deliver, deliver ? 'deliverAssistant=on (会与 dsh-wechat 双发)' : 'deliverAssistant=off')

  if (deliver) {
    advice.push(
      'deliverAssistant=true 会与 dsh-wechat 各发一条（silent 只表示「只发最终回复」仍会推送）。请改 false 并重启插件',
    )
  }
  void silent
  if (!runtime.prompt?.registered) {
    advice.push('人设未注册：确认插件在 bundles 里并已重启')
  }
  if (!bindings.length) {
    advice.push('无微信会话绑定：先扫码并用微信发一条')
  }
  if ((runtime.stats?.promptInjected || 0) === 0 && bindings.length) {
    advice.push('prompt.injected=0：对新微信会话发 /session new 后再聊一句')
  }
  if (runtime.stats?.proactiveFailReason === 'context_token') {
    advice.push('主动发言失败(context_token)：主人先发一句续期')
  }
  if (!stickers.length) {
    advice.push('暂无贴纸：可用 wx_sticker 关键词自动搜表情包并缓存，或放图到 assets/stickers')
  }
  if (runtime.stats?.stickerSearchFail > 0 && !(runtime.stats?.stickerCached > 0)) {
    advice.push('表情搜索曾失败：检查服务器能否访问 api.ruseo.cn / cn.apihz.cn')
  }

  const bad = checks.some(
    (c) => !c.ok && (c.id === 'outbound.noDouble' || c.id === 'prompt.registered'),
  )
  const warn = checks.some((c) => !c.ok) || advice.length > 0
  const level = bad ? 'bad' : warn ? 'warn' : 'ok'

  return { level, checks, advice }
}

/**
 * @param {any} ctx
 * @param {object} runtime
 */
export function applyHttp(_ctx, runtime) {
  const mod = runtime.config.modules.http
  if (!mod?.enabled) return () => {}

  const port = Number(mod.port) || 3199
  const host = defaultBindHost(mod.host)
  const token = typeof mod.token === 'string' ? mod.token.trim() : ''

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/health' || url.pathname === '/physical') {
      if (token && url.searchParams.get('token') !== token) {
        res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: 'unauthorized' }))
        return
      }

      runtime.wechatSilent = readWechatConfig(runtime.config.wechatStorageDir).silent
      const bindings = runtime.wechatSessions?.list?.() || []
      const stickers = runtime.media?.listStickers?.() || []
      const outbound = runtime.config.modules.outbound || {}
      const body = {
        ok: true,
        plugin: 'dsh-wechat-whale-companion',
        health: buildHealth(runtime),
        wechat: {
          present: runtime.wechat?.present,
          capabilities: runtime.wechat?.capabilities,
          notes: runtime.wechat?.notes,
          silent: runtime.wechatSilent,
        },
        wechatSessions: {
          file: runtime.wechatSessions?.file || '',
          count: bindings.length,
          bindings,
        },
        outbound: {
          deliverAssistant: outbound.enabled !== false && outbound.deliverAssistant === true,
          ensureWechatSilent: outbound.ensureWechatSilent !== false,
          note: 'deliverAssistant=true doubles with dsh-wechat; keep false',
        },
        prompt: {
          scope: runtime.config.modules.prompt?.scope || 'wechat',
          registered: Boolean(runtime.prompt?.registered),
          source: runtime.prompt?.source || '',
          injected: runtime.stats?.promptInjected || 0,
          skipped: runtime.stats?.promptSkipped || 0,
          lastSessionId: runtime.stats?.lastPromptSessionId || '',
        },
        proactive: {
          sent: runtime.stats?.proactiveSent || 0,
          sticker: runtime.stats?.proactiveSticker || 0,
          lastIntent: runtime.stats?.proactiveIntent || '',
          lastSkip: runtime.stats?.proactiveLastSkip || '',
          failReason: runtime.stats?.proactiveFailReason || '',
          timeZone: runtime.config.modules.persona?.timeZone || 'Asia/Shanghai',
        },
        stickers: {
          count: stickers.length,
          names: stickers.slice(0, 20),
          search: runtime.config.modules.media?.search !== false,
          searchFail: runtime.stats?.stickerSearchFail || 0,
          cachedNew: runtime.stats?.stickerCached || 0,
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
