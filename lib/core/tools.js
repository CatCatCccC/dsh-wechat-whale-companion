/**
 * DSH tool registration adapter.
 *
 * DSH's `tools.register()` takes ONE definition object:
 * `{ name, description, parameters, output: { schema, render }, execute }`.
 * Older/alternate hosts exposed `register(name, schema, handler)`; keep that
 * fallback so the plugin still works there.
 *
 * Must wait for the `tools` service (inject + short poll). A one-shot
 * `ctx.get('tools')` during `apply()` often returns undefined on DSH 0.2.x —
 * registration then no-ops and the model invents「发图工具没挂着」.
 */

/**
 * @param {any} ctx
 * @returns {any}
 */
export function getTools(ctx) {
  try {
    return ctx?.get?.('tools')
  } catch {
    return undefined
  }
}

/**
 * @param {any} tools
 * @param {object} definition
 * @param {string} name
 * @param {object} schema
 * @param {Function} handler
 */
function bindTool(tools, definition, name, schema, handler) {
  // DSH: register(definition); legacy: register(name, schema, handler).
  if (typeof tools.register === 'function' && tools.register.length >= 2) {
    try {
      return tools.register(name, schema, handler)
    } catch {
      /* fall through to the definition shape */
    }
  }
  return tools.register(definition)
}

/**
 * @param {any} ctx
 * @param {string} name
 * @param {{ description?: string, parameters?: object, output?: object }} schema
 * @param {(args: any, exec?: any) => any} handler
 * @param {{ onRegistered?: (name: string) => void }} [opts]
 * @returns {() => void} disposer
 */
export function registerTool(ctx, name, schema, handler, opts = {}) {
  const sideDisposers = []
  let disposed = false
  let off = null

  const definition = {
    name,
    description: schema.description || name,
    parameters: schema.parameters || { type: 'object', properties: {} },
    output: schema.output || {
      // Plain object root: DSH's output schema must be object-rooted.
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [
        { type: 'text', text: JSON.stringify(value ?? { ok: true }) },
      ],
    },
    async execute(args, exec) {
      const value = await handler(args, exec)
      // A tool result must be JSON-serializable; `undefined` becomes `{}`.
      return value === undefined ? { ok: true } : value
    },
  }

  const tryRegister = (serviceCtx = ctx) => {
    if (disposed || off) return Boolean(off)
    const tools = getTools(serviceCtx) || getTools(ctx)
    if (!tools || typeof tools.register !== 'function') return false
    try {
      const dispose = bindTool(tools, definition, name, schema, handler)
      off = typeof dispose === 'function' ? dispose : () => {}
      try {
        opts.onRegistered?.(name)
      } catch {
        /* ignore */
      }
      return true
    } catch {
      return false
    }
  }

  if (!tryRegister(ctx)) {
    if (typeof ctx.inject === 'function') {
      try {
        const inj = ctx.inject(['tools'], (toolsCtx) => {
          tryRegister(toolsCtx)
        })
        if (typeof inj === 'function') sideDisposers.push(inj)
      } catch {
        /* optional */
      }
    }
    const timer = setInterval(() => {
      if (tryRegister(ctx)) clearInterval(timer)
    }, 1000)
    timer.unref?.()
    sideDisposers.push(() => clearInterval(timer))
  }

  return () => {
    disposed = true
    for (const d of sideDisposers) {
      try {
        typeof d === 'function' && d()
      } catch {
        /* ignore */
      }
    }
    try {
      off?.()
    } catch {
      /* ignore */
    }
  }
}
