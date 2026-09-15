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

import { tripoAdapter } from '../src/main/services/modelProviders/tripo/adapter'

function provider(overrides?: Partial<ModelProviderInstance>): ModelProviderInstance {
  return {
    id: 'tripo-1',
    providerKind: 'tripo',
    label: 'Tripo',
    apiKey: 'tk-test',
    baseUrl: 'https://api.tripo3d.ai',
    enabled: true,
    modalities: createEmptyModalityMap(),
    ...overrides
  }
}

describe('tripoAdapter rigging', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('omits the rig field by default to preserve the prior non-rigged behaviour', async () => {
    postMock.mockResolvedValueOnce({ data: { data: { task_id: 't-1' } } })
    await tripoAdapter.submitModel3d(provider(), 'tripo-3d-v1', { prompt: 'a chair' })
    const body = postMock.mock.calls[0]?.[1] as Record<string, unknown>
    expect(body).not.toHaveProperty('rig')
  })

  it('emits rig=true when the input opts in', async () => {
    postMock.mockResolvedValueOnce({ data: { data: { task_id: 't-2' } } })
    await tripoAdapter.submitModel3d(provider(), 'tripo-3d-v1', {
      prompt: 'a robot',
      rig: true,
      rigType: 'humanoid'
    })
    const body = postMock.mock.calls[0]?.[1] as Record<string, unknown>
    expect(body.rig).toBe(true)
    // Tripo v2 仅识别 `rig`；rigType / rigAnimation 留供未来扩展，不强行注入
    expect(body).not.toHaveProperty('rig_type')
    expect(body).not.toHaveProperty('rig_animation')
  })

  it('omits rig when the input sets rig=false explicitly', async () => {
    postMock.mockResolvedValueOnce({ data: { data: { task_id: 't-3' } } })
    await tripoAdapter.submitModel3d(provider(), 'tripo-3d-v1', {
      prompt: 'a mug',
      rig: false
    })
    const body = postMock.mock.calls[0]?.[1] as Record<string, unknown>
    expect(body).not.toHaveProperty('rig')
  })
})
