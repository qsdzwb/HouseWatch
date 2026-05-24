import { getUnitCounts } from '../repositories/units.js'
import { getAvgUnitPrice, getLatestDealDate } from '../repositories/transactions.js'

export function computeProjectOverview(projectId: string) {
  const counts = getUnitCounts(projectId)
  const total = counts.soldCount + counts.availableCount
  const sellThroughRate = total > 0 ? counts.soldCount / total : null
  const avgUnitPriceCnyPerSqm = getAvgUnitPrice(projectId)
  const lastDealDate = getLatestDealDate(projectId) ?? undefined

  return {
    soldCount: counts.soldCount,
    availableCount: counts.availableCount,
    sellThroughRate,
    avgUnitPriceCnyPerSqm: avgUnitPriceCnyPerSqm ? Math.round(avgUnitPriceCnyPerSqm) : null,
    lastDealDate,
  }
}

