import { getDb } from '../db/db.js'

export type UnitRow = {
  id: string
  project_id: string
  building: string | null
  unit_no: string | null
  room_no: string | null
  floor: number | null
  area_sqm: number | null
  status: string
  listed_price_cny: number | null
  last_seen_at: string
  source: string
  source_record_id: string | null
}

export function listUnits(projectId: string, filters: {
  status?: string
  building?: string
  unitNo?: string
} = {}) {
  const db = getDb()
  const where: string[] = ['project_id = ?']
  const params: Array<string | number> = [projectId]

  if (filters.status) {
    where.push('status = ?')
    params.push(filters.status)
  }
  if (filters.building) {
    where.push('building = ?')
    params.push(filters.building)
  }
  if (filters.unitNo) {
    where.push('unit_no = ?')
    params.push(filters.unitNo)
  }

  const stmt = db.prepare(
    `SELECT id, project_id, building, unit_no, room_no, floor, area_sqm, status, listed_price_cny, last_seen_at, source, source_record_id
     FROM units
     WHERE ${where.join(' AND ')}
     ORDER BY building ASC, unit_no ASC, floor DESC, room_no ASC`,
  )
  return stmt.all(...params) as UnitRow[]
}

export function getUnitCounts(projectId: string) {
  const db = getDb()
  const stmt = db.prepare(
    `SELECT
      SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) AS sold_count,
      SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available_count
     FROM units
     WHERE project_id = ?`,
  )
  const row = stmt.get(projectId) as
    | { sold_count: number | null; available_count: number | null }
    | undefined
  return {
    soldCount: row?.sold_count ?? 0,
    availableCount: row?.available_count ?? 0,
  }
}

export function upsertUnits(
  input: Array<{
    id: string
    projectId: string
    building?: string
    unitNo?: string
    roomNo?: string
    floor?: number
    areaSqm?: number
    status: string
    listedPriceCny?: number
    lastSeenAt: string
    source: string
    sourceRecordId?: string
  }>,
) {
  if (input.length === 0) return 0

  const db = getDb()
  const stmt = db.prepare(
    `INSERT INTO units (
      id, project_id, building, unit_no, room_no, floor, area_sqm, status, listed_price_cny, last_seen_at, source, source_record_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      project_id = excluded.project_id,
      building = excluded.building,
      unit_no = excluded.unit_no,
      room_no = excluded.room_no,
      floor = excluded.floor,
      area_sqm = excluded.area_sqm,
      status = excluded.status,
      listed_price_cny = excluded.listed_price_cny,
      last_seen_at = excluded.last_seen_at,
      source = excluded.source,
      source_record_id = excluded.source_record_id`,
  )

  for (const u of input) {
    stmt.run(
      u.id,
      u.projectId,
      u.building ?? null,
      u.unitNo ?? null,
      u.roomNo ?? null,
      u.floor ?? null,
      u.areaSqm ?? null,
      u.status,
      u.listedPriceCny ?? null,
      u.lastSeenAt,
      u.source,
      u.sourceRecordId ?? null,
    )
  }

  return input.length
}
