import type { GraphDocument, GraphNode } from './types'
import { isCanonicalGraphOutputNodeId } from './types'
import { isBoundaryOutputNode } from './hostInterface'

/**
 * 是否可作为执行终端：classic output.* / 规范输出 id / boundary.output。
 * HDA 统一后内图只剩 boundary 出口，UI 与执行层必须共用这一判定。
 */
export function isGraphOutputTerminalNode(
  node: Pick<GraphNode, 'id' | 'typeId' | 'category'>
): boolean {
  return (
    node.category === 'output' ||
    isCanonicalGraphOutputNodeId(node.id) ||
    isBoundaryOutputNode(node)
  )
}

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
