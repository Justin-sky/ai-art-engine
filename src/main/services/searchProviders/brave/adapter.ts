/**
 * Brave Search API adapter.
 *
 * 协议要点：
 *   GET {baseUrl}/res/v1/web/search?q=...&count=...&safesearch=...&freshness=...
 *   Auth: X-Subscription-Token header（也可以用 Authorization: Bearer，但官方示例用前者）。
 *
 * 时间窗：用 freshness=pd|pw|pm|py，传入 recencyDays 时按以下规则映射
 *   ≤1   -> pd   (past day)
 *   ≤7   -> pw   (past week)
 *   ≤31  -> pm   (past month)
 *   >31  -> py   (past year)
 *   其它 -> 不传
 *
 * fetch 未实现：真抓取需要沙箱放通外网 + 渲染侧执行。
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

const BRAVE_DEFAULT_BASE = 'https://api.search.brave.com'
const SEARCH_TIMEOUT_MS = 30_000
const AUTH_TIMEOUT_MS = 15_000

interface BraveHitRaw {
  title?: string
  url?: string
  description?: string
  age?: string
}
interface BraveResponse {
  web?: { results?: BraveHitRaw[] }
  query?: { original?: string }
}

function resolveBase(baseUrl: string): string {
  return trimBaseUrl(baseUrl.trim() || BRAVE_DEFAULT_BASE)
}

function freshnessFor(days: number | undefined): string | undefined {
  if (typeof days !== 'number') return undefined
  if (days <= 1) return 'pd'
  if (days <= 7) return 'pw'
  if (days <= 31) return 'pm'
  if (days <= 366) return 'py'
  return undefined
}

function safeSearchToBrave(value: boolean | undefined): 'strict' | 'off' | undefined {
  if (value === true) return 'strict'
  if (value === false) return 'off'
  return undefined
}

function mapBraveHits(raw: BraveHitRaw[] | undefined): SearchResult['hits'] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((h, i) => {
      const title = typeof h.title === 'string' ? h.title.trim() : ''
      const url = typeof h.url === 'string' ? h.url.trim() : ''
      if (!title || !/^https?:\/\//i.test(url)) return null
      const snippet = typeof h.description === 'string' ? h.description : ''
      const age = h.age ? String(h.age) : undefined
      return {
        title,
        url,
        snippet,
        score: 1 - i * 0.05,
        ...(age ? { publishedAt: age } : {})
      }
    })
    .filter((h): h is NonNullable<typeof h> => h !== null)
}

export const braveSearchAdapter: SearchProviderAdapter = {
  kind: 'brave' satisfies SearchProviderKind,

  async assertAuth(provider: SearchProviderInstance): Promise<void> {
    if (!provider.apiKey.trim()) throw fail(SEARCH_PROVIDER_ERRORS.missingApiKey)
    const params = new URLSearchParams({ q: 'ping', count: '1' })
    try {
      await axios.get(`${resolveBase(provider.baseUrl)}/res/v1/web/search?${params}`, {
        headers: { 'x-subscription-token': provider.apiKey.trim() },
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
      q: input.query,
      count: String(Math.max(1, Math.min(input.topK ?? 5, 20)))
    })
    const freshness = freshnessFor(input.recencyDays)
    if (freshness) params.set('freshness', freshness)
    const ss = safeSearchToBrave(input.safeSearch)
    if (ss) params.set('safesearch', ss)

    let data: BraveResponse
    try {
      const resp = await axios.get<BraveResponse>(
        `${resolveBase(provider.baseUrl)}/res/v1/web/search?${params}`,
        {
          headers: { 'x-subscription-token': provider.apiKey.trim() },
          timeout: SEARCH_TIMEOUT_MS
        }
      )
      data = resp.data
    } catch (err) {
      throw fail(SEARCH_PROVIDER_ERRORS.searchFailed, { detail: await readHttpError(err) })
    }

    const hits = mapBraveHits(data.web?.results)
    return {
      hits,
      provider: 'brave',
      query: data.query?.original ?? input.query,
      total: hits.length
    }
  }
}
