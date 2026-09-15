/**
 * SerpAPI adapter.
 *
 * 协议要点：
 *   GET {baseUrl}/search?engine=google&q=...&api_key=...&num=...&tbs=...&gl=...&hl=...
 *   Auth: api_key 走 query（也支持 Authorization: Bearer，这里用 query 形式兼容免费档）。
 *
 * 时间窗：用 tbs=qdr:d|w|m|y 传过去，与 recencyDays 的对应：
 *   ≤1   -> qdr:d
 *   ≤7   -> qdr:w
 *   ≤31  -> qdr:m
 *   >31  -> qdr:y
 *
 * fetch 未实现：SerpAPI 没有原生抓取端点；如需保留网页 HTML 解析由 caller 自处理。
 */
import axios from 'axios'
import type {
  SearchInput,
  SearchProviderInstance,
  SearchProviderKind,
  SearchResult
} from '@shared/searchProvider'
import { fail } from '@shared/errors/appError'
import { SEARCH_PROVIDER_ERRORS } from '../catalog'
import { isAuthStatus, readHttpError, trimBaseUrl } from '../http'
import type { SearchProviderAdapter } from '../types'

const SERPAPI_DEFAULT_BASE = 'https://serpapi.com'
const SEARCH_TIMEOUT_MS = 30_000
const AUTH_TIMEOUT_MS = 15_000
const SERPAPI_MAX_NUM = 100

interface SerpApiHitRaw {
  title?: string
  link?: string
  snippet?: string
  date?: string
}
interface SerpApiResponse {
  organic_results?: SerpApiHitRaw[]
  search_metadata?: { status?: string }
}

function resolveBase(baseUrl: string): string {
  return trimBaseUrl(baseUrl.trim() || SERPAPI_DEFAULT_BASE)
}

function tbsFor(days: number | undefined): string | undefined {
  if (typeof days !== 'number') return undefined
  if (days <= 1) return 'qdr:d'
  if (days <= 7) return 'qdr:w'
  if (days <= 31) return 'qdr:m'
  if (days <= 366) return 'qdr:y'
  return undefined
}

function mapSerpApiHits(raw: SerpApiHitRaw[] | undefined): SearchResult['hits'] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((h, i) => {
      const title = typeof h.title === 'string' ? h.title.trim() : ''
      const url = typeof h.link === 'string' ? h.link.trim() : ''
      if (!title || !/^https?:\/\//i.test(url)) return null
      const snippet = typeof h.snippet === 'string' ? h.snippet : ''
      const date = h.date ? String(h.date) : undefined
      return {
        title,
        url,
        snippet,
        score: 1 - i * 0.05,
        ...(date ? { publishedAt: date } : {})
      }
    })
    .filter((h): h is NonNullable<typeof h> => h !== null)
}

export const serpapiSearchAdapter: SearchProviderAdapter = {
  kind: 'serpapi' satisfies SearchProviderKind,

  async assertAuth(provider: SearchProviderInstance): Promise<void> {
    if (!provider.apiKey.trim()) throw fail(SEARCH_PROVIDER_ERRORS.missingApiKey)
    const params = new URLSearchParams({
      engine: 'google',
      q: 'ping',
      api_key: provider.apiKey.trim(),
      num: '1'
    })
    try {
      await axios.get(`${resolveBase(provider.baseUrl)}/search?${params}`, {
        timeout: AUTH_TIMEOUT_MS
      })
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined
      if (isAuthStatus(status)) {
        throw fail(SEARCH_PROVIDER_ERRORS.invalidApiKey, { detail: await readHttpError(err) })
      }
      throw fail(SEARCH_PROVIDER_ERRORS.connectionTestFailed, { detail: await readHttpError(err) })
    }
  },

  async search(provider: SearchProviderInstance, input: SearchInput): Promise<SearchResult> {
    if (!input.query.trim()) throw fail(SEARCH_PROVIDER_ERRORS.missingQuery)
    if (!provider.apiKey.trim()) throw fail(SEARCH_PROVIDER_ERRORS.missingApiKey)

    const params = new URLSearchParams({
      engine: 'google',
      q: input.query,
      api_key: provider.apiKey.trim(),
      num: String(Math.max(1, Math.min(input.topK ?? 5, SERPAPI_MAX_NUM)))
    })
    if (input.language) {
      const hl = input.language.split('-')[0]
      if (hl) params.set('hl', hl)
    }
    const tbs = tbsFor(input.recencyDays)
    if (tbs) params.set('tbs', tbs)

    let data: SerpApiResponse
    try {
      const resp = await axios.get<SerpApiResponse>(
        `${resolveBase(provider.baseUrl)}/search?${params}`,
        { timeout: SEARCH_TIMEOUT_MS }
      )
      data = resp.data
    } catch (err) {
      throw fail(SEARCH_PROVIDER_ERRORS.searchFailed, { detail: await readHttpError(err) })
    }

    const hits = mapSerpApiHits(data.organic_results)
    return {
      hits,
      provider: 'serpapi',
      query: input.query,
      total: hits.length
    }
  }
}
