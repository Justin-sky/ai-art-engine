import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelProviderInstance } from '../src/shared/modelProvider'
import { createEmptyModalityMap } from '../src/shared/modelProvider'
import { openRouterAdapter } from '../src/main/services/modelProviders/openrouter/adapter'

const getMock = vi.fn()
const postMock = vi.fn()

vi.mock('../src/main/services/modelProviders/http', async () => {
  const actual = await vi.importActual<typeof import('../src/main/services/modelProviders/http')>(
    '../src/main/services/modelProviders/http'
  )
  return {
    ...actual,
    createProviderHttpClient: () => ({
      get: getMock,
      post: postMock
    })
  }
})

function provider(): ModelProviderInstance {
  return {
    id: 'or-1',
    providerKind: 'openrouter',
    label: 'OpenRouter',
    apiKey: 'sk-or-v1-test',
    baseUrl: 'https://openrouter.ai/api/v1',
    enabled: true,
    modalities: createEmptyModalityMap()
  }
}

describe('openRouterAdapter video', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('submit stores baseUrl-relative polling URL even when vendor returns /api/v1/... path', async () => {
    postMock.mockResolvedValue({
      data: {
        id: 'job-abc',
        polling_url: '/api/v1/videos/job-abc',
        status: 'pending'
      }
    })

    const job = await openRouterAdapter.submitVideo(provider(), 'bytedance/seedance-2.0-mini', {
      prompt: 'red sports car'
    })

    expect(job.jobId).toBe('job-abc')
    expect(job.pollingUrl).toBe('https://openrouter.ai/api/v1/videos/job-abc')
    expect(postMock).toHaveBeenCalledWith(
      '/videos',
      expect.objectContaining({ model: 'bytedance/seedance-2.0-mini' }),
      expect.any(Object)
    )
  })

  it('poll always GETs /videos/{id} and uses authenticated content path on complete', async () => {
    getMock.mockResolvedValue({
      data: {
        status: 'completed',
        unsigned_urls: ['https://openrouter.ai/api/v1/videos/job-abc/content?index=0']
      }
    })

    const result = await openRouterAdapter.pollVideo(provider(), {
      jobId: 'job-abc',
      pollingUrl: 'https://openrouter.ai/api/v1/videos/job-abc'
    })

    expect(getMock).toHaveBeenCalledWith('/videos/job-abc')
    expect(result.status).toBe('completed')
    expect(result.downloadUrl).toBe('/videos/job-abc/content')
  })

  it('poll maps cancelled/expired to failed', async () => {
    getMock.mockResolvedValue({ data: { status: 'expired', error: 'job expired' } })
    const result = await openRouterAdapter.pollVideo(provider(), {
      jobId: 'job-x',
      pollingUrl: 'https://openrouter.ai/api/v1/videos/job-x'
    })
    expect(result.status).toBe('failed')
    expect(result.error).toBe('job expired')
  })
})
