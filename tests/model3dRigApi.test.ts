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

import {
  mapCloudRigType,
  pollCloudModel3dRig,
  submitCloudModel3dRig
} from '../src/main/services/modelProviders/model3dRig'

function provider(
  kind: 'meshy' | 'tripo',
  overrides?: Partial<ModelProviderInstance>
): ModelProviderInstance {
  return {
    id: `${kind}-1`,
    providerKind: kind,
    label: kind,
    apiKey: 'k-test',
    baseUrl: kind === 'meshy' ? 'https://api.meshy.ai' : 'https://api.tripo3d.ai',
    enabled: true,
    modalities: createEmptyModalityMap(),
    ...overrides
  }
}

describe('cloud model3d Rigging API', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('maps UI rig types', () => {
    expect(mapCloudRigType('humanoid')).toBe('biped')
    expect(mapCloudRigType('quadruped')).toBe('quadruped')
  })

  it('submits Meshy /openapi/v1/rigging and encodes the poll token', async () => {
    postMock.mockResolvedValueOnce({ data: { result: 'rig-task-1' } })
    const job = await submitCloudModel3dRig(provider('meshy'), {
      modelUrl: 'https://cdn.example/model.glb',
      rigType: 'humanoid'
    })
    expect(postMock.mock.calls[0]?.[0]).toBe('/openapi/v1/rigging')
    expect(postMock.mock.calls[0]?.[1]).toMatchObject({
      model_url: 'https://cdn.example/model.glb'
    })
    expect(job.pollingUrl).toBe('meshy-rig::rig-task-1')
  })

  it('polls Meshy rigging for rigged_character_glb_url', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        status: 'SUCCEEDED',
        progress: 100,
        result: { rigged_character_glb_url: 'https://cdn.meshy/rigged.glb' }
      }
    })
    const poll = await pollCloudModel3dRig(provider('meshy'), {
      jobId: 'rig-task-1',
      pollingUrl: 'meshy::rig-task-1'
    })
    expect(getMock.mock.calls[0]?.[0]).toBe('/openapi/v1/rigging/rig-task-1')
    expect(poll).toMatchObject({
      status: 'completed',
      downloadUrl: 'https://cdn.meshy/rigged.glb'
    })
  })

  it('submits Tripo /v3/animations/rig and encodes the poll token', async () => {
    postMock.mockResolvedValueOnce({ data: { data: { task_id: 't-rig' } } })
    const job = await submitCloudModel3dRig(provider('tripo'), {
      modelUrl: 'https://cdn.example/model.glb',
      rigType: 'humanoid'
    })
    expect(postMock.mock.calls[0]?.[0]).toBe('/v3/animations/rig')
    expect(postMock.mock.calls[0]?.[1]).toMatchObject({
      input: 'https://cdn.example/model.glb',
      rig_type: 'biped',
      spec: 'mixamo',
      out_format: 'glb'
    })
    expect(job.pollingUrl).toBe('tripo-rig::t-rig')
  })

  it('honours Tripo spec / out_format and falls back on unknown values', async () => {
    postMock.mockResolvedValueOnce({ data: { data: { task_id: 't-rig-fbx' } } })
    await submitCloudModel3dRig(provider('tripo'), {
      modelUrl: 'https://cdn.example/model.glb',
      rigType: 'quadruped',
      spec: 'tripo',
      outFormat: 'fbx'
    })
    expect(postMock.mock.calls[0]?.[1]).toMatchObject({
      rig_type: 'quadruped',
      spec: 'tripo',
      out_format: 'fbx'
    })

    postMock.mockResolvedValueOnce({ data: { data: { task_id: 't-rig-bad' } } })
    await submitCloudModel3dRig(provider('tripo'), {
      modelUrl: 'https://cdn.example/model.glb',
      rigType: 'humanoid',
      spec: 'nonsense' as never,
      outFormat: 'obj' as never
    })
    expect(postMock.mock.calls[1]?.[1]).toMatchObject({ spec: 'mixamo', out_format: 'glb' })
  })

  it('polls Tripo rig task for model url', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        data: {
          status: 'success',
          progress: 100,
          output: { model_url: 'https://cdn.tripo/rigged.glb' }
        }
      }
    })
    const poll = await pollCloudModel3dRig(provider('tripo'), {
      jobId: 't-rig',
      pollingUrl: 'tripo::t-rig'
    })
    expect(getMock.mock.calls[0]?.[0]).toBe('/v3/tasks/t-rig')
    expect(poll).toMatchObject({
      status: 'completed',
      downloadUrl: 'https://cdn.tripo/rigged.glb'
    })
  })
})
