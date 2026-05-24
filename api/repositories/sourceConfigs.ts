import { getDb } from '../db/db.js'

export type SourceConfigRow = {
  id: string
  source: string
  city_code: string
  base_url: string
  settings_json: string
  updated_at: string
}

export function getSourceConfig(source: string, cityCode: string) {
  const db = getDb()
  const stmt = db.prepare(
    `SELECT id, source, city_code, base_url, settings_json, updated_at
     FROM source_configs
     WHERE source = ? AND city_code = ?`,
  )
  return (stmt.get(source, cityCode) as SourceConfigRow | undefined) ?? null
}

export function upsertSourceConfig(input: {
  id: string
  source: string
  cityCode: string
  baseUrl: string
  settingsJson: string
  updatedAt: string
}) {
  const db = getDb()
  const stmt = db.prepare(
    `INSERT INTO source_configs (id, source, city_code, base_url, settings_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(source, city_code) DO UPDATE SET
       base_url = excluded.base_url,
       settings_json = excluded.settings_json,
       updated_at = excluded.updated_at`,
  )
  stmt.run(
    input.id,
    input.source,
    input.cityCode,
    input.baseUrl,
    input.settingsJson,
    input.updatedAt,
  )
}

