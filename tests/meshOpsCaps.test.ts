import { describe, expect, it } from 'vitest'
import {
  MODEL3D_POST_PROCESS_PROVIDER_KINDS,
  MODEL3D_RIG_PROVIDER_KINDS,
  MODEL3D_SEGMENT_PROVIDER_KINDS,
  supportsModel3dPostProcess,
  supportsModel3dRig,
  supportsModel3dSegment
} from '../src/shared/modelProvider'
import {
  MESH_OPS_CAPS,
  meshOpSupported,
  meshOpsFor,
  meshOpsProvidersFor,
  type MeshOp
} from '../src/shared/meshOps'
import { tripoAdapter } from '../src/main/services/modelProviders/tripo/adapter'
import { meshyAdapter } from '../src/main/services/modelProviders/meshy/adapter'
import { tripoMeshOps } from '../src/main/services/modelProviders/tripo/meshOps'
import { meshyMeshOps } from '../src/main/services/modelProviders/meshy/meshOps'
import {
  LEGACY_MESH_OPS_TOKENS,
  encodeMeshOpsJobToken,
  isMeshOpsJobToken,
  parseMeshOpsJobToken
} from '../src/main/services/modelProviders/meshOpsJob'

const POST_PROCESS_OPS: MeshOp[] = [
  'meshComplete',
  'retopology',
  'rigCheck',
  'retarget',
  'convert',
  'texture'
]

/**
 * 3D 网格加工的门禁与协议分层不变量：
 * - 「谁能做什么」只在 `@shared/meshOps` 的 MESH_OPS_CAPS 里声明，其他处的白名单都由它派生；
 * - 「怎么做」在各供应商方言里，编排层不出现供应商分支。
 */
describe('mesh ops 能力矩阵', () => {
  it('既有白名单全部由能力矩阵派生（单一真相）', () => {
    expect(MODEL3D_RIG_PROVIDER_KINDS).toEqual(meshOpsProvidersFor('rig'))
    expect(MODEL3D_SEGMENT_PROVIDER_KINDS).toEqual(meshOpsProvidersFor('segment'))
    expect(MODEL3D_POST_PROCESS_PROVIDER_KINDS).toEqual(meshOpsProvidersFor(...POST_PROCESS_OPS))

    // 锁定当前实际值，防止派生逻辑静默改变门禁
    expect([...MODEL3D_RIG_PROVIDER_KINDS].sort()).toEqual(['meshy', 'tripo'])
    expect([...MODEL3D_SEGMENT_PROVIDER_KINDS]).toEqual(['tripo'])
    // 后处理白名单 = 至少支持一个后处理 op 的供应商（Meshy 已支持重拓扑 / 贴图）
    expect([...MODEL3D_POST_PROCESS_PROVIDER_KINDS].sort()).toEqual(['meshy', 'tripo'])
  })

  it('各家的 op 覆盖范围与实现一致', () => {
    expect([...meshOpsFor('tripo')].sort()).toEqual(
      [
        'convert',
        'meshComplete',
        'retarget',
        'retopology',
        'rig',
        'rigCheck',
        'segment',
        'texture'
      ].sort()
    )
    expect([...meshOpsFor('meshy')].sort()).toEqual([
      'convert',
      'retarget',
      'retopology',
      'rig',
      'texture'
    ])
    // Meshy 未接入的 op 必须逐个为 false（UI 过滤与 facade 逐 op 门禁共用）
    for (const op of ['meshComplete', 'rigCheck', 'segment'] as const) {
      expect(meshOpSupported('meshy', op), `meshy 不该声明 ${op}`).toBe(false)
    }
  })

  it('supports* 助手与 meshOpSupported 口径一致', () => {
    for (const kind of Object.keys(MESH_OPS_CAPS)) {
      expect(supportsModel3dRig(kind)).toBe(meshOpSupported(kind, 'rig'))
      expect(supportsModel3dSegment(kind)).toBe(meshOpSupported(kind, 'segment'))
      expect(supportsModel3dPostProcess(kind)).toBe(
        POST_PROCESS_OPS.some((op) => meshOpSupported(kind, op))
      )
    }
  })

  it('未登记的供应商不支持任何 op', () => {
    expect(meshOpsFor('luma')).toEqual([])
    expect(meshOpSupported('lux3d', 'rig')).toBe(false)
  })

  it('UI 能力位与各家实现一致（参数显隐读的就是它）', () => {
    const tripo = MESH_OPS_CAPS.tripo!
    const meshy = MESH_OPS_CAPS.meshy!
    // Tripo 参数齐全
    for (const key of [
      'partNames',
      'textureModelVersion',
      'textureSeed',
      'retopologyTier',
      'retopologyBake',
      'convertAdvanced'
    ] as const) {
      expect(tripo[key], `tripo.${key} 应为 true`).toBe(true)
    }
    // Meshy 只有 topology / 面数 / 分辨率这类通用轴
    for (const key of [
      'partNames',
      'textureModelVersion',
      'textureSeed',
      'retopologyTier',
      'retopologyBake',
      'convertAdvanced'
    ] as const) {
      expect(meshy[key], `meshy.${key} 应为 false`).toBe(false)
    }
    expect(tripo.retargetIds).toBe('preset')
    expect(meshy.retargetIds).toBe('library')
  })

  it('能力矩阵声明的 op 都有对应方言实现（含各自的必需入参）', () => {
    const adapters = { meshy: meshyAdapter, tripo: tripoAdapter }
    const source = 'https://cdn/model.glb'
    // 每个 op 的最小可构造入参：缺 task id / 缺 format / 缺动画的 op 各自补齐，
    // 且 task id 必须落在该供应商的命名空间（Tripo `task_*` / Meshy UUID）
    const postProcessInput = (kind: string, op: MeshOp) => {
      const base = { op, source } as Record<string, unknown>
      if (op === 'meshComplete' || op === 'retarget') {
        base.providerTaskId = kind === 'meshy' ? '0189f0aa-1234-7000-8000-abcdefabcdef' : 'task_up'
      }
      if (op === 'retarget') {
        if (kind === 'meshy') base.actionIds = [7]
        else base.animation = 'preset:walk'
      }
      if (op === 'convert') base.format = 'FBX'
      if (op === 'rigCheck') base.modelUrl = source
      return base as never
    }

    for (const [kind, caps] of Object.entries(MESH_OPS_CAPS)) {
      // 声明即实现：矩阵里列出的 op，方言必须能构造请求（未支持的要显式抛错而非静默）
      const dialect = adapters[kind as keyof typeof adapters]?.meshOps
      expect(dialect, `${kind} 有能力位却没有方言`).toBeDefined()
      for (const op of caps.ops) {
        if (op === 'rig') {
          expect(() => dialect!.buildRigRequest({ source })).not.toThrow()
          expect(dialect!.pollPath('rig', 't1')).toContain('t1')
          continue
        }
        const request =
          op === 'segment'
            ? dialect!.buildSegmentRequest({ source, mode: 'mesh' })
            : dialect!.buildPostProcessRequest(postProcessInput(kind, op))
        expect(request.path, `${kind}.${op} 缺端点`).toMatch(/^\//)
        expect(dialect!.pollPath(op as never, 't1')).toContain('t1')
      }
    }
    expect(tripoAdapter.meshOps).toBe(tripoMeshOps)
    expect(meshyAdapter.meshOps).toBe(meshyMeshOps)
    expect(tripoMeshOps.kind).toBe('tripo')
  })
})

describe('网格加工 token 编解码（新旧格式兼容）', () => {
  it('写侧用 <kind>-<op>::<taskId>', () => {
    expect(encodeMeshOpsJobToken('tripo', 'segment', 'task_a')).toBe('tripo-segment::task_a')
    expect(encodeMeshOpsJobToken('tripo', 'smartSegment', ' task_b ')).toBe(
      'tripo-smartSegment::task_b'
    )
    expect(encodeMeshOpsJobToken('meshy', 'rig', 'abc')).toBe('meshy-rig::abc')
  })

  it('读侧认新格式', () => {
    expect(parseMeshOpsJobToken('tripo-segment::task_a')).toEqual({
      kind: 'tripo',
      op: 'segment',
      taskId: 'task_a'
    })
    expect(parseMeshOpsJobToken('meshy-rig::abc')).toEqual({
      kind: 'meshy',
      op: 'rig',
      taskId: 'abc'
    })
  })

  it('读侧兼容历史前缀（在途任务续跑）', () => {
    const legacy: Array<[string, string]> = [
      [LEGACY_MESH_OPS_TOKENS.tripoRig, 'rig'],
      [LEGACY_MESH_OPS_TOKENS.meshyRig, 'rig'],
      [LEGACY_MESH_OPS_TOKENS.segment, 'segment'],
      [LEGACY_MESH_OPS_TOKENS.smartSegment, 'smartSegment'],
      [LEGACY_MESH_OPS_TOKENS.meshComplete, 'meshComplete'],
      [LEGACY_MESH_OPS_TOKENS.retopology, 'retopology'],
      [LEGACY_MESH_OPS_TOKENS.retarget, 'retarget'],
      [LEGACY_MESH_OPS_TOKENS.convert, 'convert'],
      [LEGACY_MESH_OPS_TOKENS.texture, 'texture']
    ]
    for (const [prefix, op] of legacy) {
      const ref = parseMeshOpsJobToken(`${prefix}task_legacy`)
      expect(ref, `${prefix} 应能解析`).toMatchObject({ op, taskId: 'task_legacy' })
    }
  })

  it('不认识的 token 一律返回 undefined', () => {
    expect(parseMeshOpsJobToken('tripo-unknownop::x')).toBeUndefined()
    expect(parseMeshOpsJobToken('tripo-segment::')).toBeUndefined()
    expect(parseMeshOpsJobToken('kling-1')).toBeUndefined()
    expect(isMeshOpsJobToken(undefined)).toBe(false)
    expect(isMeshOpsJobToken('video-job-1')).toBe(false)
  })
})

describe('tripo 方言：请求构造与响应解析', () => {
  it('拆分走两条端点，智能分割必须 GLB', () => {
    expect(
      tripoMeshOps.buildSegmentRequest({ source: 'https://cdn/model.glb', mode: 'mesh' })
    ).toEqual({ path: '/v3/mesh/segment', body: { input: 'https://cdn/model.glb' } })

    const smart = tripoMeshOps.buildSegmentRequest({
      source: 'https://cdn/model.glb',
      mode: 'smart',
      smartGranularity: 'fine'
    })
    expect(smart.path).toBe('/v3/mesh/smartsegment')
    expect(smart.body).toMatchObject({ seg_type: 'model', granularity: 'fine' })

    expect(() =>
      tripoMeshOps.buildSegmentRequest({ source: 'https://cdn/model.fbx', mode: 'smart' })
    ).toThrow(/GLB/)
  })

  it('后处理每个 op 都有端点', () => {
    const source = 'https://cdn/model.glb'
    expect(tripoMeshOps.buildPostProcessRequest({ op: 'retopology', source }).path).toBe(
      '/v3/mesh/decimate'
    )
    expect(
      tripoMeshOps.buildPostProcessRequest({ op: 'convert', source, format: 'FBX' }).path
    ).toBe('/v3/models/convert')
    expect(tripoMeshOps.buildPostProcessRequest({ op: 'texture', source }).path).toBe(
      '/v3/models/texture'
    )
    expect(
      tripoMeshOps.buildPostProcessRequest({ op: 'rigCheck', source, modelUrl: source }).path
    ).toBe('/v3/animations/rig-check')
    expect(
      tripoMeshOps.buildPostProcessRequest({
        op: 'meshComplete',
        source,
        providerTaskId: 'task_seg'
      }).path
    ).toBe('/v3/mesh/complete')
    expect(
      tripoMeshOps.buildPostProcessRequest({
        op: 'retarget',
        source,
        providerTaskId: 'task_rig',
        animation: 'preset:walk'
      }).path
    ).toBe('/v3/animations/retarget')
  })

  it('蒙皮请求带回 spec / out_format 与 rig_type 映射', () => {
    const request = tripoMeshOps.buildRigRequest({
      source: 'https://cdn/model.glb',
      rigType: 'quadruped',
      spec: 'tripo',
      outFormat: 'fbx'
    })
    expect(request.path).toBe('/v3/animations/rig')
    expect(request.body).toMatchObject({
      rig_type: 'quadruped',
      spec: 'tripo',
      out_format: 'fbx',
      model: 'v2.5-20260210'
    })
    expect(
      tripoMeshOps.buildRigRequest({
        source: 'x',
        rigType: 'humanoid',
        spec: 'nope',
        outFormat: 'obj'
      }).body
    ).toMatchObject({ rig_type: 'biped', spec: 'mixamo', out_format: 'glb' })
  })

  it('parseTask 归一化状态 / 下载地址 / 失败原因 / 绑骨结论 / 附加产物', () => {
    expect(
      tripoMeshOps.parseTask('rig', {
        data: {
          status: 'success',
          progress: 100,
          output: { rigged_model_url: 'https://cdn/r.glb' }
        }
      })
    ).toEqual({ status: 'completed', progress: 100, downloadUrl: 'https://cdn/r.glb' })

    expect(
      tripoMeshOps.parseTask('segment', {
        data: {
          status: 'success',
          output: {
            model_url: 'https://cdn/seg.glb',
            mask_url: 'https://cdn/mask.png',
            prompt: 'head, torso',
            seg_task_id: 'task_sub'
          }
        }
      })
    ).toMatchObject({
      status: 'completed',
      downloadUrl: 'https://cdn/seg.glb',
      extras: { maskUrl: 'https://cdn/mask.png', description: 'head, torso', segTaskId: 'task_sub' }
    })

    expect(
      tripoMeshOps.parseTask('rigCheck', {
        data: { status: 'success', output: { riggable: true, rig_type: 'biped' } }
      })
    ).toMatchObject({ status: 'completed', riggable: true, rigType: 'biped' })

    expect(
      tripoMeshOps.parseTask('texture', { data: { status: 'failed', error_message: 'bad input' } })
    ).toEqual({ status: 'failed', error: 'bad input' })

    expect(
      tripoMeshOps.parseTask('convert', { data: { status: 'running', progress: 42 } })
    ).toEqual({ status: 'in_progress', progress: 42 })
  })
})
