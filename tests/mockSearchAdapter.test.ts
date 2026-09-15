import { beforeEach, describe, expect, it } from 'vitest'
import { mockSearchAdapter } from '../src/main/services/searchProviders/mock/adapter'
import type { SearchProviderInstance } from '../src/shared/searchProvider'

function provider(overrides?: Partial<SearchProviderInstance>): SearchProviderInstance {
  return {
    id: 'sp-mock-1',
    providerKind: 'mock-search',
    label: 'Mock',
    apiKey: '',
    baseUrl: '',
    enabled: true,
    ...overrides
  }
}

describe('mockSearchAdapter', () => {
  beforeEach(() => {
    /* no-op */
  })

  it('assertAuth always resolves (mock 不需要任何校验)', async () => {
    await expect(mockSearchAdapter.assertAuth(provider())).resolves.toBeUndefined()
  })

  it('search 返回固定 hits 列表，按 query 关键字排序', async () => {
    const result = await mockSearchAdapter.search(provider(), {
      query: 'deepseek anthropic',
      topK: 5
    })
    expect(result.provider).toBe('mock-search')
    expect(result.query).toBe('deepseek anthropic')
    expect(result.hits.length).toBeGreaterThan(0)
    expect(result.hits.length).toBeLessThanOrEqual(5)
    // topK 限制
    const trimmed = await mockSearchAdapter.search(provider(), { query: 'deepseek', topK: 2 })
    expect(trimmed.hits.length).toBe(2)
    // 每个 hit 有基本字段
    for (const hit of result.hits) {
      expect(typeof hit.title).toBe('string')
      expect(hit.title.length).toBeGreaterThan(0)
      expect(hit.url).toMatch(/^https?:\/\//)
      expect(typeof hit.snippet).toBe('string')
    }
  })

  it('search 关键字命中会优先返回相关条目', async () => {
    const result = await mockSearchAdapter.search(provider(), { query: 'tripo 3d', topK: 5 })
    // Tripo 关键字命中：第一条应当是 Tripo 相关
    expect(result.hits[0]!.title).toMatch(/Tripo/i)
  })

  it('search 空 query 不报错，返回降级结果', async () => {
    const result = await mockSearchAdapter.search(provider(), { query: '', topK: 3 })
    // 不抛错，仍然返回若干条
    expect(result.hits.length).toBeGreaterThan(0)
  })

  it('fetch 返回 markdown 占位内容', async () => {
    const url = 'https://example.com/page'
    const result = await mockSearchAdapter.fetch!(provider(), { url })
    expect(result.url).toBe(url)
    expect(result.status).toBe(200)
    expect(result.content).toContain('Mock fetch')
    expect(result.content).toContain(url)
    expect(result.contentType).toBe('text/markdown')
    expect(result.truncated).toBe(false)
    expect(typeof result.fetchedAt).toBe('string')
  })
})
