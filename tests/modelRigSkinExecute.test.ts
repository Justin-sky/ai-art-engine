import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
  it('throws GRAPH_MODEL_RIG_NO_MODEL / GRAPH_MODEL_RIG_DSH', async () => {
    await expect(
      executeModelRigSkinNode({
        node: rigSkinNode({ generateRigType: 'humanoid' }),
        inputs: {}
      } as unknown as NodeExecuteContext)
    ).rejects.toThrow('GRAPH_MODEL_RIG_NO_MODEL')

    await expect(
      executeModelRigSkinNode({
        node: rigSkinNode({ generateRigType: 'humanoid' }),
        inputs: { 'in-model': [incomingModel] }
      } as unknown as NodeExecuteContext)
    ).rejects.toThrow('GRAPH_MODEL_RIG_DSH')
  })

  it('NodeGraphEditor wires window.studio.rigModel3d into the run session', () => {
    const src = readFileSync(resolve('src/renderer/src/components/NodeGraphEditor.vue'), 'utf8')
    expect(src).toMatch(/rigModel3d:\s*async\s*\(input\)\s*=>\s*\{/)
    expect(src).toMatch(/window\.studio\.rigModel3d\(input\)/)
  })

  it('calls rigModel3d and writes the skinned GLB path', async () => {
    const rigModel3d = vi.fn(async () => ({
      assetId: 'model-1',
      relativePath: 'Cache/Models/rig-1.glb',
      model: 'meshy'
    }))
    const ctx = {
      node: rigSkinNode({
        generateRigType: 'quadruped',
        generateProviderInstanceId: 'meshy-1',
        generateModel: 'meshy-3d'
      }),
      inputs: { 'in-model': [incomingModel] },
      rigModel3d
    } as unknown as NodeExecuteContext

    const out = await executeModelRigSkinNode(ctx)
    expect(rigModel3d).toHaveBeenCalledTimes(1)
    expect(rigModel3d.mock.calls[0]![0]).toMatchObject({
      modelRelativePath: 'Cache/Models/hero.glb',
      providerInstanceId: 'meshy-1',
      model: 'meshy-3d',
      rigType: 'quadruped'
    })

    const value = out.out
    expect(value.kind).toBe('asset')
    if (value.kind !== 'asset') return
    expect(value.relativePath).toBe('Cache/Models/rig-1.glb')
    expect(ctx.node.params.rigModelRelativePath).toBe('Cache/Models/rig-1.glb')
    expect(ctx.node.params.rigQa).toBeUndefined()
    expect(ctx.node.params.skillId).toBeUndefined()
    expect(ctx.node.params.generatedModels?.map((item) => item.relativePath)).toEqual([
      'Cache/Models/rig-1.glb'
    ])
  })

  it('ignores legacy Blender text model and maps old Chinese instruction to humanoid', async () => {
    const rigModel3d = vi.fn(async () => ({
      assetId: 'model-1',
      relativePath: 'Cache/Models/rig-legacy.glb',
      model: 'tripo'
    }))
    const ctx = {
      node: rigSkinNode({
        skillId: 'blender.rigSkin',
        generateModel: 'deepseek-flash',
        generateProviderInstanceId: '53b0e301-19ae-4562-8d14-8366fbabc420',
        generateInstruction:
          '人形简单骨架，共 21 骨：Hips（根）→ Spine → Chest → Neck → Head；按网格包围盒缩放后 parent_set(ARMATURE_AUTO)。',
        rigQa: {
          pass: false,
          attempt: 3,
          fails: [{ code: 'QA_TRANSIENT', message: 'read ECONNRESET' }]
        }
      }),
      inputs: { 'in-model': [incomingModel] },
      rigModel3d
    } as unknown as NodeExecuteContext

    await executeModelRigSkinNode(ctx)
    expect(rigModel3d.mock.calls[0]![0]).toMatchObject({
      modelRelativePath: 'Cache/Models/hero.glb',
      rigType: 'humanoid'
    })
    expect(rigModel3d.mock.calls[0]![0].model).toBeUndefined()
    expect(rigModel3d.mock.calls[0]![0].providerInstanceId).toBeUndefined()
    expect(ctx.node.params.skillId).toBeUndefined()
    expect(ctx.node.params.rigQa).toBeUndefined()
    expect(ctx.node.params.generateRigType).toBe('humanoid')
    expect(ctx.node.params.generateInstruction).toBe('humanoid')
  })

  it('falls back to generateInstruction when generateRigType is empty', async () => {
    const rigModel3d = vi.fn(async () => ({
      assetId: 'model-1',
      relativePath: 'Cache/Models/rig-2.glb',
      model: 'tripo'
    }))
    const ctx = {
      node: rigSkinNode({ generateInstruction: 'creature' }),
      inputs: { 'in-model': [incomingModel] },
      rigModel3d
    } as unknown as NodeExecuteContext

    await executeModelRigSkinNode(ctx)
    expect(rigModel3d.mock.calls[0]![0].rigType).toBe('creature')
    expect(ctx.node.params.generateRigType).toBe('creature')
  })

  it('appends gallery outputs across cooks', async () => {
    let n = 0
    const rigModel3d = vi.fn(async () => {
      n += 1
      return {
        assetId: 'model-1',
        relativePath: `Cache/Models/rig-${n}.glb`,
        model: 'meshy'
      }
    })
    const ctx = {
      node: rigSkinNode({ generateRigType: 'humanoid' }),
      inputs: { 'in-model': [incomingModel] },
      rigModel3d
    } as unknown as NodeExecuteContext

    await executeModelRigSkinNode(ctx)
    await executeModelRigSkinNode(ctx)
    expect(ctx.node.params.generatedModels?.map((item) => item.relativePath)).toEqual([
      'Cache/Models/rig-1.glb',
      'Cache/Models/rig-2.glb'
    ])
    expect(ctx.node.params.rigModelRelativePath).toBe('Cache/Models/rig-2.glb')
  })
})
