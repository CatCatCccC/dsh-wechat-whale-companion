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

/**
 * @param {object} mood
 */
export function formatMoodLine(mood = {}) {
  const asleep = mood.asleep ? '睡' : '醒'
  const quiet = (mood.affinity ?? 0) >= 60 ? '；熟人可少话、可沉默' : ''
  const fat =
    (mood.fatFishHits ?? 0) > 0
      ? `；被叫大肥鱼×${mood.fatFishHits}（别主动自称）`
      : ''
  const last = mood.lastwordHint ? `；刚说过「${mood.lastwordHint}」别复读` : ''
  return `【此刻】心情${moodWord(mood.mood)} 精力${energyWord(mood.energy)} 关系${affinityWord(mood.affinity)} 睡眠=${asleep}${quiet}${fat}${last}`
}
