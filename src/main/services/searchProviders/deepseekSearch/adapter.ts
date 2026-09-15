/**
 * DeepSeek Anthropic 兼容端点 → 搜索适配器。
 *
 * 实现策略：LLM 中介搜索（**非真联网**）。
 *  DeepSeek 官方文本模型（deepseek-flash / deepseek-v4-pro）无内建 web 检索，
 *  这里把 search 任务改写为"模型以 JSON 格式返回它训练知识内最相关的 N 条结果"。
 *  优点：复用现有 custom/anthropic 协议栈，dsh AI 对话工具立即可用；
 *  缺点：返回结果受模型知识截止约束，不能反映真实公网。
 *
 *  后续接入真 search（Tavily / Brave / SerpAPI）时新建独立 adapter 即可，
 *  本文件职责收敛在「基于 Anthropic 兼容端点的 LLM 中介搜索」。
 */
import axios from 'axios'
import {
  DEEPSEEK_SEARCH_DEFAULT_MODEL,
  type SearchInput,
  type SearchProviderInstance,
  type SearchResult
} from '@shared/searchProvider'
import { fail } from '@shared/errors/appError'
import { SEARCH_PROVIDER_ERRORS } from '../catalog'
import { isAuthStatus, readHttpError, trimBaseUrl } from '../http'
import type { SearchProviderAdapter } from '../types'

const ANTHROPIC_API_VERSION = '2023-06-01'
const SEARCH_TIMEOUT_MS = 60_000
const AUTH_TIMEOUT_MS = 20_000

/** 与 modelProviders/custom/anthropic.ts 同形：保留末尾 /v1，不重复拼接 */
function anthropicApiUrl(baseUrl: string, path: string): string {
  const base = trimBaseUrl(baseUrl)
  if (/\/v1$/i.test(base)) return `${base}${path.replace(/^\/v1/i, '')}`
  return `${base}${path}`
}

interface AnthropicContentBlock {
  type?: string
  text?: string
}
interface AnthropicResponse {
  content?: AnthropicContentBlock[]
  model?: string
}

function buildSearchSystemPrompt(topK: number, language?: string): string {
  const lang = language ? ` Prefer ${language} when possible.` : ''
  return [
    `You are a search-result formatter. Given the user's query, produce up to ${topK} highly relevant web hits from your training knowledge.`,
    'Return strict JSON with no prose:',
    '{ "hits": [ { "title": string, "url": string, "snippet": string, "publishedAt"?: string } ] }',
    'Rules: url must be http(s); title and snippet should be one short sentence; if you are not confident, return { "hits": [] }.' +
      lang
  ].join('\n')
}

interface RawHit {
  title?: string
  url?: string
  snippet?: string
  publishedAt?: string
  source?: string
  score?: number
}

function parseSearchPayload(text: string): RawHit[] {
  // 模型有时会包 ```json ... ```，做宽松剥离
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
  if (!stripped) return []
  const parsed = JSON.parse(stripped) as { hits?: unknown }
  if (!parsed || !Array.isArray(parsed.hits)) return []
  return parsed.hits.filter((h): h is RawHit => Boolean(h) && typeof h === 'object')
}

export const deepseekSearchAdapter: SearchProviderAdapter = {
  kind: 'deepseek-search',

  async assertAuth(provider: SearchProviderInstance): Promise<void> {
    if (!provider.apiKey.trim()) throw fail(SEARCH_PROVIDER_ERRORS.missingApiKey)
    const base = provider.baseUrl.trim()
    if (!base) {
      throw fail(SEARCH_PROVIDER_ERRORS.connectionTestFailed, {
        detail: 'Base URL is not configured'
      })
    }
    try {
      await axios.get(anthropicApiUrl(base, '/v1/models'), {
        headers: {
          'x-api-key': provider.apiKey.trim(),
          'anthropic-version': ANTHROPIC_API_VERSION
        },
        timeout: AUTH_TIMEOUT_MS
      })
    } catch (err) {
      const raw = await readHttpError(err)
      const status = axios.isAxiosError(err) ? err.response?.status : undefined
      if (isAuthStatus(status)) {
        throw fail(SEARCH_PROVIDER_ERRORS.invalidApiKey, { detail: raw })
      }
      throw fail(SEARCH_PROVIDER_ERRORS.connectionTestFailed, { detail: raw })
    }
  },

  async search(provider: SearchProviderInstance, input: SearchInput): Promise<SearchResult> {
    if (!input.query.trim()) throw fail(SEARCH_PROVIDER_ERRORS.missingQuery)
    if (!provider.apiKey.trim()) throw fail(SEARCH_PROVIDER_ERRORS.missingApiKey)
    const base = provider.baseUrl.trim()
    if (!base) {
      throw fail(SEARCH_PROVIDER_ERRORS.connectionTestFailed, {
        detail: 'Base URL is not configured'
      })
    }

    const topK = Math.max(1, Math.min(input.topK ?? 5, 20))
    const system = buildSearchSystemPrompt(topK, input.language)

    let responseData: AnthropicResponse
    try {
      const { data } = await axios.post<AnthropicResponse>(
        anthropicApiUrl(base, '/v1/messages'),
        {
          model: DEEPSEEK_SEARCH_DEFAULT_MODEL,
          max_tokens: 2048,
          system,
          messages: [{ role: 'user', content: input.query }]
        },
        {
          headers: {
            'x-api-key': provider.apiKey.trim(),
            'anthropic-version': ANTHROPIC_API_VERSION,
            'content-type': 'application/json'
          },
          timeout: SEARCH_TIMEOUT_MS
        }
      )
      responseData = data
    } catch (err) {
      throw fail(SEARCH_PROVIDER_ERRORS.searchFailed, {
        detail: await readHttpError(err)
      })
    }

    const text = (responseData.content ?? [])
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('')
      .trim()
    if (!text) throw fail(SEARCH_PROVIDER_ERRORS.emptyResult)

    let rawHits: RawHit[]
    try {
      rawHits = parseSearchPayload(text)
    } catch (err) {
      throw fail(SEARCH_PROVIDER_ERRORS.parseFailed, {
        detail: (err as Error).message
      })
    }

    const hits = rawHits
      .map((h, i) => {
        const title = typeof h.title === 'string' ? h.title.trim() : ''
        const url = typeof h.url === 'string' ? h.url.trim() : ''
        if (!title || !/^https?:\/\//i.test(url)) return null
        const snippet = typeof h.snippet === 'string' ? h.snippet.trim() : ''
        const publishedAt =
          typeof h.publishedAt === 'string' && h.publishedAt.trim() ? h.publishedAt : undefined
        return {
          title,
          url,
          snippet,
          ...(publishedAt ? { publishedAt } : {}),
          ...(typeof h.score === 'number' ? { score: h.score } : { score: 1 - i * 0.05 }),
          raw: { ...h }
        }
      })
      .filter((h): h is NonNullable<typeof h> => h !== null)

    return {
      hits,
      provider: 'deepseek-search',
      query: input.query,
      total: hits.length,
      raw: { model: responseData.model ?? DEEPSEEK_SEARCH_DEFAULT_MODEL }
    }
  }
}
