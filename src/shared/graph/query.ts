import type { GraphDocument, GraphNode } from './types'
import { isCanonicalGraphOutputNodeId } from './types'

export function findOutputNode(graph: GraphDocument): GraphNode | undefined {
  return (
    graph.nodes.find((n) => n.category === 'output') ??
    graph.nodes.find((n) => isCanonicalGraphOutputNodeId(n.id))
  )
}

/** 全部输出节点（多 unit 链各有一个 output.*） */
export function findAllOutputNodes(graph: GraphDocument): GraphNode[] {
  const listed = graph.nodes.filter(
    (n) => n.category === 'output' || isCanonicalGraphOutputNodeId(n.id)
  )
  if (listed.length) return listed
  const single = findOutputNode(graph)
  return single ? [single] : []
}
