/**
 * One-shot: read dsh-meme index.db → index.json for runtime (no experimental sqlite).
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/meme-packs')

for (const name of fs.readdirSync(root)) {
  const dir = path.join(root, name)
  const dbPath = path.join(dir, 'index.db')
  if (!fs.statSync(dir).isDirectory() || !fs.existsSync(dbPath)) continue
  const db = new DatabaseSync(dbPath, { readOnly: true })
  const rows = db.prepare(
    'SELECT path, tag, file_name, caption, keywords FROM memes ORDER BY path',
  ).all()
  const out = {
    schemaVersion: 1,
    id: name,
    exportedAt: new Date().toISOString(),
    count: rows.length,
    memes: rows.map((r) => ({
      path: r.path,
      tag: r.tag,
      fileName: r.file_name,
      caption: r.caption || '',
      keywords: r.keywords || '',
    })),
  }
  const dest = path.join(dir, 'index.json')
  fs.writeFileSync(dest, JSON.stringify(out, null, 2), 'utf8')
  console.log('wrote', dest, 'memes=', rows.length)
}
