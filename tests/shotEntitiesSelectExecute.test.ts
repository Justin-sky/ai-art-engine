import { describe, expect, it } from 'vitest'
import {
  canConnectNodes,
  createNodeFromType,
  executeSelectShotEntitiesNode,
  getNodePorts,
  GraphPortType,
  stringifyShotEntities,
  type NodeExecuteContext
} from '../src/shared/graph'
import { ensureBuiltinNodeTypes } from '../src/shared/graph/builtinState'

ensureBuiltinNodeTypes()

describe('shotEntities.select node', () => {
  it('has shotEntities in and image out', () => {
    const node = createNodeFromType('shotEntities.select', { x: 0, y: 0 })
    const ports = getNodePorts(node)
    expect(ports.map((p) => [p.direction, p.dataType])).toEqual([
      ['in', GraphPortType.shotEntities],
      ['out', GraphPortType.image]
    ])
    expect(ports[0]?.multiple).toBe(false)
  })

  it('connects from shotEntities boundary', () => {
    const boundary = createNodeFromType('graph.boundary.input', { x: 0, y: 0 }, {
      params: {
        hostBoundaryPort: {
          portId: 'bound-shot-ent-x',
          dataType: GraphPortType.shotEntities,
          multiple: false
        },
        text: stringifyShotEntities([
          { id: 's1', name: '镜1', imageUrls: ['Cache/a.png'] }
        ])
      }
    })
    const select = createNodeFromType('shotEntities.select', { x: 120, y: 0 })
    expect(canConnectNodes(boundary, select)).toBe(true)
  })

  it('execute picks entity and outputs first image path', () => {
    const node = createNodeFromType('shotEntities.select', { x: 0, y: 0 }, {
      params: { selectedShotEntityId: 's2' }
    })
    const patched: Record<string, unknown>[] = []
    const ctx: NodeExecuteContext = {
      node,
      inputs: {
        in: [
          {
            kind: 'shotEntities',
            text: stringifyShotEntities([
              { id: 's1', name: '镜1', imageUrls: ['Cache/a.png'] }
            ])
          },
          {
            kind: 'shotEntities',
            text: stringifyShotEntities([
              { id: 's2', name: '镜2', imageUrls: ['Cache/b.png', 'Cache/b2.png'] }
            ])
          }
        ]
      },
      patchNode: (patch) => {
        patched.push(patch.params ?? {})
      }
    }
    const result = executeSelectShotEntitiesNode(ctx)
    expect(result.out).toMatchObject({
      kind: 'image',
      id: 's2',
      relativePath: 'Cache/b.png'
    })
    expect(patched[0]).toMatchObject({
      selectedShotEntityId: 's2',
      previewRelativePath: 'Cache/b.png'
    })
  })
})
