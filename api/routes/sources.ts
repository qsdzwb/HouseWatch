import { Router, type Request, type Response } from 'express'
import { randomUUID } from 'crypto'
import { getSourceConfig, upsertSourceConfig } from '../repositories/sourceConfigs.js'
import type { ApiResponse, SourceConfigResponse } from '../../shared/api.js'

const router = Router()

function ok<T>(res: Response, data: T) {
  const payload: ApiResponse<T> = { success: true, data }
  res.status(200).json(payload)
}

function fail(res: Response, status: number, error: string) {
  const payload: ApiResponse<never> = { success: false, error }
  res.status(status).json(payload)
}

function toModel(row: any) {
  return {
    id: row.id,
    source: 'housing_commission' as const,
    cityCode: row.city_code,
    baseUrl: row.base_url,
    settings: JSON.parse(row.settings_json),
    updatedAt: row.updated_at,
  }
}

router.get('/', (req: Request, res: Response) => {
  const cityCode =
    typeof req.query.cityCode === 'string' && req.query.cityCode.trim()
      ? req.query.cityCode.trim()
      : 'beijing'

  const row = getSourceConfig('housing_commission', cityCode)
  if (!row) {
    ok<SourceConfigResponse>(res, {
      config: {
        id: 'default',
        source: 'housing_commission',
        cityCode,
        baseUrl: 'http://bjjs.zjw.beijing.gov.cn',
        settings: {
          listPage: '/eportal/ui?pageId=307670&isTrue=0',
        },
        updatedAt: new Date().toISOString(),
      },
    })
    return
  }

  ok<SourceConfigResponse>(res, { config: toModel(row) })
})

router.put('/housing-commission', (req: Request, res: Response) => {
  const cityCode =
    typeof req.body?.cityCode === 'string' && req.body.cityCode.trim()
      ? req.body.cityCode.trim()
      : 'beijing'
  const baseUrl =
    typeof req.body?.baseUrl === 'string' && req.body.baseUrl.trim()
      ? req.body.baseUrl.trim()
      : ''
  const settings = typeof req.body?.settings === 'object' ? req.body.settings : null

  if (!baseUrl) return fail(res, 400, 'baseUrl 不能为空')
  if (!settings) return fail(res, 400, 'settings 不能为空')

  const now = new Date().toISOString()
  upsertSourceConfig({
    id: randomUUID(),
    source: 'housing_commission',
    cityCode,
    baseUrl,
    settingsJson: JSON.stringify(settings),
    updatedAt: now,
  })

  const row = getSourceConfig('housing_commission', cityCode)
  ok<SourceConfigResponse>(res, { config: row ? toModel(row) : null })
})

export default router
