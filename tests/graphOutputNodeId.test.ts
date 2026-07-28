import { describe, expect, it } from 'vitest'
import {
  createOutputGraphNode,
  findAllOutputNodes,
  graphOutputNodeId,
  isGraphOutputTerminalNode,
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

  it('strips classic output nodes and their run states on normalize', () => {
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
    // HDA 统一后内图改用 boundary proxy，classic output.* 一律清理
    expect(doc.nodes.some((n) => n.category === 'output')).toBe(false)
    expect(doc.runStates?.['shot-output']).toBeUndefined()
  })

  it('syncCanonicalOutputNodeIds leaves non-canonical ids untouched', () => {
    const nodes = [
      {
        id: 'shot-output',
        category: 'output' as const,
        typeId: 'output.image',
        position: { x: 0, y: 0 },
        params: { outputKind: 'image' as const }
      }
    ]
    const edges = [
      { id: 'e1', source: 'gen', target: 'shot-output', sourcePort: 'out', targetPort: 'in' }
    ]
    syncCanonicalOutputNodeIds(nodes, edges)
    expect(nodes[0]?.id).toBe('shot-output')
    expect(edges[0]?.target).toBe('shot-output')
  })

  it('treats boundary output as an execution terminal, boundary input as not', () => {
    expect(
      isGraphOutputTerminalNode({ id: 'out-text', typeId: 'graph.boundary.output', category: 'note' })
    ).toBe(true)
    expect(
      isGraphOutputTerminalNode({ id: 'in-text', typeId: 'graph.boundary.input', category: 'note' })
    ).toBe(false)
    expect(
      isGraphOutputTerminalNode({ id: 'image-output', typeId: 'output.image', category: 'output' })
    ).toBe(true)
    expect(
      isGraphOutputTerminalNode({ id: 'a1', typeId: 'asset.image', category: 'asset' })
    ).toBe(false)
  })

  it('terminal predicate agrees with findAllOutputNodes on a boundary-only graph', () => {
    const graph = {
      nodes: [
        {
          id: 'in-text',
          category: 'note' as const,
          typeId: 'graph.boundary.input',
          position: { x: 0, y: 0 },
          params: {}
        },
        {
          id: 'gen',
          category: 'asset' as const,
          typeId: 'asset.image',
          position: { x: 100, y: 0 },
          params: {}
        },
        {
          id: 'out-image',
          category: 'note' as const,
          typeId: 'graph.boundary.output',
          position: { x: 200, y: 0 },
          params: {}
        }
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    // 入队按钮的显示条件必须与 runTask 的 target 选择一致
    const terminalIds = graph.nodes.filter(isGraphOutputTerminalNode).map((n) => n.id)
    expect(terminalIds).toEqual(['out-image'])
    expect(findAllOutputNodes(graph).map((n) => n.id)).toEqual(terminalIds)
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
