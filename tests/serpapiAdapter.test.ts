import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchProviderInstance } from '../src/shared/searchProvider'
import { serpapiSearchAdapter } from '../src/main/services/searchProviders/serpapi/adapter'

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
    id: 'sp-serp',
    providerKind: 'serpapi',
    label: 'SerpAPI',
    apiKey: 'serp-key',
    baseUrl: 'https://serpapi.com',
    enabled: true,
    ...overrides
  }
}

describe('serpapiSearchAdapter', () => {
  beforeEach(() => {
    getMock.mockReset()
  })

  it('assertAuth 缺 key 报错', async () => {
    await expect(serpapiSearchAdapter.assertAuth(provider({ apiKey: '' }))).rejects.toThrow(
      /API Key/
    )
  })

  it('assertAuth 用 engine=google + q=ping + api_key query 探测', async () => {
    getMock.mockResolvedValueOnce({ data: { organic_results: [] } })
    await serpapiSearchAdapter.assertAuth(provider())
    const [url] = getMock.mock.calls[0]!
    expect(url).toContain('/search')
    expect(url).toContain('engine=google')
    expect(url).toContain('q=ping')
    expect(url).toContain('api_key=serp-key')
    expect(url).toContain('num=1')
  })

  it('assertAuth 401 抛 invalidApiKey', async () => {
    const err = Object.assign(new Error('Unauthorized'), {
      isAxiosError: true,
      response: { status: 401, data: { error: 'invalid api key' } }
    })
    getMock.mockRejectedValueOnce(err)
    await expect(serpapiSearchAdapter.assertAuth(provider())).rejects.toThrow(/API Key 无效/)
  })

  it('search 拼 engine=google + q + api_key + num，解析 organic_results', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        organic_results: [
          {
            title: '牛来电影主页',
            link: 'https://www.niulaifilm.com/',
            snippet: '国产剧情短片',
            date: '2 days ago'
          },
          {
            title: '豆瓣 - 牛来',
            link: 'https://movie.douban.com/subject/niulai/',
            snippet: '评分 7.5'
          }
        ]
      }
    })
    const result = await serpapiSearchAdapter.search(provider(), {
      query: '牛来 电影 2026',
      topK: 10
    })
    expect(result.provider).toBe('serpapi')
    expect(result.hits.length).toBe(2)
    expect(result.hits[0]!.title).toBe('牛来电影主页')
    expect(result.hits[1]!.publishedAt).toBeUndefined() // 第二条无 date
    const [url] = getMock.mock.calls[0]!
    expect(url).toContain('engine=google')
    expect(url).toContain('q=')
    expect(url).toContain('api_key=serp-key')
    expect(url).toContain('num=10')
  })

  it('search num 夹紧到 1..100', async () => {
    getMock.mockResolvedValueOnce({ data: { organic_results: [] } })
    await serpapiSearchAdapter.search(provider(), { query: 'q', topK: 9999 })
    expect(getMock.mock.calls[0]![0]).toContain('num=100')

    getMock.mockResolvedValueOnce({ data: { organic_results: [] } })
    await serpapiSearchAdapter.search(provider(), { query: 'q', topK: 0 })
    expect(getMock.mock.calls[1]![0]).toContain('num=1')
  })

  it('search language → hl（zh-CN → zh）', async () => {
    getMock.mockResolvedValueOnce({ data: { organic_results: [] } })
    await serpapiSearchAdapter.search(provider(), { query: 'q', language: 'en-US' })
    expect(getMock.mock.calls[0]![0]).toContain('hl=en')
  })

  it('search recencyDays 映射到 tbs=qdr:d|w|m|y', async () => {
    getMock.mockResolvedValueOnce({ data: { organic_results: [] } })
    await serpapiSearchAdapter.search(provider(), { query: 'q', recencyDays: 1 })
    expect(getMock.mock.calls[0]![0]).toContain('tbs=qdr%3Ad')

    getMock.mockResolvedValueOnce({ data: { organic_results: [] } })
    await serpapiSearchAdapter.search(provider(), { query: 'q', recencyDays: 7 })
    expect(getMock.mock.calls[1]![0]).toContain('tbs=qdr%3Aw')

    getMock.mockResolvedValueOnce({ data: { organic_results: [] } })
    await serpapiSearchAdapter.search(provider(), { query: 'q', recencyDays: 30 })
    expect(getMock.mock.calls[2]![0]).toContain('tbs=qdr%3Am')

    getMock.mockResolvedValueOnce({ data: { organic_results: [] } })
    await serpapiSearchAdapter.search(provider(), { query: 'q', recencyDays: 365 })
    expect(getMock.mock.calls[3]![0]).toContain('tbs=qdr%3Ay')
  })

  it('search 过滤非 http(s) URL / 缺标题', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        organic_results: [
          { title: 'ok', link: 'https://x.com/' },
          { title: 'ftp', link: 'ftp://bad/' },
          { link: 'https://no-title.com/' }
        ]
      }
    })
    const result = await serpapiSearchAdapter.search(provider(), { query: 'q' })
    expect(result.hits.length).toBe(1)
  })

  it('search 空 query / 缺 key 抛错', async () => {
    await expect(serpapiSearchAdapter.search(provider(), { query: '' })).rejects.toThrow(
      /搜索关键词/
    )
    await expect(
      serpapiSearchAdapter.search(provider({ apiKey: '' }), { query: 'q' })
    ).rejects.toThrow(/API Key/)
  })

  it('search 上游 HTTP 失败抛 searchFailed（detail 含原始 status）', async () => {
    const err = Object.assign(new Error('Bad Gateway'), {
      isAxiosError: true,
      response: { status: 502, data: 'upstream timeout' }
    })
    getMock.mockRejectedValueOnce(err)
    await expect(serpapiSearchAdapter.search(provider(), { query: 'q' })).rejects.toThrow(
      /搜索失败.*502/
    )
  })

  it('search 走空 baseUrl 时回落到 serpapi.com', async () => {
    getMock.mockResolvedValueOnce({ data: { organic_results: [] } })
    await serpapiSearchAdapter.search(provider({ baseUrl: '' }), { query: 'q' })
    const [url] = getMock.mock.calls[0]!
    expect(url.startsWith('https://serpapi.com/search?')).toBe(true)
  })
})
