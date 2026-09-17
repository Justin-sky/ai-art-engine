import { describe, expect, it } from 'vitest'
import {
  bonePoseFromReadback,
  executeModelPoseNode,
  type GraphNode,
  type NodeExecuteContext
} from '../src/shared/graph'
import { computePresetPoseReadback } from '../src/shared/blenderPoseGeneration'

function poseNode(params: Record<string, unknown> = {}): GraphNode {
  return {
    id: 'pose-1',
    typeId: 'model.pose',
    category: 'note',
    position: { x: 0, y: 0 },
    params
  } as GraphNode
}

const incomingModel = {
  kind: 'asset' as const,
  assetId: 'model-1',
  assetType: 'model' as const,
  relativePath: 'Cache/Models/hero.glb',
  title: 'Hero'
}

describe('executeModelPoseNode', () => {
  it('throws when no upstream model is connected', async () => {
    const ctx = {
      node: poseNode({ generateInstruction: '自然站立休息' }),
      inputs: {}
    } as unknown as NodeExecuteContext
    await expect(executeModelPoseNode(ctx)).rejects.toThrow('GRAPH_MODEL_POSE_NO_MODEL')
  })

  it('throws when instruction is empty', async () => {
    const ctx = {
      node: poseNode({}),
      inputs: { 'in-model': [incomingModel] },
      inspectModelSkeleton: async () => [{ name: 'Hips', parent: null }]
    } as unknown as NodeExecuteContext
    await expect(executeModelPoseNode(ctx)).rejects.toThrow('GRAPH_PROCESS_NO_INPUT')
  })

  it('applies a preset pose locally without Blender or a text model', async () => {
    const patched: Record<string, unknown>[] = []
    const ctx = {
      node: poseNode({
        generateInstruction:
          '自然站立休息：重心略偏右腿，左膝微松；双臂自然垂于体侧，肩放松；脊柱直立，头略微前看，整体放松不僵硬。'
      }),
      inputs: { 'in-model': [incomingModel] },
      locale: 'zh-CN',
      inspectModelSkeleton: async () => [
        { name: 'mixamorig:Hips', parent: null },
        { name: 'mixamorig:Spine', parent: 'mixamorig:Hips' },
        { name: 'mixamorig:LeftArm', parent: 'mixamorig:Spine' }
      ],
      patchNode: (patch: { params?: Record<string, unknown> }) => {
        if (patch.params) patched.push(patch.params)
      }
    } as unknown as NodeExecuteContext

    const out = await executeModelPoseNode(ctx)
    const value = out.out
    expect(value.kind).toBe('asset')
    if (value.kind !== 'asset') return
    expect(value.assetId).toBe('model-1')
    expect(value.relativePath).toBe('Cache/Models/hero.glb')
    expect(value.bonePose?.['mixamorig:Spine']).toBeTruthy()
    expect(value.bonePose?.['mixamorig:LeftArm']).toBeTruthy()
    expect(ctx.node.params.posePresetId).toBe('idle')
    expect(patched[0]?.posePresetId).toBe('idle')
  })
})

describe('computePresetPoseReadback', () => {
  it('maps role rotations onto the supplied bone names', () => {
    const readback = computePresetPoseReadback({
      presetId: 'idle',
      boneRoles: {
        Hips: 'hips',
        Spine: 'spine',
        LeftArm: 'l_upperarm'
      }
    })
    const pose = bonePoseFromReadback(readback)
    expect(pose.Spine?.x).toBeCloseTo((3 * Math.PI) / 180, 5)
    expect(pose.LeftArm?.x).toBeCloseTo((-6 * Math.PI) / 180, 5)
  })
})
