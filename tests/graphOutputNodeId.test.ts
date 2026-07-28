import { describe, expect, it } from 'vitest'
import {
  createOutputGraphNode,
  graphOutputNodeId,
  normalizeScopedGraph,
  syncCanonicalOutputNodeIds
} from '../src/shared/graph'

describe('graph output node ids', () => {
  it('uses kind-specific canonical ids', () => {
    expect(graphOutputNodeId('image')).toBe('image-output')
    expect(graphOutputNodeId('video')).toBe('video-output')
    expect(graphOutputNodeId('voice')).toBe('voice-output')
    expect(createOutputGraphNode('image', { x: 0, y: 0 }).id).toBe('image-output')
  })

  it('does not migrate non-canonical shot-output id on normalize', () => {
    const doc = normalizeScopedGraph(
      'workflow',
      {
        nodes: [
          {
            id: 'shot-output',
            category: 'output',
            typeId: 'output.image',
            position: { x: 0, y: 0 },
            params: { outputKind: 'image' }
          }
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        runStates: {
          'shot-output': { status: 'done' }
        }
      },
      { assetType: 'image' }
    )
    // 非规范 id 不改写；workflow 仍可能 ensure 规范输出
    expect(doc.nodes.some((n) => n.id === 'shot-output')).toBe(true)
    expect(doc.runStates?.['shot-output']?.status).toBe('done')
  })

  it('syncCanonicalOutputNodeIds remaps mismatched canonical ids', () => {
    const nodes = [
      {
        id: 'n1',
        category: 'asset' as const,
        typeId: 'asset.image',
        position: { x: 0, y: 0 },
        params: {}
      },
      {
        id: 'video-output',
        category: 'output' as const,
        typeId: 'output.image',
        position: { x: 100, y: 0 },
        params: { outputKind: 'image' as const }
      }
    ]
    const edges = [
      {
        id: 'e1',
        source: 'n1',
        target: 'video-output',
        sourcePort: 'out',
        targetPort: 'in'
      }
    ]
    syncCanonicalOutputNodeIds(nodes, edges)
    expect(nodes[1]?.id).toBe('image-output')
    expect(edges[0]?.target).toBe('image-output')
  })
})
