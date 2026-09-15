import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchProviderInstance } from '../src/shared/searchProvider'
import { braveSearchAdapter } from '../src/main/services/searchProviders/brave/adapter'

const { getMock } = vi.hoisted(() => ({
  getMock: vi.fn()
}))

vi.mock('axios', () => ({
  default: {
    get: (...args: unknown[]) => getMock(...args),
    isAxiosError: (err: unknown) =>
      Boolean(err && typeof err === 'object' && (err as { isAxiosError?: boolean }).isAxiosError)
  }
}))

function provider(overrides?: Partial<SearchProviderInstance>): SearchProviderInstance {
  return {
    id: 'sp-brave',
    providerKind: 'brave',
    label: 'Brave',
    apiKey: 'brave-key',
    baseUrl: 'https://api.search.brave.com',
    enabled: true,
    ...overrides
  }
}

describe('braveSearchAdapter', () => {
  beforeEach(() => {
    getMock.mockReset()
  })

  it('assertAuth 缺 key 报错', async () => {
    await expect(braveSearchAdapter.assertAuth(provider({ apiKey: '' }))).rejects.toThrow(/API Key/)
  })

  it('assertAuth 用 q=ping&count=1 + X-Subscription-Token header 探测', async () => {
    getMock.mockResolvedValueOnce({ data: { web: { results: [] } } })
    await braveSearchAdapter.assertAuth(provider())
    const [url, cfg] = getMock.mock.calls[0]!
    expect(url).toContain('/res/v1/web/search')
    expect(url).toContain('q=ping')
    expect(url).toContain('count=1')
    expect(cfg?.headers?.['x-subscription-token']).toBe('brave-key')
  })

  it('assertAuth 401 抛 invalidApiKey', async () => {
    const err = Object.assign(new Error('Unauthorized'), {
      isAxiosError: true,
      response: { status: 401, data: 'invalid token' }
    })
    getMock.mockRejectedValueOnce(err)
    await expect(braveSearchAdapter.assertAuth(provider())).rejects.toThrow(/API Key 无效/)
  })

  it('search 拼 q + count，header 带 X-Subscription-Token', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        query: { original: 'deepseek harness' },
        web: {
          results: [
            {
              title: 'DeepSeek docs',
              url: 'https://platform.deepseek.com/docs',
              description: 'API ref',
              age: '3 days ago'
            }
          ]
        }
      }
    })
    const result = await braveSearchAdapter.search(provider(), {
      query: 'deepseek harness',
      topK: 5
    })
    expect(result.provider).toBe('brave')
    expect(result.query).toBe('deepseek harness')
    expect(result.hits.length).toBe(1)
    expect(result.hits[0]!.title).toBe('DeepSeek docs')
    expect(result.hits[0]!.publishedAt).toBe('3 days ago')
    const [url, cfg] = getMock.mock.calls[0]!
    expect(url).toContain('q=deepseek+harness')
    expect(url).toContain('count=5')
    expect(cfg?.headers?.['x-subscription-token']).toBe('brave-key')
  })

  it('search recencyDays 映射到 freshness 字段（≤1=pd、≤7=pw、≤31=pm、>31=py）', async () => {
    getMock.mockResolvedValueOnce({ data: { web: { results: [] } } })
    await braveSearchAdapter.search(provider(), { query: 'q', recencyDays: 1 })
    expect(getMock.mock.calls[0]![0]).toContain('freshness=pd')

    getMock.mockResolvedValueOnce({ data: { web: { results: [] } } })
    await braveSearchAdapter.search(provider(), { query: 'q', recencyDays: 5 })
    expect(getMock.mock.calls[1]![0]).toContain('freshness=pw')

    getMock.mockResolvedValueOnce({ data: { web: { results: [] } } })
    await braveSearchAdapter.search(provider(), { query: 'q', recencyDays: 20 })
    expect(getMock.mock.calls[2]![0]).toContain('freshness=pm')

    getMock.mockResolvedValueOnce({ data: { web: { results: [] } } })
    await braveSearchAdapter.search(provider(), { query: 'q', recencyDays: 200 })
    expect(getMock.mock.calls[3]![0]).toContain('freshness=py')
  })

  it('search safeSearch=true → safesearch=strict；false → off；undefined 不带', async () => {
    getMock.mockResolvedValueOnce({ data: { web: { results: [] } } })
    await braveSearchAdapter.search(provider(), { query: 'q', safeSearch: true })
    expect(getMock.mock.calls[0]![0]).toContain('safesearch=strict')

    getMock.mockResolvedValueOnce({ data: { web: { results: [] } } })
    await braveSearchAdapter.search(provider(), { query: 'q', safeSearch: false })
    expect(getMock.mock.calls[1]![0]).toContain('safesearch=off')

    getMock.mockResolvedValueOnce({ data: { web: { results: [] } } })
    await braveSearchAdapter.search(provider(), { query: 'q' })
    expect(getMock.mock.calls[2]![0]).not.toContain('safesearch')
  })

  it('search topK 夹紧到 1..20', async () => {
    getMock.mockResolvedValueOnce({ data: { web: { results: [] } } })
    await braveSearchAdapter.search(provider(), { query: 'q', topK: 999 })
    expect(getMock.mock.calls[0]![0]).toContain('count=20')

    getMock.mockResolvedValueOnce({ data: { web: { results: [] } } })
    await braveSearchAdapter.search(provider(), { query: 'q', topK: 0 })
    expect(getMock.mock.calls[1]![0]).toContain('count=1')
  })

  it('search 过滤非 http(s) URL / 缺标题', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        web: {
          results: [
            { title: 'ok', url: 'https://x.com/' },
            { title: 'ftp', url: 'ftp://bad/' },
            { url: 'https://no-title.com/' }
          ]
        }
      }
    })
    const result = await braveSearchAdapter.search(provider(), { query: 'q' })
    expect(result.hits.length).toBe(1)
  })

  it('search 空 query / 缺 key 抛错', async () => {
    await expect(braveSearchAdapter.search(provider(), { query: '' })).rejects.toThrow(/搜索关键词/)
    await expect(
      braveSearchAdapter.search(provider({ apiKey: '' }), { query: 'q' })
    ).rejects.toThrow(/API Key/)
  })

  it('search 上游 HTTP 失败抛 searchFailed', async () => {
    const err = Object.assign(new Error('Internal Server Error'), {
      isAxiosError: true,
      response: { status: 500, data: 'oops' }
    })
    getMock.mockRejectedValueOnce(err)
    await expect(braveSearchAdapter.search(provider(), { query: 'q' })).rejects.toThrow(
      /搜索失败.*500/
    )
  })

  it('search 走空 baseUrl 时回落到 api.search.brave.com', async () => {
    getMock.mockResolvedValueOnce({ data: { web: { results: [] } } })
    await braveSearchAdapter.search(provider({ baseUrl: '' }), { query: 'q' })
    const [url] = getMock.mock.calls[0]!
    expect(url.startsWith('https://api.search.brave.com/res/v1/web/search?')).toBe(true)
  })
})
