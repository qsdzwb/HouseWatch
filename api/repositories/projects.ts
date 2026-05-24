import { getDb } from '../db/db.js'

export type ProjectRow = {
  id: string
  name: string
  city_code: string
  developer: string | null
  created_at: string
}

export function listProjects(query?: string) {
  const db = getDb()
  if (query && query.trim()) {
    const stmt = db.prepare(
      `SELECT id, name, city_code, developer, created_at
       FROM projects
       WHERE name LIKE ?
       ORDER BY created_at DESC`,
    )
    return stmt.all(`%${query.trim()}%`) as ProjectRow[]
  }

  const stmt = db.prepare(
    `SELECT id, name, city_code, developer, created_at
     FROM projects
     ORDER BY created_at DESC`,
  )
  return stmt.all() as ProjectRow[]
}

export function getProjectById(projectId: string) {
  const db = getDb()
  const stmt = db.prepare(
    `SELECT id, name, city_code, developer, created_at
     FROM projects
     WHERE id = ?`,
  )
  return (stmt.get(projectId) as ProjectRow | undefined) ?? null
}

export function createProject(input: {
  id: string
  name: string
  cityCode: string
  developer?: string
  createdAt: string
}) {
  const db = getDb()
  const stmt = db.prepare(
    `INSERT INTO projects (id, name, city_code, developer, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
  stmt.run(
    input.id,
    input.name,
    input.cityCode,
    input.developer ?? null,
    input.createdAt,
  )
}

