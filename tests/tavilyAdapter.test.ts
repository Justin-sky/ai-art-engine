import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchProviderInstance } from '../src/shared/searchProvider'
import { tavilySearchAdapter } from '../src/main/services/searchProviders/tavily/adapter'

const { postMock } = vi.hoisted(() => ({
  postMock: vi.fn()
}))

vi.mock('axios', () => ({
  default: {
    post: (...args: unknown[]) => postMock(...args),
    isAxiosError: (err: unknown) =>
      Boolean(err && typeof err === 'object' && (err as { isAxiosError?: boolean }).isAxiosError)
  }
}))

function provider(overrides?: Partial<SearchProviderInstance>): SearchProviderInstance {
  return {
    id: 'sp-tavily',
    providerKind: 'tavily',
    label: 'Tavily',
    apiKey: 'tvly-test',
    baseUrl: 'https://api.tavily.com',
    enabled: true,
    ...overrides
  }
}

describe('tavilySearchAdapter', () => {
  beforeEach(() => {
    postMock.mockReset()
  })

  it('assertAuth 缺 key 报错', async () => {
    await expect(tavilySearchAdapter.assertAuth(provider({ apiKey: '' }))).rejects.toThrow(
      /API Key/
    )
  })

  it('assertAuth 用 1 结果 ping 查询做探测', async () => {
    postMock.mockResolvedValueOnce({ data: { results: [] } })
    await tavilySearchAdapter.assertAuth(provider())
    expect(postMock).toHaveBeenCalledTimes(1)
    const [url, body, cfg] = postMock.mock.calls[0]!
    expect(url).toBe('https://api.tavily.com/search')
    expect(body).toMatchObject({ api_key: 'tvly-test', query: 'ping', max_results: 1 })
    expect(cfg?.headers?.['content-type']).toBe('application/json')
  })

  it('assertAuth 401 抛 invalidApiKey', async () => {
    const err = Object.assign(new Error('Unauthorized'), {
      isAxiosError: true,
      response: { status: 401, data: { detail: 'invalid api key' } }
    })
    postMock.mockRejectedValueOnce(err)
    await expect(tavilySearchAdapter.assertAuth(provider())).rejects.toThrow(/API Key 无效/)
  })

  it('assertAuth 500 抛 connectionTestFailed', async () => {
    const err = Object.assign(new Error('Server error'), {
      isAxiosError: true,
      response: { status: 500, data: 'oops' }
    })
    postMock.mockRejectedValueOnce(err)
    await expect(tavilySearchAdapter.assertAuth(provider())).rejects.toThrow(/连接测试失败/)
  })

  it('search 发送 api_key / query / max_results', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        query: '牛来 电影',
        results: [
          {
            title: '牛来电影',
            url: 'https://www.niulaifilm.com/',
            content: '剧情短片',
            score: 0.95,
            published_date: '2026-09-01'
          }
        ]
      }
    })
    const result = await tavilySearchAdapter.search(provider(), { query: '牛来 电影', topK: 5 })
    expect(result.provider).toBe('tavily')
    expect(result.hits.length).toBe(1)
    expect(result.hits[0]!.score).toBe(0.95)
    expect(result.hits[0]!.publishedAt).toBe('2026-09-01')
    const [, body] = postMock.mock.calls[0]!
    expect(body.max_results).toBe(5)
    expect(body.query).toBe('牛来 电影')
  })

  it('search 把 topK 限制在 1..20', async () => {
    postMock.mockResolvedValueOnce({ data: { results: [] } })
    await tavilySearchAdapter.search(provider(), { query: 'q', topK: 1000 })
    const [, body] = postMock.mock.calls[0]!
    expect(body.max_results).toBe(20)

    postMock.mockResolvedValueOnce({ data: { results: [] } })
    await tavilySearchAdapter.search(provider(), { query: 'q', topK: -5 })
    const [, body2] = postMock.mock.calls[1]!
    expect(body2.max_results).toBe(1)
  })

  it('search 把 language 切到 BCP-47 主语言（zh-CN → zh）', async () => {
    postMock.mockResolvedValueOnce({ data: { results: [] } })
    await tavilySearchAdapter.search(provider(), { query: 'q', language: 'zh-CN' })
    const [, body] = postMock.mock.calls[0]!
    expect(body.language).toBe('zh')
  })

  it('search recencyDays 透传到 days（夹紧到 1..365）', async () => {
    postMock.mockResolvedValueOnce({ data: { results: [] } })
    await tavilySearchAdapter.search(provider(), { query: 'q', recencyDays: 3 })
    const [, body] = postMock.mock.calls[0]!
    expect(body.days).toBe(3)

    postMock.mockResolvedValueOnce({ data: { results: [] } })
    await tavilySearchAdapter.search(provider(), { query: 'q', recencyDays: 999 })
    const [, body2] = postMock.mock.calls[1]!
    expect(body2.days).toBe(365)
  })

  it('search 过滤非 http(s) URL 与缺字段', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        results: [
          { title: 'ok', url: 'https://x.com/' },
          { title: 'ftp', url: 'ftp://bad/' },
          { url: 'https://no-title.com/' }
        ]
      }
    })
    const result = await tavilySearchAdapter.search(provider(), { query: 'q' })
    expect(result.hits.length).toBe(1)
    expect(result.hits[0]!.title).toBe('ok')
  })

  it('search 空 query / 缺 key 抛错', async () => {
    await expect(tavilySearchAdapter.search(provider(), { query: '' })).rejects.toThrow(
      /搜索关键词/
    )
    await expect(
      tavilySearchAdapter.search(provider({ apiKey: '' }), { query: 'q' })
    ).rejects.toThrow(/API Key/)
  })

  it('search 上游 HTTP 失败抛 searchFailed（detail 含原始 status）', async () => {
    const err = Object.assign(new Error('Bad Gateway'), {
      isAxiosError: true,
      response: { status: 502, data: 'upstream timeout' }
    })
    postMock.mockRejectedValueOnce(err)
    await expect(tavilySearchAdapter.search(provider(), { query: 'q' })).rejects.toThrow(
      /搜索失败.*502/
    )
  })

  it('search 走空 baseUrl 时回落到默认 api.tavily.com', async () => {
    postMock.mockResolvedValueOnce({ data: { results: [] } })
    await tavilySearchAdapter.search(provider({ baseUrl: '' }), { query: 'q' })
    const [url] = postMock.mock.calls[0]!
    expect(url).toBe('https://api.tavily.com/search')
  })
})
