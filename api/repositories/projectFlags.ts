import { getDb } from '../db/db.js'

export type ProjectFlagRow = {
  project_id: string
  is_followed: number
  updated_at: string
}

export function setProjectFollowed(projectId: string, isFollowed: boolean, updatedAt: string) {
  const db = getDb()
  const stmt = db.prepare(
    `INSERT INTO project_flags (project_id, is_followed, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       is_followed = excluded.is_followed,
       updated_at = excluded.updated_at`,
  )
  stmt.run(projectId, isFollowed ? 1 : 0, updatedAt)
}

export function isProjectFollowed(projectId: string) {
  const db = getDb()
  const stmt = db.prepare(
    `SELECT project_id, is_followed, updated_at
     FROM project_flags
     WHERE project_id = ?`,
  )
  const row = (stmt.get(projectId) as ProjectFlagRow | undefined) ?? null
  return row ? row.is_followed === 1 : false
}

export function listFollowedProjectIds() {
  const db = getDb()
  const stmt = db.prepare(
    `SELECT project_id
     FROM project_flags
     WHERE is_followed = 1
     ORDER BY updated_at DESC`,
  )
  const rows = stmt.all() as Array<{ project_id: string }>
  return rows.map((r) => r.project_id)
}

