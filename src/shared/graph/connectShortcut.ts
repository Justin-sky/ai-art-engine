/**
 * 单通路连线：两节点之间只保留一条通路。
 * - A→…→D 再连 A→D：断开旧通路在 D 上的入边
 * - 已有 A→D 再经另一线路连到 D：断开短路 A→D
 * - 无关来源的并行入边保留
 */
import type { GraphEdge } from './types'

export interface ConnectEdgeSpec {
  sourceId: string
  targetId: string
  sourcePort: string
  targetPort: string
  /** 新边 id；省略则由调用方自行 push */
  edgeId?: string
}

function buildAdj(edges: GraphEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>()
  for (const e of edges) {
    const list = adj.get(e.source)
    if (list) list.push(e.target)
    else adj.set(e.source, [e.target])
  }
  return adj
}

function buildRevAdj(edges: GraphEdge[]): Map<string, string[]> {
  const rev = new Map<string, string[]>()
  for (const e of edges) {
    const list = rev.get(e.target)
    if (list) list.push(e.source)
    else rev.set(e.target, [e.source])
  }
  return rev
}

/** 有向图：source 是否已能到达 target */
export function nodeCanReach(
  edges: GraphEdge[],
  sourceId: string,
  targetId: string
): boolean {
  if (sourceId === targetId) return true
  const adj = buildAdj(edges)
  const seen = new Set<string>([sourceId])
  const stack = [sourceId]
  while (stack.length) {
    const cur = stack.pop()!
    const nexts = adj.get(cur)
    if (!nexts) continue
    for (const n of nexts) {
      if (n === targetId) return true
      if (seen.has(n)) continue
      seen.add(n)
      stack.push(n)
    }
  }
  return false
}

/** 能到达 nodeId 的所有祖先（不含自身） */
export function nodesReaching(
  edges: GraphEdge[],
  nodeId: string
): Set<string> {
  const rev = buildRevAdj(edges)
  const seen = new Set<string>()
  const stack = [nodeId]
  while (stack.length) {
    const cur = stack.pop()!
    const prevs = rev.get(cur)
    if (!prevs) continue
    for (const p of prevs) {
      if (seen.has(p)) continue
      seen.add(p)
      stack.push(p)
    }
  }
  return seen
}

/** 两节点是否共享上游，或彼此可达（同属一条馈入族） */
export function nodesShareUpstream(
  edges: GraphEdge[],
  a: string,
  b: string
): boolean {
  if (a === b) return true
  if (nodeCanReach(edges, a, b) || nodeCanReach(edges, b, a)) return true
  const ancA = nodesReaching(edges, a)
  const ancB = nodesReaching(edges, b)
  for (const n of ancA) {
    if (ancB.has(n)) return true
  }
  return false
}

/**
 * 施加连线并保证：新边所在馈入族到目标口只保留一条通路。
 */
export function connectEdgesWithShortcutPrune(
  edges: GraphEdge[],
  spec: ConnectEdgeSpec
): GraphEdge[] {
  const sourcePort = spec.sourcePort || 'out'
  const targetPort = spec.targetPort || 'in'
  const newId = spec.edgeId ?? `edge-tmp-${spec.sourceId}-${spec.targetId}`

  // 去重同四元组后加入新边
  let next = edges.filter((e) => {
    const eTargetPort = e.targetPort ?? 'in'
    const eSourcePort = e.sourcePort ?? 'out'
    return !(
      e.source === spec.sourceId &&
      e.target === spec.targetId &&
      eSourcePort === sourcePort &&
      eTargetPort === targetPort
    )
  })

  const newEdge: GraphEdge = {
    id: newId,
    source: spec.sourceId,
    target: spec.targetId,
    sourcePort,
    targetPort
  }
  next = [...next, newEdge]

  // 目标口上：与新边同源馈入族的其它入边一律去掉（只留新通路）
  next = next.filter((e) => {
    if (e.id === newId) return true
    const eTargetPort = e.targetPort ?? 'in'
    if (e.target !== spec.targetId || eTargetPort !== targetPort) return true
    // 用「含新边」的图判断共享上游，使 A→D 与 C→D 在 A→B→C→D 形成后被识别为同族
    return !nodesShareUpstream(next, spec.sourceId, e.source)
  })

  // 再清掉其它已成冗余的直连（源仍可经别的路径到达目标）
  next = next.filter((e) => {
    if (e.id === newId) return true
    const rest = next.filter((x) => x.id !== e.id)
    return !nodeCanReach(rest, e.source, e.target)
  })

  // 若调用方未提供 edgeId，不留下临时 id 边（仅返回剪枝后的旧边 + 由调用方自行 push）
  if (!spec.edgeId) {
    return next.filter((e) => e.id !== newId)
  }
  return next
}
