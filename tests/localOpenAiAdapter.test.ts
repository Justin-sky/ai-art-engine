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

import {
  vllmAdapter,
  ollamaAdapter,
  lmStudioAdapter
} from '../src/main/services/modelProviders/localOpenAi'

function provider(overrides?: Partial<ModelProviderInstance>): ModelProviderInstance {
  return {
    id: 'local-1',
    providerKind: 'vllm',
    label: 'vLLM',
    apiKey: '',
    baseUrl: 'http://localhost:8000/v1',
    enabled: true,
    modalities: createEmptyModalityMap(),
    ...overrides
  }
}

describe('localOpenAiAdapter', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('registers vLLM / Ollama / LM Studio with correct kinds', () => {
    expect(vllmAdapter.kind).toBe('vllm')
    expect(ollamaAdapter.kind).toBe('ollama')
    expect(lmStudioAdapter.kind).toBe('lmstudio')
  })

  it('fetches text catalog from /models without vendor filtering', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        data: [
          { id: 'Qwen2.5-72B-Instruct' },
          { id: 'llama3.1-8b' },
          { id: 'deepseek-r1' }
        ]
      }
    })
    const models = await vllmAdapter.fetchCatalog(provider(), 'text')
    expect(models.map((m) => m.id).sort()).toEqual([
      'Qwen2.5-72B-Instruct',
      'deepseek-r1',
      'llama3.1-8b'
    ])
  })

  it('returns empty catalog for unsupported modalities', async () => {
    expect(await vllmAdapter.fetchCatalog(provider(), 'image')).toEqual([])
    expect(await vllmAdapter.fetchCatalog(provider(), 'audio')).toEqual([])
    expect(await ollamaAdapter.fetchCatalog(provider({ providerKind: 'ollama' }), 'video')).toEqual(
      []
    )
  })

  it('fetches vLLM video catalog rows with video capabilities', async () => {
    getMock.mockResolvedValueOnce({
      data: { data: [{ id: 'Wan-AI/Wan2.2-T2V-A14B-Diffusers' }] }
    })
    const videos = await vllmAdapter.fetchCatalog(provider(), 'video')
    expect(videos[0]?.id).toBe('Wan-AI/Wan2.2-T2V-A14B-Diffusers')
    expect(
      (videos[0]?.capabilities as { supported_resolutions?: string[] } | undefined)
        ?.supported_resolutions
    ).toContain('720p')
  })

  it('submits video generation to /videos with mapped multipart fields', async () => {
    postMock.mockResolvedValueOnce({ data: { id: 'vid-1', status: 'queued' } })
    const job = await vllmAdapter.submitVideo(provider(), 'Wan-AI/Wan2.2-T2V-A14B-Diffusers', {
      prompt: 'a cat running',
      duration: 5,
      aspectRatio: '16:9',
      resolution: '720p',
      generateAudio: true,
      seed: 42
    })
    const [path, form] = postMock.mock.calls[0] as [string, FormData, unknown]
    expect(path).toBe('/videos')
    expect(form.get('prompt')).toBe('a cat running')
    expect(form.get('model')).toBe('Wan-AI/Wan2.2-T2V-A14B-Diffusers')
    expect(form.get('seconds')).toBe('5')
    expect(form.get('width')).toBe('1280')
    expect(form.get('height')).toBe('720')
    expect(form.get('generate_sound')).toBe('true')
    expect(form.get('seed')).toBe('42')
    expect(job.jobId).toBe('vid-1')
    expect(job.pollingUrl).toBe('http://localhost:8000/v1/videos/vid-1')
  })

  it('uploads first-frame data URL as input_reference for image-to-video', async () => {
    postMock.mockResolvedValueOnce({ data: { id: 'vid-2', status: 'queued' } })
    await vllmAdapter.submitVideo(provider(), 'wan-i2v', {
      prompt: 'animate',
      firstFrameImageUrl: 'data:image/png;base64,iVBORw0KGgo='
    })
    const form = postMock.mock.calls[0][1] as FormData
    expect(form.get('input_reference')).toBeInstanceOf(Blob)
    expect(form.get('image_reference')).toBeNull()
  })

  it('sends http first-frame image as JSON image_reference', async () => {
    postMock.mockResolvedValueOnce({ data: { id: 'vid-3', status: 'queued' } })
    await vllmAdapter.submitVideo(provider(), 'wan-i2v', {
      prompt: 'animate',
      firstFrameImageUrl: 'https://example.com/frame.png'
    })
    const form = postMock.mock.calls[0][1] as FormData
    expect(JSON.parse(String(form.get('image_reference')))).toEqual({
      image_url: 'https://example.com/frame.png'
    })
  })

  it('rejects combining image and video references', async () => {
    await expect(
      vllmAdapter.submitVideo(provider(), 'wan', {
        prompt: 'x',
        firstFrameImageUrl: 'data:image/png;base64,QQ==',
        inputReferences: [{ kind: 'video_url', url: 'https://example.com/v.mp4' }]
      })
    ).rejects.toThrow(/不支持图片与视频参考同时使用/)
  })

  it('polls video job and returns download path when completed', async () => {
    getMock.mockResolvedValueOnce({ data: { status: 'completed' } })
    const result = await vllmAdapter.pollVideo(provider(), {
      jobId: 'vid-1',
      pollingUrl: 'http://localhost:8000/v1/videos/vid-1'
    })
    expect(result.status).toBe('completed')
    expect(result.downloadUrl).toBe('/videos/vid-1/content')

    getMock.mockResolvedValueOnce({ data: { status: 'failed', error: { message: 'boom' } } })
    const failed = await vllmAdapter.pollVideo(provider(), {
      jobId: 'vid-1',
      pollingUrl: 'http://localhost:8000/v1/videos/vid-1'
    })
    expect(failed.status).toBe('failed')
    expect(failed.error).toBe('boom')
  })

  it('assertAuth passes with empty API key when /models is reachable', async () => {
    getMock.mockResolvedValueOnce({ data: { data: [] } })
    await expect(vllmAdapter.assertAuth(provider())).resolves.toBeUndefined()
  })

  it('assertAuth gives a friendly message when the local server is down', async () => {
    getMock.mockRejectedValueOnce({
      isAxiosError: true,
      message: 'connect ECONNREFUSED 127.0.0.1:8000'
    })
    await expect(vllmAdapter.assertAuth(provider())).rejects.toThrow(/无法连接本地 vLLM 服务/)
  })

  it('delegates text generation to OpenAI compatible client with empty key', async () => {
    const result = await vllmAdapter.generateText(provider(), 'Qwen2.5-72B-Instruct', {
      prompt: 'hi'
    })
    expect(result.text).toBe('echo:hi')
    expect(result.model).toBe('Qwen2.5-72B-Instruct')
  })

  it('rejects image, video and speech with a clear message', async () => {
    await expect(
      vllmAdapter.generateImage(provider(), 'flux', { prompt: 'x' })
    ).rejects.toThrow(/仅支持文本/)
    await expect(
      ollamaAdapter.generateSpeech(provider({ providerKind: 'ollama' }), 'tts-1', {
        input: 'hi'
      })
    ).rejects.toThrow(/仅支持文本/)
    await expect(
      lmStudioAdapter.submitVideo(provider({ providerKind: 'lmstudio' }), 'video', {
        prompt: 'x'
      })
    ).rejects.toThrow(/仅支持文本/)
  })
})
