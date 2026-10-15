import { describe, expect, it } from 'vitest'
import {
  boundaryInputNodeId,
  boundaryOutputNodeId,
  createDefaultScopedGraph,
  defaultHostInterfaceForAssetType
} from '../src/shared/graph'

function hasEdge(
  graph: {
    edges: Array<{ source: string; target: string; sourcePort?: string; targetPort?: string }>
  },
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
})
