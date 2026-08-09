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

import { googleAdapter } from '../src/main/services/modelProviders/google/adapter'

function provider(overrides?: Partial<ModelProviderInstance>): ModelProviderInstance {
  return {
    id: 'gg-1',
    providerKind: 'google',
    label: 'Google（Gemini）',
    apiKey: 'ai-test',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    enabled: true,
    modalities: createEmptyModalityMap(),
    ...overrides
  }
}

describe('googleAdapter', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('fetches and filters Gemini text catalog from GET /models', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        data: [
          { id: 'gemini-2.5-flash' },
          { id: 'gemini-2.5-pro' },
          { id: 'gemini-3-pro-preview' },
          { id: 'gemini-2.5-flash-image' },
          { id: 'veo-3.1-generate-001' },
          { id: 'gemini-embedding-001' },
          { id: 'some-other-model' }
        ]
      }
    })
    const models = await googleAdapter.fetchCatalog(provider(), 'text')
    expect(models.map((m) => m.id).sort()).toEqual([
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-3-pro-preview'
    ])
    expect(getMock).toHaveBeenCalledWith('/models')
  })

  it('returns empty catalog for non-text modalities', async () => {
    expect(await googleAdapter.fetchCatalog(provider(), 'image')).toEqual([])
    expect(await googleAdapter.fetchCatalog(provider(), 'video')).toEqual([])
    expect(await googleAdapter.fetchCatalog(provider(), 'audio')).toEqual([])
  })

  it('delegates text generation to OpenAI compatible client', async () => {
    const result = await googleAdapter.generateText(provider(), 'gemini-2.5-flash', {
      prompt: 'hi'
    })
    expect(result.text).toBe('echo:hi')
    expect(result.model).toBe('gemini-2.5-flash')
  })

  it('rejects image, video and speech with a clear message', async () => {
    await expect(
      googleAdapter.generateImage(provider(), 'gemini-2.5-flash-image', { prompt: 'x' })
    ).rejects.toThrow(/仅支持文本/)
    await expect(
      googleAdapter.generateSpeech(provider(), 'tts-1', { input: 'hi' })
    ).rejects.toThrow(/仅支持文本/)
    await expect(
      googleAdapter.submitVideo(provider(), 'veo-3.1', { prompt: 'x' })
    ).rejects.toThrow(/仅支持文本/)
  })
})
