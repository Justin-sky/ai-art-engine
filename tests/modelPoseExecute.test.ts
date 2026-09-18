import { describe, expect, it, vi } from 'vitest'
import { executeModelPoseNode, type GraphNode, type NodeExecuteContext } from '../src/shared/graph'

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
      node: poseNode({ generateInstruction: 'idle' }),
      inputs: {}
    } as unknown as NodeExecuteContext
    await expect(executeModelPoseNode(ctx)).rejects.toThrow('GRAPH_MODEL_POSE_NO_MODEL')
  })

  it('throws when instruction is empty', async () => {
    const ctx = {
      node: poseNode({}),
      inputs: { 'in-model': [incomingModel] }
    } as unknown as NodeExecuteContext
    await expect(executeModelPoseNode(ctx)).rejects.toThrow('GRAPH_PROCESS_NO_INPUT')
  })

  it('throws GRAPH_MODEL_POSE_DSH when the blender job runner is missing', async () => {
    const ctx = {
      node: poseNode({ generateInstruction: 'idle stand' }),
      inputs: { 'in-model': [incomingModel] }
    } as unknown as NodeExecuteContext
    await expect(executeModelPoseNode(ctx)).rejects.toThrow('GRAPH_MODEL_POSE_DSH')
  })

  it('writes the new GLB path and bonePose overlay from the dsh job', async () => {
    const runBlenderDshJob = vi.fn(async () => ({
      relativePath: 'Cache/Models/pose-1.glb',
      result: {
        ok: true,
        kind: 'pose' as const,
        bonePose: { Spine: { x: 0.1, y: 0, z: 0 } }
      }
    }))
    const patched: Record<string, unknown>[] = []
    const ctx = {
      node: poseNode({ generateInstruction: 'idle stand' }),
      inputs: { 'in-model': [incomingModel] },
      runBlenderDshJob,
      patchNode: (patch: { params?: Record<string, unknown> }) => {
        if (patch.params) patched.push(patch.params)
      }
    } as unknown as NodeExecuteContext

    const out = await executeModelPoseNode(ctx)
    expect(runBlenderDshJob).toHaveBeenCalledTimes(1)
    const call = runBlenderDshJob.mock.calls[0]![0]
    expect(call.kind).toBe('pose')
    expect(call.skillId).toBe('blender.pose')
    expect(call.sourceRelativePath).toBe('Cache/Models/hero.glb')

    const value = out.out
    expect(value.kind).toBe('asset')
    if (value.kind !== 'asset') return
    expect(value.assetId).toBe('model-1')
    expect(value.relativePath).toBe('Cache/Models/pose-1.glb')
    expect(value.bonePose?.Spine).toEqual({ x: 0.1, y: 0, z: 0 })
    expect(ctx.node.params.poseModelRelativePath).toBe('Cache/Models/pose-1.glb')
    expect(patched[0]?.bonePose).toEqual(value.bonePose)
  })
})
