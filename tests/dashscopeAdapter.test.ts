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

import { dashscopeAdapter } from '../src/main/services/modelProviders/dashscope/adapter'

function provider(overrides?: Partial<ModelProviderInstance>): ModelProviderInstance {
  return {
    id: 'ds-1',
    providerKind: 'dashscope',
    label: '通义千问',
    apiKey: 'sk-test',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    enabled: true,
    modalities: createEmptyModalityMap(),
    ...overrides
  }
}

describe('dashscopeAdapter', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('returns static image catalog', async () => {
    const images = await dashscopeAdapter.fetchCatalog(provider(), 'image')
    expect(images.some((m) => m.id === 'wanx2.1-t2i-turbo')).toBe(true)
  })

  it('generateText delegates to openai compat', async () => {
    const result = await dashscopeAdapter.generateText(provider(), 'qwen-plus', {
      prompt: '你好'
    })
    expect(result.text).toBe('echo:你好')
    expect(result.model).toBe('qwen-plus')
  })

  it('throws for speech', async () => {
    await expect(
      dashscopeAdapter.generateSpeech(provider(), 'x', { input: 'hi' })
    ).rejects.toThrow(/不支持语音/)
  })

  it('submits text-to-video and polls', async () => {
    postMock.mockResolvedValueOnce({
      data: { output: { task_id: 'tv1', task_status: 'PENDING' } }
    })
    const job = await dashscopeAdapter.submitVideo(provider(), 'wan2.2-t2v-plus', {
      prompt: 'a cat',
      duration: 5,
      aspectRatio: '16:9',
      resolution: '720p'
    })
    expect(job.jobId).toBe('tv1')
    expect(job.pollingUrl).toContain('/api/v1/tasks/tv1')
    expect(postMock).toHaveBeenCalledWith(
      '/services/aigc/video-generation/video-synthesis',
      expect.objectContaining({
        model: 'wan2.2-t2v-plus',
        input: { prompt: 'a cat' },
        parameters: expect.objectContaining({
          duration: 5,
          ratio: '16:9',
          resolution: '720P'
        })
      }),
      expect.objectContaining({
        headers: { 'X-DashScope-Async': 'enable' }
      })
    )

    getMock.mockResolvedValueOnce({
      data: {
        output: {
          task_status: 'SUCCEEDED',
          video_url: 'https://cdn.example.com/v.mp4'
        }
      }
    })
    const polled = await dashscopeAdapter.pollVideo(provider(), {
      jobId: 'tv1',
      pollingUrl: job.pollingUrl
    })
    expect(polled.status).toBe('completed')
    expect(polled.downloadUrl).toBe('https://cdn.example.com/v.mp4')
  })

  it('submits image-to-video with img_url', async () => {
    postMock.mockResolvedValueOnce({
      data: { output: { task_id: 'iv1', task_status: 'PENDING' } }
    })
    await dashscopeAdapter.submitVideo(provider(), 'wan2.2-i2v-flash', {
      prompt: 'move',
      firstFrameImageUrl: 'https://example.com/a.png'
    })
    expect(postMock).toHaveBeenCalledWith(
      '/services/aigc/video-generation/video-synthesis',
      expect.objectContaining({
        input: {
          prompt: 'move',
          img_url: 'https://example.com/a.png'
        }
      }),
      expect.any(Object)
    )
  })

  it('generateImage submits and polls task', async () => {
    postMock.mockResolvedValueOnce({
      data: { output: { task_id: 'img1', task_status: 'PENDING' } }
    })
    getMock.mockResolvedValueOnce({
      data: {
        output: {
          task_status: 'SUCCEEDED',
          results: [{ url: 'https://cdn.example.com/i.png' }]
        }
      }
    })
    const result = await dashscopeAdapter.generateImage(provider(), 'wanx2.1-t2i-turbo', {
      prompt: 'sunset',
      aspectRatio: '1:1'
    })
    expect(result.images).toEqual(['https://cdn.example.com/i.png'])
    expect(postMock).toHaveBeenCalledWith(
      '/services/aigc/text2image/image-synthesis',
      expect.objectContaining({
        model: 'wanx2.1-t2i-turbo',
        parameters: expect.objectContaining({ size: '1024*1024' })
      }),
      expect.any(Object)
    )
  })
})
