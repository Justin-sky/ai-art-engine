import { describe, expect, it } from 'vitest'
import {
  createNodeFromType,
  executeBundleNode,
  GraphPortType,
  type NodeExecuteContext
} from '../src/shared/graph'

describe('media.bundle execute', () => {
  it('aggregates images into plural out and patches preview', () => {
    const node = createNodeFromType('media.bundle', { x: 0, y: 0 }, {
      params: { bundleDataType: GraphPortType.image }
    })
    const patched: Record<string, unknown>[] = []
    const ctx: NodeExecuteContext = {
      node,
      inputs: {
        in: [
          { kind: 'image', id: 'a', dataUrl: 'data:image/png;base64,aaa' },
          { kind: 'image', id: 'b', dataUrl: 'data:image/png;base64,bbb' }
        ]
      },
      patchNode: (patch) => {
        patched.push(patch.params ?? {})
      }
    }
    const result = executeBundleNode(ctx)
    expect(result.out).toEqual({
      kind: 'images',
      items: [
        { id: 'a', dataUrl: 'data:image/png;base64,aaa' },
        { id: 'b', dataUrl: 'data:image/png;base64,bbb' }
      ]
    })
    expect(patched[0]).toMatchObject({
      previewDataUrl: 'data:image/png;base64,aaa',
      previewCollapsed: false
    })
  })

  it('returns empty plural when no inputs', () => {
    const node = createNodeFromType('media.bundle', { x: 0, y: 0 }, {
      params: { bundleDataType: GraphPortType.video }
    })
    const result = executeBundleNode({ node, inputs: { in: [] } })
    expect(result.out).toEqual({ kind: 'videos', items: [] })
  })
})
