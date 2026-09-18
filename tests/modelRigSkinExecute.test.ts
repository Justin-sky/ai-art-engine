import { describe, expect, it, vi } from 'vitest'
import {
  executeModelRigSkinNode,
  type GraphNode,
  type NodeExecuteContext
} from '../src/shared/graph'

function rigSkinNode(params: Record<string, unknown> = {}): GraphNode {
  return {
    id: 'rigskin-1',
    typeId: 'model.rigSkin',
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

describe('executeModelRigSkinNode', () => {
  it('throws GRAPH_MODEL_RIG_NO_MODEL / GRAPH_PROCESS_NO_INPUT / GRAPH_MODEL_RIG_DSH', async () => {
    await expect(
      executeModelRigSkinNode({
        node: rigSkinNode({ generateInstruction: 'humanoid' }),
        inputs: {}
      } as unknown as NodeExecuteContext)
    ).rejects.toThrow('GRAPH_MODEL_RIG_NO_MODEL')

    await expect(
      executeModelRigSkinNode({
        node: rigSkinNode({}),
        inputs: { 'in-model': [incomingModel] }
      } as unknown as NodeExecuteContext)
    ).rejects.toThrow('GRAPH_PROCESS_NO_INPUT')

    await expect(
      executeModelRigSkinNode({
        node: rigSkinNode({ generateInstruction: 'humanoid' }),
        inputs: { 'in-model': [incomingModel] }
      } as unknown as NodeExecuteContext)
    ).rejects.toThrow('GRAPH_MODEL_RIG_DSH')
  })

  it('writes the skinned GLB path and rigMeta overlay from the dsh job', async () => {
    const runBlenderDshJob = vi.fn(async () => ({
      relativePath: 'Cache/Models/rig-1.glb',
      result: {
        ok: true,
        kind: 'rig' as const,
        rigMeta: {
          armature: 'Armature',
          bones: ['Hips', 'Spine', 'Head'],
          vertexGroups: ['Hips', 'Spine']
        }
      }
    }))
    const ctx = {
      node: rigSkinNode({ generateInstruction: 'humanoid simple' }),
      inputs: { 'in-model': [incomingModel] },
      runBlenderDshJob
    } as unknown as NodeExecuteContext

    const out = await executeModelRigSkinNode(ctx)
    expect(runBlenderDshJob).toHaveBeenCalledTimes(1)
    expect(runBlenderDshJob.mock.calls[0]![0].kind).toBe('rig')
    expect(runBlenderDshJob.mock.calls[0]![0].skillId).toBe('blender.rigSkin')

    const value = out.out
    expect(value.kind).toBe('asset')
    if (value.kind !== 'asset') return
    expect(value.relativePath).toBe('Cache/Models/rig-1.glb')
    expect(value.rigMeta?.bones).toEqual(['Hips', 'Spine', 'Head'])
    expect(ctx.node.params.rigModelRelativePath).toBe('Cache/Models/rig-1.glb')
  })
})
