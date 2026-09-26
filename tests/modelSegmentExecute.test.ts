import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  executeModelSegmentNode,
  type GraphNode,
  type NodeExecuteContext
} from '../src/shared/graph'
import { resolveSegmentMode } from '../src/shared/graph/execute/modelSegment'

function segmentNode(params: Record<string, unknown> = {}): GraphNode {
  return {
    id: 'segment-1',
    typeId: 'model.segment',
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

describe('executeModelSegmentNode', () => {
  it('throws GRAPH_MODEL_SEG_NO_MODEL / GRAPH_MODEL_SEG_API', async () => {
    await expect(
      executeModelSegmentNode({
        node: segmentNode(),
        inputs: {}
      } as unknown as NodeExecuteContext)
    ).rejects.toThrow('GRAPH_MODEL_SEG_NO_MODEL')

    await expect(
      executeModelSegmentNode({
        node: segmentNode(),
        inputs: { 'in-model': [incomingModel] }
      } as unknown as NodeExecuteContext)
    ).rejects.toThrow('GRAPH_MODEL_SEG_API')
  })

  it('NodeGraphEditor wires window.studio.segmentModel3d into the run session', () => {
    const src = readFileSync(resolve('src/renderer/src/components/NodeGraphEditor.vue'), 'utf8')
    expect(src).toMatch(/segmentModel3d:\s*async\s*\(input\)\s*=>\s*\{/)
    expect(src).toMatch(/window\.studio\.segmentModel3d\(input\)/)
  })

  it('calls segmentModel3d and writes parts into the node params', async () => {
    const segmentModel3d = vi.fn(async () => ({
      assetId: 'model-1',
      relativePath: 'Cache/Models/seg-1.glb',
      model: 'tripo',
      mode: 'mesh' as const,
      parts: ['head', 'torso']
    }))
    const node = segmentNode({
      segmentMode: 'mesh',
      segmentGranularity: 'detailed',
      segmentSplitByConnectivity: false,
      generateProviderInstanceId: 'tripo-1',
      generateModel: 'tripo-3d-v1'
    })
    const ctx = {
      node,
      inputs: { 'in-model': [incomingModel] },
      segmentModel3d
    } as unknown as NodeExecuteContext

    await executeModelSegmentNode(ctx)
    expect(segmentModel3d).toHaveBeenCalledTimes(1)
    expect(segmentModel3d.mock.calls[0]![0]).toMatchObject({
      modelRelativePath: 'Cache/Models/hero.glb',
      providerInstanceId: 'tripo-1',
      model: 'tripo-3d-v1',
      mode: 'mesh',
      granularity: 'detailed',
      splitByConnectivity: false
    })
    expect(node.params.segmentParts).toEqual(['head', 'torso'])
    expect(node.params.segmentModelRelativePath).toBe('Cache/Models/seg-1.glb')
  })

  it('sends smart mode with its own granularity and drops unknown values', async () => {
    const segmentModel3d = vi.fn(async () => ({
      assetId: 'model-1',
      relativePath: 'Cache/Models/seg-2.glb',
      model: 'tripo',
      mode: 'smart' as const,
      parts: [],
      maskUrl: 'https://cdn.tripo/mask.png',
      description: 'head, torso'
    }))
    const node = segmentNode({
      segmentMode: 'smart',
      segmentGranularity: 'nonsense',
      segmentSmartGranularity: 'fine',
      segmentHint: 'character with sword'
    })
    const ctx = {
      node,
      inputs: { 'in-model': [incomingModel] },
      segmentModel3d
    } as unknown as NodeExecuteContext

    await executeModelSegmentNode(ctx)
    expect(segmentModel3d.mock.calls[0]![0]).toMatchObject({
      mode: 'smart',
      smartGranularity: 'fine',
      hint: 'character with sword'
    })
    expect(segmentModel3d.mock.calls[0]![0].granularity).toBeUndefined()
    expect(node.params.segmentDescription).toBe('head, torso')
    expect(node.params.segmentMaskUrl).toBe('https://cdn.tripo/mask.png')
  })

  it('drops text-model ids left over from legacy nodes', async () => {
    const segmentModel3d = vi.fn(async () => ({
      assetId: 'model-1',
      relativePath: 'Cache/Models/seg-3.glb',
      model: 'tripo',
      mode: 'mesh' as const,
      parts: []
    }))
    const ctx = {
      node: segmentNode({
        generateModel: 'deepseek-flash',
        generateProviderInstanceId: 'dsh-1'
      }),
      inputs: { 'in-model': [incomingModel] },
      segmentModel3d
    } as unknown as NodeExecuteContext

    await executeModelSegmentNode(ctx)
    expect(segmentModel3d.mock.calls[0]![0].model).toBeUndefined()
    expect(segmentModel3d.mock.calls[0]![0].providerInstanceId).toBeUndefined()
  })

  it('resolves the split mode with mesh as the default', () => {
    expect(resolveSegmentMode({ node: segmentNode() } as unknown as NodeExecuteContext)).toBe(
      'mesh'
    )
    expect(
      resolveSegmentMode({
        node: segmentNode({ segmentMode: 'smart' })
      } as unknown as NodeExecuteContext)
    ).toBe('smart')
  })
})
