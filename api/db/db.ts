import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { DatabaseSync } from 'node:sqlite'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const dataDir = path.resolve(__dirname, '../../data')
const dbPath = path.resolve(dataDir, 'app.sqlite')

let db: DatabaseSync | null = null

export function getDb() {
  if (db) return db

  fs.mkdirSync(dataDir, { recursive: true })
  db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  return db
}

