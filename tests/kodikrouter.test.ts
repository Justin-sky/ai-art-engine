import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyModalityMap, type ModelProviderInstance } from '../src/shared/modelProvider'
import { isKodikRouterBaseUrl } from '../src/shared/modelProviders/kodikrouter'

const getMock = vi.fn()
const postMock = vi.fn()

vi.mock('axios', () => ({
  default: {
    create: () => ({
      get: getMock,
      post: postMock,
      interceptors: { request: { use: () => undefined } }
    }),
    isAxiosError: (err: unknown) =>
      Boolean(err && typeof err === 'object' && (err as { isAxiosError?: boolean }).isAxiosError)
  }
}))

import { customAdapter } from '../src/main/services/modelProviders/custom/adapter'

function provider(overrides?: Partial<ModelProviderInstance>): ModelProviderInstance {
  return {
    id: 'custom-1',
    providerKind: 'custom',
    apiStyle: 'openai',
    label: 'Custom',
    apiKey: 'sk-test',
    baseUrl: 'https://gateway.example/v1',
    enabled: true,
    modalities: createEmptyModalityMap(),
    ...overrides
  }
}

describe('KodikRouter 地址只影响语音的 voice 字段', () => {
  it('只认 kodikrouter.ru 及其子域', () => {
    expect(isKodikRouterBaseUrl('https://api.kodikrouter.ru/v1')).toBe(true)
    expect(isKodikRouterBaseUrl('https://kodikrouter.ru.evil.com')).toBe(false)
    expect(isKodikRouterBaseUrl('')).toBe(false)
  })
})

describe('customAdapter · OpenAI 兼容语音', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('语音目录不从 GET /models 拉，和图片一样手填', async () => {
    const models = await customAdapter.fetchCatalog(provider(), 'audio')
    expect(models).toEqual([])
    expect(getMock).not.toHaveBeenCalled()
  })

  it('Kodik 上 seed-audio 也必须带上用户填的 voice', async () => {
    postMock.mockResolvedValueOnce({ data: new Uint8Array([1, 2, 3]) })
    await customAdapter.generateSpeech(
      provider({ baseUrl: 'https://api.kodikrouter.ru/v1' }),
      'bytedance-seed/seed-audio-1-0',
      { input: 'Hello', voice: 'zh_female_vv_uranus_bigtts' }
    )
    const [path, body] = postMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(path).toBe('/audio/speech')
    expect(body.voice).toBe('zh_female_vv_uranus_bigtts')
  })

  it('Kodik 上没填 voice 时直接报错', async () => {
    await expect(
      customAdapter.generateSpeech(
        provider({ baseUrl: 'https://api.kodikrouter.ru/v1' }),
        'bytedance-seed/seed-audio-1-0',
        { input: 'Hello' }
      )
    ).rejects.toThrow(/音色 ID/)
    expect(postMock).not.toHaveBeenCalled()
  })

  it('其它 OpenAI 兼容网关仍按无音色模型省略 voice', async () => {
    postMock.mockResolvedValueOnce({ data: new Uint8Array([1, 2, 3]) })
    await customAdapter.generateSpeech(provider(), 'bytedance-seed/seed-audio-1-0', {
      input: 'Hello',
      voice: 'alloy'
    })
    const body = postMock.mock.calls[0]?.[1] as Record<string, unknown>
    expect(body).not.toHaveProperty('voice')
  })

  it('视频始终不支持，包括 Kodik 地址', async () => {
    await expect(
      customAdapter.submitVideo(provider({ baseUrl: 'https://api.kodikrouter.ru/v1' }), 'sora-2', {
        prompt: 'x'
      })
    ).rejects.toThrow(/暂不支持/)
    expect(postMock).not.toHaveBeenCalled()
  })
})
