import type {
  Project,
  Unit,
  Transaction,
  SyncRun,
  SourceConfig,
  ProjectOverviewMetrics,
  TrendPoint,
} from './models'

export type ApiSuccess<T> = {
  success: true
  data: T
}

export type ApiError = {
  success: false
  error: string
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError

export type ProjectListResponse = {
  projects: Project[]
}

export type ProjectGetResponse = {
  project: Project
  metrics: ProjectOverviewMetrics
  updatedAt?: string
}

export type UnitsListResponse = {
  units: Unit[]
}

export type TransactionsListResponse = {
  transactions: Transaction[]
}

export type MetricsResponse = {
  overview: ProjectOverviewMetrics
  trend: TrendPoint[]
}

export type SyncRunsResponse = {
  runs: SyncRun[]
}

export type SourceConfigResponse = {
  config: SourceConfig | null
}

