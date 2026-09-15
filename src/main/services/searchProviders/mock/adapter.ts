/**
 * Mock search adapter — 单测 / 本地调试用。
 *
 * 不发起任何网络请求，按 query 关键字挑 hits 返回。
 * 不做认证，永远通过 assertAuth。
 */
import type {
  FetchInput,
  FetchResult,
  SearchInput,
  SearchProviderInstance,
  SearchResult
} from '@shared/searchProvider'
import type { SearchProviderAdapter } from '../types'

interface MockHitSpec {
  title: string
  url: string
  snippet: string
  publishedAt?: string
}

/** 默认 5 条；keyword 命中时优先返回 */
const MOCK_HITS: readonly MockHitSpec[] = [
  {
    title: 'AIArtEngine project homepage',
    url: 'https://github.com/Justin-sky/ai-art-engine',
    snippet:
      'Professional AI creation tool for short drama, ads and film: image, 3D, video, workflow in one window',
    publishedAt: '2026-01-15T00:00:00.000Z'
  },
  {
    title: 'DeepSeek platform',
    url: 'https://platform.deepseek.com/api_keys',
    snippet: 'DeepSeek API key application and usage management'
  },
  {
    title: 'Anthropic Messages API docs',
    url: 'https://docs.anthropic.com/en/api/messages',
    snippet:
      'POST /v1/messages with system top-level field, image content blocks, non-streaming single call'
  },
  {
    title: 'Cordis plugin framework',
    url: 'https://cordis.js.org/',
    snippet: 'Progressive service container with dependency injection and context lifecycle'
  },
  {
    title: 'Tripo 3D platform',
    url: 'https://platform.tripo3d.ai/',
    snippet: 'Text / image to rigged GLB; supports humanoid and quadruped skeletons'
  }
]

/** query 里出现该子串即把对应 hit 排到最前 */
const KEYWORD_HINTS: ReadonlyArray<{ keyword: string; match: RegExp }> = [
  { keyword: 'deepseek', match: /deepseek/i },
  { keyword: 'anthropic', match: /anthropic/i },
  { keyword: 'tripo', match: /tripo/i },
  { keyword: 'cordis', match: /cordis/i },
  { keyword: 'aiartengine', match: /ai.?art.?engine/i }
]

function pickHits(query: string, topK: number): MockHitSpec[] {
  const lowered = query.toLowerCase()
  const ordered = [...MOCK_HITS]
  ordered.sort((a, b) => {
    const score = (h: MockHitSpec): number => {
      const text = `${h.title} ${h.snippet}`.toLowerCase()
      let s = 0
      for (const hint of KEYWORD_HINTS) if (hint.match.test(text)) s += 1
      if (text.includes(lowered)) s += 0.5
      return s
    }
    return score(b) - score(a)
  })
  return ordered.slice(0, Math.max(1, Math.min(topK, ordered.length)))
}

export const mockSearchAdapter: SearchProviderAdapter = {
  kind: 'mock-search',

  // mock 不需要任何校验
  async assertAuth(_provider: SearchProviderInstance): Promise<void> {
    /* no-op */
  },

  async search(_provider: SearchProviderInstance, input: SearchInput): Promise<SearchResult> {
    const topK = input.topK ?? 5
    const hits = pickHits(input.query, topK).map((hit, i) => ({
      title: hit.title,
      url: hit.url,
      snippet: hit.snippet,
      ...(hit.publishedAt ? { publishedAt: hit.publishedAt } : {}),
      score: 1 - i * 0.1
    }))
    return {
      hits,
      provider: 'mock-search',
      query: input.query,
      total: hits.length
    }
  },

  async fetch(_provider: SearchProviderInstance, input: FetchInput): Promise<FetchResult> {
    const url = input.url.trim()
    return {
      url,
      title: `Mock Page — ${url}`,
      content: `# Mock fetch\n\nURL: ${url}\n\nPlaceholder response from mockSearchAdapter.fetch — no network request is made.`,
      contentType: 'text/markdown',
      fetchedAt: new Date().toISOString(),
      truncated: false,
      status: 200
    }
  }
}
