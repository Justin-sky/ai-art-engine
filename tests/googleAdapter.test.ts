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

  it('fetches and filters Gemini text catalog from GET /models (both bare and models/ prefixed IDs)', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        data: [
          { id: 'models/gemini-2.5-flash' },
          { id: 'models/gemini-2.5-pro' },
          { id: 'gemini-3-pro-preview' },
          { id: 'models/gemini-2.5-flash-image' },
          { id: 'models/veo-3.1-generate-001' },
          { id: 'models/gemini-embedding-001' },
          { id: 'models/aqa' },
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

  it('supports native Gemini /v1beta/models payload ({ models: [{ name: "models/..." }] })', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        models: [
          {
            name: 'models/gemini-2.5-flash',
            supportedGenerationMethods: ['generateContent', 'countTokens']
          },
          {
            name: 'models/gemini-2.5-pro',
            supportedGenerationMethods: ['generateContent']
          },
          {
            name: 'models/gemini-embedding-001',
            supportedGenerationMethods: ['embedContent']
          }
        ]
      }
    })
    const models = await googleAdapter.fetchCatalog(provider(), 'text')
    expect(models.map((m) => m.id).sort()).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro'])
  })

  it('returns static image and video catalogs with capabilities', async () => {
    const images = await googleAdapter.fetchCatalog(provider(), 'image')
    expect(images.map((m) => m.id)).toContain('gemini-2.5-flash-image')
    const image = images.find((m) => m.id === 'gemini-2.5-flash-image')
    expect(image?.capabilities?.supported_parameters).toBeTruthy()

    const videos = await googleAdapter.fetchCatalog(provider(), 'video')
    expect(videos.map((m) => m.id)).toContain('veo-3.1-generate-001')
    const video = videos.find((m) => m.id === 'veo-3.1-generate-001')
    expect(video?.capabilities?.supported_resolutions).toContain('4K')
    expect(video?.capabilities?.supported_durations).toContain(8)
    expect(await googleAdapter.fetchCatalog(provider(), 'audio')).toEqual([])
  })

  it('delegates text generation to OpenAI compatible client and strips models/ prefix', async () => {
    const result = await googleAdapter.generateText(provider(), 'models/gemini-2.5-flash', {
      prompt: 'hi'
    })
    expect(result.text).toBe('echo:hi')
    expect(result.model).toBe('gemini-2.5-flash')
  })

  it('generates Gemini / Nano Banana images via native /models/{model}:generateContent with imageConfig', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: 'image/png',
                    data: 'aGVsbG8='
                  }
                }
              ]
            }
          }
        ]
      }
    })
    const result = await googleAdapter.generateImage(provider(), 'models/gemini-3.1-flash-image', {
      prompt: 'a cat',
      aspectRatio: '16:9',
      resolution: '2K',
      n: 1
    })
    expect(postMock).toHaveBeenCalledWith('/models/gemini-3.1-flash-image:generateContent', {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'a cat' }]
        }
      ],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          aspectRatio: '16:9',
          imageSize: '2K'
        }
      }
    })
    expect(result.images[0]).toBe('data:image/png;base64,aGVsbG8=')
    expect(result.model).toBe('gemini-3.1-flash-image')
  })

  it('passes reference images as inlineData parts in :generateContent', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        candidates: [
          {
            content: {
              parts: [
                {
                  inline_data: {
                    mime_type: 'image/png',
                    data: 'b3V0'
                  }
                }
              ]
            }
          }
        ]
      }
    })
    const result = await googleAdapter.generateImage(provider(), 'gemini-3-pro-image-preview', {
      prompt: 'give @1 a hat like @2',
      inputReferences: ['data:image/png;base64,cmVmMQ==', 'data:image/jpeg;base64,cmVmMg==']
    })
    expect(postMock).toHaveBeenCalledWith('/models/gemini-3-pro-image-preview:generateContent', {
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/png', data: 'cmVmMQ==' } },
            { inlineData: { mimeType: 'image/jpeg', data: 'cmVmMg==' } },
            { text: 'give 图1 a hat like 图2' }
          ]
        }
      ],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE']
      }
    })
    expect(result.images[0]).toBe('data:image/png;base64,b3V0')
  })

  it('falls back to /images/generations on third-party relays and strips unknown resolution field if rejected', async () => {
    postMock
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 404, data: { error: { message: 'Not Found' } } }
      })
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: {
          status: 400,
          data: {
            error: {
              message:
                'Invalid JSON payload received. Unknown name "resolution": Cannot find field.'
            }
          }
        }
      })
      .mockResolvedValueOnce({
        data: { data: [{ b64_json: 'aGVsbG8=' }] }
      })

    const relayProvider = provider({ baseUrl: 'https://relay.example.com/v1' })
    const result = await googleAdapter.generateImage(relayProvider, 'gemini-2.5-flash-image', {
      prompt: 'a cat',
      aspectRatio: '16:9',
      resolution: '1K'
    })
    expect(postMock).toHaveBeenNthCalledWith(3, '/images/generations', {
      model: 'gemini-2.5-flash-image',
      prompt: 'a cat',
      response_format: 'b64_json'
    })
    expect(result.images[0]).toBe('data:image/png;base64,aGVsbG8=')
  })

  it('explains Google AI Studio Free Tier 0-quota error clearly when limit: 0 is returned', async () => {
    postMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 429,
        data: {
          error: {
            message:
              'You exceeded your current quota. * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-3.1-flash-image'
          }
        }
      }
    })

    await expect(
      googleAdapter.generateImage(provider(), 'gemini-3.1-flash-image', {
        prompt: 'a cat',
        aspectRatio: '1:1',
        resolution: '1K'
      })
    ).rejects.toThrow(/Free Tier|免费配额为 0|Paid Tier 1/)
  })

  it('submits video to /videos with duration_seconds (snapped to 4/6/8) and lowercase resolution', async () => {
    postMock.mockResolvedValueOnce({ data: { id: 'video-123' } })
    const job = await googleAdapter.submitVideo(provider(), 'models/veo-3.1-generate-preview', {
      prompt: 'ocean waves',
      duration: 5,
      resolution: '4K',
      aspectRatio: '1:1',
      firstFrameImageUrl: 'data:image/png;base64,Zmlyc3Q='
    })
    expect(postMock).toHaveBeenCalledWith('/videos', {
      model: 'veo-3.1-generate-preview',
      prompt: 'ocean waves',
      duration_seconds: 6,
      resolution: '4k',
      aspect_ratio: '16:9',
      image: 'data:image/png;base64,Zmlyc3Q='
    })
    expect(job.jobId).toBe('video-123')
    expect(job.pollingUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/videos/video-123'
    )
  })

  it('explains Google AI Studio Free Tier video quota error clearly', async () => {
    postMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 429,
        data: {
          error: {
            message:
              'You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.'
          }
        }
      }
    })

    await expect(
      googleAdapter.submitVideo(provider(), 'veo-3.1-generate-preview', {
        prompt: 'ocean waves',
        duration: 5,
        resolution: '720p',
        aspectRatio: '16:9'
      })
    ).rejects.toThrow(/Free Tier|无免费配额|Paid Tier 1/)
  })

  it('polls video until done and extracts video_url as download address', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        id: 'video-123',
        status: 'completed',
        video_url: 'https://example.com/v.mp4'
      }
    })
    const result = await googleAdapter.pollVideo(provider(), {
      jobId: 'video-123',
      pollingUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/videos/video-123'
    })
    expect(result.status).toBe('completed')
    expect(result.progress).toBe(100)
    expect(result.downloadUrl).toBe('https://example.com/v.mp4')
  })

  it('maps queued / failed video job statuses', async () => {
    getMock.mockResolvedValueOnce({
      data: { id: 'video-123', status: 'queued' }
    })
    const queued = await googleAdapter.pollVideo(provider(), {
      jobId: 'video-123',
      pollingUrl: '/videos/video-123'
    })
    expect(queued.status).toBe('pending')

    getMock.mockResolvedValueOnce({
      data: { id: 'video-123', status: 'failed', error: { message: 'boom' } }
    })
    const failed = await googleAdapter.pollVideo(provider(), {
      jobId: 'video-123',
      pollingUrl: '/videos/video-123'
    })
    expect(failed.status).toBe('failed')
    expect(failed.error).toBe('boom')
    expect(failed.downloadUrl).toBeUndefined()
  })

  it('rejects speech with a clear message', async () => {
    await expect(
      googleAdapter.generateSpeech(provider(), 'tts-1', { input: 'hi' })
    ).rejects.toThrow(/仅支持文本/)
  })
})
