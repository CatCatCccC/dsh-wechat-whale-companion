/**
 * Map numeric mood stats to short Chinese labels for prompts.
 * Keep 【此刻】short — long “口吻说明书” freezes the voice (feiyu-mood lesson).
 */

/**
 * @param {number} n
 * @param {[number, string][]} bands  // descending thresholds
 */
function band(n, bands) {
  const v = Number(n)
  const x = Number.isFinite(v) ? v : 50
  for (const [min, label] of bands) {
    if (x >= min) return label
  }
  return bands[bands.length - 1][1]
}

export function moodWord(n) {
  return band(n, [
    [75, '偏开心'],
    [55, '还行'],
    [35, '偏低落'],
    [0, '闷闷的'],
  ])
}

export function energyWord(n) {
  return band(n, [
    [70, '精力足'],
    [40, '精力一般'],
    [20, '有点累'],
    [0, '很倦'],
  ])
}

export function affinityWord(n) {
  return band(n, [
    [85, '很亲'],
    [60, '挺熟'],
    [30, '熟人'],
    [10, '刚认识'],
    [0, '陌生'],
  ])
}

/** @param {number} [shortBias] */
export function lengthVoice(shortBias) {
  const b = Number(shortBias)
  if (!Number.isFinite(b)) return ''
  if (b > 0.6) return '偏短句'
  if (b < 0.4) return '可稍长'
  return '中等句长'
}

/** One-shot “刚才心里那一下” from owner-react kind (feiyu-style). */
export const FEELING_BY_KIND = {
  apology: '刚才心里软了一下，嘴上还是别扭',
  praise: '被夸了有点飘，别得意太久',
  dismiss: '被敷衍有点不爽',
  fatfish: '又被叫大肥鱼，炸一下就够',
  normal: '',
}

/**
 * @param {object} mood
 */
export function formatMoodLine(mood = {}) {
  const asleep = mood.asleep ? '睡' : '醒'
  const mw = moodWord(mood.mood)
  const ew = energyWord(mood.energy)
  const tierLabel =
    typeof mood.tierLabel === 'string' && mood.tierLabel.trim()
      ? mood.tierLabel.trim()
      : affinityWord(mood.affinity)

  const bits = [`【此刻】心情${mw}，${ew}，关系${tierLabel}，${asleep}`]

  const feel =
    typeof mood.lastFeeling === 'string' && mood.lastFeeling.trim()
      ? mood.lastFeeling.trim()
      : ''
  if (feel) bits.push(`刚才：${feel}`)

  if ((mood.fatFishHits ?? 0) > 0) {
    bits.push('别主动自称大肥鱼')
  }
  if (mood.lastwordHint) {
    bits.push(`刚说过「${mood.lastwordHint}」别复读`)
  }
  return bits.join('。')
}
