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

vi.mock('../src/main/services/projectService', () => ({
  projectService: {
    isOpen: () => false
  }
}))

import { miniMaxAdapter } from '../src/main/services/modelProviders/minimax/adapter'

function provider(overrides?: Partial<ModelProviderInstance>): ModelProviderInstance {
  return {
    id: 'mm-1',
    providerKind: 'minimax',
    label: '海螺 AI',
    apiKey: 'mm-test',
    baseUrl: 'https://api.minimaxi.com',
    enabled: true,
    modalities: createEmptyModalityMap(),
    ...overrides
  }
}

describe('miniMaxAdapter', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('rejects missing api key on auth', async () => {
    await expect(miniMaxAdapter.assertAuth(provider({ apiKey: '' }))).rejects.toThrow(/API Key/)
  })

  it('returns static video/image/audio catalogs and text fallback', async () => {
    const videos = await miniMaxAdapter.fetchCatalog(provider(), 'video')
    expect(videos.some((m) => m.id === 'MiniMax-Hailuo-2.3')).toBe(true)
    expect(videos.some((m) => m.id === 'MiniMax-Hailuo-02')).toBe(true)

    const images = await miniMaxAdapter.fetchCatalog(provider(), 'image')
    expect(images.some((m) => m.id === 'image-01')).toBe(true)

    const audios = await miniMaxAdapter.fetchCatalog(provider(), 'audio')
    expect(audios.some((m) => m.id === 'voice-design')).toBe(true)

    getMock.mockRejectedValueOnce(new Error('network'))
    const texts = await miniMaxAdapter.fetchCatalog(provider(), 'text')
    expect(texts.some((m) => m.id === 'MiniMax-M3')).toBe(true)
  })

  it('generateImage posts image_generation with optional subject_reference', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        data: { image_urls: ['https://cdn.example.com/a.jpg'] },
        base_resp: { status_code: 0 }
      }
    })
    const result = await miniMaxAdapter.generateImage(provider(), 'image-01', {
      prompt: 'a cat',
      aspectRatio: '16:9',
      n: 2,
      inputReferences: ['https://example.com/ref.png']
    })
    expect(result.images).toEqual(['https://cdn.example.com/a.jpg'])
    expect(postMock).toHaveBeenCalledWith(
      '/v1/image_generation',
      expect.objectContaining({
        model: 'image-01',
        prompt: 'a cat',
        aspect_ratio: '16:9',
        n: 2,
        subject_reference: [{ type: 'character', image_file: 'https://example.com/ref.png' }]
      })
    )
  })

  it('generateSpeech posts voice_design and decodes trial hex', async () => {
    const mp3Hex = Buffer.from('ID3fake').toString('hex')
    postMock.mockResolvedValueOnce({
      data: {
        voice_id: 'ttv-voice-1',
        trial_audio: mp3Hex,
        base_resp: { status_code: 0 }
      }
    })
    const result = await miniMaxAdapter.generateSpeech(provider(), 'voice-design', {
      input: '低沉磁性的旁白'
    })
    expect(result.voice).toBe('ttv-voice-1')
    expect(result.filePath).toBeTruthy()
    expect(postMock).toHaveBeenCalledWith(
      '/v1/voice_design',
      expect.objectContaining({
        prompt: '低沉磁性的旁白',
        preview_text: expect.any(String)
      })
    )
  })

  it('generateText uses openai compat under /v1', async () => {
    const { generateOpenAiCompatibleText } = await import(
      '../src/main/services/modelProviders/openaiCompat'
    )
    // delegated via real import — assert through post path by mocking axios create base
    postMock.mockResolvedValueOnce({
      data: { model: 'MiniMax-M3', choices: [{ message: { content: 'hello' } }] }
    })
    // openaiCompat uses createProviderHttpClient which is also mocked axios.create
    const result = await miniMaxAdapter.generateText(provider(), 'MiniMax-M3', {
      prompt: 'hi'
    })
    expect(result.text).toBe('hello')
    expect(postMock).toHaveBeenCalledWith(
      '/chat/completions',
      expect.objectContaining({ model: 'MiniMax-M3' }),
      expect.anything()
    )
    void generateOpenAiCompatibleText
  })

  it('submits text-to-video', async () => {
    postMock.mockResolvedValueOnce({
      data: { task_id: 't1', base_resp: { status_code: 0, status_msg: 'success' } }
    })
    const job = await miniMaxAdapter.submitVideo(provider(), 'MiniMax-Hailuo-2.3', {
      prompt: 'a cat',
      duration: 5,
      resolution: '1080p'
    })
    expect(job.jobId).toBe('t1')
    expect(job.pollingUrl).toContain('/v1/query/video_generation?task_id=t1')
    expect(postMock).toHaveBeenCalledWith(
      '/v1/video_generation',
      expect.objectContaining({
        model: 'MiniMax-Hailuo-2.3',
        prompt: 'a cat',
        duration: 6,
        resolution: '1080P',
        aigc_watermark: false
      })
    )
  })

  it('submits image-to-video with first frame', async () => {
    postMock.mockResolvedValueOnce({
      data: { task_id: 't2', base_resp: { status_code: 0 } }
    })
    await miniMaxAdapter.submitVideo(provider(), 'MiniMax-Hailuo-2.3', {
      prompt: 'move',
      firstFrameImageUrl: 'https://example.com/a.png',
      duration: 10,
      resolution: '768p'
    })
    expect(postMock).toHaveBeenCalledWith(
      '/v1/video_generation',
      expect.objectContaining({
        first_frame_image: 'https://example.com/a.png',
        duration: 10,
        resolution: '768P'
      })
    )
  })

  it('submits first-last frame on Hailuo-02', async () => {
    postMock.mockResolvedValueOnce({
      data: { task_id: 't3', base_resp: { status_code: 0 } }
    })
    await miniMaxAdapter.submitVideo(provider(), 'MiniMax-Hailuo-02', {
      prompt: 'grow',
      firstFrameImageUrl: 'https://example.com/a.png',
      lastFrameImageUrl: 'https://example.com/b.png',
      duration: 6,
      resolution: '1080P'
    })
    expect(postMock).toHaveBeenCalledWith(
      '/v1/video_generation',
      expect.objectContaining({
        first_frame_image: 'https://example.com/a.png',
        last_frame_image: 'https://example.com/b.png'
      })
    )
  })

  it('rejects Fast without first frame', async () => {
    await expect(
      miniMaxAdapter.submitVideo(provider(), 'MiniMax-Hailuo-2.3-Fast', {
        prompt: 'go',
        duration: 6
      })
    ).rejects.toThrow(/仅支持图生视频/)
  })

  it('rejects last frame on non-02 models', async () => {
    await expect(
      miniMaxAdapter.submitVideo(provider(), 'MiniMax-Hailuo-2.3', {
        prompt: 'go',
        firstFrameImageUrl: 'https://example.com/a.png',
        lastFrameImageUrl: 'https://example.com/b.png'
      })
    ).rejects.toThrow(/仅支持 MiniMax-Hailuo-02/)
  })

  it('polls success and resolves download url via file_id', async () => {
    getMock
      .mockResolvedValueOnce({
        data: {
          task_id: 't1',
          status: 'Success',
          file_id: 'f1',
          base_resp: { status_code: 0 }
        }
      })
      .mockResolvedValueOnce({
        data: {
          file: { download_url: 'https://cdn.example.com/out.mp4' },
          base_resp: { status_code: 0 }
        }
      })
    const result = await miniMaxAdapter.pollVideo(provider(), {
      jobId: 't1',
      pollingUrl: 'https://api.minimaxi.com/v1/query/video_generation?task_id=t1'
    })
    expect(result.status).toBe('completed')
    expect(result.downloadUrl).toBe('https://cdn.example.com/out.mp4')
    expect(getMock).toHaveBeenNthCalledWith(
      1,
      '/v1/query/video_generation',
      expect.objectContaining({ params: { task_id: 't1' } })
    )
    expect(getMock).toHaveBeenNthCalledWith(
      2,
      '/v1/files/retrieve',
      expect.objectContaining({ params: { file_id: 'f1' } })
    )
  })

  it('maps processing status', async () => {
    getMock.mockResolvedValueOnce({
      data: { status: 'Processing', base_resp: { status_code: 0 } }
    })
    const result = await miniMaxAdapter.pollVideo(provider(), {
      jobId: 't1',
      pollingUrl: 'x'
    })
    expect(result.status).toBe('in_progress')
    expect(result.downloadUrl).toBeUndefined()
  })
})
