import { describe, expect, it, vi } from 'vitest'
import { executeExpandNode } from '../src/shared/graph/execute/values'
import type { GraphNode, NodeExecuteContext } from '../src/shared/graph'

function baseNode(): GraphNode {
  return {
    id: 'expand-1',
    typeId: 'image.expand',
    category: 'note',
    title: 'Image expand',
    x: 0,
    y: 0,
    params: {
      imageExpand: {
        expandLeft: 0,
        expandRight: 0.5,
        expandTop: 0.5,
        expandBottom: 0,
        aspectId: 'original',
        resolution: '2K',
        count: 1
      }
    }
  }
}

describe('executeExpandNode', () => {
  it('uses composed canvas as input reference when available', async () => {
    const generateImage = vi.fn(async () => ({
      images: ['data:image/png;base64,out'],
      model: 'test'
    }))
    const composeImageExpandCanvas = vi.fn(async () => ({
      dataUrl: 'data:image/png;base64,composed',
      aspectRatio: '16:9',
      width: 1920,
      height: 1080
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
      generateImage,
      composeImageExpandCanvas
    }
    await executeExpandNode(ctx)
    expect(composeImageExpandCanvas).toHaveBeenCalled()
    expect(generateImage.mock.calls[0]?.[0]?.inputReferences).toEqual([
      'data:image/png;base64,composed'
    ])
    expect(generateImage.mock.calls[0]?.[0]?.aspectRatio).toBe('16:9')
  })
})
