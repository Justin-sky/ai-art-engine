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

vi.mock('../src/main/services/resolveMediaBytesFromUrl', () => ({
  resolveMediaBytesFromUrl: vi.fn(async (url: string) => ({
    mime: 'image/png',
    buf: new Uint8Array([1, 2, 3]),
    source: { url }
  }))
}))

import { hyper3dAdapter } from '../src/main/services/modelProviders/hyper3d/adapter'

function provider(overrides?: Partial<ModelProviderInstance>): ModelProviderInstance {
  return {
    id: 'h3d-1',
    providerKind: 'hyper3d',
    label: 'Rodin',
    apiKey: 'hk-test',
    baseUrl: 'https://api.hyper3d.com/api/v2',
    enabled: true,
    modalities: createEmptyModalityMap(),
    ...overrides
  }
}

function asFormData(input: unknown): FormData {
  if (!(input instanceof FormData)) throw new Error('expected FormData body')
  return input
}

describe('hyper3dAdapter rigging (multipart)', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('omits rig fields by default', async () => {
    postMock.mockResolvedValueOnce({ data: { uuid: 'u-1' } })
    await hyper3dAdapter.submitModel3d(provider(), 'rodin-gen-2.5', { prompt: 'a chair' })
    const form = asFormData(postMock.mock.calls[0]?.[1])
    expect(form.get('rig')).toBeNull()
    expect(form.get('rig_type')).toBeNull()
    expect(form.get('rig_animation')).toBeNull()
  })

  it('forwards rig=true, rig_type, and rig_animation to the multipart payload', async () => {
    postMock.mockResolvedValueOnce({ data: { uuid: 'u-2' } })
    await hyper3dAdapter.submitModel3d(provider(), 'rodin-gen-2.5', {
      prompt: 'a robot',
      rig: true,
      rigType: 'humanoid',
      rigAnimation: 'walk'
    })
    const form = asFormData(postMock.mock.calls[0]?.[1])
    expect(form.get('rig')).toBe('true')
    expect(form.get('rig_type')).toBe('humanoid')
    expect(form.get('rig_animation')).toBe('walk')
  })

  it('skips rig_type and rig_animation when only their trimmed values are blank', async () => {
    postMock.mockResolvedValueOnce({ data: { uuid: 'u-3' } })
    await hyper3dAdapter.submitModel3d(provider(), 'rodin-gen-2.5', {
      prompt: 'a mug',
      rig: true,
      rigType: '   ',
      rigAnimation: ''
    })
    const form = asFormData(postMock.mock.calls[0]?.[1])
    expect(form.get('rig')).toBe('true')
    expect(form.get('rig_type')).toBeNull()
    expect(form.get('rig_animation')).toBeNull()
  })
})
