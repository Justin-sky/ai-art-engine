import type { GraphDocument, GraphNode } from './types'
import { isCanonicalGraphOutputNodeId } from './types'
import { isBoundaryOutputNode } from './hostInterface'

export function findOutputNode(graph: GraphDocument): GraphNode | undefined {
  return (
    graph.nodes.find((n) => n.category === 'output') ??
    graph.nodes.find((n) => isCanonicalGraphOutputNodeId(n.id)) ??
    graph.nodes.find((n) => isBoundaryOutputNode(n))
  )
}

/** 全部输出节点（多 unit 链各有一个 output.*；宿主内图可回退到 boundary.output） */
export function findAllOutputNodes(graph: GraphDocument): GraphNode[] {
  const listed = graph.nodes.filter(
    (n) => n.category === 'output' || isCanonicalGraphOutputNodeId(n.id)
  )
  const boundaryOuts = graph.nodes.filter((n) => isBoundaryOutputNode(n))
  if (listed.length || boundaryOuts.length) {
    const seen = new Set<string>()
    return [...listed, ...boundaryOuts].filter((node) => {
      if (seen.has(node.id)) return false
      seen.add(node.id)
      return true
    })
  }
  const single = findOutputNode(graph)
  return single ? [single] : []
}
