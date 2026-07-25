import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelProviderInstance } from '../src/shared/openrouter'
import { createEmptyModalityMap } from '../src/shared/openrouter'

const getMock = vi.fn()
const postMock = vi.fn()

vi.mock('axios', () => ({
  default: {
    create: () => ({
      get: getMock,
      post: postMock,
      interceptors: {
        request: { use: (fn: (cfg: { headers?: Record<string, string> }) => unknown) => fn({}) }
      }
    }),
    isAxiosError: (err: unknown) =>
      Boolean(err && typeof err === 'object' && (err as { isAxiosError?: boolean }).isAxiosError)
  }
}))

import { klingAdapter } from '../src/main/services/modelProviders/kling/adapter'

function provider(overrides?: Partial<ModelProviderInstance>): ModelProviderInstance {
  return {
    id: 'kling-1',
    providerKind: 'kling',
    label: '可灵',
    apiKey: 'ak-test',
    secretKey: 'sk-test',
    baseUrl: 'https://api-beijing.klingai.com',
    enabled: true,
    modalities: createEmptyModalityMap(),
    ...overrides
  }
}

describe('klingAdapter', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('rejects missing secret key on auth', async () => {
    await expect(klingAdapter.assertAuth(provider({ secretKey: '' }))).rejects.toThrow(/Secret Key/)
  })

  it('returns static image/video catalogs', async () => {
    const images = await klingAdapter.fetchCatalog(provider(), 'image')
    const videos = await klingAdapter.fetchCatalog(provider(), 'video')
    expect(images.some((m) => m.id === 'kling-v2')).toBe(true)
    expect(videos.some((m) => m.id === 'kling-v2-6')).toBe(true)
    expect(await klingAdapter.fetchCatalog(provider(), 'text')).toEqual([])
  })

  it('throws for text/speech', async () => {
    await expect(klingAdapter.generateText(provider(), 'x', { prompt: 'hi' })).rejects.toThrow(
      /不支持文本/
    )
    await expect(
      klingAdapter.generateSpeech(provider(), 'x', { input: 'hi' })
    ).rejects.toThrow(/不支持语音/)
  })

  it('submits text2video when no first frame', async () => {
    postMock.mockResolvedValueOnce({
      data: { code: 0, data: { task_id: 't1', task_status: 'submitted' } }
    })
    const job = await klingAdapter.submitVideo(provider(), 'kling-v2-6', {
      prompt: 'a cat',
      duration: 5,
      aspectRatio: '16:9'
    })
    expect(job.jobId).toBe('t1')
    expect(job.pollingUrl).toContain('/v1/videos/text2video/t1')
    expect(postMock).toHaveBeenCalledWith(
      '/v1/videos/text2video',
      expect.objectContaining({
        model_name: 'kling-v2-6',
        prompt: 'a cat',
        duration: '5',
        aspect_ratio: '16:9'
      })
    )
  })

  it('submits image2video when first frame present', async () => {
    postMock.mockResolvedValueOnce({
      data: { code: 0, data: { task_id: 't2', task_status: 'submitted' } }
    })
    const job = await klingAdapter.submitVideo(provider(), 'kling-v2-1', {
      prompt: 'move',
      firstFrameImageUrl: 'https://example.com/a.png',
      lastFrameImageUrl: 'https://example.com/b.png',
      generateAudio: true
    })
    expect(job.pollingUrl).toContain('/v1/videos/image2video/t2')
    expect(postMock).toHaveBeenCalledWith(
      '/v1/videos/image2video',
      expect.objectContaining({
        image: 'https://example.com/a.png',
        image_tail: 'https://example.com/b.png',
        sound: 'on'
      })
    )
  })

  it('polls video until succeed', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        code: 0,
        data: {
          task_status: 'succeed',
          task_result: { videos: [{ url: 'https://cdn.example.com/v.mp4' }] }
        }
      }
    })
    const result = await klingAdapter.pollVideo(provider(), {
      jobId: 't1',
      pollingUrl: 'https://api-beijing.klingai.com/v1/videos/text2video/t1'
    })
    expect(result.status).toBe('completed')
    expect(result.downloadUrl).toBe('https://cdn.example.com/v.mp4')
  })

  it('generateImage submits and polls', async () => {
    postMock.mockResolvedValueOnce({
      data: { code: 0, data: { task_id: 'img1', task_status: 'submitted' } }
    })
    getMock.mockResolvedValueOnce({
      data: {
        code: 0,
        data: {
          task_status: 'succeed',
          task_result: { images: [{ url: 'https://cdn.example.com/i.png' }] }
        }
      }
    })
    const result = await klingAdapter.generateImage(provider(), 'kling-v2', {
      prompt: 'sunset'
    })
    expect(result.images).toEqual(['https://cdn.example.com/i.png'])
    expect(postMock).toHaveBeenCalledWith(
      '/v1/images/generations',
      expect.objectContaining({ model_name: 'kling-v2', prompt: 'sunset' })
    )
  })
})
