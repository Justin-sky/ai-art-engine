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

import { openAiAdapter } from '../src/main/services/modelProviders/openai/adapter'

function provider(overrides?: Partial<ModelProviderInstance>): ModelProviderInstance {
  return {
    id: 'oa-1',
    providerKind: 'openai',
    label: 'OpenAI',
    apiKey: 'sk-test',
    baseUrl: 'https://api.openai.com/v1',
    enabled: true,
    modalities: createEmptyModalityMap(),
    ...overrides
  }
}

describe('openAiAdapter', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('returns static image catalog', async () => {
    const images = await openAiAdapter.fetchCatalog(provider(), 'image')
    expect(images.some((m) => m.id === 'gpt-image-1')).toBe(true)
    expect(images.some((m) => m.id === 'gpt-image-2')).toBe(true)
  })

  it('fetches and filters text catalog from GET /models', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        data: [
          { id: 'gpt-5.5' },
          { id: 'gpt-4o-mini' },
          { id: 'gpt-image-1' },
          { id: 'whisper-1' },
          { id: 'o3' }
        ]
      }
    })
    const models = await openAiAdapter.fetchCatalog(provider(), 'text')
    expect(models.map((m) => m.id).sort()).toEqual(['gpt-4o-mini', 'gpt-5.5', 'o3'])
  })

  it('returns empty catalog for unsupported modalities', async () => {
    expect(await openAiAdapter.fetchCatalog(provider(), 'video')).toEqual([])
    expect(await openAiAdapter.fetchCatalog(provider(), 'audio')).toEqual([])
  })

  it('delegates text generation to OpenAI compatible client', async () => {
    const result = await openAiAdapter.generateText(provider(), 'gpt-5.5', {
      prompt: 'hello'
    })
    expect(result.text).toBe('echo:hello')
    expect(result.model).toBe('gpt-5.5')
  })

  it('generates text-to-image with mapped size and quality', async () => {
    postMock.mockResolvedValueOnce({
      data: { data: [{ b64_json: 'QUJD' }] }
    })
    const result = await openAiAdapter.generateImage(provider(), 'gpt-image-1', {
      prompt: 'a cat',
      aspectRatio: '16:9',
      quality: 'medium',
      n: 2
    })
    expect(postMock).toHaveBeenCalledWith(
      '/images/generations',
      { model: 'gpt-image-1', prompt: 'a cat', size: '1536x1024', quality: 'medium', n: 2 }
    )
    expect(result.images[0]).toBe('data:image/png;base64,QUJD')
  })

  it('sends reference image via /images/edits multipart form', async () => {
    postMock.mockResolvedValueOnce({
      data: { data: [{ url: 'https://cdn.example.com/out.png' }] }
    })
    const result = await openAiAdapter.generateImage(provider(), 'gpt-image-1', {
      prompt: 'make it red',
      aspectRatio: '1:1',
      inputReferences: ['data:image/png;base64,iVBORw0KGgo=']
    })
    expect(postMock).toHaveBeenCalledTimes(1)
    const [path, form] = postMock.mock.calls[0] as [string, FormData, unknown]
    expect(path).toBe('/images/edits')
    expect(form.get('model')).toBe('gpt-image-1')
    expect(form.get('prompt')).toBe('make it red')
    expect(form.get('size')).toBe('1024x1024')
    expect(form.get('image')).toBeInstanceOf(Blob)
    expect(result.images[0]).toBe('https://cdn.example.com/out.png')
  })

  it('rejects video and speech with a clear message', async () => {
    await expect(
      openAiAdapter.generateSpeech(provider(), 'tts-1', { input: 'hi' })
    ).rejects.toThrow(/仅支持文本与图片/)
    await expect(
      openAiAdapter.submitVideo(provider(), 'sora-2', { prompt: 'x' })
    ).rejects.toThrow(/仅支持文本与图片/)
  })
})
