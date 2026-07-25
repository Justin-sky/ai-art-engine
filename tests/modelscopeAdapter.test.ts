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
      interceptors: { request: { use: () => undefined } }
    }),
    isAxiosError: (err: unknown) =>
      Boolean(err && typeof err === 'object' && (err as { isAxiosError?: boolean }).isAxiosError)
  }
}))

vi.mock('../src/main/services/modelProviders/openaiCompat', () => ({
  generateOpenAiCompatibleText: vi.fn(async (_p, modelId: string, input: { prompt: string }) => ({
    text: `ms:${input.prompt}`,
    model: modelId
  }))
}))

vi.mock('../src/main/services/modelProviders/http', async () => {
  const actual = await vi.importActual<typeof import('../src/main/services/modelProviders/http')>(
    '../src/main/services/modelProviders/http'
  )
  return {
    ...actual,
    sleep: vi.fn(async () => undefined)
  }
})

import { modelScopeAdapter } from '../src/main/services/modelProviders/modelscope/adapter'

function provider(overrides?: Partial<ModelProviderInstance>): ModelProviderInstance {
  return {
    id: 'ms-1',
    providerKind: 'modelscope',
    label: '魔塔',
    apiKey: 'ms-token',
    baseUrl: 'https://api-inference.modelscope.cn/v1',
    enabled: true,
    modalities: createEmptyModalityMap(),
    ...overrides
  }
}

describe('modelScopeAdapter', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('returns static image catalog and empty video', async () => {
    const images = await modelScopeAdapter.fetchCatalog(provider(), 'image')
    expect(images.some((m) => m.id === 'MAILAND/majicflus_v1')).toBe(true)
    expect(await modelScopeAdapter.fetchCatalog(provider(), 'video')).toEqual([])
  })

  it('generateText delegates to openai compat', async () => {
    const result = await modelScopeAdapter.generateText(provider(), 'Qwen/Qwen2.5-72B-Instruct', {
      prompt: 'hi'
    })
    expect(result.text).toBe('ms:hi')
  })

  it('generateImage submits async task and polls /tasks', async () => {
    postMock.mockResolvedValueOnce({
      data: { task_id: 'task-1' }
    })
    getMock
      .mockResolvedValueOnce({
        data: { task_status: 'RUNNING' }
      })
      .mockResolvedValueOnce({
        data: {
          task_status: 'SUCCEED',
          output_images: ['https://cdn.example.com/a.png']
        }
      })

    const result = await modelScopeAdapter.generateImage(provider(), 'MAILAND/majicflus_v1', {
      prompt: 'a cat',
      aspectRatio: '1:1'
    })
    expect(result.images).toEqual(['https://cdn.example.com/a.png'])
    expect(postMock).toHaveBeenCalledWith(
      '/images/generations',
      expect.objectContaining({
        model: 'MAILAND/majicflus_v1',
        prompt: 'a cat',
        size: '1024x1024'
      }),
      expect.objectContaining({
        headers: { 'X-ModelScope-Async-Mode': 'true' }
      })
    )
    expect(getMock).toHaveBeenCalledWith(
      '/tasks/task-1',
      expect.objectContaining({
        headers: { 'X-ModelScope-Task-Type': 'image_generation' }
      })
    )
  })

  it('rejects video and speech', async () => {
    await expect(
      modelScopeAdapter.submitVideo(provider(), 'x', { prompt: 'v' })
    ).rejects.toThrow(/不支持视频/)
    await expect(
      modelScopeAdapter.generateSpeech(provider(), 'x', { input: 'hi' })
    ).rejects.toThrow(/不支持语音/)
  })
})
