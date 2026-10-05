/**
 * 导演台「参数存到节点 → 再次进入」的往返测试。
 *
 * 用户反馈：在 3D 导演台调整参数后保存到节点，再次进入没有保持在调整后的值。
 * 这条把整条链路钉住：完整舞台 → `patchGenParamsWithNodeStage`（写进节点 genParams）
 * → `resolveDirectorStageForNode`（再次进入时读回），逐字段比对。
 *
 * 顺带守住那个历史坑：`normalizeStageObject` 的白名单必须覆盖全部 `StagePrimitive`，
 * 漏一个就会在重建网格时退化成 prop 占位方块（历史上 cone / arch 重开后全变 box）。
 */
import { describe, expect, it } from 'vitest'
import {
  STAGE_PRIMITIVE_VALUES,
  createDefaultDirectorStage,
  readDirectorStage,
  type DirectorStageState
} from '../src/shared/domain'
import {
  patchGenParamsWithNodeStage,
  readStagesByNodeId,
  resolveDirectorStageForNode
} from '../src/renderer/src/features/director/directorStageBinding'

/** 只给 stage / stagesByNodeId 这类字段，graphJson 里放一个导演台处理节点 */
function graphJsonWith(nodeId: string) {
  return {
    nodes: [directorNode(nodeId)],
    edges: []
  }
}

/**
 * 导演台处理节点：`asset.motion` + `category: 'asset'`，且**不能带 assetId**
 * （带 assetId 会被判成宿主引用节点，不再算加工节点 → 舞台会被当成孤儿清掉）。
 */
function directorNode(nodeId: string) {
  return { id: nodeId, typeId: 'asset.motion', category: 'asset', params: {} }
}

/** 一份「每个字段都被改成非默认值」的舞台，用于逐字段比对 */
function richStage(nodeId: string): DirectorStageState {
  const stage = createDefaultDirectorStage()
  const cameraId = stage.cameras?.[0]?.id ?? 'cam-default'
  return {
    ...stage,
    ownerProcessingNodeId: nodeId,
    transformMode: 'rotate',
    selectedObjectId: 'obj-1',
    activeCameraId: cameraId,
    gridVisible: false,
    gridOpacity: 0.42,
    gridOffsetY: -1.5,
    aspectRatio: '21:9',
    skyColor: '#123456',
    panoramaVisible: false,
    panoramaYaw: 123.5,
    panoramaRadius: 42,
    skyColorIsFollow: undefined,
    world: { ...(stage.world ?? {}), scalePercent: 175, position: { x: 3, y: 4, z: 5 } },
    objects: [
      {
        id: 'obj-1',
        name: '角色 A',
        kind: 'character',
        position: { x: 1, y: 2, z: 3 },
        rotation: { x: 0.1, y: 0.2, z: 0.3 },
        scale: { x: 1.1, y: 1.2, z: 1.3 },
        visible: false,
        locked: true,
        nameVisible: true,
        parentId: null,
        modelAssetId: 'asset-9',
        modelRelativePath: 'Cache/Models/hero.glb',
        // 贴图覆盖是「材质 key → { 贴图槽: 路径 | null }」（槽位只有 map / normalMap）
        materialTextures: {
          'mat-0': { map: 'Cache/Images/b.png', normalMap: null }
        },
        posePresets: [{ id: 'p1', name: '挥手', bones: {} }],
        // IK 链的真实形状：id 是槽位（slot1..4）+ 末端效应器骨骼
        ikChains: [{ id: 'slot1', effector: 'hand_l', links: ['wrist_l'] }]
      }
    ],
    cameras: (stage.cameras ?? []).map((cam) => ({
      ...cam,
      name: '主机位',
      viewer: {
        // DirectorViewerState 的真实形状：position / target / fov（没有 distance / yaw）
        ...cam.viewer,
        position: { x: 1, y: 2, z: 3 },
        target: { x: 7, y: 8, z: 9 },
        fov: 38
      }
    }))
  } as unknown as DirectorStageState
}

describe('导演台参数存到节点后再次进入', () => {
  it('整体往返：写进节点 genParams 再读回，逐字段一致', () => {
    const nodeId = 'node-director'
    const stage = richStage(nodeId)

    const genParams = patchGenParamsWithNodeStage(
      { graphJson: graphJsonWith(nodeId) },
      nodeId,
      stage
    )
    const restored = resolveDirectorStageForNode(genParams, genParams.graphJson, nodeId)

    // 舞台级字段
    expect(restored.transformMode).toBe('rotate')
    expect(restored.selectedObjectId).toBe('obj-1')
    expect(restored.gridVisible).toBe(false)
    expect(restored.gridOpacity).toBeCloseTo(0.42, 5)
    expect(restored.gridOffsetY).toBeCloseTo(-1.5, 5)
    expect(restored.aspectRatio).toBe('21:9')
    expect(restored.skyColor).toBe('#123456')
    expect(restored.panoramaVisible).toBe(false)
    expect(restored.panoramaYaw).toBeCloseTo(123.5, 5)
    expect(restored.panoramaRadius).toBeCloseTo(42, 5)
    expect(restored.activeCameraId).toBe(stage.activeCameraId)
    // 场景根（world）
    expect(restored.world?.scalePercent).toBeCloseTo(175, 5)
    expect(restored.world?.position).toEqual({ x: 3, y: 4, z: 5 })
    // 相机（含 viewer）
    const cam = restored.cameras?.find((c) => c.id === stage.activeCameraId)
    expect(cam?.name).toBe('主机位')
    expect(cam?.viewer?.target).toEqual({ x: 7, y: 8, z: 9 })
    expect(cam?.viewer?.position).toEqual({ x: 1, y: 2, z: 3 })
    expect(cam?.viewer?.fov).toBeCloseTo(38, 5)
  })

  it('物体级字段（含贴图 / 姿态预设 / IK 链）也要保住', () => {
    const nodeId = 'node-director'
    const stage = richStage(nodeId)
    const genParams = patchGenParamsWithNodeStage(
      { graphJson: graphJsonWith(nodeId) },
      nodeId,
      stage
    )
    const restored = resolveDirectorStageForNode(genParams, genParams.graphJson, nodeId)
    const obj = restored.objects.find((o) => o.id === 'obj-1')!

    expect(obj).toBeTruthy()
    expect(obj.name).toBe('角色 A')
    expect(obj.visible).toBe(false)
    expect(obj.locked).toBe(true)
    expect(obj.position).toEqual({ x: 1, y: 2, z: 3 })
    expect(obj.rotation).toEqual({ x: 0.1, y: 0.2, z: 0.3 })
    expect(obj.scale).toEqual({ x: 1.1, y: 1.2, z: 1.3 })
    expect(obj.modelAssetId).toBe('asset-9')
    // Cache 产物不入资产库：丢了这条路径就只能退化成占位方块
    expect(obj.modelRelativePath).toBe('Cache/Models/hero.glb')
    expect(obj.materialTextures).toEqual({
      'mat-0': { map: 'Cache/Images/b.png', normalMap: null }
    })
    expect(obj.posePresets?.[0]?.name).toBe('挥手')
    expect(obj.ikChains?.[0]?.effector).toBe('hand_l')
  })

  it('多个导演台节点各自独立，互不串台', () => {
    const a = 'node-a'
    const b = 'node-b'
    // 图里必须**同时存在**两个导演台节点 —— 绑定层会清掉不在图中的节点舞台（这是有意的）
    const graphJson = { nodes: [directorNode(a), directorNode(b)], edges: [] }
    const genParams = patchGenParamsWithNodeStage({ graphJson }, a, {
      ...richStage(a),
      panoramaYaw: 10
    })
    const withBoth = patchGenParamsWithNodeStage(genParams, b, {
      ...richStage(b),
      panoramaYaw: 200,
      transformMode: 'scale'
    })

    const stages = readStagesByNodeId(withBoth)
    expect(Object.keys(stages).sort()).toEqual([a, b])
    expect(stages[a]!.panoramaYaw).toBeCloseTo(10, 5)
    expect(stages[b]!.panoramaYaw).toBeCloseTo(200, 5)
    expect(stages[b]!.transformMode).toBe('scale')
  })

  it('节点从图中删除后，其舞台不再残留（不会在重建后串回旧参数）', () => {
    const nodeId = 'node-director'
    const stage = richStage(nodeId)
    const genParams = patchGenParamsWithNodeStage({}, nodeId, stage)
    // 图里已经没有这个节点了
    const cleaned = patchGenParamsWithNodeStage(
      { ...genParams, graphJson: { nodes: [], edges: [] } },
      'other',
      createDefaultDirectorStage()
    )
    const stages = readStagesByNodeId(cleaned)
    expect(stages[nodeId]).toBeUndefined()
  })
})

/**
 * StagePrimitive 白名单：`normalizeStageObject` 里漏一个，重建网格就退化成占位方块。
 *
 * 直接遍历**导出的真实清单**（而不是在测试里另抄一份）——
 * 以后新增几何体自动纳入检查，这正是历史上 cone / arch 被漏掉的那类 bug。
 */
describe('基础几何体白名单', () => {
  it('每个 StagePrimitive 往返后都还是自己（不会退化成 undefined → box）', () => {
    expect(STAGE_PRIMITIVE_VALUES.length).toBeGreaterThan(0)
    for (const primitive of STAGE_PRIMITIVE_VALUES) {
      const stage = createDefaultDirectorStage()
      const raw = {
        ...stage,
        objects: [
          {
            id: 'o',
            name: 'p',
            kind: 'primitive',
            primitive,
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
          }
        ]
      }
      const read = readDirectorStage({ stage: raw })
      expect(read.objects[0]?.primitive, `primitive=${primitive}`).toBe(primitive)
    }
  })
})
