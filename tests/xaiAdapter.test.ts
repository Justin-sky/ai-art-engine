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

import { xaiAdapter } from '../src/main/services/modelProviders/xai/adapter'

function provider(overrides?: Partial<ModelProviderInstance>): ModelProviderInstance {
  return {
    id: 'xai-1',
    providerKind: 'xai',
    label: 'xAI（Grok）',
    apiKey: 'xai-test',
    baseUrl: 'https://api.x.ai/v1',
    enabled: true,
    modalities: createEmptyModalityMap(),
    ...overrides
  }
}

describe('xaiAdapter', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('fetches and filters Grok text catalog from GET /models', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        data: [
          { id: 'grok-4' },
          { id: 'grok-4-reasoning' },
          { id: 'grok-4-vision' },
          { id: 'grok-4.1-fast' },
          { id: 'grok-imagine-image' },
          { id: 'grok-imagine-video' },
          { id: 'grok-embedding-1' },
          { id: 'some-other-model' }
        ]
      }
    })
    const models = await xaiAdapter.fetchCatalog(provider(), 'text')
    expect(models.map((m) => m.id).sort()).toEqual([
      'grok-4',
      'grok-4-reasoning',
      'grok-4-vision',
      'grok-4.1-fast'
    ])
    expect(getMock).toHaveBeenCalledWith('/models')
  })

  it('returns static image and video catalogs with capabilities', async () => {
    const images = await xaiAdapter.fetchCatalog(provider(), 'image')
    expect(images.map((m) => m.id)).toContain('grok-imagine-image')
    const image = images.find((m) => m.id === 'grok-imagine-image')
    expect(image?.capabilities?.supported_parameters).toBeTruthy()

    const videos = await xaiAdapter.fetchCatalog(provider(), 'video')
    expect(videos.map((m) => m.id)).toContain('grok-imagine-video')
    const video = videos.find((m) => m.id === 'grok-imagine-video')
    expect(video?.capabilities?.supported_resolutions).toContain('720p')
    expect(video?.capabilities?.supported_durations).toContain(10)
  })

  it('delegates text generation to OpenAI compatible client', async () => {
    const result = await xaiAdapter.generateText(provider(), 'grok-4', { prompt: 'hi' })
    expect(result.text).toBe('echo:hi')
    expect(result.model).toBe('grok-4')
  })

  it('generates images via JSON /images/generations with aspect_ratio and base64 output', async () => {
    postMock.mockResolvedValueOnce({
      data: { data: [{ b64_json: 'aGVsbG8=' }] }
    })
    const result = await xaiAdapter.generateImage(provider(), 'grok-imagine-image', {
      prompt: 'a cat',
      aspectRatio: '16:9',
      resolution: '1K',
      n: 2
    })
    expect(postMock).toHaveBeenCalledWith('/images/generations', {
      model: 'grok-imagine-image',
      prompt: 'a cat',
      response_format: 'b64_json',
      aspect_ratio: '16:9',
      resolution: '1K',
      n: 2
    })
    expect(result.images[0]).toBe('data:image/png;base64,aGVsbG8=')
    expect(result.model).toBe('grok-imagine-image')
  })

  it('submits video to /videos/generations and builds polling URL from request_id', async () => {
    postMock.mockResolvedValueOnce({ data: { request_id: 'req-123' } })
    const job = await xaiAdapter.submitVideo(provider(), 'grok-imagine-video', {
      prompt: 'ocean waves',
      duration: 10,
      resolution: '720p',
      aspectRatio: '16:9',
      firstFrameImageUrl: 'data:image/png;base64,Zmlyc3Q='
    })
    expect(postMock).toHaveBeenCalledWith('/videos/generations', {
      model: 'grok-imagine-video',
      prompt: 'ocean waves',
      duration: 10,
      resolution: '720p',
      aspect_ratio: '16:9',
      image: 'data:image/png;base64,Zmlyc3Q='
    })
    expect(job.jobId).toBe('req-123')
    expect(job.pollingUrl).toBe('https://api.x.ai/v1/videos/req-123')
  })

  it('polls video until done and extracts video.url as download address', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        status: 'processing',
        video: { url: 'https://cdn.x.ai/out.mp4' }
      }
    })
    const pending = await xaiAdapter.pollVideo(provider(), {
      jobId: 'req-123',
      pollingUrl: 'https://api.x.ai/v1/videos/req-123'
    })
    expect(pending.status).toBe('in_progress')

    getMock.mockResolvedValueOnce({
      data: {
        status: 'done',
        video: { url: 'https://cdn.x.ai/out.mp4' }
      }
    })
    const done = await xaiAdapter.pollVideo(provider(), {
      jobId: 'req-123',
      pollingUrl: 'https://api.x.ai/v1/videos/req-123'
    })
    expect(done.status).toBe('completed')
    expect(done.downloadUrl).toBe('https://cdn.x.ai/out.mp4')
  })

  it('maps failed video polling status with the provider error message', async () => {
    getMock.mockResolvedValueOnce({
      data: { status: 'failed', error: { message: 'rate limited' } }
    })
    const failed = await xaiAdapter.pollVideo(provider(), {
      jobId: 'req-123',
      pollingUrl: 'https://api.x.ai/v1/videos/req-123'
    })
    expect(failed.status).toBe('failed')
    expect(failed.error).toBe('rate limited')
  })

  it('rejects speech synthesis as unsupported', async () => {
    await expect(
      xaiAdapter.generateSpeech(provider(), 'grok-tts', { input: 'hi' })
    ).rejects.toThrow(/暂未接入语音合成/)
  })
})
