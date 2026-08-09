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

import { moonshotAdapter } from '../src/main/services/modelProviders/moonshot/adapter'

function provider(overrides?: Partial<ModelProviderInstance>): ModelProviderInstance {
  return {
    id: 'ms-1',
    providerKind: 'moonshot',
    label: 'Kimi（月之暗面）',
    apiKey: 'sk-test',
    baseUrl: 'https://api.moonshot.cn/v1',
    enabled: true,
    modalities: createEmptyModalityMap(),
    ...overrides
  }
}

describe('moonshotAdapter', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('fetches and filters text catalog from GET /models', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        data: [
          { id: 'kimi-k2' },
          { id: 'moonshot-v1-128k' },
          { id: 'some-other-model' }
        ]
      }
    })
    const models = await moonshotAdapter.fetchCatalog(provider(), 'text')
    expect(models.map((m) => m.id).sort()).toEqual(['kimi-k2', 'moonshot-v1-128k'])
    expect(getMock).toHaveBeenCalledWith('/models')
  })

  it('returns empty catalog for non-text modalities', async () => {
    expect(await moonshotAdapter.fetchCatalog(provider(), 'image')).toEqual([])
    expect(await moonshotAdapter.fetchCatalog(provider(), 'video')).toEqual([])
    expect(await moonshotAdapter.fetchCatalog(provider(), 'audio')).toEqual([])
  })

  it('delegates text generation to OpenAI compatible client', async () => {
    const result = await moonshotAdapter.generateText(provider(), 'kimi-k2', {
      prompt: 'hi'
    })
    expect(result.text).toBe('echo:hi')
    expect(result.model).toBe('kimi-k2')
  })

  it('rejects image, video and speech with a clear message', async () => {
    await expect(
      moonshotAdapter.generateImage(provider(), 'gpt-image-1', { prompt: 'x' })
    ).rejects.toThrow(/仅支持文本/)
    await expect(
      moonshotAdapter.generateSpeech(provider(), 'tts-1', { input: 'hi' })
    ).rejects.toThrow(/仅支持文本/)
    await expect(
      moonshotAdapter.submitVideo(provider(), 'sora-2', { prompt: 'x' })
    ).rejects.toThrow(/仅支持文本/)
  })
})
