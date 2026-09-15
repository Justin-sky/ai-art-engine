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

import { meshyAdapter } from '../src/main/services/modelProviders/meshy/adapter'

function provider(overrides?: Partial<ModelProviderInstance>): ModelProviderInstance {
  return {
    id: 'meshy-1',
    providerKind: 'meshy',
    label: 'Meshy',
    apiKey: 'mk-test',
    baseUrl: 'https://api.meshy.ai',
    enabled: true,
    modalities: createEmptyModalityMap(),
    ...overrides
  }
}

describe('meshyAdapter rigging', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('omits rigging on text-to-3d by default', async () => {
    postMock.mockResolvedValueOnce({ data: { result: { id: 'm-1' } } })
    await meshyAdapter.submitModel3d(provider(), 'meshy-3d-v2', { prompt: 'a chair' })
    const [endpoint, body] = postMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(endpoint).toBe('/v2/text-to-3d')
    expect(body).not.toHaveProperty('rigging')
    expect(body).not.toHaveProperty('rig_type')
    expect(body).not.toHaveProperty('pose')
  })

  it('forwards rigging+rig_type+pose on text-to-3d', async () => {
    postMock.mockResolvedValueOnce({ data: { result: { id: 'm-2' } } })
    await meshyAdapter.submitModel3d(provider(), 'meshy-3d-v2', {
      prompt: 'a robot',
      rig: true,
      rigType: 'humanoid',
      rigAnimation: 'walk'
    })
    const body = postMock.mock.calls[0]?.[1] as Record<string, unknown>
    expect(body).toMatchObject({
      rigging: true,
      rig_type: 'humanoid',
      pose: 'walk'
    })
  })

  it('forwards rigging on image-to-3d', async () => {
    postMock.mockResolvedValueOnce({ data: { result: { id: 'm-3' } } })
    await meshyAdapter.submitModel3d(provider(), 'meshy-3d-v2', {
      prompt: '',
      inputReferences: ['https://cdn.example.com/a.png'],
      rig: true,
      rigType: 'quadruped'
    })
    const [endpoint, body] = postMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(endpoint).toBe('/v2/image-to-3d')
    expect(body).toMatchObject({ rigging: true, rig_type: 'quadruped' })
    // 未填 animation → 不发 pose
    expect(body).not.toHaveProperty('pose')
  })

  it('forwards rigging on multi-image-to-3d', async () => {
    postMock.mockResolvedValueOnce({ data: { result: { id: 'm-4' } } })
    await meshyAdapter.submitModel3d(provider(), 'meshy-3d-v2', {
      prompt: '',
      inputReferences: [
        { kind: 'image_url', url: 'https://cdn.example.com/1.png' },
        { kind: 'image_url', url: 'https://cdn.example.com/2.png' }
      ],
      rig: true
    })
    const [endpoint, body] = postMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(endpoint).toBe('/v2/multi-image-to-3d')
    expect(body).toMatchObject({ rigging: true })
  })

  it('skips rig_type when only rigType is empty after trim', async () => {
    postMock.mockResolvedValueOnce({ data: { result: { id: 'm-5' } } })
    await meshyAdapter.submitModel3d(provider(), 'meshy-3d-v2', {
      prompt: 'a chair',
      rig: true,
      rigType: '   '
    })
    const body = postMock.mock.calls[0]?.[1] as Record<string, unknown>
    expect(body.rigging).toBe(true)
    expect(body).not.toHaveProperty('rig_type')
  })
})
