import { describe, expect, it } from 'vitest'
import {
  LEGACY_GRAPH_OUTPUT_NODE_ID,
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

  it('migrates legacy shot-output to image-output on normalize', () => {
    const doc = normalizeScopedGraph(
      'workflow',
      {
        nodes: [
          {
            id: LEGACY_GRAPH_OUTPUT_NODE_ID,
            category: 'output',
            typeId: 'output.image',
            position: { x: 0, y: 0 },
            params: { outputKind: 'image' }
          }
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        runStates: {
          [LEGACY_GRAPH_OUTPUT_NODE_ID]: { status: 'done' }
        }
      },
      { assetType: 'image' }
    )
    expect(doc.nodes.some((n) => n.id === 'image-output')).toBe(true)
    expect(doc.nodes.some((n) => n.id === LEGACY_GRAPH_OUTPUT_NODE_ID)).toBe(false)
    expect(doc.runStates?.['image-output']?.status).toBe('done')
    expect(doc.runStates?.[LEGACY_GRAPH_OUTPUT_NODE_ID]).toBeUndefined()
  })

  it('syncCanonicalOutputNodeIds remaps edges', () => {
    const nodes = [
      {
        id: 'n1',
        category: 'asset' as const,
        typeId: 'asset.image',
        position: { x: 0, y: 0 },
        params: {}
      },
      {
        id: LEGACY_GRAPH_OUTPUT_NODE_ID,
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
        target: LEGACY_GRAPH_OUTPUT_NODE_ID,
        sourcePort: 'out',
        targetPort: 'in'
      }
    ]
    syncCanonicalOutputNodeIds(nodes, edges)
    expect(nodes[1]?.id).toBe('image-output')
    expect(edges[0]?.target).toBe('image-output')
  })
})
