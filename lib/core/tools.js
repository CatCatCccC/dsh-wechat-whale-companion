/**
 * DSH tool registration adapter.
 *
 * DSH's `tools.register()` takes ONE definition object:
 * `{ name, description, parameters, output: { schema, render }, execute }`.
 * Older/alternate hosts exposed `register(name, schema, handler)`; keep that
 * fallback so the plugin still works there.
 *
 * The previous `register(name, schema, handler)` call silently failed on DSH
 * 0.2.x because every `wx_*` tool lacked the required `output` field.
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
 * @param {any} ctx
 * @param {string} name
 * @param {{ description?: string, parameters?: object, output?: object }} schema
 * @param {(args: any, exec?: any) => any} handler
 */
export function registerTool(ctx, name, schema, handler) {
  const tools = getTools(ctx)
  if (!tools || typeof tools.register !== 'function') return () => {}

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

  // DSH: register(definition); legacy: register(name, schema, handler).
  if (tools.register.length >= 2) {
    try {
      return tools.register(name, schema, handler)
    } catch {
      /* fall through to the definition shape */
    }
  }
  try {
    return tools.register(definition)
  } catch {
    return () => {}
  }
}
