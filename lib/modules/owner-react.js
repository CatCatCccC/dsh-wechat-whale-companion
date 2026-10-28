/**
 * Content-aware mood/affinity deltas from owner text (no LLM).
 */

const FAT_FISH = /大肥鱼/
/** Pure dismissive / one-word brush-offs */
const DISMISS =
  /^(哦+|嗯+|啊+|呃+|额+|行|好|ok|OK|Okay|哦了|嗯嗯|哈哈|呵呵|嗨)$/i
const APOLOGY_SOFT = /对不起|抱歉|不好意思|想你了|想你|喜欢你|爱你|么么|抱抱/
const PRAISE = /可爱|厉害|真棒|好棒|好聪明|好乖|喜欢这|太棒|漂亮|好看/

/**
 * @param {string} text
 * @returns {{
 *   moodDelta: number,
 *   affinityDelta: number,
 *   energyDelta: number,
 *   fatFish: boolean,
 *   kind: 'dismiss'|'apology'|'praise'|'fatfish'|'normal'
 * }}
 */
export function reactToOwnerText(text) {
  const t = String(text || '').trim().slice(0, 200)
  if (!t) {
    return {
      moodDelta: 0,
      affinityDelta: 0,
      energyDelta: 0,
      fatFish: false,
      kind: 'normal',
    }
  }

  const fatFish = FAT_FISH.test(t)
  let moodDelta = 0
  let affinityDelta = 0.15
  const energyDelta = -1
  /** @type {'dismiss'|'apology'|'praise'|'fatfish'|'normal'} */
  let kind = 'normal'

  if (DISMISS.test(t) || t.length <= 2) {
    kind = 'dismiss'
    moodDelta = -1.5
    affinityDelta = 0.02
  } else if (APOLOGY_SOFT.test(t)) {
    kind = 'apology'
    moodDelta = 2
    affinityDelta = 0.4
  } else if (PRAISE.test(t)) {
    kind = 'praise'
    moodDelta = 1.5
    affinityDelta = 0.15
  }

  if (fatFish) {
    moodDelta -= 2
    if (kind === 'normal') kind = 'fatfish'
  }

  return { moodDelta, affinityDelta, energyDelta, fatFish, kind }
}
