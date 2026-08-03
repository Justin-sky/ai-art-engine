import { getNodeSize, getNodesBounds, type GraphNode, type GraphViewport } from '@shared/graph'
import { viewportBoxToWorldRect, type GraphRect } from './geometry'

export interface MinimapWorldBounds {
  x: number
  y: number
  w: number
  h: number
}

export interface MinimapNodeRect {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export interface MinimapTransform {
  scale: number
  offsetX: number
  offsetY: number
  canvasW: number
  canvasH: number
}

const EMPTY_WORLD: MinimapWorldBounds = { x: 0, y: 0, w: 1600, h: 1200 }

/** 节点世界包围盒；空图回退固定范围 */
export function resolveMinimapWorldBounds(
  nodes: GraphNode[],
  padding = 120
): MinimapWorldBounds {
  const bounds = getNodesBounds(nodes, padding)
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) return { ...EMPTY_WORLD }
  // 保证最小可视范围，避免单节点时视口框盖满小地图
  return {
    x: bounds.x,
    y: bounds.y,
    w: Math.max(bounds.w, 400),
    h: Math.max(bounds.h, 300)
  }
}

export function collectMinimapNodeRects(nodes: GraphNode[]): MinimapNodeRect[] {
  return nodes.map((node) => {
    const { w, h } = getNodeSize(node)
    return {
      id: node.id,
      x: node.position.x,
      y: node.position.y,
      w,
      h
    }
  })
}

/**
 * 世界矩形等比落入画布。
 * 贴齐左下：多余空白只出现在上/右侧，左、下不留空。
 */
export function computeMinimapTransform(
  world: MinimapWorldBounds,
  canvasW: number,
  canvasH: number,
  inset = 0
): MinimapTransform {
  const innerW = Math.max(1, canvasW - inset)
  const innerH = Math.max(1, canvasH - inset)
  const scale = Math.min(innerW / world.w, innerH / world.h)
  const contentH = world.h * scale
  return {
    scale,
    offsetX: -world.x * scale,
    offsetY: canvasH - contentH - world.y * scale,
    canvasW,
    canvasH
  }
}

export function worldToMinimap(
  worldX: number,
  worldY: number,
  t: MinimapTransform
): { x: number; y: number } {
  return {
    x: worldX * t.scale + t.offsetX,
    y: worldY * t.scale + t.offsetY
  }
}

export function minimapToWorld(
  mapX: number,
  mapY: number,
  t: MinimapTransform
): { x: number; y: number } {
  const scale = t.scale || 1
  return {
    x: (mapX - t.offsetX) / scale,
    y: (mapY - t.offsetY) / scale
  }
}

/** 当前视口在世界坐标中的矩形 */
export function viewportWorldRect(
  viewport: GraphViewport,
  hostWidth: number,
  hostHeight: number
): GraphRect {
  return viewportBoxToWorldRect(
    { x: 0, y: 0, w: Math.max(1, hostWidth), h: Math.max(1, hostHeight) },
    viewport
  )
}

export function graphRectToMinimap(
  rect: GraphRect,
  t: MinimapTransform
): { x: number; y: number; w: number; h: number } {
  const a = worldToMinimap(rect.left, rect.top, t)
  const b = worldToMinimap(rect.right, rect.bottom, t)
  return {
    x: a.x,
    y: a.y,
    w: Math.max(2, b.x - a.x),
    h: Math.max(2, b.y - a.y)
  }
}
