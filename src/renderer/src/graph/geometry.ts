import {
  getNodeDefaultSize,
  getNodePortCenter,
  getNodeSize,
  type GraphEdge,
  type GraphNode,
  type GraphNodeTypeId,
  type GraphViewport
} from '@shared/graph'

export const GRAPH_WORLD_SIZE = { w: 12000, h: 9000 } as const

export interface GraphRect {
  left: number
  top: number
  right: number
  bottom: number
}

export function rectsIntersect(a: GraphRect, b: GraphRect): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top
}

export function viewportBoxToWorldRect(
  box: { x: number; y: number; w: number; h: number },
  viewport: GraphViewport
): GraphRect {
  return {
    left: (box.x - viewport.x) / viewport.zoom,
    top: (box.y - viewport.y) / viewport.zoom,
    right: (box.x + box.w - viewport.x) / viewport.zoom,
    bottom: (box.y + box.h - viewport.y) / viewport.zoom
  }
}

export function getNodeWorldBounds(node: GraphNode): GraphRect {
  const { w, h } = getNodeSize(node)
  return {
    left: node.position.x,
    top: node.position.y,
    right: node.position.x + w,
    bottom: node.position.y + h
  }
}

export function getEdgeWorldBounds(
  edge: GraphEdge,
  nodes: GraphNode[],
  padding = 8
): GraphRect | null {
  const source = nodes.find((node) => node.id === edge.source)
  const target = nodes.find((node) => node.id === edge.target)
  if (!source || !target) return null
  const start = getNodePortCenter(source, 'right', edge.sourcePort)
  const end = getNodePortCenter(target, 'left', edge.targetPort)
  const dx = Math.max(60, Math.abs(end.x - start.x) * 0.5)
  const xs = [start.x, start.x + dx, end.x - dx, end.x]
  const ys = [start.y, start.y, end.y, end.y]
  return {
    left: Math.min(...xs) - padding,
    top: Math.min(...ys) - padding,
    right: Math.max(...xs) + padding,
    bottom: Math.max(...ys) + padding
  }
}

export function collectMarqueeHits(
  graph: { nodes: GraphNode[]; edges: GraphEdge[] },
  worldRect: GraphRect
): { nodeIds: string[]; edgeIds: string[] } {
  const nodeIds = graph.nodes
    .filter((node) => rectsIntersect(getNodeWorldBounds(node), worldRect))
    .map((node) => node.id)
  const edgeIds = graph.edges
    .filter((edge) => {
      const bounds = getEdgeWorldBounds(edge, graph.nodes)
      return bounds ? rectsIntersect(bounds, worldRect) : false
    })
    .map((edge) => edge.id)
  return { nodeIds, edgeIds }
}

export function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(60, Math.abs(x2 - x1) * 0.5)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

export function graphEdgePath(edge: GraphEdge, nodes: GraphNode[]): string {
  const source = nodes.find((node) => node.id === edge.source)
  const target = nodes.find((node) => node.id === edge.target)
  if (!source || !target) return ''
  const start = getNodePortCenter(source, 'right', edge.sourcePort)
  const end = getNodePortCenter(target, 'left', edge.targetPort)
  return bezierPath(start.x, start.y, end.x, end.y)
}

export function graphCenterPosition(
  typeId: GraphNodeTypeId | GraphNode['category'],
  worldX: number,
  worldY: number
): { x: number; y: number } {
  const { w, h } = getNodeDefaultSize(typeId)
  return { x: worldX - w / 2, y: worldY - h / 2 }
}

export function clientToGraphWorld(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  viewport: GraphViewport
): { x: number; y: number } {
  return {
    x: (clientX - rect.left - viewport.x) / viewport.zoom,
    y: (clientY - rect.top - viewport.y) / viewport.zoom
  }
}
