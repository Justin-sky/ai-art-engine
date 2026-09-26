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
  MODEL3D_SEGMENT_TOKEN,
  MODEL3D_SMART_SEGMENT_TOKEN,
  TRIPO_SEGMENT_IDENTITY_TRANSFORM,
  fetchCloudModel3dSegmentExtras,
  isModel3dSegmentPollingUrl,
  parseModel3dSegmentToken,
  pollCloudModel3dSegment,
  submitCloudModel3dSegment
} from '../src/main/services/modelProviders/model3dSegment'
import { parseGlbPartNames, readGlbPartNames } from '../src/main/services/modelProviders/glbParts'

function provider(
  kind: 'tripo' | 'meshy',
  overrides?: Partial<ModelProviderInstance>
): ModelProviderInstance {
  return {
    id: `${kind}-1`,
    providerKind: kind,
    label: kind,
    apiKey: 'k-test',
    baseUrl: kind === 'tripo' ? 'https://api.tripo3d.ai' : 'https://api.meshy.ai',
    enabled: true,
    modalities: createEmptyModalityMap(),
    ...overrides
  }
}

/** 造一个最小合法 GLB：12 字节头 + JSON chunk（node 名即部件名） */
function makeGlb(names: string[]): Uint8Array {
  const json = JSON.stringify({
    asset: { version: '2.0' },
    nodes: names.map((name) => ({ name }))
  })
  const jsonBytes = new TextEncoder().encode(json)
  const padded = jsonBytes.length + ((4 - (jsonBytes.length % 4)) % 4)
  const total = 12 + 8 + padded
  const buf = new Uint8Array(total)
  const view = new DataView(buf.buffer)
  view.setUint32(0, 0x46546c67, true) // 'glTF'
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, padded, true)
  view.setUint32(16, 0x4e4f534a, true) // 'JSON'
  buf.fill(0x20, 20)
  buf.set(jsonBytes, 20)
  return buf
}

describe('Tripo mesh segmentation API', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('submits /v3/mesh/segment with v1 defaults and encodes the poll token', async () => {
    postMock.mockResolvedValueOnce({ data: { data: { task_id: 't-seg' } } })
    const job = await submitCloudModel3dSegment(provider('tripo'), {
      modelUrl: 'https://cdn.example/model.glb',
      mode: 'mesh'
    })
    expect(postMock.mock.calls[0]?.[0]).toBe('/v3/mesh/segment')
    expect(postMock.mock.calls[0]?.[1]).toEqual({ input: 'https://cdn.example/model.glb' })
    expect(job.pollingUrl).toBe('tripo-segment::t-seg')
    expect(job.jobId).toBe('t-seg')
  })

  it('upgrades to v2 when a granularity is requested', async () => {
    postMock.mockResolvedValueOnce({ data: { data: { task_id: 't-seg2' } } })
    await submitCloudModel3dSegment(provider('tripo'), {
      modelUrl: 'https://cdn.example/model.glb',
      mode: 'mesh',
      granularity: 'detailed',
      splitByConnectivity: false
    })
    expect(postMock.mock.calls[0]?.[1]).toMatchObject({
      model: 'v2.0-20260430',
      segmentation_granularity: 'detailed',
      split_by_connectivity: false
    })
  })

  it('submits /v3/mesh/smartsegment with the identity transform', async () => {
    postMock.mockResolvedValueOnce({ data: { data: { task_id: 't-smart' } } })
    const job = await submitCloudModel3dSegment(provider('tripo'), {
      modelUrl: 'https://cdn.example/model.glb',
      mode: 'smart',
      smartGranularity: 'fine',
      hint: 'character with sword'
    })
    expect(postMock.mock.calls[0]?.[0]).toBe('/v3/mesh/smartsegment')
    expect(postMock.mock.calls[0]?.[1]).toEqual({
      input: 'https://cdn.example/model.glb',
      seg_type: 'model',
      transform: TRIPO_SEGMENT_IDENTITY_TRANSFORM,
      granularity: 'fine',
      hint: 'character with sword'
    })
    expect(job.pollingUrl).toBe('tripo-smartSegment::t-smart')
  })

  it('rejects smart segmentation for non-GLB sources', async () => {
    await expect(
      submitCloudModel3dSegment(provider('tripo'), {
        modelUrl: 'https://cdn.example/model.fbx',
        mode: 'smart'
      })
    ).rejects.toThrow(/GLB/)
    expect(postMock).not.toHaveBeenCalled()
  })

  it('rejects providers without a segmentation API', async () => {
    await expect(
      submitCloudModel3dSegment(provider('meshy'), {
        modelUrl: 'https://cdn.example/model.glb'
      })
    ).rejects.toThrow(/Tripo/)
    expect(postMock).not.toHaveBeenCalled()
  })

  it('polls the shared task endpoint and reads model_url', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        data: {
          status: 'success',
          progress: 100,
          output: { model_url: 'https://cdn.tripo/mesh_seg.glb' }
        }
      }
    })
    const poll = await pollCloudModel3dSegment(provider('tripo'), {
      jobId: 't-seg',
      pollingUrl: `${MODEL3D_SEGMENT_TOKEN}t-seg`
    })
    expect(getMock.mock.calls[0]?.[0]).toBe('/v3/tasks/t-seg')
    expect(poll).toMatchObject({
      status: 'completed',
      downloadUrl: 'https://cdn.tripo/mesh_seg.glb'
    })
  })

  it('prefers seg_model_url for smart segmentation', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        data: {
          status: 'success',
          progress: 100,
          output: {
            model_url: 'https://cdn.tripo/source.glb',
            seg_model_url: 'https://cdn.tripo/smart_seg.glb'
          }
        }
      }
    })
    const poll = await pollCloudModel3dSegment(provider('tripo'), {
      jobId: 't-smart',
      pollingUrl: `${MODEL3D_SMART_SEGMENT_TOKEN}t-smart`
    })
    expect(poll.downloadUrl).toBe('https://cdn.tripo/smart_seg.glb')
  })

  it('surfaces the upstream failure message', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        data: { status: 'failed', error_code: 1004, error_message: 'invalid mesh' }
      }
    })
    const poll = await pollCloudModel3dSegment(provider('tripo'), {
      jobId: 't-seg',
      pollingUrl: `${MODEL3D_SEGMENT_TOKEN}t-seg`
    })
    expect(poll).toMatchObject({ status: 'failed', error: 'invalid mesh' })
  })

  it('reads smart-mode extras (mask + part description)', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        data: {
          status: 'success',
          output: {
            seg_model_url: 'https://cdn.tripo/smart_seg.glb',
            mask_url: 'https://cdn.tripo/mask.png',
            prompt: 'head, torso, legs'
          }
        }
      }
    })
    const extras = await fetchCloudModel3dSegmentExtras(provider('tripo'), {
      jobId: 't-smart',
      pollingUrl: `${MODEL3D_SMART_SEGMENT_TOKEN}t-smart`
    })
    expect(extras).toEqual({
      maskUrl: 'https://cdn.tripo/mask.png',
      description: 'head, torso, legs'
    })
  })

  it('skips extras for mesh mode and never throws on a failed extras lookup', async () => {
    await expect(
      fetchCloudModel3dSegmentExtras(provider('tripo'), {
        jobId: 't-seg',
        pollingUrl: `${MODEL3D_SEGMENT_TOKEN}t-seg`
      })
    ).resolves.toEqual({})
    expect(getMock).not.toHaveBeenCalled()

    getMock.mockRejectedValueOnce(new Error('boom'))
    await expect(
      fetchCloudModel3dSegmentExtras(provider('tripo'), {
        jobId: 't-smart',
        pollingUrl: `${MODEL3D_SMART_SEGMENT_TOKEN}t-smart`
      })
    ).resolves.toEqual({})
  })

  it('parses poll tokens', () => {
    expect(isModel3dSegmentPollingUrl(`${MODEL3D_SEGMENT_TOKEN}x`)).toBe(true)
    expect(isModel3dSegmentPollingUrl(`${MODEL3D_SMART_SEGMENT_TOKEN}x`)).toBe(true)
    expect(isModel3dSegmentPollingUrl('tripo::x')).toBe(false)
    expect(parseModel3dSegmentToken(`${MODEL3D_SMART_SEGMENT_TOKEN}x`)).toEqual({
      mode: 'smart',
      taskId: 'x'
    })
    expect(parseModel3dSegmentToken(`${MODEL3D_SEGMENT_TOKEN}x`)).toEqual({
      mode: 'mesh',
      taskId: 'x'
    })
  })
})

describe('GLB part names', () => {
  it('reads node names as part names', () => {
    expect(parseGlbPartNames(makeGlb(['head', 'torso', 'leg']))).toEqual(['head', 'torso', 'leg'])
  })

  it('dedupes and drops blank names', () => {
    expect(parseGlbPartNames(makeGlb(['head', 'head', '  ', 'torso']))).toEqual(['head', 'torso'])
  })

  it('returns nothing for non-GLB payloads', () => {
    expect(parseGlbPartNames(new Uint8Array([1, 2, 3, 4]))).toEqual([])
    expect(parseGlbPartNames(new TextEncoder().encode('{"nodes":[{"name":"head"}]}'))).toEqual([])
  })

  it('readGlbPartNames tolerates a missing file', () => {
    expect(readGlbPartNames('C:/definitely/not/here.glb')).toEqual([])
  })
})
