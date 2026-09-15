import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEEPSEEK_SEARCH_DEFAULT_MODEL,
  type SearchProviderInstance
} from '../src/shared/searchProvider'
import { deepseekSearchAdapter } from '../src/main/services/searchProviders/deepseekSearch/adapter'

const { getMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn()
}))

vi.mock('axios', () => ({
  default: {
    get: (...args: unknown[]) => getMock(...args),
    post: (...args: unknown[]) => postMock(...args),
    isAxiosError: (err: unknown) =>
      Boolean(err && typeof err === 'object' && (err as { isAxiosError?: boolean }).isAxiosError)
  }
}))

function provider(overrides?: Partial<SearchProviderInstance>): SearchProviderInstance {
  return {
    id: 'sp-ds-1',
    providerKind: 'deepseek-search',
    label: 'DeepSeek',
    apiKey: 'sk-test',
    baseUrl: 'https://api.deepseek.com/anthropic',
    enabled: true,
    ...overrides
  }
}

describe('deepseekSearchAdapter', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('assertAuth 缺 key 直接报错', async () => {
    await expect(deepseekSearchAdapter.assertAuth(provider({ apiKey: '' }))).rejects.toThrow(
      /API Key/
    )
  })

  it('assertAuth 200 OK 视为通过', async () => {
    getMock.mockResolvedValueOnce({ data: { data: [] } })
    await expect(deepseekSearchAdapter.assertAuth(provider())).resolves.toBeUndefined()
    expect(getMock).toHaveBeenCalledTimes(1)
    const [url, cfg] = getMock.mock.calls[0]!
    expect(url).toContain('/v1/models')
    expect(cfg?.headers?.['x-api-key']).toBe('sk-test')
    expect(cfg?.headers?.['anthropic-version']).toBe('2023-06-01')
  })

  it('assertAuth 401 抛 invalidApiKey', async () => {
    const err = Object.assign(new Error('Unauthorized'), {
      isAxiosError: true,
      response: { status: 401, data: { error: 'invalid api key' } }
    })
    getMock.mockRejectedValueOnce(err)
    await expect(deepseekSearchAdapter.assertAuth(provider())).rejects.toThrow(/API Key 无效/)
  })

  it('search 发送 system prompt 与 user query，并解析 JSON hits', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        model: 'deepseek-flash',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              hits: [
                {
                  title: '牛来电影 官方主页',
                  url: 'https://www.niulaifilm.com/',
                  snippet: '《牛来》是一部国产剧情短片，2026 年上映',
                  publishedAt: '2026-09-01'
                },
                {
                  title: '豆瓣 - 牛来',
                  url: 'https://movie.douban.com/subject/niulai/',
                  snippet: '评分 7.5 / 10'
                }
              ]
            })
          }
        ]
      }
    })
    const result = await deepseekSearchAdapter.search(provider(), {
      query: '牛来 电影 2026',
      topK: 5
    })
    expect(result.provider).toBe('deepseek-search')
    expect(result.hits.length).toBe(2)
    expect(result.hits[0]!.title).toBe('牛来电影 官方主页')
    expect(result.hits[0]!.url).toMatch(/^https?:\/\//)
    expect(postMock).toHaveBeenCalledTimes(1)
    const [url, body, cfg] = postMock.mock.calls[0]!
    expect(url).toContain('/v1/messages')
    expect(body.model).toBe(DEEPSEEK_SEARCH_DEFAULT_MODEL)
    expect(body.system).toMatch(/search/i)
    expect(body.messages[0].content).toBe('牛来 电影 2026')
    expect(cfg?.headers?.['x-api-key']).toBe('sk-test')
  })

  it('search 剥离 ```json ... ``` 包裹仍能解析', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        content: [
          {
            type: 'text',
            text: '```json\n{ "hits": [ { "title": "t", "url": "https://x.com/", "snippet": "s" } ] }\n```'
          }
        ]
      }
    })
    const result = await deepseekSearchAdapter.search(provider(), { query: 'x' })
    expect(result.hits.length).toBe(1)
    expect(result.hits[0]!.url).toBe('https://x.com/')
  })

  it('search 过滤非 http(s) URL 与缺字段的 hit', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              hits: [
                { title: 'ok', url: 'https://valid.com/', snippet: 'ok' },
                { title: 'bad url', url: 'ftp://no/', snippet: 'x' },
                { title: 'no url' },
                { title: '', url: 'https://empty-title.com/' }
              ]
            })
          }
        ]
      }
    })
    const result = await deepseekSearchAdapter.search(provider(), { query: 'q' })
    expect(result.hits.length).toBe(1)
    expect(result.hits[0]!.title).toBe('ok')
  })

  it('search 空 query 抛 missingQuery', async () => {
    await expect(deepseekSearchAdapter.search(provider(), { query: '' })).rejects.toThrow(
      /搜索关键词/
    )
  })

  it('search 缺 key 抛 missingApiKey', async () => {
    await expect(
      deepseekSearchAdapter.search(provider({ apiKey: '' }), { query: 'q' })
    ).rejects.toThrow(/API Key/)
  })

  it('search 模型未返回文本抛 emptyResult', async () => {
    postMock.mockResolvedValueOnce({ data: { content: [{ type: 'text', text: '' }] } })
    await expect(deepseekSearchAdapter.search(provider(), { query: 'q' })).rejects.toThrow(
      /未返回结果/
    )
  })

  it('search JSON 解析失败抛 parseFailed', async () => {
    postMock.mockResolvedValueOnce({
      data: { content: [{ type: 'text', text: 'not json at all' }] }
    })
    await expect(deepseekSearchAdapter.search(provider(), { query: 'q' })).rejects.toThrow(
      /解析上游响应失败/
    )
  })

  it('search 上游 HTTP 失败抛 searchFailed（包含原始 detail）', async () => {
    const err = Object.assign(new Error('Bad Gateway'), {
      isAxiosError: true,
      response: { status: 502, data: 'upstream timeout' }
    })
    postMock.mockRejectedValueOnce(err)
    await expect(deepseekSearchAdapter.search(provider(), { query: 'q' })).rejects.toThrow(
      /搜索失败.*502/
    )
  })

  it('search 接受带 /v1 末尾的 baseUrl（不重复拼 /v1）', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        content: [{ type: 'text', text: '{"hits":[]}' }]
      }
    })
    await deepseekSearchAdapter.search(
      provider({ baseUrl: 'https://api.deepseek.com/anthropic/v1' }),
      { query: 'q' }
    )
    const [url] = postMock.mock.calls[0]!
    expect(url).toBe('https://api.deepseek.com/anthropic/v1/messages')
  })

  it('search 接受不带 /v1 的 baseUrl（自动补 /v1/messages）', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        content: [{ type: 'text', text: '{"hits":[]}' }]
      }
    })
    await deepseekSearchAdapter.search(
      provider({ baseUrl: 'https://api.deepseek.com/anthropic' }),
      { query: 'q' }
    )
    const [url] = postMock.mock.calls[0]!
    expect(url).toBe('https://api.deepseek.com/anthropic/v1/messages')
  })
})
