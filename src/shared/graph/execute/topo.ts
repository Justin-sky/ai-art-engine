import type { GraphDocument, GraphEdge } from '../types'

/** 收集汇入 target 的全部上游节点（含 target） */
export function collectUpstreamNodeIds(graph: GraphDocument, targetId: string): Set<string> {
  const incoming = new Map<string, string[]>()
  for (const edge of graph.edges) {
    const list = incoming.get(edge.target) ?? []
    list.push(edge.source)
    incoming.set(edge.target, list)
  }

  const visited = new Set<string>()
  const stack = [targetId]
  while (stack.length) {
    const id = stack.pop()!
    if (visited.has(id)) continue
    visited.add(id)
    for (const src of incoming.get(id) ?? []) stack.push(src)
  }
  return visited
}

/**
 * Kahn 拓扑排序。若有环返回 null。
 * 仅对 `subset` 内节点排序；边只考虑两端都在 subset 中的。
 */
export function topologicalSort(
  nodeIds: Iterable<string>,
  edges: GraphEdge[]
): string[] | null {
  const waves = topologicalWaves(nodeIds, edges)
  return waves ? waves.flat() : null
}

/**
 * Kahn 分层：同一层内节点互不依赖，可并行执行。若有环返回 null。
 */
export function topologicalWaves(
  nodeIds: Iterable<string>,
  edges: GraphEdge[]
): string[][] | null {
  const ids = new Set(nodeIds)
  const indegree = new Map<string, number>()
  const outgoing = new Map<string, string[]>()

  for (const id of ids) {
    indegree.set(id, 0)
    outgoing.set(id, [])
  }

  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
    outgoing.get(edge.source)!.push(edge.target)
  }

  const waves: string[][] = []
  let ready = [...ids].filter((id) => (indegree.get(id) ?? 0) === 0).sort()
  let placed = 0

  while (ready.length) {
    waves.push(ready)
    placed += ready.length
    const nextReady: string[] = []
    for (const id of ready) {
      for (const next of outgoing.get(id) ?? []) {
        const d = (indegree.get(next) ?? 0) - 1
        indegree.set(next, d)
        if (d === 0) nextReady.push(next)
      }
    }
    ready = nextReady.sort()
  }

  return placed === ids.size ? waves : null
}
