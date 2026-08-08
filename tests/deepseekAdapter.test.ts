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

import { deepSeekAdapter } from '../src/main/services/modelProviders/deepseek/adapter'

function provider(overrides?: Partial<ModelProviderInstance>): ModelProviderInstance {
  return {
    id: 'ds-1',
    providerKind: 'deepseek',
    label: 'DeepSeek',
    apiKey: 'sk-test',
    baseUrl: 'https://api.deepseek.com',
    enabled: true,
    modalities: createEmptyModalityMap(),
    ...overrides
  }
}

describe('deepSeekAdapter', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('fetches and filters text catalog from GET /models', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        data: [
          { id: 'deepseek-chat' },
          { id: 'deepseek-reasoner' },
          { id: 'some-other-model' }
        ]
      }
    })
    const models = await deepSeekAdapter.fetchCatalog(provider(), 'text')
    expect(models.map((m) => m.id).sort()).toEqual(['deepseek-chat', 'deepseek-reasoner'])
    expect(getMock).toHaveBeenCalledWith('/models')
  })

  it('returns empty catalog for non-text modalities', async () => {
    expect(await deepSeekAdapter.fetchCatalog(provider(), 'image')).toEqual([])
    expect(await deepSeekAdapter.fetchCatalog(provider(), 'video')).toEqual([])
    expect(await deepSeekAdapter.fetchCatalog(provider(), 'audio')).toEqual([])
  })

  it('delegates text generation to OpenAI compatible client', async () => {
    const result = await deepSeekAdapter.generateText(provider(), 'deepseek-chat', {
      prompt: 'hi'
    })
    expect(result.text).toBe('echo:hi')
    expect(result.model).toBe('deepseek-chat')
  })

  it('rejects image, video and speech with a clear message', async () => {
    await expect(
      deepSeekAdapter.generateImage(provider(), 'gpt-image-1', { prompt: 'x' })
    ).rejects.toThrow(/仅支持文本/)
    await expect(
      deepSeekAdapter.generateSpeech(provider(), 'tts-1', { input: 'hi' })
    ).rejects.toThrow(/仅支持文本/)
    await expect(
      deepSeekAdapter.submitVideo(provider(), 'sora-2', { prompt: 'x' })
    ).rejects.toThrow(/仅支持文本/)
  })
})
