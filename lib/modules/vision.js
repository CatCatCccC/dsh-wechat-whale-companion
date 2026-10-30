/**
 * WeChat inbound vision: turn `[收到图片] 文件已保存到: path` into native
 * DSH `{type:'image', attachment}` blocks so deepseek-flash can see the
 * pixels directly (no extra Zhipu key).
 *
 * dsh-wechat 0.13+ only hands the model a path pointer; dsh-image-bridge
 * only handles GUI image blocks and would need a separate VLM key. This
 * module fills the WeChat gap via ctx.attachments.saveImage.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  VISION_DEFAULTS,
  createVisionCache,
  defaultTempRoots,
  describeLocalImage,
  formatDescription,
  formatFailure,
  isPathAllowed,
  mapMessageText,
  pathsFromMessage,
  replaceImageNotices,
  resolveVisionApiKey,
  rewriteMessageWithNativeImages,
  sniffMediaType,
} from '../core/vision-describe.js'

/**
 * @param {any} ctx
 * @param {object} runtime
 */
export function applyVision(ctx, runtime) {
  const mod = runtime.config.modules.vision
  if (!mod?.enabled) return () => {}

  const mode = String(mod.mode || 'native').toLowerCase() // native | describe
  const cache = createVisionCache()
  const allowedRoots = defaultTempRoots(runtime.config.wechatStorageDir)
  if (typeof mod.tempDir === 'string' && mod.tempDir.trim()) {
    allowedRoots.push(path.resolve(mod.tempDir.trim()))
  }

  const model = mod.model || process.env.IMAGE_BRIDGE_MODEL || VISION_DEFAULTS.model
  const envFallbacks = process.env.IMAGE_BRIDGE_FALLBACKS
  const fallbacks =
    Array.isArray(mod.fallbacks) && mod.fallbacks.length
      ? mod.fallbacks
      : envFallbacks
        ? envFallbacks
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : VISION_DEFAULTS.fallbacks
  const models = [model, ...fallbacks.filter((m) => m !== model)]
  const retries = Number(mod.retries ?? process.env.IMAGE_BRIDGE_RETRIES ?? VISION_DEFAULTS.retries)
  const attemptTimeoutMs = Number(mod.attemptTimeoutMs ?? VISION_DEFAULTS.attemptTimeoutMs)
  const budgetMs = Number(mod.budgetMs ?? VISION_DEFAULTS.budgetMs)
  const maxImageBytes = Number(
    mod.maxImageBytes ?? process.env.IMAGE_BRIDGE_MAX_IMAGE_BYTES ?? VISION_DEFAULTS.maxImageBytes,
  )
  const baseURL =
    mod.baseURL || process.env.IMAGE_BRIDGE_BASE_URL || VISION_DEFAULTS.baseURL

  runtime.vision = {
    enabled: true,
    mode,
    cacheSize: () => cache.size,
    allowedRoots: () => [...allowedRoots],
    hasKey: async () => Boolean(await resolveVisionApiKey(ctx)),
    stats: () => ({
      mode,
      attached: runtime.stats.visionAttached || 0,
      described: runtime.stats.visionDescribed || 0,
      failed: runtime.stats.visionFailed || 0,
      skipped: runtime.stats.visionSkipped || 0,
      lastReason: runtime.stats.visionLastReason || '',
      cache: cache.size,
    }),
  }

  if (typeof ctx.on !== 'function') {
    runtime.log?.warn?.('[whale-companion] vision: ctx.on missing; WeChat images stay path-only')
    return () => {}
  }

  const getAttachments = () => {
    try {
      return typeof ctx.get === 'function' ? ctx.get('attachments') : ctx.attachments
    } catch {
      return undefined
    }
  }

  /**
   * @param {string} filePath
   */
  const attachOne = async (filePath) => {
    const attachments = getAttachments()
    if (!attachments?.saveImage) {
      throw new Error('attachments.saveImage unavailable')
    }
    if (!isPathAllowed(filePath, allowedRoots)) {
      throw new Error(`路径不在 tempfile 白名单：${path.basename(filePath)}`)
    }
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在：${path.basename(filePath)}`)
    }
    const st = fs.statSync(filePath)
    if (!st.isFile()) throw new Error('not a file')
    if (st.size > maxImageBytes) {
      throw new Error(`图片过大（${(st.size / 1024 / 1024).toFixed(1)} MB）`)
    }
    const buf = fs.readFileSync(filePath)
    const mediaType = sniffMediaType(buf)
    const ref = await attachments.saveImage({
      data: new Uint8Array(buf),
      mediaType,
      name: path.basename(filePath),
    })
    return ref
  }

  /**
   * @param {string[]} paths
   * @param {any} signal
   */
  const describePaths = async (paths, signal) => {
    const apiKey = await resolveVisionApiKey(ctx)
    if (!apiKey) {
      throw new Error(
        '缺少视觉 API key（ZHIPU_API_KEY…）；native 模式也不具备 attachments',
      )
    }
    const descriptions = []
    for (const filePath of paths) {
      if (!isPathAllowed(filePath, allowedRoots)) {
        throw new Error(`路径不在 tempfile 白名单：${path.basename(filePath)}`)
      }
      if (!fs.existsSync(filePath)) {
        throw new Error(`文件不存在：${path.basename(filePath)}`)
      }
      let key
      try {
        const st = fs.statSync(filePath)
        key = `${filePath}|${st.size}|${st.mtimeMs}`
      } catch {
        key = filePath
      }
      const hit = cache.get(key)
      if (hit) {
        descriptions.push(hit)
        continue
      }
      const desc = await describeLocalImage({
        filePath,
        apiKey,
        models,
        baseURL,
        maxBytes: maxImageBytes,
        retries,
        attemptTimeoutMs,
        budgetMs,
        signal,
        log: runtime.log,
      })
      cache.set(key, desc)
      descriptions.push(desc)
      runtime.stats.visionDescribed = (runtime.stats.visionDescribed || 0) + 1
    }
    return formatDescription(descriptions.join('\n---\n'))
  }

  const off = ctx.on('agent/pre-step', async (payload, next) => {
    const decision = typeof next === 'function' ? await next() : payload
    if (!decision || decision.kind !== 'enter' || !Array.isArray(decision.messages)) {
      return decision
    }

    /** @type {number[]} */
    const targets = []
    for (let i = 0; i < decision.messages.length; i++) {
      const msg = decision.messages[i]
      const sourceKind = msg?.source?.kind
      if (sourceKind && sourceKind !== 'user' && sourceKind !== 'plugin') continue
      if (pathsFromMessage(msg).length) targets.push(i)
    }
    if (!targets.length) return decision

    const replaced = [...decision.messages]
    const attachmentsSvc = getAttachments()
    const canNative = mode !== 'describe' && typeof attachmentsSvc?.saveImage === 'function'

    for (const index of targets) {
      const message = decision.messages[index]
      const paths = pathsFromMessage(message)

      if (canNative) {
        /** @type {object[]} */
        const refs = []
        /** @type {string[]} */
        const failures = []
        for (const filePath of paths) {
          try {
            refs.push(await attachOne(filePath))
            runtime.stats.visionAttached = (runtime.stats.visionAttached || 0) + 1
          } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') throw err
            const reason = err instanceof Error ? err.message : String(err)
            failures.push(reason)
            runtime.log?.error?.(`[whale-vision] attach failed: ${reason}`)
          }
        }
        if (refs.length) {
          replaced[index] = rewriteMessageWithNativeImages(message, {
            attachments: refs,
            fallbackText: failures.length
              ? formatFailure(failures.join('；'))
              : '',
          })
          runtime.stats.visionLastReason = failures.length
            ? `partial:${failures.join('；')}`
            : 'native-ok'
          continue
        }
        // native totally failed → try describe, else failure text
        try {
          const text = await describePaths(paths, payload?.signal)
          replaced[index] = mapMessageText(message, (t) =>
            pathsFromMessage({ content: t }).length ? replaceImageNotices(t, text) : t,
          )
          runtime.stats.visionLastReason = 'describe-fallback'
          continue
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') throw err
          const reason =
            failures.join('；') ||
            (err instanceof Error ? err.message : String(err))
          runtime.stats.visionFailed = (runtime.stats.visionFailed || 0) + 1
          runtime.stats.visionLastReason = reason
          replaced[index] = mapMessageText(message, (t) =>
            pathsFromMessage({ content: t }).length
              ? replaceImageNotices(t, formatFailure(reason))
              : t,
          )
          continue
        }
      }

      // describe mode (or no attachments service)
      try {
        const text = await describePaths(paths, payload?.signal)
        replaced[index] = mapMessageText(message, (t) =>
          pathsFromMessage({ content: t }).length ? replaceImageNotices(t, text) : t,
        )
        runtime.stats.visionLastReason = 'describe-ok'
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') throw err
        const reason = err instanceof Error ? err.message : String(err)
        runtime.stats.visionFailed = (runtime.stats.visionFailed || 0) + 1
        runtime.stats.visionLastReason = reason
        runtime.log?.error?.(`[whale-vision] ${reason}`)
        replaced[index] = mapMessageText(message, (t) =>
          pathsFromMessage({ content: t }).length
            ? replaceImageNotices(t, formatFailure(reason))
            : t,
        )
      }
    }

    return { kind: 'enter', messages: replaced }
  })

  runtime.log?.info?.(
    `[whale-companion] vision: WeChat path→${canNativeLabel(mode)} (deepseek-flash native; no Zhipu required)`,
  )

  return () => {
    try {
      if (typeof off === 'function') off()
    } catch {
      /* ignore */
    }
  }
}

function canNativeLabel(mode) {
  return mode === 'describe' ? 'describe' : 'attachment'
}
