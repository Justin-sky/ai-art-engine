import type { GraphDocument, GraphNode } from './types'
import { isCanonicalGraphOutputNodeId } from './types'

export function findOutputNode(graph: GraphDocument): GraphNode | undefined {
  return (
    graph.nodes.find((n) => n.category === 'output') ??
    graph.nodes.find((n) => isCanonicalGraphOutputNodeId(n.id))
  )
}
