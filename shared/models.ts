export type Project = {
  id: string
  name: string
  cityCode: string
  developer?: string
  createdAt: string
}

export type UnitStatus = 'sold' | 'available' | 'unknown'

export type Unit = {
  id: string
  projectId: string
  building?: string
  unitNo?: string
  roomNo?: string
  floor?: number
  areaSqm?: number
  status: UnitStatus
  listedPriceCny?: number
  source: 'housing_commission'
  lastSeenAt: string
}

export type Transaction = {
  id: string
  projectId: string
  unitId?: string
  dealDate?: string
  dealTotalCny?: number
  dealUnitPriceCnyPerSqm?: number
  areaSqm?: number
  building?: string
  unitNo?: string
  roomNo?: string
  source: 'housing_commission'
  sourceRecordId?: string
}

export type SyncRun = {
  id: string
  projectId: string
  source: 'housing_commission'
  startedAt: string
  finishedAt?: string
  status: 'success' | 'failed' | 'partial'
  stats: {
    unitsUpserted: number
    transactionsUpserted: number
    anomalies: number
  }
  errorMessage?: string
}

export type SourceConfig = {
  id: string
  source: 'housing_commission'
  cityCode: string
  baseUrl: string
  settings: Record<string, unknown>
  updatedAt: string
}

export type ProjectOverviewMetrics = {
  soldCount: number
  availableCount: number
  sellThroughRate: number | null
  avgUnitPriceCnyPerSqm: number | null
  lastDealDate?: string
}

export type TrendPoint = {
  date: string
  dealCount: number
  avgUnitPriceCnyPerSqm: number | null
}

