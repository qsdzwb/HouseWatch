import { getDb } from '../db/db.js'

export type RawPageRow = {
  id: string
  source: string
  city_code: string
  url: string
  status: number | null
  fetched_at: string
  body_text: string | null
}

export function insertRawPage(input: {
  id: string
  source: string
  cityCode: string
  url: string
  status?: number
  fetchedAt: string
  bodyText?: string
}) {
  const db = getDb()
  const stmt = db.prepare(
    `INSERT INTO raw_pages (id, source, city_code, url, status, fetched_at, body_text)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  stmt.run(
    input.id,
    input.source,
    input.cityCode,
    input.url,
    input.status ?? null,
    input.fetchedAt,
    input.bodyText ?? null,
  )
}

export function getLatestRawPage(source: string, cityCode: string) {
  const db = getDb()
  const stmt = db.prepare(
    `SELECT id, source, city_code, url, status, fetched_at, body_text
     FROM raw_pages
     WHERE source = ? AND city_code = ?
     ORDER BY fetched_at DESC
     LIMIT 1`,
  )
  return (stmt.get(source, cityCode) as RawPageRow | undefined) ?? null
}

