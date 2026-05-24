export type BjjsProjectMatch = {
  salePermitId: string
  projectName: string
}

export type BjjsBuilding = {
  buildingId: string
  buildingName: string
  unitCount?: number
  areaSqm?: number
  listedUnitPriceCnyPerSqm?: number
}

export type BjjsHouseStatus = {
  label: string
  normalized: 'sold' | 'available' | 'unknown'
}

export type BjjsHouse = {
  houseId: string
  houseNo: string
  unitNo?: string
  roomNo?: string
  status: BjjsHouseStatus
}

export function parseProjectFromSearch(html: string, projectName: string) {
  const normalized = projectName.replace(/\s+/g, '')
  const re = /projectID=(\d+)[^>]*>([^<]+)<\/a>/g
  const matches: Array<{ salePermitId: string; text: string }> = []
  for (const m of html.matchAll(re)) {
    const salePermitId = m[1]
    const text = (m[2] ?? '').trim()
    if (!text) continue
    matches.push({ salePermitId, text })
  }

  const byName = matches.find((m) => m.text.replace(/\s+/g, '') === normalized)
  if (byName) return { salePermitId: byName.salePermitId, projectName: byName.text }

  const contains = matches.find((m) => m.text.replace(/\s+/g, '').includes(normalized))
  if (contains) return { salePermitId: contains.salePermitId, projectName: contains.text }

  return null
}

export function parseBuildingsFromSalePermitDetail(html: string) {
  const tableMatch = html.match(
    /<table[^>]*id=\"tbfloor\"[^>]*>[\s\S]*?<\/table>/i,
  )
  if (!tableMatch) return []

  const table = tableMatch[0]
  const rows = Array.from(table.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/gi)).map(
    (m) => m[0],
  )

  const buildings: BjjsBuilding[] = []
  for (const row of rows) {
    const buildingIdMatch = row.match(/buildingId=(\d+)/i)
    if (!buildingIdMatch) continue
    const buildingId = buildingIdMatch[1]

    const cells = Array.from(row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi))
      .map((m) => stripHtml(m[1]))
      .map((s) => s.trim())
      .filter(Boolean)

    const buildingName = cells[0] ?? `building-${buildingId}`
    const unitCount = cells[1] ? safeInt(cells[1]) : undefined
    const areaSqm = cells[2] ? safeFloat(cells[2]) : undefined
    const listedUnitPriceCnyPerSqm = cells[4] ? safeFloat(cells[4]) : undefined

    buildings.push({
      buildingId,
      buildingName,
      unitCount: unitCount ?? undefined,
      areaSqm: areaSqm ?? undefined,
      listedUnitPriceCnyPerSqm: listedUnitPriceCnyPerSqm ?? undefined,
    })
  }

  return buildings
}

export function parseLegendFromBuildingPage(html: string) {
  const re =
    /background:(#[0-9a-fA-F]{3,6})[^<]*<\/td>\s*<\/tr>\s*<\/tbody>\s*<\/table>\s*<\/td>\s*<td[^>]*>\s*<span>([^<]+)<\/span>/gi
  const map = new Map<string, string>()
  for (const m of html.matchAll(re)) {
    const color = normalizeColor(m[1])
    const label = (m[2] ?? '').trim()
    if (!color || !label) continue
    map.set(color, label)
  }
  return map
}

export function parseHousesFromBuildingPage(html: string) {
  const legend = parseLegendFromBuildingPage(html)

  const houses: BjjsHouse[] = []
  const re =
    /<div[^>]*style=\"[^\"]*background:([^;\" ]+)[^\"]*\"[^>]*>[\s\S]*?<a[^>]*pageId=373432[^>]*houseId=(\d+)[^\"]*\"[^>]*>([^<]+)<\/a>/gi

  for (const m of html.matchAll(re)) {
    const color = normalizeColor(m[1])
    const label = color ? legend.get(color) ?? '未知' : '未知'
    const houseId = m[2]
    const houseNo = (m[3] ?? '').trim()

    const { unitNo, roomNo } = parseHouseNo(houseNo)
    houses.push({
      houseId,
      houseNo,
      unitNo,
      roomNo,
      status: normalizeStatus(label),
    })
  }

  return houses
}

export function parseHouseDetail(html: string) {
  const text = normalizeText(stripHtml(html))

  const areaSqm = matchNumber(text, /建筑面积\s*([0-9.]+)\s*平方/)
  const unitPrice = matchNumber(text, /按建筑面积拟售单价\s*([0-9.]+)\s*元\/平方米/)
  const unitPriceFallback = matchNumber(text, /拟售单价\s*([0-9.]+)\s*元\/平方米/)

  return {
    areaSqm: areaSqm ?? undefined,
    listedUnitPriceCnyPerSqm: unitPrice ?? unitPriceFallback ?? undefined,
  }
}

function stripHtml(input: string) {
  return input.replace(/<[^>]+>/g, ' ')
}

function normalizeText(input: string) {
  return input.replace(/\s+/g, ' ').trim()
}

function matchNumber(text: string, re: RegExp) {
  const m = text.match(re)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  return n
}

function safeInt(s: string) {
  const n = Number.parseInt(s.replace(/[^\d-]/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

function safeFloat(s: string) {
  const m = s.match(/-?\d+(\.\d+)?/)
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) ? n : null
}

function normalizeColor(raw: string) {
  const v = raw.trim().toLowerCase()
  if (!v.startsWith('#')) return null
  if (v.length === 4) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`
  }
  if (v.length === 7) return v
  if (v.length === 6) return `#${v}`
  return v
}

function normalizeStatus(label: string): BjjsHouseStatus {
  const l = label.trim()
  if (l === '可售') return { label: l, normalized: 'available' }
  if (l === '已签约' || l === '网上联机备案') return { label: l, normalized: 'sold' }
  return { label: l, normalized: 'unknown' }
}

function parseHouseNo(houseNo: string) {
  const cleaned = houseNo.trim()
  const parts = cleaned.split('-')
  if (parts.length < 2) return { unitNo: undefined, roomNo: cleaned || undefined }

  const unitPart = parts[0].trim()
  const roomPart = parts.slice(1).join('-').trim()
  const unitNo = unitPart.replace(/单元/g, '').trim() || unitPart

  return {
    unitNo,
    roomNo: roomPart || undefined,
  }
}
