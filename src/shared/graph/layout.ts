import { getNodeSize } from './create'
import { getNodesBounds } from './groups'
import type { GraphEdge, GraphNode } from './types'

export type AlignMode = 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY'
export type DistributeMode = 'horizontal' | 'vertical'

export const GRAPH_LAYOUT_GRID_STEP = 40

export function snapToGrid(value: number, step = GRAPH_LAYOUT_GRID_STEP): number {
  return Math.round(value / step) * step
}

export function snapPositionToGrid(
  position: { x: number; y: number },
  step = GRAPH_LAYOUT_GRID_STEP
): { x: number; y: number } {
  return {
    x: snapToGrid(position.x, step),
    y: snapToGrid(position.y, step)
  }
}

/** 对齐选中节点（至少 2 个） */
export function alignNodes(nodes: GraphNode[], mode: AlignMode): void {
  if (nodes.length < 2) return
  const items = nodes.map((node) => {
    const size = getNodeSize(node)
    return { node, w: size.w, h: size.h, x: node.position.x, y: node.position.y }
  })
  const left = Math.min(...items.map((item) => item.x))
  const right = Math.max(...items.map((item) => item.x + item.w))
  const top = Math.min(...items.map((item) => item.y))
  const bottom = Math.max(...items.map((item) => item.y + item.h))
  const midX = (left + right) / 2
  const midY = (top + bottom) / 2

  for (const item of items) {
    if (mode === 'left') item.node.position.x = left
    else if (mode === 'right') item.node.position.x = right - item.w
    else if (mode === 'top') item.node.position.y = top
    else if (mode === 'bottom') item.node.position.y = bottom - item.h
    else if (mode === 'centerX') item.node.position.x = midX - item.w / 2
    else if (mode === 'centerY') item.node.position.y = midY - item.h / 2
  }
}

/** 等距分布（至少 3 个）；按包围盒间隙均分 */
export function distributeNodes(nodes: GraphNode[], mode: DistributeMode): void {
  if (nodes.length < 3) return

  if (mode === 'horizontal') {
    const sorted = [...nodes].sort((a, b) => a.position.x - b.position.x)
    const first = sorted[0]!
    const last = sorted[sorted.length - 1]!
    const firstW = getNodeSize(first).w
    const lastW = getNodeSize(last).w
    const start = first.position.x
    const end = last.position.x + lastW
    const middleWidth = sorted
      .slice(1, -1)
      .reduce((sum, node) => sum + getNodeSize(node).w, 0)
    const free = end - start - firstW - middleWidth - lastW
    const gap = free / (sorted.length - 1)
    let x = start + firstW + gap
    for (let i = 1; i < sorted.length - 1; i++) {
      const node = sorted[i]!
      node.position.x = x
      x += getNodeSize(node).w + gap
    }
    return
  }

  const sorted = [...nodes].sort((a, b) => a.position.y - b.position.y)
  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!
  const firstH = getNodeSize(first).h
  const lastH = getNodeSize(last).h
  const start = first.position.y
  const end = last.position.y + lastH
  const middleHeight = sorted
    .slice(1, -1)
    .reduce((sum, node) => sum + getNodeSize(node).h, 0)
  const free = end - start - firstH - middleHeight - lastH
  const gap = free / (sorted.length - 1)
  let y = start + firstH + gap
  for (let i = 1; i < sorted.length - 1; i++) {
    const node = sorted[i]!
    node.position.y = y
    y += getNodeSize(node).h + gap
  }
}

/**
 * 按连线拓扑做左→右分层自动布局。
 * 仅调整给定 nodes；edges 用于确定层关系。
 */
export function autoLayoutNodes(
  nodes: GraphNode[],
  edges: Pick<GraphEdge, 'sourceNodeId' | 'targetNodeId'>[],
  options?: { columnGap?: number; rowGap?: number }
): void {
  if (nodes.length === 0) return
  if (nodes.length === 1) return

  const ids = new Set(nodes.map((node) => node.id))
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const outgoing = new Map<string, string[]>()
  const indegree = new Map<string, number>()
  for (const id of ids) {
    outgoing.set(id, [])
    indegree.set(id, 0)
  }

  for (const edge of edges) {
    if (!ids.has(edge.sourceNodeId) || !ids.has(edge.targetNodeId)) continue
    if (edge.sourceNodeId === edge.targetNodeId) continue
    outgoing.get(edge.sourceNodeId)!.push(edge.targetNodeId)
    indegree.set(edge.targetNodeId, (indegree.get(edge.targetNodeId) ?? 0) + 1)
  }

  const layer = new Map<string, number>()
  const queue = [...ids].filter((id) => (indegree.get(id) ?? 0) === 0)
  for (const id of queue) layer.set(id, 0)

  const remaining = new Map(indegree)
  const walk = [...queue]
  while (walk.length) {
    const id = walk.shift()!
    const current = layer.get(id) ?? 0
    for (const next of outgoing.get(id) ?? []) {
      layer.set(next, Math.max(layer.get(next) ?? 0, current + 1))
      const nextDegree = (remaining.get(next) ?? 1) - 1
      remaining.set(next, nextDegree)
      if (nextDegree === 0) walk.push(next)
    }
  }

  let maxLayer = 0
  for (const id of ids) {
    if (!layer.has(id)) layer.set(id, 0)
    maxLayer = Math.max(maxLayer, layer.get(id)!)
  }

  const columns: string[][] = Array.from({ length: maxLayer + 1 }, () => [])
  for (const id of ids) {
    columns[layer.get(id)!]!.push(id)
  }
  for (const column of columns) {
    column.sort((a, b) => (byId.get(a)?.position.y ?? 0) - (byId.get(b)?.position.y ?? 0))
  }

  const columnGap = options?.columnGap ?? 72
  const rowGap = options?.rowGap ?? 36
  const origin = getNodesBounds(nodes, 0) ?? { x: 0, y: 0, w: 0, h: 0 }
  let x = origin.x

  for (const column of columns) {
    let maxWidth = 0
    let y = origin.y
    for (const id of column) {
      const node = byId.get(id)
      if (!node) continue
      const size = getNodeSize(node)
      node.position.x = x
      node.position.y = y
      y += size.h + rowGap
      maxWidth = Math.max(maxWidth, size.w)
    }
    x += maxWidth + columnGap
  }
}
