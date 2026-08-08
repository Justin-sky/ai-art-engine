import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelProviderInstance } from '../src/shared/modelProvider'
import { createEmptyModalityMap } from '../src/shared/modelProvider'

const getMock = vi.fn()
const postMock = vi.fn()

vi.mock('axios', () => ({
  default: {
    create: () => ({
      get: getMock,
      post: postMock,
      interceptors: {
        request: { use: () => undefined }
      }
    }),
    isAxiosError: (err: unknown) =>
      Boolean(err && typeof err === 'object' && (err as { isAxiosError?: boolean }).isAxiosError)
  }
}))

vi.mock('../src/main/services/modelProviders/openaiCompat', () => ({
  generateOpenAiCompatibleText: vi.fn(async (_p, modelId: string, input: { prompt: string }) => ({
    text: `echo:${input.prompt}`,
    model: modelId
  }))
}))

import { zhipuAdapter } from '../src/main/services/modelProviders/zhipu/adapter'

function provider(overrides?: Partial<ModelProviderInstance>): ModelProviderInstance {
  return {
    id: 'zp-1',
    providerKind: 'zhipu',
    label: '智谱',
    apiKey: 'sk-test',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    enabled: true,
    modalities: createEmptyModalityMap(),
    ...overrides
  }
}

describe('zhipuAdapter', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('returns static image catalog', async () => {
    const images = await zhipuAdapter.fetchCatalog(provider(), 'image')
    expect(images.some((m) => m.id === 'cogview-4')).toBe(true)
    expect(images.some((m) => m.id === 'glm-image')).toBe(true)
  })

  it('fetches and filters GLM text catalog from GET /models', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        data: [{ id: 'glm-5.2' }, { id: 'glm-4-flash' }, { id: 'cogview-4' }]
      }
    })
    const models = await zhipuAdapter.fetchCatalog(provider(), 'text')
    expect(models.map((m) => m.id).sort()).toEqual(['glm-4-flash', 'glm-5.2'])
  })

  it('falls back to static GLM list when GET /models is unavailable', async () => {
    getMock.mockRejectedValueOnce(new Error('404'))
    const models = await zhipuAdapter.fetchCatalog(provider(), 'text')
    expect(models.some((m) => m.id === 'glm-5.2')).toBe(true)
    expect(models.some((m) => m.id === 'glm-4-flash')).toBe(true)
  })

  it('returns empty catalog for non-text/image modalities', async () => {
    expect(await zhipuAdapter.fetchCatalog(provider(), 'video')).toEqual([])
    expect(await zhipuAdapter.fetchCatalog(provider(), 'audio')).toEqual([])
  })

  it('delegates text generation to OpenAI compatible client', async () => {
    const result = await zhipuAdapter.generateText(provider(), 'glm-5.2', {
      prompt: 'hi'
    })
    expect(result.text).toBe('echo:hi')
    expect(result.model).toBe('glm-5.2')
  })

  it('generates text-to-image with mapped size', async () => {
    postMock.mockResolvedValueOnce({
      data: { data: [{ url: 'https://cdn.example.com/img.png' }] }
    })
    const result = await zhipuAdapter.generateImage(provider(), 'cogview-4', {
      prompt: '一只猫',
      aspectRatio: '16:9'
    })
    expect(postMock).toHaveBeenCalledWith('/images/generations', {
      model: 'cogview-4',
      prompt: '一只猫',
      size: '1344x768'
    })
    expect(result.images[0]).toBe('https://cdn.example.com/img.png')
  })

  it('rejects reference images for CogView', async () => {
    await expect(
      zhipuAdapter.generateImage(provider(), 'cogview-4', {
        prompt: 'x',
        inputReferences: ['data:image/png;base64,iVBORw0KGgo=']
      })
    ).rejects.toThrow(/不支持参考图/)
  })

  it('rejects video and speech with a clear message', async () => {
    await expect(
      zhipuAdapter.generateSpeech(provider(), 'tts-1', { input: 'hi' })
    ).rejects.toThrow(/仅支持文本与图片/)
    await expect(
      zhipuAdapter.submitVideo(provider(), 'cogvideox', { prompt: 'x' })
    ).rejects.toThrow(/仅支持文本与图片/)
  })
})
