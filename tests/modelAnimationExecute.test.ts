import { describe, expect, it, vi } from 'vitest'
import {
  executeModelAnimationNode,
  type GraphNode,
  type NodeExecuteContext
} from '../src/shared/graph'

function animNode(params: Record<string, unknown> = {}): GraphNode {
  return {
    id: 'anim-1',
    typeId: 'model.animation',
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

describe('executeModelAnimationNode', () => {
  it('throws GRAPH_MODEL_ANIM_NO_MODEL / GRAPH_PROCESS_NO_INPUT / GRAPH_MODEL_ANIM_DSH', async () => {
    await expect(
      executeModelAnimationNode({
        node: animNode({ generateInstruction: 'walk' }),
        inputs: {}
      } as unknown as NodeExecuteContext)
    ).rejects.toThrow('GRAPH_MODEL_ANIM_NO_MODEL')

    await expect(
      executeModelAnimationNode({
        node: animNode({}),
        inputs: { 'in-model': [incomingModel] }
      } as unknown as NodeExecuteContext)
    ).rejects.toThrow('GRAPH_PROCESS_NO_INPUT')

    await expect(
      executeModelAnimationNode({
        node: animNode({ generateInstruction: 'walk' }),
        inputs: { 'in-model': [incomingModel] }
      } as unknown as NodeExecuteContext)
    ).rejects.toThrow('GRAPH_MODEL_ANIM_DSH')
  })

  it('writes the animated GLB path and clip overlay from the dsh job', async () => {
    const runBlenderDshJob = vi.fn(async () => ({
      relativePath: 'Cache/Models/anim-1.glb',
      result: {
        ok: true,
        kind: 'anim' as const,
        clip: {
          name: 'Walk',
          fps: 24,
          frameRange: [1, 24] as [number, number],
          keyframes: { Hips: { 1: [0, 0.1, 0] as [number, number, number] } }
        }
      }
    }))
    const ctx = {
      node: animNode({ generateInstruction: 'walk cycle' }),
      inputs: { 'in-model': [incomingModel] },
      runBlenderDshJob
    } as unknown as NodeExecuteContext

    const out = await executeModelAnimationNode(ctx)
    expect(runBlenderDshJob).toHaveBeenCalledTimes(1)
    expect(runBlenderDshJob.mock.calls[0]![0].kind).toBe('anim')
    expect(runBlenderDshJob.mock.calls[0]![0].skillId).toBe('blender.animation')

    const value = out.out
    expect(value.kind).toBe('asset')
    if (value.kind !== 'asset') return
    expect(value.relativePath).toBe('Cache/Models/anim-1.glb')
    expect(value.clip?.name).toBe('Walk')
    expect(ctx.node.params.animationModelRelativePath).toBe('Cache/Models/anim-1.glb')
  })
})
