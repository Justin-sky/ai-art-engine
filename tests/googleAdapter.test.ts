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

  it('delegates text generation to OpenAI compatible client', async () => {
    const result = await googleAdapter.generateText(provider(), 'gemini-2.5-flash', {
      prompt: 'hi'
    })
    expect(result.text).toBe('echo:hi')
    expect(result.model).toBe('gemini-2.5-flash')
  })

  it('generates images via JSON /images/generations with aspect_ratio and base64 output', async () => {
    postMock.mockResolvedValueOnce({
      data: { data: [{ b64_json: 'aGVsbG8=' }] }
    })
    const result = await googleAdapter.generateImage(provider(), 'gemini-2.5-flash-image', {
      prompt: 'a cat',
      aspectRatio: '16:9',
      resolution: '2K',
      n: 2
    })
    expect(postMock).toHaveBeenCalledWith('/images/generations', {
      model: 'gemini-2.5-flash-image',
      prompt: 'a cat',
      response_format: 'b64_json',
      aspect_ratio: '16:9',
      resolution: '2K',
      n: 2
    })
    expect(result.images[0]).toBe('data:image/png;base64,aGVsbG8=')
    expect(result.model).toBe('gemini-2.5-flash-image')
  })

  it('passes reference images in the image field for image editing', async () => {
    postMock.mockResolvedValueOnce({
      data: { data: [{ url: 'https://example.com/out.png' }] }
    })
    const result = await googleAdapter.generateImage(
      provider(),
      'gemini-3-pro-image-preview',
      {
        prompt: 'add a hat',
        inputReferences: ['data:image/png;base64,cmVmMQ==', 'data:image/png;base64,cmVmMg==']
      }
    )
    expect(postMock).toHaveBeenCalledWith('/images/generations', {
      model: 'gemini-3-pro-image-preview',
      prompt: 'add a hat',
      response_format: 'b64_json',
      image: ['data:image/png;base64,cmVmMQ==', 'data:image/png;base64,cmVmMg==']
    })
    expect(result.images[0]).toBe('https://example.com/out.png')
  })

  it('submits video to /videos and builds polling URL from id', async () => {
    postMock.mockResolvedValueOnce({ data: { id: 'video-123' } })
    const job = await googleAdapter.submitVideo(provider(), 'veo-3.1-generate-preview', {
      prompt: 'ocean waves',
      duration: 10,
      resolution: '1080p',
      aspectRatio: '16:9',
      firstFrameImageUrl: 'data:image/png;base64,Zmlyc3Q='
    })
    expect(postMock).toHaveBeenCalledWith('/videos', {
      model: 'veo-3.1-generate-preview',
      prompt: 'ocean waves',
      duration: 8,
      resolution: '1080p',
      aspect_ratio: '16:9',
      image: 'data:image/png;base64,Zmlyc3Q='
    })
    expect(job.jobId).toBe('video-123')
    expect(job.pollingUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/videos/video-123'
    )
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
