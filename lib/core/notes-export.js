/**
 * Export readable Markdown mirrors of JSON state (view-only).
 */
import fs from 'node:fs'
import path from 'node:path'

/**
 * @param {string} notesDir
 */
export function ensureNotesDir(notesDir) {
  fs.mkdirSync(notesDir, { recursive: true })
  return notesDir
}

/**
 * @param {string} filePath
 * @param {string} body
 */
function writeMd(filePath, body) {
  const text = String(body || '').trimEnd() + '\n'
  fs.writeFileSync(filePath, text, 'utf8')
}

/**
 * @param {object} input
 * @param {string} input.notesDir
 * @param {object} [input.profile]
 * @param {object} [input.diary]
 * @param {object} [input.memory]
 * @param {object} [input.shareLog]
 * @param {string} [input.stateDir]
 */
export function exportAllNotes(input) {
  const dir = ensureNotesDir(input.notesDir)
  const profile = input.profile || { traits: {}, summaryLines: [] }
  const diary = input.diary || { entries: [] }
  const memory = input.memory || { items: [] }
  const shareLog = input.shareLog || { entries: [], day: '' }

  const profileLines = (profile.summaryLines || []).length
    ? profile.summaryLines
    : Object.entries(profile.traits || {}).map(
        ([k, v]) => `${String(k).replace(/^主人\./, '')}：${v}`,
      )
  writeMd(
    path.join(dir, 'owner-profile.md'),
    [
      '# 我眼中的主人',
      '',
      '> 自动生成，请勿手改。改偏好请聊天回答她的问题，或等她记入 fish-memory。',
      '',
      profileLines.length ? profileLines.map((l) => `- ${l}`).join('\n') : '_还在了解中…_',
      '',
    ].join('\n'),
  )

  const diaryEntries = Array.isArray(diary.entries) ? diary.entries : []
  writeMd(
    path.join(dir, 'diary.md'),
    [
      '# 小鲸鱼日记',
      '',
      '> 自动生成，请勿手改。',
      '',
      ...diaryEntries.slice(0, 60).flatMap((e) => {
        const day = e.day || ''
        const text = String(e.text || '').trim()
        return [`## ${day || '某天'}`, '', text || '_空_', '']
      }),
    ].join('\n'),
  )

  const items = Array.isArray(memory.items) ? memory.items : []
  const facts = items.filter((i) => i.kind === 'fact' && !i.superseded)
  const events = items.filter((i) => i.kind !== 'fact' && !i.superseded).slice(0, 30)
  writeMd(
    path.join(dir, 'memory.md'),
    [
      '# 记忆',
      '',
      '> 自动生成。fact 长期保留；event 会淡忘。',
      '',
      '## Facts',
      '',
      facts.length
        ? facts.map((f) => `- **${f.factKey || 'fact'}**：${f.text}`).join('\n')
        : '_暂无_',
      '',
      '## 近期事件',
      '',
      events.length ? events.map((e) => `- ${e.text}`).join('\n') : '_暂无_',
      '',
    ].join('\n'),
  )

  const shareEntries = Array.isArray(shareLog.entries) ? shareLog.entries : []
  writeMd(
    path.join(dir, 'share-log.md'),
    [
      '# 主动分享 / 提问',
      '',
      `当日（${shareLog.day || '?'}）学习提问 ${shareLog.learnCount || 0} 次，分享 ${shareLog.shareCount || 0} 次。`,
      '',
      shareEntries.length
        ? shareEntries
            .slice(0, 30)
            .map((e) => {
              const when = e.at ? new Date(e.at).toLocaleString('zh-CN', { hour12: false }) : ''
              return `- [${e.motive || '?'}] ${when} ${e.hook || e.line || ''}`
            })
            .join('\n')
        : '_今天还没主动分享_',
      '',
    ].join('\n'),
  )

  writeMd(
    path.join(dir, 'INDEX.md'),
    [
      '# 鲸鱼娘笔记（自动导出）',
      '',
      `状态目录：\`${input.stateDir || ''}\``,
      '',
      '- [owner-profile.md](./owner-profile.md) — 主人画像',
      '- [diary.md](./diary.md) — 日记',
      '- [memory.md](./memory.md) — 记忆',
      '- [share-log.md](./share-log.md) — 主动分享记录',
      '',
      '这些文件由插件自动覆盖生成，**请勿手改**。',
      '',
    ].join('\n'),
  )

  return { ok: true, dir }
}
