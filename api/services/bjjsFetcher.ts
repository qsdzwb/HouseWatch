import { insertRawPage } from '../repositories/rawPages.js'
import { randomUUID } from 'crypto'

export async function fetchBjjsPage(input: {
  cityCode: string
  url: string
  method?: 'GET' | 'POST'
  form?: Record<string, string>
  timeoutMs?: number
}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 15000)

  const fetchedAt = new Date().toISOString()
  try {
    const method = input.method ?? 'GET'
    const formBody = input.form ? new URLSearchParams(input.form).toString() : null

    const res = await fetch(input.url, {
      method,
      signal: controller.signal,
      headers: {
        'user-agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36',
        accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...(method === 'POST'
          ? { 'content-type': 'application/x-www-form-urlencoded' }
          : {}),
      },
      body: method === 'POST' ? formBody : undefined,
    })
    const text = await res.text()

    insertRawPage({
      id: randomUUID(),
      source: 'housing_commission',
      cityCode: input.cityCode,
      url: input.url,
      status: res.status,
      fetchedAt,
      bodyText: text,
    })

    return { ok: res.ok, status: res.status, fetchedAt, text }
  } catch (e) {
    insertRawPage({
      id: randomUUID(),
      source: 'housing_commission',
      cityCode: input.cityCode,
      url: input.url,
      status: undefined,
      fetchedAt,
      bodyText: String(e),
    })
    throw e
  } finally {
    clearTimeout(timeout)
  }
}
