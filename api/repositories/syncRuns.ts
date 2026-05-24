import { getDb } from '../db/db.js'

export type SyncRunRow = {
  id: string
  project_id: string
  source: string
  started_at: string
  finished_at: string | null
  status: string
  error_message: string | null
  stats_json: string
}

export function insertSyncRun(input: {
  id: string
  projectId: string
  source: string
  startedAt: string
  status: string
  statsJson: string
}) {
  const db = getDb()
  const stmt = db.prepare(
    `INSERT INTO sync_runs (id, project_id, source, started_at, status, stats_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  stmt.run(
    input.id,
    input.projectId,
    input.source,
    input.startedAt,
    input.status,
    input.statsJson,
  )
}

export function finishSyncRun(input: {
  id: string
  finishedAt: string
  status: string
  statsJson: string
  errorMessage?: string
}) {
  const db = getDb()
  const stmt = db.prepare(
    `UPDATE sync_runs
     SET finished_at = ?, status = ?, stats_json = ?, error_message = ?
     WHERE id = ?`,
  )
  stmt.run(
    input.finishedAt,
    input.status,
    input.statsJson,
    input.errorMessage ?? null,
    input.id,
  )
}

export function listSyncRuns(projectId: string) {
  const db = getDb()
  const stmt = db.prepare(
    `SELECT id, project_id, source, started_at, finished_at, status, error_message, stats_json
     FROM sync_runs
     WHERE project_id = ?
     ORDER BY started_at DESC
     LIMIT 50`,
  )
  return stmt.all(projectId) as SyncRunRow[]
}

