/**
 * Map numeric mood stats to short Chinese labels for prompts.
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

/** @type {Record<string, string>} */
export const TIER_VOICE = {
  stranger: '生疏少叫主人、别太熟络',
  acquaintance: '熟人短聊，可偶发别扭',
  friend: '损友可怼少哄，别突然变甜',
  close: '很熟可软仍嘴硬，别每句腻',
  bond: '羁绊才可真心软，仍傲娇收尾',
}

/** @type {Record<string, string>} */
export const MOOD_VOICE = {
  偏开心: '可俏皮、可偶发贴纸，别刷屏',
  还行: '平常短口语',
  偏低落: '少接梗、少贴纸自嗨',
  闷闷的: '更短更冲，少表情自嗨',
}

/** @type {Record<string, string>} */
export const DAY_VOICE = {
  morning: '上午可稍精神',
  noon: '饭点别说教催命',
  evening: '傍晚随意短聊',
  night: '深夜更懒更短',
}

/**
 * @param {number} [shortBias]
 */
export function lengthVoice(shortBias) {
  const b = Number(shortBias)
  if (!Number.isFinite(b)) return ''
  if (b > 0.6) return '偏短句'
  if (b < 0.4) return '可稍长'
  return '中等句长'
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
  const tierId = typeof mood.tierId === 'string' ? mood.tierId : ''
  const tierHint = TIER_VOICE[tierId] || ((mood.affinity ?? 0) >= 60 ? '熟人可少话、可沉默' : '')

  const moodHint = MOOD_VOICE[mw] || ''
  const dayId = typeof mood.dayPart === 'string' ? mood.dayPart : ''
  const dayHint = DAY_VOICE[dayId] || ''
  const lenHint = lengthVoice(mood.shortBias ?? mood.style?.shortBias)

  const bits = [
    `【此刻】心情${mw} 精力${ew} 关系${tierLabel} 睡眠=${asleep}`,
  ]
  const extras = [tierHint, moodHint, dayHint, lenHint].filter(Boolean)
  if (extras.length) bits.push(`口吻：${extras.join('；')}`)

  if ((mood.fatFishHits ?? 0) > 0) {
    bits.push(`被叫大肥鱼×${mood.fatFishHits}（别主动自称）`)
  }
  if (mood.lastwordHint) {
    bits.push(`刚说过「${mood.lastwordHint}」别复读`)
  }
  return bits.join('；')
}
