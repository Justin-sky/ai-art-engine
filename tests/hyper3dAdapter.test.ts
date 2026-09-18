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

import { hyper3dAdapter } from '../src/main/services/modelProviders/hyper3d/adapter'

function provider(overrides?: Partial<ModelProviderInstance>): ModelProviderInstance {
  return {
    id: 'rodin-1',
    providerKind: 'hyper3d',
    label: 'Rodin',
    apiKey: 'rk-test',
    baseUrl: 'https://api.hyper3d.com/api/v2',
    enabled: true,
    modalities: createEmptyModalityMap(),
    ...overrides
  }
}

describe('hyper3dAdapter generation omits inline rigging', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('omits rig fields by default', async () => {
    postMock.mockResolvedValueOnce({ data: { uuid: 'u-1' } })
    await hyper3dAdapter.submitModel3d(provider(), 'rodin-gen-2.5', { prompt: 'a chair' })
    const form = postMock.mock.calls[0]?.[1] as FormData
    expect(form.get('rig')).toBeNull()
    expect(form.get('rig_type')).toBeNull()
    expect(form.get('rig_animation')).toBeNull()
  })

  it('ignores deprecated rig flags and still omits multipart rig fields', async () => {
    postMock.mockResolvedValueOnce({ data: { uuid: 'u-2' } })
    await hyper3dAdapter.submitModel3d(provider(), 'rodin-gen-2.5', {
      prompt: 'a hero',
      rig: true,
      rigType: 'humanoid',
      rigAnimation: 'walk'
    })
    const form = postMock.mock.calls[0]?.[1] as FormData
    expect(form.get('rig')).toBeNull()
    expect(form.get('rig_type')).toBeNull()
    expect(form.get('rig_animation')).toBeNull()
  })
})
