import { beforeEach, describe, expect, it, vi } from 'vitest'

const getMock = vi.fn()

vi.mock('axios', () => ({
  default: {
    create: () => ({
      get: getMock,
      post: vi.fn(),
      interceptors: { request: { use: () => undefined } }
    }),
    isAxiosError: (err: unknown) =>
      Boolean(err && typeof err === 'object' && (err as { isAxiosError?: boolean }).isAxiosError)
  }
}))

import { meshyMeshOps } from '../src/main/services/modelProviders/meshy/meshOps'
import type { ModelProviderInstance } from '../src/shared/modelProvider'
import { createEmptyModalityMap } from '../src/shared/modelProvider'

function provider(): ModelProviderInstance {
  return {
    id: 'meshy-1',
    providerKind: 'meshy',
    label: 'Meshy',
    apiKey: 'k-test',
    baseUrl: 'https://api.meshy.ai',
    enabled: true,
    modalities: createEmptyModalityMap()
  }
}

const MESHY_RIG_TASK = '0189f0aa-1234-7000-8000-abcdefabcdef'

/**
 * Meshy 方言：retexture（贴图）/ remesh（重拓扑）/ rigging（蒙皮）的协议细节。
 * 换行/字段名以官方 OpenAPI（docs.meshy.ai/openapi.json）为准。
 */
describe('meshy 方言', () => {
  beforeEach(() => {
    getMock.mockReset()
  })
  it('贴图走 /openapi/v1/retexture 并映射提示词 / PBR / 去光照 / 分辨率', () => {
    const request = meshyMeshOps.buildPostProcessRequest({
      op: 'texture',
      source: 'https://cdn.example/model.glb',
      texturePromptText: 'worn leather',
      pbr: true,
      delight: false,
      textureQuality: 'detailed'
    })
    expect(request.path).toBe('/openapi/v1/retexture')
    expect(request.body).toEqual({
      model_url: 'https://cdn.example/model.glb',
      text_style_prompt: 'worn leather',
      enable_pbr: true,
      remove_lighting: false,
      texture_resolution: '4k'
    })
  })

  it('贴图精度档位映射到 Meshy 分辨率（两家的轴不同）', () => {
    const resolution = (quality: string) =>
      meshyMeshOps.buildPostProcessRequest({
        op: 'texture',
        source: 'https://cdn.example/model.glb',
        textureQuality: quality as never
      }).body.texture_resolution
    expect(resolution('fast')).toBe('2k')
    expect(resolution('standard')).toBe('2k')
    expect(resolution('detailed')).toBe('4k')
    expect(resolution('extreme')).toBe('8k')
  })

  it('上游是 Meshy 自己的 task id 时用 input_task_id，不再上传', () => {
    const request = meshyMeshOps.buildPostProcessRequest({
      op: 'texture',
      providerTaskId: '0189f0aa-1234-7000-8000-abcdefabcdef',
      source: 'https://cdn.example/model.glb'
    })
    expect(request.body.input_task_id).toBe('0189f0aa-1234-7000-8000-abcdefabcdef')
    expect(request.body.model_url).toBeUndefined()
  })

  it('重拓扑走 /openapi/v1/remesh 并映射 topology / 面数 / origin', () => {
    const request = meshyMeshOps.buildPostProcessRequest({
      op: 'retopology',
      source: 'https://cdn.example/model.glb',
      quad: true,
      faceLimit: 5000,
      pivotToCenterBottom: true
    })
    expect(request.path).toBe('/openapi/v1/remesh')
    expect(request.body).toEqual({
      model_url: 'https://cdn.example/model.glb',
      topology: 'quad',
      target_polycount: 5000,
      origin_at: 'bottom'
    })
  })

  it('未传 quad 时 topology 为 triangle，且不透传 Tripo 的算法档位', () => {
    const request = meshyMeshOps.buildPostProcessRequest({
      op: 'retopology',
      source: 'https://cdn.example/model.glb',
      retopologyMode: 'basic'
    })
    expect(request.body).toEqual({
      model_url: 'https://cdn.example/model.glb',
      topology: 'triangle'
    })
  })

  it('未接入的 op 显式报错（含 meshComplete / rigCheck / segment）', () => {
    for (const op of ['meshComplete', 'rigCheck'] as const) {
      expect(() =>
        meshyMeshOps.buildPostProcessRequest({ op, source: 'https://cdn.example/model.glb' })
      ).toThrow(/Meshy/)
    }
    expect(() =>
      meshyMeshOps.buildSegmentRequest({ source: 'https://cdn.example/model.glb', mode: 'mesh' })
    ).toThrow(/Meshy/)
  })

  it('格式转换只传 target_formats，并把 GLTF 映射成 glb', () => {
    const request = meshyMeshOps.buildPostProcessRequest({
      op: 'convert',
      source: 'https://cdn.example/model.glb',
      format: 'FBX',
      // 高级参数对它无效：不应出现在请求体里
      fbxPreset: '3dsmax',
      quad: true,
      faceLimit: 5000,
      pivotToCenterBottom: true,
      packUv: true,
      partNames: ['head']
    })
    expect(request.path).toBe('/openapi/v1/convert')
    expect(request.body).toEqual({
      model_url: 'https://cdn.example/model.glb',
      target_formats: ['fbx']
    })

    expect(
      meshyMeshOps.buildPostProcessRequest({
        op: 'convert',
        providerTaskId: MESHY_RIG_TASK,
        source: 'https://cdn.example/model.glb',
        format: 'GLTF'
      }).body
    ).toEqual({ input_task_id: MESHY_RIG_TASK, target_formats: ['glb'] })

    expect(() =>
      meshyMeshOps.buildPostProcessRequest({
        op: 'convert',
        source: 'https://cdn.example/model.glb'
      })
    ).toThrow(/format|格式/)
  })

  it('任务查询路径按任务族分', () => {
    expect(meshyMeshOps.pollPath('rig', 't1')).toBe('/openapi/v1/rigging/t1')
    expect(meshyMeshOps.pollPath('retarget', 't2')).toBe('/openapi/v1/animations/t2')
    expect(meshyMeshOps.pollPath('texture', 't3')).toBe('/openapi/v1/retexture/t3')
    expect(meshyMeshOps.pollPath('retopology', 't4')).toBe('/openapi/v1/remesh/t4')
    expect(meshyMeshOps.pollPath('convert', 't5')).toBe('/openapi/v1/convert/t5')
    expect(() => meshyMeshOps.pollPath('segment', 't6')).toThrow(/Meshy/)
  })

  it('提交响应取 result（字符串或对象）', () => {
    expect(meshyMeshOps.parseSubmit({ result: 'abc' })).toBe('abc')
    expect(meshyMeshOps.parseSubmit({ result: { id: 'def' } })).toBe('def')
    expect(meshyMeshOps.parseSubmit({})).toBeUndefined()
  })

  it('task id 命名空间判定：UUID 认、Tripo 的 task_* 不认', () => {
    expect(meshyMeshOps.acceptsTaskId('0189f0aa-1234-7000-8000-abcdefabcdef')).toBe(true)
    expect(meshyMeshOps.acceptsTaskId('task_abc123')).toBe(false)
    expect(meshyMeshOps.acceptsTaskId('  ')).toBe(false)
  })

  it('解析 retexture / remesh 产物（model_urls.glb → model_url 兜底）', () => {
    expect(
      meshyMeshOps.parseTask('texture', {
        status: 'SUCCEEDED',
        progress: 100,
        model_urls: { glb: 'https://cdn.meshy/textured.glb', fbx: 'https://cdn.meshy/t.fbx' }
      })
    ).toMatchObject({ status: 'completed', downloadUrl: 'https://cdn.meshy/textured.glb' })

    expect(
      meshyMeshOps.parseTask('retopology', {
        status: 'SUCCEEDED',
        model_url: 'https://cdn.meshy/remeshed.glb'
      })
    ).toMatchObject({ status: 'completed', downloadUrl: 'https://cdn.meshy/remeshed.glb' })

    // EXPIRED 按失败处理（以前会落进 pending 一直轮询）
    expect(meshyMeshOps.parseTask('texture', { status: 'EXPIRED' })).toEqual({ status: 'failed' })
    expect(
      meshyMeshOps.parseTask('texture', { status: 'FAILED', task_error: { message: 'nope' } })
    ).toEqual({ status: 'failed', error: 'nope' })
    expect(meshyMeshOps.parseTask('texture', { status: 'IN_PROGRESS', progress: 30 })).toEqual({
      status: 'in_progress',
      progress: 30
    })
  })

  it('蒙皮产物仍走 result 字段', () => {
    expect(
      meshyMeshOps.parseTask('rig', {
        status: 'SUCCEEDED',
        result: { rigged_character_glb_url: 'https://cdn.meshy/rigged.glb' }
      })
    ).toMatchObject({ status: 'completed', downloadUrl: 'https://cdn.meshy/rigged.glb' })
  })

  it('重定向走 /openapi/v1/animations，单个用 action_id、多个用 action_ids', () => {
    const single = meshyMeshOps.buildPostProcessRequest({
      op: 'retarget',
      providerTaskId: MESHY_RIG_TASK,
      source: 'https://cdn.example/model.glb',
      actionIds: [7]
    })
    expect(single.path).toBe('/openapi/v1/animations')
    expect(single.body).toEqual({ rig_task_id: MESHY_RIG_TASK, action_id: 7 })

    const batch = meshyMeshOps.buildPostProcessRequest({
      op: 'retarget',
      providerTaskId: MESHY_RIG_TASK,
      source: 'https://cdn.example/model.glb',
      actionIds: [7, 12, 7, 0, -3]
    })
    // 去重 + 丢弃非法值
    expect(batch.body).toEqual({ rig_task_id: MESHY_RIG_TASK, action_ids: [7, 12] })
  })

  it('重定向只吃 Meshy 自己的绑骨任务 id，且必须有动作', () => {
    // Tripo 的 task_* 不认（跨供应商链路）
    expect(() =>
      meshyMeshOps.buildPostProcessRequest({
        op: 'retarget',
        providerTaskId: 'task_tripo_rig',
        source: 'https://cdn.example/model.glb',
        actionIds: [7]
      })
    ).toThrow(/Meshy/)

    // 只有 URL 也不行：Meshy 该端点要求 rig_task_id
    expect(() =>
      meshyMeshOps.buildPostProcessRequest({
        op: 'retarget',
        source: 'https://cdn.example/model.glb',
        actionIds: [7]
      })
    ).toThrow(/rig task id|绑骨任务 id/)

    // 没有选动作
    expect(() =>
      meshyMeshOps.buildPostProcessRequest({
        op: 'retarget',
        providerTaskId: MESHY_RIG_TASK,
        source: 'https://cdn.example/model.glb'
      })
    ).toThrow(/action_id/)
  })

  it('解析重定向产物（result.animation_glb_url）', () => {
    expect(
      meshyMeshOps.parseTask('retarget', {
        status: 'SUCCEEDED',
        progress: 100,
        result: { animation_glb_url: 'https://cdn.meshy/walk.glb' }
      })
    ).toMatchObject({ status: 'completed', downloadUrl: 'https://cdn.meshy/walk.glb' })

    expect(
      meshyMeshOps.parseTask('retarget', {
        status: 'SUCCEEDED',
        result: { animation_fbx_url: 'https://cdn.meshy/walk.fbx' }
      })
    ).toMatchObject({ status: 'completed', downloadUrl: 'https://cdn.meshy/walk.fbx' })
  })

  it('动作库：映射 action_id/name/category/preview，支持搜索参数', async () => {
    getMock.mockResolvedValueOnce({
      data: [
        {
          action_id: 7,
          name: 'Walk',
          key: 'walk',
          category: 'WalkAndRun',
          sub_category: 'Basic',
          preview_url: 'https://cdn.meshy/walk.gif'
        },
        { action_id: 12, name: 'Run', key: 'run', category: 'WalkAndRun' },
        { name: 'broken-without-id' }
      ]
    })
    const list = await meshyMeshOps.listAnimations!(provider(), { search: 'alk' })
    expect(getMock.mock.calls[0]?.[0]).toBe('/openapi/v1/animations/library')
    expect(getMock.mock.calls[0]?.[1]).toMatchObject({ params: { search: 'alk' } })
    expect(list).toEqual([
      {
        id: '7',
        label: 'Walk',
        category: 'WalkAndRun',
        subCategory: 'Basic',
        previewUrl: 'https://cdn.meshy/walk.gif'
      },
      { id: '12', label: 'Run', category: 'WalkAndRun' }
    ])
  })

  it('动作库返回非数组时安全降级为空', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [] } })
    await expect(meshyMeshOps.listAnimations!(provider())).resolves.toEqual([])
  })
})
