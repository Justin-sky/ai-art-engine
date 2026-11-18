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

  it('generateImage passes Seedream layer_decomposition under provider.options.seed and parses nested data[].layer', async () => {
    const png1920x1080 = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52, 0x00, 0x00, 0x07, 0x80, 0x00, 0x00, 0x04, 0x38, 0x08, 0x06, 0x00, 0x00, 0x00
    ]).toString('base64')

    postMock.mockResolvedValue({
      data: {
        created: 1794988000,
        data: [
          {
            b64_json: png1920x1080,
            media_type: 'image/png',
            layer: {
              z_index: 0,
              background: 'opaque',
              name: 'Base'
            }
          },
          {
            b64_json: png1920x1080,
            media_type: 'image/png',
            layer: {
              z_index: 1,
              background: 'transparent',
              bounding_box: {
                absolute: [100, 80, 420, 200],
                normalized: [52, 74, 219, 185]
              },
              name: 'Confirm Button',
              description: 'Primary gold CTA button'
            }
          }
        ]
      }
    })

    const res = await openRouterAdapter.generateImage(provider(), 'bytedance-seed/seedream-5-5', {
      prompt: '拆解游戏 UI 图层',
      resolution: '2K',
      inputReferences: ['data:image/png;base64,iVBORw0KGgo='],
      layerDecomposition: true
    })

    expect(postMock).toHaveBeenCalledWith(
      '/images',
      expect.objectContaining({
        model: 'bytedance-seed/seedream-5-5',
        resolution: '2K',
        provider: {
          only: ['seed'],
          options: {
            seed: {
              layer_decomposition: true,
              layer_decomposition_options: {
                max_images: 16
              }
            }
          }
        }
      })
    )
    const sentBody = postMock.mock.calls[0]?.[1] as Record<string, unknown>
    expect(sentBody.layer_decomposition).toBeUndefined()
    expect(sentBody.n).toBeUndefined()

    expect(res.images).toHaveLength(2)
    expect(res.layers).toHaveLength(2)
    expect(res.layers?.[0]).toMatchObject({ zIndex: 0, size: '1920x1080', name: 'Base' })
    expect(res.layers?.[1]).toMatchObject({
      zIndex: 1,
      name: 'Confirm Button',
      boundingBox: {
        absolute: [100, 80, 420, 200],
        normalized: [52, 74, 219, 185]
      }
    })
  })

  it('forwards custom layerDecompositionMaxImages and clamps >16 to OpenRouter schema limit', async () => {
    postMock.mockResolvedValue({
      data: {
        data: [
          {
            url: 'https://cdn.example.com/base.png',
            size: '1024x1024',
            layer: { z_index: 0, name: 'Base' }
          },
          {
            url: 'https://cdn.example.com/btn.png',
            size: '1024x1024',
            layer: { z_index: 1, name: 'Btn', bounding_box: { absolute: [10, 10, 90, 50] } }
          }
        ]
      }
    })

    await openRouterAdapter.generateImage(provider(), 'bytedance-seed/seedream-5-5', {
      prompt: '拆解图层',
      resolution: '2K',
      inputReferences: ['data:image/png;base64,iVBORw0KGgo='],
      layerDecomposition: true,
      layerDecompositionMaxImages: 8
    })
    expect(postMock).toHaveBeenLastCalledWith(
      '/images',
      expect.objectContaining({
        provider: {
          only: ['seed'],
          options: {
            seed: {
              layer_decomposition: true,
              layer_decomposition_options: { max_images: 8 }
            }
          }
        }
      })
    )

    await openRouterAdapter.generateImage(provider(), 'bytedance-seed/seedream-5-5', {
      prompt: '拆解图层',
      resolution: '2K',
      inputReferences: ['data:image/png;base64,iVBORw0KGgo='],
      layerDecomposition: true,
      layerDecompositionMaxImages: 50
    })
    expect(postMock).toHaveBeenLastCalledWith(
      '/images',
      expect.objectContaining({
        provider: {
          only: ['seed'],
          options: {
            seed: {
              layer_decomposition: true,
              layer_decomposition_options: { max_images: 16 }
            }
          }
        }
      })
    )
  })
})
