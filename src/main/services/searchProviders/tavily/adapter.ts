/**
 * Tavily Search API adapter.
 *
 * 协议要点：
 *   POST {baseUrl}/search
 *   Body: { api_key, query, max_results, search_depth?, topic?, days?, language? }
 *   Auth: api_key 走 body（官方默认方式；不在 Authorization header）。
 *
 * Tavily 实际上还有 /extract 等端点做抓取，本文件只暴露 search 接口；
 * fetch 留给上层走 fetch=null 兜底（沙箱网络限制暂未放通）。
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

const TAVILY_DEFAULT_BASE = 'https://api.tavily.com'
const SEARCH_TIMEOUT_MS = 30_000
const AUTH_TIMEOUT_MS = 15_000

interface TavilyHitRaw {
  title?: string
  url?: string
  content?: string
  score?: number
  published_date?: string
}
interface TavilyResponse {
  query?: string
  results?: TavilyHitRaw[]
  answer?: string
}

function resolveBase(baseUrl: string): string {
  return trimBaseUrl(baseUrl.trim() || TAVILY_DEFAULT_BASE)
}

function mapTavilyHits(raw: TavilyHitRaw[] | undefined): SearchResult['hits'] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((h, i) => {
      const title = typeof h.title === 'string' ? h.title.trim() : ''
      const url = typeof h.url === 'string' ? h.url.trim() : ''
      if (!title || !/^https?:\/\//i.test(url)) return null
      const snippet = typeof h.content === 'string' ? h.content : ''
      const score = typeof h.score === 'number' ? h.score : 1 - i * 0.05
      const publishedAt = h.published_date ? String(h.published_date) : undefined
      return {
        title,
        url,
        snippet,
        score,
        ...(publishedAt ? { publishedAt } : {})
      }
    })
    .filter((h): h is NonNullable<typeof h> => h !== null)
}

export const tavilySearchAdapter: SearchProviderAdapter = {
  kind: 'tavily' satisfies SearchProviderKind,

  async assertAuth(provider: SearchProviderInstance): Promise<void> {
    if (!provider.apiKey.trim()) throw fail(SEARCH_PROVIDER_ERRORS.missingApiKey)
    try {
      await axios.post(
        `${resolveBase(provider.baseUrl)}/search`,
        { api_key: provider.apiKey.trim(), query: 'ping', max_results: 1 },
        { headers: { 'content-type': 'application/json' }, timeout: AUTH_TIMEOUT_MS }
      )
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

    const body: Record<string, unknown> = {
      api_key: provider.apiKey.trim(),
      query: input.query,
      max_results: Math.max(1, Math.min(input.topK ?? 5, 20))
    }
    if (input.language) body.language = input.language.split('-')[0] // 'zh-CN' -> 'zh'
    if (typeof input.recencyDays === 'number') {
      body.days = Math.max(1, Math.min(input.recencyDays, 365))
    }

    let data: TavilyResponse
    try {
      const resp = await axios.post<TavilyResponse>(
        `${resolveBase(provider.baseUrl)}/search`,
        body,
        {
          headers: { 'content-type': 'application/json' },
          timeout: SEARCH_TIMEOUT_MS
        }
      )
      data = resp.data
    } catch (err) {
      throw fail(SEARCH_PROVIDER_ERRORS.searchFailed, { detail: await readHttpError(err) })
    }

    const hits = mapTavilyHits(data.results)
    return {
      hits,
      provider: 'tavily',
      query: data.query ?? input.query,
      total: hits.length
    }
  }
}
