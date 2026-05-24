import { randomUUID } from 'crypto'
import { getProjectById } from '../repositories/projects.js'
import { getSourceConfig } from '../repositories/sourceConfigs.js'
import { insertSyncRun, finishSyncRun } from '../repositories/syncRuns.js'
import { upsertUnits } from '../repositories/units.js'
import { fetchBjjsPage } from './bjjsFetcher.js'
import {
  parseProjectFromSearch,
  parseBuildingsFromSalePermitDetail,
  parseHousesFromBuildingPage,
  parseHouseDetail,
} from './bjjsParser.js'

export async function syncProject(projectId: string) {
  const project = getProjectById(projectId)
  if (!project) {
    return { ok: false, error: '楼盘不存在' as const }
  }

  const source = 'housing_commission'
  const runId = randomUUID()
  const startedAt = new Date().toISOString()
  insertSyncRun({
    id: runId,
    projectId,
    source,
    startedAt,
    status: 'running',
    statsJson: JSON.stringify({
      unitsUpserted: 0,
      transactionsUpserted: 0,
      anomalies: 0,
    }),
  })

  const cfg = getSourceConfig(source, project.city_code)
  const fallbackBaseUrl = 'http://bjjs.zjw.beijing.gov.cn'
  const baseUrl = cfg?.base_url ?? fallbackBaseUrl
  const settings = cfg?.settings_json
    ? (JSON.parse(cfg.settings_json) as any)
    : { listPage: '/eportal/ui?pageId=307670&isTrue=0' }
  const listPage =
    settings && typeof settings.listPage === 'string'
      ? settings.listPage
      : '/eportal/ui?pageId=307670&isTrue=0'
  const listUrl = listPage.startsWith('http') ? listPage : `${baseUrl}${listPage}`

  try {
    const searched = await fetchBjjsPage({
      cityCode: project.city_code,
      url: listUrl.includes('pageId=307670')
        ? listUrl.split('&isTrue=')[0]
        : listUrl,
      method: 'POST',
      form: {
        projectName: project.name,
        developer: '',
        txtaddress: '',
        txtYS: '',
        txtZH: '',
        txtCQZH: '',
        isTrue: '0',
      },
    })

    const match = parseProjectFromSearch(searched.text, project.name)
    if (!match) {
      throw new Error('未在住建委站点检索到该楼盘，请确认楼盘名称是否与官网一致')
    }

    const salePermitId = match.salePermitId
    const detailUrl = `${baseUrl}/eportal/ui?pageId=320794&projectID=${salePermitId}&systemID=2&srcId=1`
    const detail = await fetchBjjsPage({
      cityCode: project.city_code,
      url: detailUrl,
    })

    const buildings = parseBuildingsFromSalePermitDetail(detail.text)
    if (buildings.length === 0) {
      throw new Error('未解析到楼栋信息，可能是页面结构变更')
    }

    const now = new Date().toISOString()
    const units: Array<{
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
    }> = []

    let anomalies = 0
    let soldDetailsFetched = 0

    for (const b of buildings) {
      const buildingUrl = `${baseUrl}/eportal/ui?pageId=320833&systemId=2&categoryId=1&salePermitId=${salePermitId}&buildingId=${b.buildingId}`
      const buildingPage = await fetchBjjsPage({
        cityCode: project.city_code,
        url: buildingUrl,
      })
      const houses = parseHousesFromBuildingPage(buildingPage.text)

      for (const h of houses) {
        const roomNoDigits = h.roomNo && /^\d+$/.test(h.roomNo) ? h.roomNo : null
        const floor =
          roomNoDigits && roomNoDigits.length >= 3
            ? Math.floor(Number(roomNoDigits) / 100)
            : undefined
        const baseUnitPrice = b.listedUnitPriceCnyPerSqm
          ? Math.round(b.listedUnitPriceCnyPerSqm)
          : undefined

        const unit = {
          id: h.houseId,
          projectId,
          building: b.buildingName,
          unitNo: h.unitNo,
          roomNo: h.roomNo,
          floor,
          areaSqm: undefined as number | undefined,
          status: h.status.normalized,
          listedPriceCny: baseUnitPrice,
          lastSeenAt: now,
          source,
          sourceRecordId: h.houseId,
        }

        if (h.status.normalized === 'sold' && soldDetailsFetched < 50) {
          try {
            const houseDetailUrl = `${baseUrl}/eportal/ui?pageId=373432&houseId=${h.houseId}&categoryId=1&salePermitId=${salePermitId}&systemId=2`
            const houseDetail = await fetchBjjsPage({
              cityCode: project.city_code,
              url: houseDetailUrl,
            })
            const parsed = parseHouseDetail(houseDetail.text)
            if (parsed.areaSqm) unit.areaSqm = parsed.areaSqm
            if (parsed.listedUnitPriceCnyPerSqm) {
              unit.listedPriceCny = Math.round(parsed.listedUnitPriceCnyPerSqm)
            }
            soldDetailsFetched += 1
          } catch {
            anomalies += 1
          }
        }

        units.push(unit)
      }
    }

    const unitsUpserted = upsertUnits(units)
    const finishedAt = new Date().toISOString()
    finishSyncRun({
      id: runId,
      finishedAt,
      status: 'partial',
      statsJson: JSON.stringify({
        unitsUpserted,
        transactionsUpserted: 0,
        anomalies,
      }),
    })
    return { ok: true, runId }
  } catch (e) {
    const finishedAt = new Date().toISOString()
    finishSyncRun({
      id: runId,
      finishedAt,
      status: 'failed',
      statsJson: JSON.stringify({
        unitsUpserted: 0,
        transactionsUpserted: 0,
        anomalies: 0,
      }),
      errorMessage: String(e),
    })
    return { ok: false, error: String(e) }
  }
}
