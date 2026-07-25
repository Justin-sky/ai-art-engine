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
    expect(images.some((m) => m.id === 'wan2.5-t2i-preview')).toBe(true)
    expect(images.some((m) => m.id === 'wanx2.1-t2i-turbo')).toBe(true)
  })

  it('returns static video catalog with current Bailian models', async () => {
    const videos = await dashscopeAdapter.fetchCatalog(provider(), 'video')
    expect(videos.some((m) => m.id === 'happyhorse-1.1-t2v')).toBe(true)
    expect(videos.some((m) => m.id === 'kling/kling-v3-video-generation')).toBe(true)
    expect(videos.some((m) => m.id === 'kling/kling-v3-omni-video-generation')).toBe(true)
    expect(videos.some((m) => m.id === 'wan2.7-t2v')).toBe(true)
    expect(videos.some((m) => m.id === 'wan2.6-i2v-flash')).toBe(true)
  })

  it('submits bailian kling t2v with mode/aspect_ratio/audio', async () => {
    postMock.mockResolvedValueOnce({
      data: { output: { task_id: 'kv1', task_status: 'PENDING' } }
    })
    await dashscopeAdapter.submitVideo(provider(), 'kling/kling-v3-video-generation', {
      prompt: 'a kitten',
      duration: 5,
      aspectRatio: '16:9',
      resolution: '1080p',
      generateAudio: true
    })
    expect(postMock).toHaveBeenCalledWith(
      '/services/aigc/video-generation/video-synthesis',
      {
        model: 'kling/kling-v3-video-generation',
        input: { prompt: 'a kitten' },
        parameters: {
          duration: 5,
          watermark: false,
          mode: 'pro',
          aspect_ratio: '16:9',
          audio: true
        }
      },
      expect.anything()
    )
  })

  it('submits bailian kling i2v with media frames', async () => {
    postMock.mockResolvedValueOnce({
      data: { output: { task_id: 'kv2', task_status: 'PENDING' } }
    })
    await dashscopeAdapter.submitVideo(provider(), 'kling/kling-v3-video-generation', {
      prompt: 'move',
      firstFrameImageUrl: 'https://example.com/a.png',
      lastFrameImageUrl: 'https://example.com/b.png',
      duration: 5,
      aspectRatio: '16:9',
      resolution: '720p'
    })
    expect(postMock).toHaveBeenCalledWith(
      '/services/aigc/video-generation/video-synthesis',
      expect.objectContaining({
        model: 'kling/kling-v3-video-generation',
        input: {
          prompt: 'move',
          media: [
            { type: 'first_frame', url: 'https://example.com/a.png' },
            { type: 'last_frame', url: 'https://example.com/b.png' }
          ]
        },
        parameters: expect.objectContaining({
          mode: 'std',
          duration: 5,
          watermark: false
        })
      }),
      expect.anything()
    )
    const body = postMock.mock.calls[0]![1] as { parameters: Record<string, unknown> }
    expect(body.parameters.aspect_ratio).toBeUndefined()
  })

  it('submits happyhorse i2v with media first_frame', async () => {
    postMock.mockResolvedValueOnce({
      data: { output: { task_id: 'hh1', task_status: 'PENDING' } }
    })
    await dashscopeAdapter.submitVideo(provider(), 'happyhorse-1.1-i2v', {
      prompt: 'run',
      firstFrameImageUrl: 'https://example.com/a.png',
      duration: 5,
      aspectRatio: '16:9',
      resolution: '720p'
    })
    expect(postMock).toHaveBeenCalledWith(
      '/services/aigc/video-generation/video-synthesis',
      expect.objectContaining({
        model: 'happyhorse-1.1-i2v',
        input: {
          prompt: 'run',
          media: [{ type: 'first_frame', url: 'https://example.com/a.png' }]
        },
        parameters: expect.objectContaining({
          duration: 5,
          resolution: '720P',
          watermark: false
        })
      }),
      expect.anything()
    )
    const body = postMock.mock.calls[0]![1] as {
      parameters: Record<string, unknown>
    }
    expect(body.parameters.ratio).toBeUndefined()
  })

  it('submits happyhorse r2v with reference_image media', async () => {
    postMock.mockResolvedValueOnce({
      data: { output: { task_id: 'hh-r2v', task_status: 'PENDING' } }
    })
    await dashscopeAdapter.submitVideo(provider(), 'happyhorse-1.1-r2v', {
      prompt: 'Image 1 walks with Image 2',
      inputReferences: [
        { kind: 'image_url', url: 'https://example.com/1.png' },
        { kind: 'image_url', url: 'https://example.com/2.png' }
      ],
      duration: 5,
      aspectRatio: '16:9',
      resolution: '1080p'
    })
    expect(postMock).toHaveBeenCalledWith(
      '/services/aigc/video-generation/video-synthesis',
      expect.objectContaining({
        model: 'happyhorse-1.1-r2v',
        input: {
          prompt: 'Image 1 walks with Image 2',
          media: [
            { type: 'reference_image', url: 'https://example.com/1.png' },
            { type: 'reference_image', url: 'https://example.com/2.png' }
          ]
        },
        parameters: expect.objectContaining({
          duration: 5,
          resolution: '1080P',
          ratio: '16:9',
          watermark: false
        })
      }),
      expect.anything()
    )
  })

  it('rejects happyhorse r2v without images', async () => {
    await expect(
      dashscopeAdapter.submitVideo(provider(), 'happyhorse-1.1-r2v', {
        prompt: 'go',
        duration: 5
      })
    ).rejects.toThrow(/至少需要 1 张参考图/)
  })

  it('submits happyhorse video-edit with video + reference images', async () => {
    postMock.mockResolvedValueOnce({
      data: { output: { task_id: 'hh-edit', task_status: 'PENDING' } }
    })
    await dashscopeAdapter.submitVideo(provider(), 'happyhorse-1.0-video-edit', {
      prompt: 'change background',
      inputReferences: [
        { kind: 'video_url', url: 'https://example.com/in.mp4' },
        { kind: 'image_url', url: 'https://example.com/ref.png' }
      ],
      resolution: '720p'
    })
    expect(postMock).toHaveBeenCalledWith(
      '/services/aigc/video-generation/video-synthesis',
      expect.objectContaining({
        model: 'happyhorse-1.0-video-edit',
        input: {
          prompt: 'change background',
          media: [
            { type: 'video', url: 'https://example.com/in.mp4' },
            { type: 'reference_image', url: 'https://example.com/ref.png' }
          ]
        },
        parameters: expect.objectContaining({
          resolution: '720P',
          watermark: false
        })
      }),
      expect.anything()
    )
    const body = postMock.mock.calls[0]![1] as { parameters: Record<string, unknown> }
    expect(body.parameters.duration).toBeUndefined()
    expect(body.parameters.ratio).toBeUndefined()
  })

  it('rejects happyhorse video-edit without video', async () => {
    await expect(
      dashscopeAdapter.submitVideo(provider(), 'happyhorse-1.0-video-edit', {
        prompt: 'edit',
        inputReferences: [{ kind: 'image_url', url: 'https://example.com/ref.png' }]
      })
    ).rejects.toThrow(/需要 1 段输入视频/)
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
