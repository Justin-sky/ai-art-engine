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
export const DEFAULT_MINIMAP_INSET = 8

/** 节点世界包围盒；空图回退固定范围 */
export function resolveMinimapWorldBounds(nodes: GraphNode[], padding = 80): MinimapWorldBounds {
  const bounds = getNodesBounds(nodes, padding)
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) return { ...EMPTY_WORLD }
  // 保证最小可视范围，避免单节点时视口框盖满小地图；扩展时保持中心对称
  const w = Math.max(bounds.w, 400)
  const h = Math.max(bounds.h, 300)
  return {
    x: bounds.x - (w - bounds.w) / 2,
    y: bounds.y - (h - bounds.h) / 2,
    w,
    h
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
 * 世界矩形等比居中落入小地图画布（四周保留均匀像素内边距 inset）。
 * 横向与纵向均自动居中显示，避免窄高布局贴死左边缘或宽扁布局贴死底边。
 */
export function computeMinimapTransform(
  world: MinimapWorldBounds,
  canvasW: number,
  canvasH: number,
  inset = DEFAULT_MINIMAP_INSET
): MinimapTransform {
  const maxSafeInset = Math.max(0, Math.floor(Math.min(canvasW, canvasH) / 2) - 1)
  const safeInset = Math.max(0, Math.min(inset, maxSafeInset))
  const innerW = Math.max(1, canvasW - safeInset * 2)
  const innerH = Math.max(1, canvasH - safeInset * 2)
  const scale = Math.min(innerW / world.w, innerH / world.h)
  const contentW = world.w * scale
  const contentH = world.h * scale
  return {
    scale,
    offsetX: (canvasW - contentW) / 2 - world.x * scale,
    offsetY: (canvasH - contentH) / 2 - world.y * scale,
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
