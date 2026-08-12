import { describe, expect, it } from 'vitest'
import {
  canConnectNodes,
  canConnectToNodeType,
  createNodeFromType,
  expandIncomingThroughBundles,
  getNodePorts,
  getNodeType,
  GraphPortType,
  isBundleAcceptableDataType,
  lockBundleDataType,
  syncBundleDataTypeAfterEdgeChange,
  type GraphDocument
} from '../src/shared/graph'

function doc(nodes: GraphDocument['nodes'], edges: GraphDocument['edges']): GraphDocument {
  return { nodes, edges, groups: [], viewport: { x: 0, y: 0, zoom: 1 } }
}

describe('media.bundle expand / lock', () => {
  it('exposes singular in/out ports and locks bundleDataType', () => {
    const bundle = createNodeFromType('media.bundle', { x: 0, y: 0 })
    expect(getNodePorts(bundle).map((p) => [p.id, p.dataType, p.multiple])).toEqual([
      ['in', GraphPortType.image, true],
      ['out', GraphPortType.image, true]
    ])
    lockBundleDataType(bundle, GraphPortType.videos)
    expect(bundle.params.bundleDataType).toBe(GraphPortType.video)
    expect(getNodePorts(bundle).map((p) => p.dataType)).toEqual([
      GraphPortType.video,
      GraphPortType.video
    ])
  })

  it('accepts gallery out into unlocked bundle (unlike image.select)', () => {
    const image = createNodeFromType('asset.image', { x: 0, y: 0 })
    const bundle = createNodeFromType('media.bundle', { x: 120, y: 0 })
    const select = createNodeFromType('image.select', { x: 240, y: 0 })
    expect(canConnectNodes(image, bundle, { sourcePort: 'out' })).toBe(true)
    expect(canConnectNodes(image, select, { sourcePort: 'out' })).toBe(false)
    const def = getNodeType('media.bundle')!
    expect(canConnectToNodeType(image, def, { sourcePort: 'out' })).toBe(true)
    expect(isBundleAcceptableDataType(GraphPortType.text)).toBe(true)
  })

  it('expands nested bundles in order and guards cycles', () => {
    const a = createNodeFromType('asset.image', { x: 0, y: 0 }, { id: 'a' })
    const b = createNodeFromType('asset.image', { x: 0, y: 40 }, { id: 'b' })
    const c = createNodeFromType('asset.image', { x: 0, y: 80 }, { id: 'c' })
    const inner = createNodeFromType('media.bundle', { x: 120, y: 20 }, { id: 'inner' })
    const outer = createNodeFromType('media.bundle', { x: 240, y: 40 }, { id: 'outer' })
    const gen = createNodeFromType('asset.image', { x: 360, y: 40 }, { id: 'gen' })
    lockBundleDataType(inner, GraphPortType.image)
    lockBundleDataType(outer, GraphPortType.image)
    const graph = doc(
      [a, b, c, inner, outer, gen],
      [
        { id: 'e1', source: 'a', target: 'inner', sourcePort: 'out', targetPort: 'in' },
        { id: 'e2', source: 'b', target: 'inner', sourcePort: 'out', targetPort: 'in' },
        { id: 'e3', source: 'inner', target: 'outer', sourcePort: 'out', targetPort: 'in' },
        { id: 'e4', source: 'c', target: 'outer', sourcePort: 'out', targetPort: 'in' },
        { id: 'e5', source: 'outer', target: 'gen', sourcePort: 'out', targetPort: 'in-image' }
      ]
    )
    expect(expandIncomingThroughBundles(graph, 'gen').map((e) => e.sourceNodeId)).toEqual([
      'a',
      'b',
      'c'
    ])
    expect(expandIncomingThroughBundles(graph, 'gen').map((e) => e.ownerNodeId)).toEqual([
      'inner',
      'inner',
      'outer'
    ])

    // cycle: outer ← inner ← outer
    graph.edges.push({
      id: 'cycle',
      source: 'outer',
      target: 'inner',
      sourcePort: 'out',
      targetPort: 'in'
    })
    expect(() => expandIncomingThroughBundles(graph, 'gen')).not.toThrow()
  })

  it('unlocks when all incoming edges are removed', () => {
    const a = createNodeFromType('asset.image', { x: 0, y: 0 }, { id: 'a' })
    const bundle = createNodeFromType('media.bundle', { x: 120, y: 0 }, { id: 'bundle' })
    lockBundleDataType(bundle, GraphPortType.image)
    const graph = doc(
      [a, bundle],
      [{ id: 'e1', source: 'a', target: 'bundle', sourcePort: 'out', targetPort: 'in' }]
    )
    graph.edges = []
    syncBundleDataTypeAfterEdgeChange(graph, 'bundle')
    expect(bundle.params.bundleDataType).toBeUndefined()
  })
})
