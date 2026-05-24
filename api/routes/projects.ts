import { Router, type Request, type Response } from 'express'
import { randomUUID } from 'crypto'
import {
  listProjects,
  createProject,
  getProjectById,
} from '../repositories/projects.js'
import { listUnits } from '../repositories/units.js'
import { listTransactions } from '../repositories/transactions.js'
import { listSyncRuns } from '../repositories/syncRuns.js'
import { setProjectFollowed } from '../repositories/projectFlags.js'
import { computeProjectOverview } from '../services/metrics.js'
import { syncProject } from '../services/syncProject.js'
import type {
  ApiResponse,
  ProjectListResponse,
  ProjectGetResponse,
  UnitsListResponse,
  TransactionsListResponse,
  MetricsResponse,
  SyncRunsResponse,
} from '../../shared/api.js'

const router = Router()

function ok<T>(res: Response, data: T) {
  const payload: ApiResponse<T> = { success: true, data }
  res.status(200).json(payload)
}

function fail(res: Response, status: number, error: string) {
  const payload: ApiResponse<never> = { success: false, error }
  res.status(status).json(payload)
}

router.get('/', (req: Request, res: Response) => {
  const query = typeof req.query.query === 'string' ? req.query.query : undefined
  const rows = listProjects(query)

  ok<ProjectListResponse>(res, {
    projects: rows.map((r) => ({
      id: r.id,
      name: r.name,
      cityCode: r.city_code,
      developer: r.developer ?? undefined,
      createdAt: r.created_at,
    })),
  })
})

router.post('/', (req: Request, res: Response) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  const cityCode =
    typeof req.body?.cityCode === 'string' ? req.body.cityCode.trim() : ''
  const developer =
    typeof req.body?.developer === 'string' ? req.body.developer.trim() : ''

  if (!name) return fail(res, 400, '楼盘名称不能为空')
  if (!cityCode) return fail(res, 400, 'cityCode 不能为空')

  const id = randomUUID()
  const createdAt = new Date().toISOString()
  createProject({
    id,
    name,
    cityCode,
    developer: developer || undefined,
    createdAt,
  })

  const project = getProjectById(id)
  if (!project) return fail(res, 500, '创建失败')

  ok<ProjectGetResponse>(res, {
    project: {
      id: project.id,
      name: project.name,
      cityCode: project.city_code,
      developer: project.developer ?? undefined,
      createdAt: project.created_at,
    },
    metrics: computeProjectOverview(id),
    updatedAt: new Date().toISOString(),
  })
})

router.get('/:projectId', (req: Request, res: Response) => {
  const project = getProjectById(req.params.projectId)
  if (!project) return fail(res, 404, '楼盘不存在')

  ok<ProjectGetResponse>(res, {
    project: {
      id: project.id,
      name: project.name,
      cityCode: project.city_code,
      developer: project.developer ?? undefined,
      createdAt: project.created_at,
    },
    metrics: computeProjectOverview(project.id),
    updatedAt: new Date().toISOString(),
  })
})

router.post('/:projectId/sync', async (req: Request, res: Response) => {
  const result = await syncProject(req.params.projectId)
  if (!result.ok) return fail(res, 500, result.error)
  ok(res, { runId: result.runId })
})

router.post('/:projectId/follow', (req: Request, res: Response) => {
  const project = getProjectById(req.params.projectId)
  if (!project) return fail(res, 404, '楼盘不存在')
  setProjectFollowed(req.params.projectId, true, new Date().toISOString())
  ok(res, { ok: true })
})

router.post('/:projectId/unfollow', (req: Request, res: Response) => {
  const project = getProjectById(req.params.projectId)
  if (!project) return fail(res, 404, '楼盘不存在')
  setProjectFollowed(req.params.projectId, false, new Date().toISOString())
  ok(res, { ok: true })
})

router.get('/:projectId/units', (req: Request, res: Response) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined
  const building =
    typeof req.query.building === 'string' ? req.query.building : undefined
  const unitNo = typeof req.query.unitNo === 'string' ? req.query.unitNo : undefined

  const rows = listUnits(req.params.projectId, { status, building, unitNo })
  ok<UnitsListResponse>(res, {
    units: rows.map((u) => ({
      id: u.id,
      projectId: u.project_id,
      building: u.building ?? undefined,
      unitNo: u.unit_no ?? undefined,
      roomNo: u.room_no ?? undefined,
      floor: u.floor ?? undefined,
      areaSqm: u.area_sqm ?? undefined,
      status: u.status as any,
      listedPriceCny: u.listed_price_cny ?? undefined,
      source: 'housing_commission',
      lastSeenAt: u.last_seen_at,
    })),
  })
})

router.get('/:projectId/transactions', (req: Request, res: Response) => {
  const startDate =
    typeof req.query.startDate === 'string' ? req.query.startDate : undefined
  const endDate =
    typeof req.query.endDate === 'string' ? req.query.endDate : undefined
  const unitNo = typeof req.query.unitNo === 'string' ? req.query.unitNo : undefined

  const rows = listTransactions(req.params.projectId, { startDate, endDate, unitNo })
  ok<TransactionsListResponse>(res, {
    transactions: rows.map((t) => ({
      id: t.id,
      projectId: t.project_id,
      unitId: t.unit_id ?? undefined,
      dealDate: t.deal_date ?? undefined,
      dealTotalCny: t.deal_total_cny ?? undefined,
      dealUnitPriceCnyPerSqm: t.deal_unit_price_cny_per_sqm ?? undefined,
      areaSqm: t.area_sqm ?? undefined,
      building: t.building ?? undefined,
      unitNo: t.unit_no ?? undefined,
      roomNo: t.room_no ?? undefined,
      source: 'housing_commission',
      sourceRecordId: t.source_record_id ?? undefined,
    })),
  })
})

router.get('/:projectId/metrics', (req: Request, res: Response) => {
  const overview = computeProjectOverview(req.params.projectId)
  ok<MetricsResponse>(res, { overview, trend: [] })
})

router.get('/:projectId/sync-runs', (req: Request, res: Response) => {
  const rows = listSyncRuns(req.params.projectId)
  ok<SyncRunsResponse>(res, {
    runs: rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      source: 'housing_commission',
      startedAt: r.started_at,
      finishedAt: r.finished_at ?? undefined,
      status: r.status as any,
      stats: JSON.parse(r.stats_json),
      errorMessage: r.error_message ?? undefined,
    })),
  })
})

export default router
