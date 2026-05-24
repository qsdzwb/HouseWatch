import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getDb } from './db.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function ensureMigrationsTable() {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `)
}

function getAppliedIds() {
  const db = getDb()
  const stmt = db.prepare('SELECT id FROM schema_migrations ORDER BY id ASC')
  const rows = stmt.all() as Array<{ id: string }>
  return new Set(rows.map((r) => r.id))
}

export function migrate() {
  ensureMigrationsTable()

  const migrationsDir = path.resolve(__dirname, '../../migrations')
  if (!fs.existsSync(migrationsDir)) return

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))

  const applied = getAppliedIds()
  const db = getDb()

  for (const file of files) {
    if (applied.has(file)) continue
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
    db.exec('BEGIN')
    try {
      db.exec(sql)
      const stmt = db.prepare(
        'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)',
      )
      stmt.run(file, new Date().toISOString())
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
}

