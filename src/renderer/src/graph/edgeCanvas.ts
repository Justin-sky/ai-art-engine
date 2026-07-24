import { getNodePortCenter, type GraphEdge, type GraphNode, type GraphViewport } from '@shared/graph'

/**
 * 一条边在“屏幕坐标系”下的三次贝塞尔控制点。
 * 屏幕坐标 = 世界坐标 * zoom + viewport 偏移，与 .graph-world 的 transform 完全一致，
 * 因此 Canvas 覆盖层与节点 DOM 在平移/缩放时保持像素级对齐。
 */
export interface EdgeScreenGeometry {
  id: string
  source: string
  target: string
  sx: number
  sy: number
  c1x: number
  c1y: number
  c2x: number
  c2y: number
  ex: number
  ey: number
}

export interface EdgeColors {
  edge: string
  selected: string
  temp: string
}

export interface DrawEdgesOptions {
  /** 设备像素比：Canvas 位图按 dpr 放大，绘制坐标仍用 CSS px */
  dpr: number
  /** Canvas 的 CSS 像素宽高（含 overscan） */
  width: number
  height: number
  /**
   * 绘制原点偏移（CSS px）：Canvas 比视口大一圈并向外定位，
   * 传入的边坐标是相对视口原点的，绘制时整体平移 offset 使其落在 Canvas 内正确位置。
   */
  offsetX: number
  offsetY: number
  zoom: number
  selectedEdgeIds: Set<string>
  /** source 命中该集合的边绘制“流动”高亮 */
  flowEdgeIds: Set<string>
  /** 流动动画相位（毫秒时间戳，用于计算 lineDashOffset） */
  flowTimeMs: number
  /** 手势期：跳过流动/发光等高成本效果 */
  reduceEffects: boolean
  colors: EdgeColors
}

export interface TempEdgeScreen {
  sx: number
  sy: number
  c1x: number
  c1y: number
  c2x: number
  c2y: number
  ex: number
  ey: number
}

function toScreenX(worldX: number, viewport: GraphViewport): number {
  return worldX * viewport.zoom + viewport.x
}

function toScreenY(worldY: number, viewport: GraphViewport): number {
  return worldY * viewport.zoom + viewport.y
}

/** 与 geometry.bezierPath 一致的控制点算法：水平方向按端点距离外扩 */
function controlOffset(startX: number, endX: number): number {
  return Math.max(60, Math.abs(endX - startX) * 0.5)
}

export function computeEdgeScreenGeometry(
  edge: GraphEdge,
  sourceNode: GraphNode,
  targetNode: GraphNode,
  viewport: GraphViewport
): EdgeScreenGeometry {
  const start = getNodePortCenter(sourceNode, 'right', edge.sourcePort)
  const end = getNodePortCenter(targetNode, 'left', edge.targetPort)
  const dx = controlOffset(start.x, end.x)
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sx: toScreenX(start.x, viewport),
    sy: toScreenY(start.y, viewport),
    c1x: toScreenX(start.x + dx, viewport),
    c1y: toScreenY(start.y, viewport),
    c2x: toScreenX(end.x - dx, viewport),
    c2y: toScreenY(end.y, viewport),
    ex: toScreenX(end.x, viewport),
    ey: toScreenY(end.y, viewport)
  }
}

export function computeTempEdgeScreen(
  from: { x: number; y: number },
  to: { x: number; y: number },
  viewport: GraphViewport
): TempEdgeScreen {
  const dx = controlOffset(from.x, to.x)
  return {
    sx: toScreenX(from.x, viewport),
    sy: toScreenY(from.y, viewport),
    c1x: toScreenX(from.x + dx, viewport),
    c1y: toScreenY(from.y, viewport),
    c2x: toScreenX(to.x - dx, viewport),
    c2y: toScreenY(to.y, viewport),
    ex: toScreenX(to.x, viewport),
    ey: toScreenY(to.y, viewport)
  }
}

/** 采样贝塞尔上某点，用于命中测试 */
export function bezierPointAt(g: EdgeScreenGeometry, t: number): { x: number; y: number } {
  const mt = 1 - t
  const a = mt * mt * mt
  const b = 3 * mt * mt * t
  const c = 3 * mt * t * t
  const d = t * t * t
  return {
    x: a * g.sx + b * g.c1x + c * g.c2x + d * g.ex,
    y: a * g.sy + b * g.c1y + c * g.c2y + d * g.ey
  }
}

function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** 点是否落在边控制点包围盒（外扩 tolerance）之外——用于命中前快速剔除 */
function outsideEdgeBounds(
  g: EdgeScreenGeometry,
  px: number,
  py: number,
  tolerance: number
): boolean {
  const minX = Math.min(g.sx, g.c1x, g.c2x, g.ex) - tolerance
  const maxX = Math.max(g.sx, g.c1x, g.c2x, g.ex) + tolerance
  const minY = Math.min(g.sy, g.c1y, g.c2y, g.ey) - tolerance
  const maxY = Math.max(g.sy, g.c1y, g.c2y, g.ey) + tolerance
  return px < minX || px > maxX || py < minY || py > maxY
}

/**
 * 屏幕坐标命中测试：返回距离点击点最近且在容差内的边 id。
 * 先用控制点包围盒快速剔除，再对候选边做定段贝塞尔采样，
 * 使开销与「靠近指针的边数」相关，而非全部可见边。
 */
export function hitTestEdges(
  geoms: EdgeScreenGeometry[],
  px: number,
  py: number,
  tolerance: number,
  samples = 18
): string | null {
  let bestId: string | null = null
  let bestDist = tolerance
  for (const g of geoms) {
    if (outsideEdgeBounds(g, px, py, tolerance)) continue
    let prev = bezierPointAt(g, 0)
    for (let i = 1; i <= samples; i += 1) {
      const cur = bezierPointAt(g, i / samples)
      const dist = distanceToSegment(px, py, prev.x, prev.y, cur.x, cur.y)
      if (dist <= bestDist) {
        bestDist = dist
        bestId = g.id
      }
      prev = cur
    }
  }
  return bestId
}

function traceEdge(ctx: CanvasRenderingContext2D, g: EdgeScreenGeometry | TempEdgeScreen): void {
  ctx.beginPath()
  ctx.moveTo(g.sx, g.sy)
  ctx.bezierCurveTo(g.c1x, g.c1y, g.c2x, g.c2y, g.ex, g.ey)
}

export function drawGraphEdges(
  ctx: CanvasRenderingContext2D,
  geoms: EdgeScreenGeometry[],
  tempEdge: TempEdgeScreen | null,
  opts: DrawEdgesOptions
): void {
  const { dpr, width, height, offsetX, offsetY, zoom, selectedEdgeIds, flowEdgeIds, colors, reduceEffects } =
    opts
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  // 之后所有绘制坐标 = 视口屏幕坐标 + offset，落入含 overscan 的 Canvas
  ctx.setTransform(dpr, 0, 0, dpr, offsetX * dpr, offsetY * dpr)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // 1) 普通边（含选中态）：一次遍历，选中边最后补画以叠在上层
  ctx.setLineDash([])
  for (const g of geoms) {
    if (selectedEdgeIds.has(g.id)) continue
    traceEdge(ctx, g)
    ctx.lineWidth = 2 * zoom
    ctx.globalAlpha = 0.85
    ctx.strokeStyle = colors.edge
    ctx.stroke()
  }

  ctx.globalAlpha = 1
  for (const g of geoms) {
    if (!selectedEdgeIds.has(g.id)) continue
    traceEdge(ctx, g)
    ctx.lineWidth = 3 * zoom
    ctx.strokeStyle = colors.selected
    if (!reduceEffects) {
      ctx.shadowColor = 'rgba(61, 139, 253, 0.65)'
      ctx.shadowBlur = 3 * dpr
    }
    ctx.stroke()
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
  }

  // 2) 流动高亮：沿边方向的渐变（起点透明→终点纯白）配合滚动虚线，
  //    形成“越靠近目标越亮”的彗星拖尾，与原 SVG userSpaceOnUse 渐变一致
  if (!reduceEffects && flowEdgeIds.size > 0) {
    const period = 500
    const dashTravel = 160 * zoom
    const offset = -((opts.flowTimeMs % period) / period) * dashTravel
    for (const g of geoms) {
      if (!flowEdgeIds.has(g.source)) continue
      const grad = ctx.createLinearGradient(g.sx, g.sy, g.ex, g.ey)
      grad.addColorStop(0, 'rgba(94, 200, 255, 0)')
      grad.addColorStop(0.18, 'rgba(94, 200, 255, 0.06)')
      grad.addColorStop(0.42, 'rgba(110, 216, 255, 0.22)')
      grad.addColorStop(0.68, 'rgba(158, 232, 255, 0.55)')
      grad.addColorStop(0.88, 'rgba(200, 246, 255, 0.88)')
      grad.addColorStop(1, 'rgba(255, 255, 255, 1)')

      ctx.setLineDash([36 * zoom, 100 * zoom])
      ctx.lineDashOffset = offset

      // 宽发光层：低透明 + 软阴影模拟原 feGaussianBlur
      traceEdge(ctx, g)
      ctx.lineWidth = 6 * zoom
      ctx.globalAlpha = 0.35
      ctx.strokeStyle = grad
      ctx.shadowColor = 'rgba(120, 220, 255, 0.45)'
      ctx.shadowBlur = 3.5 * dpr
      ctx.stroke()

      // 亮核层
      traceEdge(ctx, g)
      ctx.lineWidth = 2 * zoom
      ctx.globalAlpha = 1
      ctx.strokeStyle = grad
      ctx.shadowColor = 'rgba(120, 220, 255, 0.55)'
      ctx.shadowBlur = 2 * dpr
      ctx.stroke()

      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
    }
    ctx.setLineDash([])
    ctx.globalAlpha = 1
    ctx.lineDashOffset = 0
  }

  // 3) 临时连线（拖拽建边）
  if (tempEdge) {
    traceEdge(ctx, tempEdge)
    ctx.lineWidth = 2 * zoom
    ctx.setLineDash([6 * zoom, 4 * zoom])
    ctx.strokeStyle = colors.temp
    ctx.stroke()
    ctx.setLineDash([])
  }
}
