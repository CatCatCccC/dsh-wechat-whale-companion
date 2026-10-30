/**
 * WeChat inbound images arrive as path pointers
 * (`[收到图片] 文件已保存到: …`), not `{type:'image'}` blocks.
 * Helpers: parse paths, allowlist, rewrite messages to native image parts
 * (DeepSeek-flash via DSH attachments) with optional describe fallback.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const DEFAULT_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
const DEFAULT_MODEL = 'glm-4v-flash'
const DEFAULT_FALLBACKS = ['glm-4.6v-flash', 'glm-4.1v-thinking-flash', 'glm-4v-flash']
const DEFAULT_RETRIES = 2
const DEFAULT_ATTEMPT_TIMEOUT_MS = 30000
const DEFAULT_BUDGET_MS = 75000
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024
const MAX_OUTPUT_TOKENS = 1024
const RETRY_BACKOFF_BASE_MS = 1000
const RETRY_BACKOFF_MAX_MS = 8000
const CACHE_MAX = 40

const ENV_KEY_NAMES = [
  'ZHIPU_API_KEY',
  'ZHIPUAI_API_KEY',
  'VISION_API_KEY',
  'DASHSCOPE_API_KEY',
]

/** Match dsh-wechat path / @-mention image notices. */
export const WECHAT_IMAGE_NOTICE_RE =
  /\[收到图片\]\s*(?:文件已保存到:\s*)?@?"?([^\s"\]]+?\.(?:png|jpe?g|gif|webp))"?/gi

export const SAVED_PATH_RE =
  /文件已保存到:\s*@?"?([^\s"\]]+?\.(?:png|jpe?g|gif|webp))"?/gi

class ApiHttpError extends Error {
  /**
   * @param {number} status
   * @param {string} body
   */
  constructor(status, body) {
    super(`vision API HTTP ${status}: ${String(body || '').slice(0, 300)}`)
    this.name = 'ApiHttpError'
    this.status = status
  }
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function extractImagePaths(text) {
  if (typeof text !== 'string' || !text) return []
  const found = []
  const push = (p) => {
    const clean = String(p || '').trim().replace(/^@"?|"$/g, '')
    if (!clean) return
    if (!found.includes(clean)) found.push(clean)
  }
  for (const re of [WECHAT_IMAGE_NOTICE_RE, SAVED_PATH_RE]) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) push(m[1])
  }
  return found
}

/**
 * @param {Buffer} buf
 * @returns {'image/png'|'image/jpeg'|'image/gif'|'image/webp'}
 */
export function sniffMediaType(buf) {
  if (!buf || buf.length < 12) return 'image/jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png'
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif'
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'image/webp'
  }
  return 'image/jpeg'
}

/**
 * @param {string} filePath
 * @param {string[]} allowedRoots
 */
export function isPathAllowed(filePath, allowedRoots) {
  let resolved
  try {
    resolved = fs.realpathSync(filePath)
  } catch {
    resolved = path.resolve(filePath)
  }
  return (allowedRoots || []).some((root) => {
    let base
    try {
      base = fs.realpathSync(root)
    } catch {
      base = path.resolve(root)
    }
    const rel = path.relative(base, resolved)
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
  })
}

/**
 * @param {string} [storageDir]
 */
export function defaultTempRoots(storageDir) {
  const roots = []
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  roots.push(path.join(os.homedir(), '.dsh-wechat', 'tempfile'))
  roots.push(path.join(home, '..', '.dsh-wechat', 'tempfile'))
  roots.push('/root/.dsh-wechat/tempfile')
  if (storageDir) {
    roots.push(path.join(path.resolve(storageDir), 'tempfile'))
  }
  return [...new Set(roots.map((r) => path.resolve(r)))]
}

function credentialsFilePath() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, '.credentials.yaml')
}

/**
 * @param {string} text
 */
export function parseCredentialsYaml(text) {
  /** @type {Map<string, string>} */
  const result = new Map()
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line)
    if (!match) continue
    let value = match[2]
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    result.set(match[1], value)
  }
  return result
}

/**
 * @param {any} [ctx]
 * @returns {Promise<string|undefined>}
 */
export async function resolveVisionApiKey(ctx) {
  for (const name of ENV_KEY_NAMES) {
    const v = process.env[name]
    if (v && String(v).length > 0) return String(v)
  }

  const credentials = ctx?.get?.('credentials')
  if (credentials && typeof credentials.resolve === 'function') {
    for (const name of ENV_KEY_NAMES) {
      try {
        const resolved = await credentials.resolve(name)
        if (resolved?.value) return String(resolved.value)
      } catch {
        /* try next */
      }
    }
  }

  try {
    const file = credentialsFilePath()
    if (fs.existsSync(file)) {
      const parsed = parseCredentialsYaml(fs.readFileSync(file, 'utf8'))
      for (const name of ENV_KEY_NAMES) {
        const value = parsed.get(name)
        if (value) return value
      }
    }
  } catch {
    /* ignore */
  }
  return undefined
}

function buildPrompt() {
  return (
    '请按以下四点描述这张图片（给微信聊天里的陪伴角色用，口语可读）：' +
    '1) 逐字转写图中全部可见文字（原文照抄，不要概括或翻译）；' +
    '2) 画面主体与场景；' +
    '3) 视觉元素（颜色、构图、人物/物体表情动作）；' +
    '4) 其他关键细节。完整优先于简洁。'
  )
}

function stripThink(text) {
  const closed = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '')
  if (closed !== text) return closed.trim()
  if (/^\s*<think>/.test(String(text || ''))) return ''
  return String(text || '').trim()
}

/**
 * @param {string} description
 */
export function formatDescription(description) {
  return (
    '[图片描述] 以下由视觉模型根据主人发来的微信图片识别，请当真看见了来聊（勿提路径/工具）：\n\n' +
    String(description || '').trim()
  )
}

/**
 * @param {string} reason
 */
export function formatFailure(reason) {
  return (
    `[图片识别失败] 主人发了图，但没能交给识图通道（${reason}）。` +
    '请老实说这会儿看不清，让主人打字说，或稍后再发；禁止编造图里内容。'
  )
}

/**
 * Strip every WeChat image path notice and attach one replacement block.
 * @param {string} text
 * @param {string} replacement
 */
export function replaceImageNotices(text, replacement) {
  if (typeof text !== 'string' || !text) return text
  if (!extractImagePaths(text).length) return text
  let out = text
  out = out.replace(WECHAT_IMAGE_NOTICE_RE, '')
  out = out.replace(SAVED_PATH_RE, '')
  out = out.replace(/\n{3,}/g, '\n\n').trim()
  return out ? `${out}\n${replacement}` : replacement
}

/**
 * Remove image path notices; keep remaining caption text.
 * @param {string} text
 */
export function stripImageNotices(text) {
  if (typeof text !== 'string' || !text) return ''
  let out = text
  out = out.replace(WECHAT_IMAGE_NOTICE_RE, '')
  out = out.replace(SAVED_PATH_RE, '')
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * @param {any} message
 * @param {(text: string) => string} mapText
 */
export function mapMessageText(message, mapText) {
  if (!message || typeof message !== 'object') return message
  const content = message.content
  if (typeof content === 'string') {
    return { ...message, content: mapText(content) }
  }
  if (!Array.isArray(content)) return message
  const next = content.map((block) => {
    if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      return { ...block, text: mapText(block.text) }
    }
    if (typeof block === 'string') return mapText(block)
    return block
  })
  return { ...message, content: next }
}

/**
 * Collect paths from a DSH message content.
 * @param {any} message
 */
export function pathsFromMessage(message) {
  const content = message?.content
  if (typeof content === 'string') return extractImagePaths(content)
  if (!Array.isArray(content)) return []
  /** @type {string[]} */
  const all = []
  for (const block of content) {
    const text =
      typeof block === 'string'
        ? block
        : block?.type === 'text' && typeof block.text === 'string'
          ? block.text
          : ''
    for (const p of extractImagePaths(text)) {
      if (!all.includes(p)) all.push(p)
    }
  }
  return all
}

/**
 * Rewrite a user message: strip WeChat path notices and append native
 * `{type:'image', attachment}` parts (and/or a text fallback).
 * @param {any} message
 * @param {{ attachments?: object[], fallbackText?: string }} opts
 */
export function rewriteMessageWithNativeImages(message, opts = {}) {
  const attachments = opts.attachments || []
  const fallbackText = opts.fallbackText || ''
  if (!attachments.length && !fallbackText) return message

  /** @type {any[]} */
  const parts = []
  const pushText = (t) => {
    const s = String(t || '').trim()
    if (s) parts.push({ type: 'text', text: s })
  }

  const content = message?.content
  if (typeof content === 'string') {
    pushText(stripImageNotices(content))
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === 'string') {
        pushText(stripImageNotices(block))
        continue
      }
      if (block?.type === 'text' && typeof block.text === 'string') {
        pushText(stripImageNotices(block.text))
        continue
      }
      if (block?.type === 'image' || block?.type === 'file') {
        parts.push(block)
      }
    }
  }

  for (const attachment of attachments) {
    parts.push({ type: 'image', attachment })
  }
  if (fallbackText) pushText(fallbackText)
  if (!parts.length) pushText(fallbackText || '[空消息]')

  return { ...message, content: parts }
}

async function sleep(ms, signal) {
  if (ms <= 0) return
  await new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    }
    if (signal) {
      if (signal.aborted) return onAbort()
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

/**
 * @param {object} opts
 */
async function callVisionOnce(opts) {
  const {
    apiKey,
    model,
    prompt,
    mediaType,
    base64,
    signal,
    timeoutMs,
    baseURL,
    fetchImpl = fetch,
  } = opts
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(baseURL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: { url: `data:${mediaType};base64,${base64}` },
              },
            ],
          },
        ],
      }),
    })
    const body = await res.text()
    if (!res.ok) throw new ApiHttpError(res.status, body)
    let json
    try {
      json = JSON.parse(body)
    } catch {
      throw new Error('vision API returned non-JSON')
    }
    const content = json?.choices?.[0]?.message?.content
    let text = ''
    if (typeof content === 'string') text = content
    else if (Array.isArray(content)) {
      text = content
        .map((p) => (typeof p === 'string' ? p : p?.text || ''))
        .join('')
    }
    text = stripThink(text)
    if (!text) throw new Error('vision API empty content')
    return text
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener?.('abort', onAbort)
  }
}

/**
 * Optional Zhipu-style describe fallback (only when native attach unavailable).
 * @param {object} opts
 */
export async function describeLocalImage(opts) {
  const {
    filePath,
    apiKey,
    models = [DEFAULT_MODEL, ...DEFAULT_FALLBACKS],
    baseURL = DEFAULT_API_URL,
    maxBytes = DEFAULT_MAX_BYTES,
    retries = DEFAULT_RETRIES,
    attemptTimeoutMs = DEFAULT_ATTEMPT_TIMEOUT_MS,
    budgetMs = DEFAULT_BUDGET_MS,
    signal,
    fetchImpl = fetch,
    log,
  } = opts

  const st = fs.statSync(filePath)
  if (!st.isFile()) throw new Error('not a file')
  if (st.size > maxBytes) {
    throw new Error(`图片过大（${(st.size / 1024 / 1024).toFixed(1)} MB）`)
  }
  const buf = fs.readFileSync(filePath)
  const mediaType = sniffMediaType(buf)
  const base64 = buf.toString('base64')
  const prompt = buildPrompt()
  const deadline = Date.now() + budgetMs
  let lastError

  for (const model of models) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (Date.now() >= deadline) {
        throw lastError || new Error(`视觉识别超时（>${budgetMs}ms）`)
      }
      try {
        return await callVisionOnce({
          apiKey,
          model,
          prompt,
          mediaType,
          base64,
          signal,
          timeoutMs: attemptTimeoutMs,
          baseURL,
          fetchImpl,
        })
      } catch (error) {
        lastError = error
        if (error instanceof Error && error.name === 'AbortError') throw error
        const retriable =
          error instanceof ApiHttpError && (error.status === 429 || error.status === 503)
        if (retriable && attempt < retries) {
          const delay = Math.min(RETRY_BACKOFF_BASE_MS * 2 ** attempt, RETRY_BACKOFF_MAX_MS)
          log?.warn?.(`[whale-vision] ${model} ${error.status}, retry in ${delay}ms`)
          await sleep(delay, signal)
          continue
        }
        if (
          error instanceof ApiHttpError &&
          (error.status === 404 ||
            error.status === 429 ||
            error.status === 503 ||
            error.status >= 500)
        ) {
          log?.warn?.(`[whale-vision] ${model} unavailable (${error.status}), next model`)
          break
        }
        throw error
      }
    }
  }
  throw lastError || new Error('vision API unavailable')
}

export function createVisionCache() {
  /** @type {Map<string, string>} */
  const cache = new Map()
  return {
    get(key) {
      return cache.get(key)
    },
    set(key, value) {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value)
      cache.set(key, value)
    },
    get size() {
      return cache.size
    },
  }
}

export const VISION_DEFAULTS = {
  model: DEFAULT_MODEL,
  fallbacks: DEFAULT_FALLBACKS,
  retries: DEFAULT_RETRIES,
  attemptTimeoutMs: DEFAULT_ATTEMPT_TIMEOUT_MS,
  budgetMs: DEFAULT_BUDGET_MS,
  maxImageBytes: DEFAULT_MAX_BYTES,
  baseURL: DEFAULT_API_URL,
}
