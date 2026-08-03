import { describe, expect, it } from 'vitest'
import {
  boundaryInputNodeId,
  boundaryOutputNodeId,
  createDefaultScopedGraph,
  defaultHostInterfaceForAssetType
} from '../src/shared/graph'

function hasEdge(
  graph: { edges: Array<{ source: string; target: string; sourcePort?: string; targetPort?: string }> },
  source: string,
  target: string,
  targetPort = 'in'
): boolean {
  return graph.edges.some(
    (edge) =>
      edge.source === source &&
      edge.target === target &&
      (edge.sourcePort ?? 'out') === 'out' &&
      (edge.targetPort ?? 'in') === targetPort
  )
}

describe('createDefaultScopedGraph boundary input wiring', () => {
  it('wires screenplay boundary in → Screenplay processing → boundary out', () => {
    const graph = createDefaultScopedGraph('screenplayAsset', 'screenplay')
    const iface = defaultHostInterfaceForAssetType('screenplay')
    const bin = boundaryInputNodeId(iface.inputs[0]!.id)
    const bout = boundaryOutputNodeId(iface.outputs[0]!.id)
    const gen = graph.nodes.find((n) => n.typeId === 'asset.screenplay')!
    expect(hasEdge(graph, bin, gen.id, 'in')).toBe(true)
    expect(hasEdge(graph, gen.id, bout, 'in')).toBe(true)
  })

  it('wires world boundary in → extract chain head', () => {
    const graph = createDefaultScopedGraph('worldAsset', 'world')
    const iface = defaultHostInterfaceForAssetType('world')
    const bin = boundaryInputNodeId(iface.inputs[0]!.id)
    const extract = graph.nodes.find((n) => n.typeId === 'world.extract')!
    expect(hasEdge(graph, bin, extract.id, 'in')).toBe(true)
  })

  it('wires beat boundary in → split chain head', () => {
    const graph = createDefaultScopedGraph('beatAsset', 'beat')
    const iface = defaultHostInterfaceForAssetType('beat')
    const bin = boundaryInputNodeId(iface.inputs[0]!.id)
    const split = graph.nodes.find((n) => n.typeId === 'beat.split')!
    expect(hasEdge(graph, bin, split.id, 'in')).toBe(true)
  })

  it('wires all script boundary inputs to their chain heads', () => {
    const graph = createDefaultScopedGraph('scriptAsset', 'script')
    const iface = defaultHostInterfaceForAssetType('script')
    const worldIn = boundaryInputNodeId('in-worldEntities')
    const beatIn = boundaryInputNodeId('in-beat')
    const split = graph.nodes.find((n) => n.typeId === 'script.shotSplit')!
    const table = graph.nodes.find((n) => n.typeId === 'script.shotTable')!
    // beat → shotSplit.in；worldEntities → shotTable.in-worldEntities
    expect(hasEdge(graph, beatIn, split.id, 'in')).toBe(true)
    expect(hasEdge(graph, worldIn, table.id, 'in-worldEntities')).toBe(true)
    expect(iface.inputs.map((p) => p.id).sort()).toEqual(
      ['in-beat', 'in-worldEntities'].sort()
    )
  })
})
