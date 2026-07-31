import { describe, expect, it, vi } from 'vitest'
import { executeUpscaleNode } from '../src/shared/graph/execute/values'
import type { GraphNode, NodeExecuteContext } from '../src/shared/graph'
import { portsCompatible, GraphPortType } from '../src/shared/graph'

function baseNode(overrides?: Partial<GraphNode>): GraphNode {
  return {
    id: 'upscale-1',
    typeId: 'image.upscale',
    category: 'note',
    title: 'HD upscale',
    x: 0,
    y: 0,
    params: {
      imageUpscale: { engineId: 'imageApi', variantId: 'general', scale: 2 }
    },
    ...overrides
  }
}

describe('executeUpscaleNode input', () => {
  it('resolves image asset refs as input', async () => {
    const generateImage = vi.fn(async () => ({
      images: ['data:image/png;base64,aaa'],
      model: 'test'
    }))
    const ctx: NodeExecuteContext = {
      node: baseNode(),
      inputs: {
        in: [
          {
            kind: 'asset',
            assetId: 'img-1',
            assetType: 'image',
            label: 'Photo'
          }
        ]
      },
      document: { nodes: [], edges: [] },
      generateImage,
      resolveAssetImageUrl: async (assetId) =>
        assetId === 'img-1' ? 'data:image/png;base64,src' : undefined
    }
    const out = await executeUpscaleNode(ctx)
    expect(generateImage).toHaveBeenCalled()
    expect(generateImage.mock.calls[0]?.[0]?.inputReferences).toEqual([
      'data:image/png;base64,src'
    ])
    expect(out.out?.kind).toBe('image')
    expect(out['out-all']?.kind).toBe('images')
  })

  it('accepts upstream images values', async () => {
    const generateImage = vi.fn(async () => ({
      images: ['data:image/png;base64,out'],
      model: 'test'
    }))
    const ctx: NodeExecuteContext = {
      node: baseNode(),
      inputs: {
        in: [
          {
            kind: 'images',
            items: [{ id: 'a', dataUrl: 'data:image/png;base64,src', createdAt: '' }]
          }
        ]
      },
      document: { nodes: [], edges: [] },
      generateImage
    }
    await executeUpscaleNode(ctx)
    expect(generateImage.mock.calls[0]?.[0]?.inputReferences).toEqual([
      'data:image/png;base64,src'
    ])
  })
})

describe('portsCompatible image family', () => {
  it('allows singular into matching plural, rejects cross family', () => {
    expect(portsCompatible(GraphPortType.image, GraphPortType.image)).toBe(true)
    expect(portsCompatible(GraphPortType.image, GraphPortType.images)).toBe(true)
    expect(portsCompatible(GraphPortType.video, GraphPortType.videos)).toBe(true)
    expect(portsCompatible(GraphPortType.images, GraphPortType.image)).toBe(false)
    expect(portsCompatible(GraphPortType.image, GraphPortType.video)).toBe(false)
    expect(portsCompatible(GraphPortType.image, GraphPortType.text)).toBe(false)
  })
})
