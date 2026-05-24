import { getDb } from '../db/db.js'

export type TransactionRow = {
  id: string
  project_id: string
  unit_id: string | null
  deal_date: string | null
  deal_total_cny: number | null
  deal_unit_price_cny_per_sqm: number | null
  area_sqm: number | null
  building: string | null
  unit_no: string | null
  room_no: string | null
  source: string
  source_record_id: string | null
}

export function listTransactions(
  projectId: string,
  filters: { startDate?: string; endDate?: string; unitNo?: string } = {},
) {
  const db = getDb()
  const where: string[] = ['project_id = ?']
  const params: Array<string | number> = [projectId]

  if (filters.startDate) {
    where.push('deal_date >= ?')
    params.push(filters.startDate)
  }
  if (filters.endDate) {
    where.push('deal_date <= ?')
    params.push(filters.endDate)
  }
  if (filters.unitNo) {
    where.push('unit_no = ?')
    params.push(filters.unitNo)
  }

  const stmt = db.prepare(
    `SELECT id, project_id, unit_id, deal_date, deal_total_cny, deal_unit_price_cny_per_sqm, area_sqm, building, unit_no, room_no, source, source_record_id
     FROM transactions
     WHERE ${where.join(' AND ')}
     ORDER BY deal_date DESC NULLS LAST`,
  )
  return stmt.all(...params) as TransactionRow[]
}

export function getLatestDealDate(projectId: string) {
  const db = getDb()
  const stmt = db.prepare(
    `SELECT deal_date
     FROM transactions
     WHERE project_id = ? AND deal_date IS NOT NULL
     ORDER BY deal_date DESC
     LIMIT 1`,
  )
  const row = stmt.get(projectId) as { deal_date: string } | undefined
  return row?.deal_date ?? null
}

export function getAvgUnitPrice(projectId: string) {
  const db = getDb()
  const stmt = db.prepare(
    `SELECT AVG(deal_unit_price_cny_per_sqm) AS avg_price
     FROM transactions
     WHERE project_id = ? AND deal_unit_price_cny_per_sqm IS NOT NULL`,
  )
  const row = stmt.get(projectId) as { avg_price: number | null } | undefined
  return row?.avg_price ?? null
}

