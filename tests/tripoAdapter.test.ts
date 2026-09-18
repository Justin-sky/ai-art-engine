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

import { mapCloudRigType } from '../src/main/services/modelProviders/model3dRig'
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

describe('tripoAdapter generation is geometry-only', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('maps UI rig types for standalone Rigging API', () => {
    expect(mapCloudRigType('humanoid')).toBe('biped')
    expect(mapCloudRigType('bipedal')).toBe('biped')
    expect(mapCloudRigType('quadruped')).toBe('quadruped')
    expect(mapCloudRigType('creature')).toBe('avian')
  })

  it('omits inline rig on generation even when deprecated rig flags are set', async () => {
    postMock.mockResolvedValueOnce({ data: { data: { task_id: 't-1' } } })
    const job = await tripoAdapter.submitModel3d(provider(), 'tripo-3d-v1', {
      prompt: 'a robot',
      rig: true,
      rigType: 'humanoid',
      rigAnimation: 'walk'
    })
    const body = postMock.mock.calls[0]?.[1] as Record<string, unknown>
    expect(body).not.toHaveProperty('rig')
    expect(postMock.mock.calls[0]?.[0]).toBe('/v3/generation/text-to-model')
    expect(job.pollingUrl).toBe('t-1')
    expect(job.pollingUrl).not.toMatch(/tripo-pipe/)
  })

  it('polls a bare task id without gen→rig pipe', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        data: {
          status: 'success',
          progress: 100,
          output: { model_url: 'https://cdn.tripo3d.ai/mesh.glb' }
        }
      }
    })
    const poll = await tripoAdapter.pollModel3d(provider(), {
      jobId: 't-1',
      pollingUrl: 't-1'
    })
    expect(poll).toMatchObject({
      status: 'completed',
      downloadUrl: 'https://cdn.tripo3d.ai/mesh.glb'
    })
    expect(postMock).not.toHaveBeenCalled()
  })
})
