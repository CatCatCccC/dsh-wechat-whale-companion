/**
 * Sleep gate: after goodnight words, suppress proactive; wake on owner message.
 */

// No /g — RegExp.test must not advance lastIndex across ticks
const SLEEP_WORDS = /晚安|去睡|睡了|困了|撑不住|先睡|睡觉了/

/**
 * @param {any} ctx
 * @param {object} runtime
 */
export function applySleep(ctx, runtime) {
  if (!runtime.config.modules.sleep?.enabled) return () => {}

  runtime.sleep = {
    /**
     * Call when she sends outbound text.
     * @param {string} text
     */
    observeOutbound(text) {
      if (SLEEP_WORDS.test(String(text || ''))) {
        runtime.persona?.setAsleep?.(true)
        runtime.stats.sleepTriggers = (runtime.stats.sleepTriggers || 0) + 1
      }
    },
    /**
     * Owner inbound always wakes.
     */
    onOwnerInbound() {
      runtime.persona?.setAsleep?.(false)
    },
    shouldSuppressProactive() {
      return Boolean(runtime.persona?.snapshot?.()?.asleep)
    },
  }

  return () => {}
}
