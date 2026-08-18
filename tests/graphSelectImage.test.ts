import { describe, expect, it } from 'vitest'
import {
  canConnectNodes,
  createNodeFromType,
  executeSelectImageNode,
  getNodePorts,
  GraphPortType,
  pickImageItem,
  type GraphImageItem,
  type NodeExecuteContext
} from '../src/shared/graph'

describe('image.select node', () => {
  it('has images in and image out ports', () => {
    const node = createNodeFromType('image.select', { x: 0, y: 0 })
    const ports = getNodePorts(node)
    expect(ports.map((p) => [p.direction, p.dataType])).toEqual([
      ['in', GraphPortType.images],
      ['out', GraphPortType.image]
    ])
  })

  it('connects from motion out-shots / generate out-all, not singular out', () => {
    const motion = createNodeFromType('asset.motion', { x: 0, y: 0 })
    const select = createNodeFromType('image.select', { x: 120, y: 0 })
    const imageGenerate = createNodeFromType('asset.image', { x: 240, y: 0 })
    expect(canConnectNodes(motion, select, { sourcePort: 'out-shots' })).toBe(true)
    expect(canConnectNodes(motion, select, { sourcePort: 'out' })).toBe(false)
    expect(canConnectNodes(imageGenerate, select, { sourcePort: 'out-all' })).toBe(true)
    expect(canConnectNodes(imageGenerate, select, { sourcePort: 'out' })).toBe(false)
    expect(canConnectNodes(select, imageGenerate)).toBe(true)
  })

  it('rejects a singular image boundary into images in', () => {
    const boundary = createNodeFromType('graph.boundary.input', { x: 0, y: 0 }, {
      params: {
        hostBoundaryPort: { portId: 'bound-img-x', dataType: GraphPortType.image, multiple: false }
      }
    })
    const select = createNodeFromType('image.select', { x: 120, y: 0 })
    expect(canConnectNodes(boundary, select)).toBe(false)
  })

  it('defaults to the first image and can pick by id', () => {
    const items: GraphImageItem[] = [
      { id: 'a', dataUrl: 'data:image/png;base64,aaa' },
      { id: 'b', dataUrl: 'data:image/png;base64,bbb' }
    ]
    expect(pickImageItem(items)?.id).toBe('a')
    expect(pickImageItem(items, 'b')?.id).toBe('b')
  })

  it('execute outputs the selected single image', () => {
    const node = createNodeFromType('image.select', { x: 0, y: 0 }, {
      params: { selectedImageId: 'b' }
    })
    const patched: Record<string, unknown>[] = []
    const ctx: NodeExecuteContext = {
      node,
      inputs: {
        in: [
          {
            kind: 'images',
            items: [
              { id: 'a', dataUrl: 'data:image/png;base64,aaa' },
              { id: 'b', dataUrl: 'data:image/png;base64,bbb' }
            ]
          }
        ]
      },
      patchNode: (patch) => {
        patched.push(patch.params ?? {})
      }
    }
    const result = executeSelectImageNode(ctx)
    expect(result.out).toEqual({
      kind: 'image',
      id: 'b',
      dataUrl: 'data:image/png;base64,bbb',
      createdAt: undefined
    })
    expect(patched[0]).toMatchObject({
      selectedImageId: 'b',
      previewDataUrl: 'data:image/png;base64,bbb'
    })
  })
})
