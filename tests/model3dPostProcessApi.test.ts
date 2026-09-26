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
  MODEL3D_COMPLETE_TOKEN,
  MODEL3D_CONVERT_TOKEN,
  MODEL3D_RETARGET_TOKEN,
  MODEL3D_TEXTURE_TOKEN,
  isModel3dPostProcessPollingUrl,
  parseModel3dPostProcessToken,
  pollCloudModel3dPostProcess,
  pollCloudRigCheck,
  submitCloudModel3dPostProcess,
  submitCloudRigCheck
} from '../src/main/services/modelProviders/model3dPostProcess'

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

describe('Tripo mesh post-process API', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('submits /v3/mesh/complete with the segment task id', async () => {
    postMock.mockResolvedValueOnce({ data: { data: { task_id: 't-complete' } } })
    const job = await submitCloudModel3dPostProcess(provider('tripo'), {
      op: 'meshComplete',
      providerTaskId: 'task_seg',
      partNames: ['head', 'torso'],
      completionMode: 'quick_cap'
    })
    expect(postMock.mock.calls[0]?.[0]).toBe('/v3/mesh/complete')
    expect(postMock.mock.calls[0]?.[1]).toEqual({
      input: 'task_seg',
      model: 'v1.0-20250506',
      part_names: ['head', 'torso'],
      completion_mode: 'quick_cap'
    })
    expect(job.pollingUrl).toBe('tripo-meshComplete::t-complete')
  })

  it('requires a segment task id for part completion', async () => {
    await expect(
      submitCloudModel3dPostProcess(provider('tripo'), {
        op: 'meshComplete',
        modelUrl: 'https://cdn.example/model.glb'
      })
    ).rejects.toThrow(/task id|任务 id/)
    expect(postMock).not.toHaveBeenCalled()
  })

  it('submits smart retopology with parts and bake', async () => {
    postMock.mockResolvedValueOnce({ data: { data: { task_id: 't-dec' } } })
    await submitCloudModel3dPostProcess(provider('tripo'), {
      op: 'retopology',
      modelUrl: 'https://cdn.example/model.glb',
      faceLimit: 5000,
      quad: true,
      bake: true,
      partNames: ['head']
    })
    expect(postMock.mock.calls[0]?.[0]).toBe('/v3/mesh/decimate')
    expect(postMock.mock.calls[0]?.[1]).toEqual({
      input: 'https://cdn.example/model.glb',
      model: 'v2.0',
      face_limit: 5000,
      quad: true,
      bake: true,
      part_names: ['head']
    })
  })

  it('drops bake / part_names on the basic tier and prefers the upstream task id', async () => {
    postMock.mockResolvedValueOnce({ data: { data: { task_id: 't-dec2' } } })
    await submitCloudModel3dPostProcess(provider('tripo'), {
      op: 'retopology',
      providerTaskId: 'task_model',
      modelUrl: 'https://cdn.example/model.glb',
      retopologyMode: 'basic',
      bake: true,
      partNames: ['head']
    })
    expect(postMock.mock.calls[0]?.[1]).toEqual({ input: 'task_model', model: 'v1.0' })
  })

  it('submits retarget with a single or batched animation list', async () => {
    postMock.mockResolvedValueOnce({ data: { data: { task_id: 't-rt' } } })
    await submitCloudModel3dPostProcess(provider('tripo'), {
      op: 'retarget',
      providerTaskId: 'task_rig',
      animation: 'preset:walk',
      outFormat: 'fbx',
      animateInPlace: true
    })
    expect(postMock.mock.calls[0]?.[0]).toBe('/v3/animations/retarget')
    expect(postMock.mock.calls[0]?.[1]).toEqual({
      input: 'task_rig',
      animation: 'preset:walk',
      out_format: 'fbx',
      animate_in_place: true
    })

    postMock.mockResolvedValueOnce({ data: { data: { task_id: 't-rt2' } } })
    await submitCloudModel3dPostProcess(provider('tripo'), {
      op: 'retarget',
      providerTaskId: 'task_rig',
      animations: ['preset:idle', 'preset:run'],
      bakeAnimation: false,
      exportWithGeometry: false
    })
    expect(postMock.mock.calls[1]?.[1]).toEqual({
      input: 'task_rig',
      animations: ['preset:idle', 'preset:run'],
      bake_animation: false,
      export_with_geometry: false
    })
  })

  it('requires a rig task id and at least one animation for retarget', async () => {
    await expect(
      submitCloudModel3dPostProcess(provider('tripo'), {
        op: 'retarget',
        providerTaskId: 'task_rig'
      })
    ).rejects.toThrow(/animation|动画/i)

    await expect(
      submitCloudModel3dPostProcess(provider('tripo'), {
        op: 'retarget',
        modelUrl: 'https://cdn.example/model.glb',
        animation: 'preset:walk'
      })
    ).rejects.toThrow(/task id|任务 id/)
  })

  it('按 op 逐个校验供应商能力（Meshy 有重拓扑但无补全）', async () => {
    // Meshy 未接入的 op：能力矩阵拦住，不发请求
    await expect(
      submitCloudModel3dPostProcess(provider('meshy'), {
        op: 'meshComplete',
        providerTaskId: 'task_seg',
        modelUrl: 'https://cdn.example/model.glb'
      })
    ).rejects.toThrow(/Tripo/)
    expect(postMock).not.toHaveBeenCalled()

    // Meshy 已接入的 op：走它自己的端点
    postMock.mockResolvedValueOnce({ data: { result: { id: 'meshy-remesh-1' } } })
    const job = await submitCloudModel3dPostProcess(provider('meshy'), {
      op: 'retopology',
      modelUrl: 'https://cdn.example/model.glb'
    })
    expect(postMock.mock.calls[0]?.[0]).toBe('/openapi/v1/remesh')
    expect(job.pollingUrl).toBe('meshy-retopology::meshy-remesh-1')
  })

  it('submits rig-check for GLB sources or task ids', async () => {
    postMock.mockResolvedValueOnce({ data: { data: { task_id: 't-check' } } })
    await expect(
      submitCloudRigCheck(provider('tripo'), { modelUrl: 'https://cdn.example/model.glb' })
    ).resolves.toBe('t-check')
    expect(postMock.mock.calls[0]?.[0]).toBe('/v3/animations/rig-check')
    expect(postMock.mock.calls[0]?.[1]).toEqual({ input: 'https://cdn.example/model.glb' })

    postMock.mockResolvedValueOnce({ data: { data: { task_id: 't-check2' } } })
    await expect(
      submitCloudRigCheck(provider('tripo'), { providerTaskId: 'task_model' })
    ).resolves.toBe('t-check2')
  })

  it('rejects rig-check for non-GLB urls', async () => {
    await expect(
      submitCloudRigCheck(provider('tripo'), { modelUrl: 'https://cdn.example/model.fbx' })
    ).rejects.toThrow(/GLB/)
    expect(postMock).not.toHaveBeenCalled()
  })

  it('submits /v3/models/convert with format and advanced export options', async () => {
    postMock.mockResolvedValueOnce({ data: { data: { task_id: 't-conv' } } })
    const job = await submitCloudModel3dPostProcess(provider('tripo'), {
      op: 'convert',
      modelUrl: 'https://cdn.example/model.glb',
      format: 'FBX',
      fbxPreset: '3dsmax',
      textureSize: 2048,
      textureFormat: 'png',
      quad: true,
      faceLimit: 8000,
      pivotToCenterBottom: true,
      packUv: true,
      bake: true,
      withAnimation: false,
      partNames: ['head']
    })
    expect(postMock.mock.calls[0]?.[0]).toBe('/v3/models/convert')
    expect(postMock.mock.calls[0]?.[1]).toEqual({
      input: 'https://cdn.example/model.glb',
      format: 'FBX',
      quad: true,
      face_limit: 8000,
      texture_size: 2048,
      texture_format: 'PNG',
      bake: true,
      pack_uv: true,
      pivot_to_center_bottom: true,
      with_animation: false,
      fbx_preset: '3dsmax',
      part_names: ['head']
    })
    expect(job.pollingUrl).toBe(`${MODEL3D_CONVERT_TOKEN}t-conv`)
  })

  it('requires a valid convert format and drops unknown enum values', async () => {
    await expect(
      submitCloudModel3dPostProcess(provider('tripo'), {
        op: 'convert',
        modelUrl: 'https://cdn.example/model.glb'
      })
    ).rejects.toThrow(/format|格式/)
    expect(postMock).not.toHaveBeenCalled()

    postMock.mockResolvedValueOnce({ data: { data: { task_id: 't-conv2' } } })
    await submitCloudModel3dPostProcess(provider('tripo'), {
      op: 'convert',
      providerTaskId: 'task_model',
      format: 'gltf',
      fbxPreset: 'nonsense',
      textureFormat: 'gif',
      exportOrientation: '+y',
      flattenBottom: true,
      flattenBottomThreshold: 0.02,
      scaleFactor: 2,
      exportVertexColors: true
    })
    expect(postMock.mock.calls[0]?.[1]).toEqual({
      input: 'task_model',
      format: 'GLTF',
      flatten_bottom: true,
      flatten_bottom_threshold: 0.02,
      export_vertex_colors: true,
      scale_factor: 2,
      export_orientation: '+y'
    })
  })

  it('submits /v3/models/texture with prompt and quality', async () => {
    postMock.mockResolvedValueOnce({ data: { data: { task_id: 't-tex' } } })
    const job = await submitCloudModel3dPostProcess(provider('tripo'), {
      op: 'texture',
      modelUrl: 'https://cdn.example/model.glb',
      texturePromptText: 'worn leather with scratches',
      textureQuality: 'detailed',
      textureAlignment: 'geometry',
      textureSeed: 42,
      pbr: true,
      partNames: ['torso']
    })
    expect(postMock.mock.calls[0]?.[0]).toBe('/v3/models/texture')
    expect(postMock.mock.calls[0]?.[1]).toEqual({
      input: 'https://cdn.example/model.glb',
      model: 'v3.0-20250812',
      texture_prompt: { text: 'worn leather with scratches' },
      pbr: true,
      texture_seed: 42,
      texture_alignment: 'geometry',
      texture_quality: 'detailed',
      part_names: ['torso']
    })
    expect(job.pollingUrl).toBe(`${MODEL3D_TEXTURE_TOKEN}t-tex`)
  })

  it('blocks texture_quality=fast on texture models that do not support it', async () => {
    await expect(
      submitCloudModel3dPostProcess(provider('tripo'), {
        op: 'texture',
        modelUrl: 'https://cdn.example/model.glb',
        textureQuality: 'fast'
      })
    ).rejects.toThrow(/3\.5|fast/i)
    expect(postMock).not.toHaveBeenCalled()

    postMock.mockResolvedValueOnce({ data: { data: { task_id: 't-tex-fast' } } })
    await submitCloudModel3dPostProcess(provider('tripo'), {
      op: 'texture',
      modelUrl: 'https://cdn.example/model.glb',
      textureVersion: 'v3.5-20260815',
      textureQuality: 'fast',
      delight: false
    })
    expect(postMock.mock.calls[0]?.[1]).toEqual({
      input: 'https://cdn.example/model.glb',
      model: 'v3.5-20260815',
      texture_quality: 'fast',
      delight: false
    })
  })

  it('polls post-process tasks for the model url', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        data: {
          status: 'success',
          progress: 100,
          output: { model_url: 'https://cdn.tripo/lowpoly.glb' }
        }
      }
    })
    const poll = await pollCloudModel3dPostProcess(provider('tripo'), {
      jobId: 't-dec',
      pollingUrl: `${MODEL3D_RETARGET_TOKEN}t-dec`
    })
    expect(getMock.mock.calls[0]?.[0]).toBe('/v3/tasks/t-dec')
    expect(poll).toMatchObject({
      status: 'completed',
      downloadUrl: 'https://cdn.tripo/lowpoly.glb'
    })
  })

  it('polls rig-check for riggable + rig_type', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        data: {
          status: 'success',
          progress: 100,
          output: { riggable: true, rig_type: 'quadruped' }
        }
      }
    })
    const poll = await pollCloudRigCheck(provider('tripo'), 't-check')
    expect(poll).toMatchObject({ status: 'completed', riggable: true, rigType: 'quadruped' })
  })

  it('parses post-process poll tokens', () => {
    expect(isModel3dPostProcessPollingUrl(`${MODEL3D_COMPLETE_TOKEN}x`)).toBe(true)
    expect(isModel3dPostProcessPollingUrl('tripo-seg::x')).toBe(false)
    expect(parseModel3dPostProcessToken(`${MODEL3D_RETARGET_TOKEN}x`)).toEqual({
      op: 'retarget',
      taskId: 'x'
    })
    expect(parseModel3dPostProcessToken(`${MODEL3D_COMPLETE_TOKEN}x`)).toEqual({
      op: 'meshComplete',
      taskId: 'x'
    })
  })
})
