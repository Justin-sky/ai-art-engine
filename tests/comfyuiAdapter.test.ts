import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelProviderInstance } from '../src/shared/modelProvider'
import { createEmptyModalityMap } from '../src/shared/modelProvider'

const getMock = vi.fn()
const postMock = vi.fn()

vi.mock('axios', () => ({
  default: {
    create: () => ({
      get: getMock,
      post: postMock
    }),
    isAxiosError: (err: unknown) =>
      Boolean(err && typeof err === 'object' && (err as { isAxiosError?: boolean }).isAxiosError)
  }
}))

vi.mock('../src/main/services/projectService', () => ({
  projectService: {
    isOpen: () => false,
    attachExternalGeneratedFile: vi.fn()
  }
}))

import { comfyUiAdapter } from '../src/main/services/modelProviders/comfyui/adapter'

const workflow = {
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'old' } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512 } }
}

function provider(overrides?: Partial<ModelProviderInstance>): ModelProviderInstance {
  return {
    id: 'comfy-1',
    providerKind: 'comfyui',
    label: 'ComfyUI',
    apiKey: '',
    baseUrl: 'http://127.0.0.1:8189',
    enabled: true,
    modalities: createEmptyModalityMap(),
    ...overrides
  }
}

describe('comfyUiAdapter', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('allows empty api key on auth when v2 jobs responds', async () => {
    getMock.mockResolvedValueOnce({ data: { jobs: [] } })
    await expect(comfyUiAdapter.assertAuth(provider())).resolves.toBeUndefined()
    expect(getMock).toHaveBeenCalledWith('/api/v2/jobs', { params: { limit: 1 } })
  })

  it('returns static catalogs and ignores text', async () => {
    getMock.mockRejectedValue(new Error('no templates'))
    const images = await comfyUiAdapter.fetchCatalog(provider(), 'image')
    const videos = await comfyUiAdapter.fetchCatalog(provider(), 'video')
    const audio = await comfyUiAdapter.fetchCatalog(provider(), 'audio')
    expect(images.some((m) => m.id === 'txt2img')).toBe(true)
    expect(videos.some((m) => m.id === 'txt2vid')).toBe(true)
    expect(audio.some((m) => m.id === 'txt2audio')).toBe(true)
    expect(await comfyUiAdapter.fetchCatalog(provider(), 'text')).toEqual([])
  })

  it('throws for text chat', async () => {
    await expect(comfyUiAdapter.generateText(provider(), 'x', { prompt: 'hi' })).rejects.toThrow(
      /不支持文本/
    )
  })

  it('submits an image job through /api/v2/jobs', async () => {
    getMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/userdata')) {
        return Promise.resolve({ data: workflow })
      }
      return Promise.reject(new Error(`unexpected GET ${url}`))
    })
    postMock.mockResolvedValueOnce({
      data: {
        id: 'job-1',
        status: 'succeeded',
        outputs: [{ type: 'image', url: 'http://127.0.0.1:8189/view?f=a.png' }],
        urls: { self: '/api/v2/jobs/job-1' }
      }
    })
    const result = await comfyUiAdapter.generateImage(provider(), 'txt2img', {
      prompt: 'a cat',
      aspectRatio: '16:9'
    })
    expect(result.images[0]).toContain('a.png')
    expect(postMock).toHaveBeenCalledWith(
      '/api/v2/jobs',
      expect.objectContaining({
        workflow: expect.objectContaining({
          '6': expect.objectContaining({
            inputs: expect.objectContaining({ text: 'a cat' })
          })
        })
      }),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) })
      })
    )
  })

  it('submits video and polls status', async () => {
    getMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/userdata')) {
        return Promise.resolve({ data: workflow })
      }
      if (String(url).includes('/api/v2/jobs')) {
        return Promise.resolve({
          data: {
            id: 'v1',
            status: 'succeeded',
            outputs: [{ type: 'video', url: 'http://x/out.mp4' }],
            progress: { value: 1 }
          }
        })
      }
      return Promise.reject(new Error(`unexpected GET ${url}`))
    })
    postMock.mockResolvedValueOnce({
      data: { id: 'v1', status: 'queued', urls: { self: '/api/v2/jobs/v1' } }
    })
    const job = await comfyUiAdapter.submitVideo(provider(), 'txt2vid', { prompt: 'run' })
    expect(job.jobId).toBe('v1')
    const poll = await comfyUiAdapter.pollVideo(provider(), {
      jobId: 'v1',
      pollingUrl: job.pollingUrl
    })
    expect(poll.status).toBe('completed')
    expect(poll.downloadUrl).toBe('http://x/out.mp4')
  })
})
