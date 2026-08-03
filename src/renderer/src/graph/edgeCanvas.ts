import { getNodePortCenter, type GraphEdge, type GraphNode, type GraphViewport } from '@shared/graph'

/** 画布连线路径样式（视图偏好，不写入 GraphEdge） */
export type GraphEdgePathStyle = 'curve' | 'orthogonal' | 'hidden'

export const GRAPH_EDGE_PATH_STYLES: GraphEdgePathStyle[] = ['curve', 'orthogonal', 'hidden']

export function nextGraphEdgePathStyle(current: GraphEdgePathStyle): GraphEdgePathStyle {
  const idx = GRAPH_EDGE_PATH_STYLES.indexOf(current)
  return GRAPH_EDGE_PATH_STYLES[(idx + 1) % GRAPH_EDGE_PATH_STYLES.length] ?? 'curve'
}

export function parseGraphEdgePathStyle(raw: string | null | undefined): GraphEdgePathStyle {
  if (raw === 'orthogonal' || raw === 'hidden' || raw === 'curve') return raw
  if (raw === 'straight') return 'orthogonal'
  return 'curve'
}

/**
 * 一条边在“屏幕坐标系”下的路径几何。
 * 屏幕坐标 = 世界坐标 * zoom + viewport 偏移，与 .graph-world 的 transform 完全一致，
 * 因此 Canvas 覆盖层与节点 DOM 在平移/缩放时保持像素级对齐。
 */
export interface EdgeScreenGeometry {
  id: string
  source: string
  target: string
  pathStyle: Exclude<GraphEdgePathStyle, 'hidden'>
  /** 折线顶点（含起止）；curve 时仍填起止便于包围盒 */
  points: Array<{ x: number; y: number }>
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
  /** 隐藏时不画已有边；临时拖线仍可画 */
  pathStyle?: GraphEdgePathStyle
}

export interface TempEdgeScreen {
  pathStyle: Exclude<GraphEdgePathStyle, 'hidden'>
  points: Array<{ x: number; y: number }>
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

/** 世界坐标下的直角折线顶点（含起止），右出左入 */
export function computeOrthogonalWorldPoints(
  start: { x: number; y: number },
  end: { x: number; y: number }
): Array<{ x: number; y: number }> {
  const stub = Math.max(40, Math.min(80, Math.abs(end.x - start.x) * 0.25))
  const outX = start.x + stub
  const inX = end.x - stub
  if (outX <= inX) {
    const midX = (start.x + end.x) / 2
    if (Math.abs(start.y - end.y) < 0.5) {
      return [start, end]
    }
    return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end]
  }
  // 目标在左侧或过近：先外伸，再垂直绕行，再回入
  const midY = (start.y + end.y) / 2
  return [
    start,
    { x: outX, y: start.y },
    { x: outX, y: midY },
    { x: inX, y: midY },
    { x: inX, y: end.y },
    end
  ]
}

function curveControlPoints(
  start: { x: number; y: number },
  end: { x: number; y: number }
): { c1: { x: number; y: number }; c2: { x: number; y: number } } {
  const dx = controlOffset(start.x, end.x)
  return {
    c1: { x: start.x + dx, y: start.y },
    c2: { x: end.x - dx, y: end.y }
  }
}

function toScreenPoint(
  p: { x: number; y: number },
  viewport: GraphViewport
): { x: number; y: number } {
  return { x: toScreenX(p.x, viewport), y: toScreenY(p.y, viewport) }
}

function buildEdgeGeometry(
  id: string,
  source: string,
  target: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
  viewport: GraphViewport,
  pathStyle: Exclude<GraphEdgePathStyle, 'hidden'>
): EdgeScreenGeometry {
  const screenStart = toScreenPoint(start, viewport)
  const screenEnd = toScreenPoint(end, viewport)
  if (pathStyle === 'orthogonal') {
    const worldPts = computeOrthogonalWorldPoints(start, end)
    const points = worldPts.map((p) => toScreenPoint(p, viewport))
    return {
      id,
      source,
      target,
      pathStyle,
      points,
      sx: screenStart.x,
      sy: screenStart.y,
      c1x: points[1]?.x ?? screenStart.x,
      c1y: points[1]?.y ?? screenStart.y,
      c2x: points[points.length - 2]?.x ?? screenEnd.x,
      c2y: points[points.length - 2]?.y ?? screenEnd.y,
      ex: screenEnd.x,
      ey: screenEnd.y
    }
  }
  const { c1, c2 } = curveControlPoints(start, end)
  const c1s = toScreenPoint(c1, viewport)
  const c2s = toScreenPoint(c2, viewport)
  return {
    id,
    source,
    target,
    pathStyle: 'curve',
    points: [screenStart, screenEnd],
    sx: screenStart.x,
    sy: screenStart.y,
    c1x: c1s.x,
    c1y: c1s.y,
    c2x: c2s.x,
    c2y: c2s.y,
    ex: screenEnd.x,
    ey: screenEnd.y
  }
}

export function computeEdgeScreenGeometry(
  edge: GraphEdge,
  sourceNode: GraphNode,
  targetNode: GraphNode,
  viewport: GraphViewport,
  pathStyle: GraphEdgePathStyle = 'curve'
): EdgeScreenGeometry {
  const start = getNodePortCenter(sourceNode, 'right', edge.sourcePort)
  const end = getNodePortCenter(targetNode, 'left', edge.targetPort)
  const style = pathStyle === 'hidden' ? 'curve' : pathStyle
  return buildEdgeGeometry(edge.id, edge.source, edge.target, start, end, viewport, style)
}

export function computeTempEdgeScreen(
  from: { x: number; y: number },
  to: { x: number; y: number },
  viewport: GraphViewport,
  pathStyle: GraphEdgePathStyle = 'curve'
): TempEdgeScreen {
  const style = pathStyle === 'hidden' ? 'curve' : pathStyle
  const g = buildEdgeGeometry('temp', 'temp', 'temp', from, to, viewport, style)
  return {
    pathStyle: g.pathStyle,
    points: g.points,
    sx: g.sx,
    sy: g.sy,
    c1x: g.c1x,
    c1y: g.c1y,
    c2x: g.c2x,
    c2y: g.c2y,
    ex: g.ex,
    ey: g.ey
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

function edgeBoundsPoints(g: EdgeScreenGeometry): Array<{ x: number; y: number }> {
  if (g.pathStyle === 'orthogonal' && g.points.length >= 2) return g.points
  return [
    { x: g.sx, y: g.sy },
    { x: g.c1x, y: g.c1y },
    { x: g.c2x, y: g.c2y },
    { x: g.ex, y: g.ey }
  ]
}

/** 点是否落在边控制点包围盒（外扩 tolerance）之外——用于命中前快速剔除 */
function outsideEdgeBounds(
  g: EdgeScreenGeometry,
  px: number,
  py: number,
  tolerance: number
): boolean {
  const pts = edgeBoundsPoints(g)
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return (
    px < minX - tolerance ||
    px > maxX + tolerance ||
    py < minY - tolerance ||
    py > maxY + tolerance
  )
}

function distanceToEdgePath(g: EdgeScreenGeometry, px: number, py: number, samples: number): number {
  if (g.pathStyle === 'orthogonal' && g.points.length >= 2) {
    let best = Infinity
    for (let i = 1; i < g.points.length; i += 1) {
      const a = g.points[i - 1]!
      const b = g.points[i]!
      best = Math.min(best, distanceToSegment(px, py, a.x, a.y, b.x, b.y))
    }
    return best
  }
  let best = Infinity
  let prev = bezierPointAt(g, 0)
  for (let i = 1; i <= samples; i += 1) {
    const cur = bezierPointAt(g, i / samples)
    best = Math.min(best, distanceToSegment(px, py, prev.x, prev.y, cur.x, cur.y))
    prev = cur
  }
  return best
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
    const dist = distanceToEdgePath(g, px, py, samples)
    if (dist <= bestDist) {
      bestDist = dist
      bestId = g.id
    }
  }
  return bestId
}

/** 命中边后判断更靠近哪一端（用于拖线改接） */
export function nearerEdgeEndpoint(
  geom: EdgeScreenGeometry,
  px: number,
  py: number
): 'source' | 'target' {
  const ds = Math.hypot(px - geom.sx, py - geom.sy)
  const dt = Math.hypot(px - geom.ex, py - geom.ey)
  return ds <= dt ? 'source' : 'target'
}

function traceEdge(ctx: CanvasRenderingContext2D, g: EdgeScreenGeometry | TempEdgeScreen): void {
  ctx.beginPath()
  if (g.pathStyle === 'orthogonal' && g.points.length >= 2) {
    ctx.moveTo(g.points[0]!.x, g.points[0]!.y)
    for (let i = 1; i < g.points.length; i += 1) {
      ctx.lineTo(g.points[i]!.x, g.points[i]!.y)
    }
    return
  }
  ctx.moveTo(g.sx, g.sy)
  ctx.bezierCurveTo(g.c1x, g.c1y, g.c2x, g.c2y, g.ex, g.ey)
}

export function drawGraphEdges(
  ctx: CanvasRenderingContext2D,
  geoms: EdgeScreenGeometry[],
  tempEdge: TempEdgeScreen | TempEdgeScreen[] | null,
  opts: DrawEdgesOptions
): void {
  const { dpr, width, height, offsetX, offsetY, zoom, selectedEdgeIds, flowEdgeIds, colors, reduceEffects } =
    opts
  const pathStyle = opts.pathStyle ?? 'curve'
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  // 之后所有绘制坐标 = 视口屏幕坐标 + offset，落入含 overscan 的 Canvas
  ctx.setTransform(dpr, 0, 0, dpr, offsetX * dpr, offsetY * dpr)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const visibleGeoms = pathStyle === 'hidden' ? [] : geoms

  // 1) 普通边（含选中态）：一次遍历，选中边最后补画以叠在上层
  ctx.setLineDash([])
  for (const g of visibleGeoms) {
    if (selectedEdgeIds.has(g.id)) continue
    traceEdge(ctx, g)
    ctx.lineWidth = 2 * zoom
    ctx.globalAlpha = 0.85
    ctx.strokeStyle = colors.edge
    ctx.stroke()
  }

  ctx.globalAlpha = 1
  for (const g of visibleGeoms) {
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
  if (!reduceEffects && flowEdgeIds.size > 0 && pathStyle !== 'hidden') {
    const period = 500
    const dashTravel = 160 * zoom
    const offset = -((opts.flowTimeMs % period) / period) * dashTravel
    for (const g of visibleGeoms) {
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

  // 3) 临时连线（拖拽建边 / 批量改接）——隐藏样式下仍显示，便于对准端口
  const tempList = !tempEdge ? [] : Array.isArray(tempEdge) ? tempEdge : [tempEdge]
  if (tempList.length > 0) {
    ctx.lineWidth = 2 * zoom
    ctx.setLineDash([6 * zoom, 4 * zoom])
    ctx.strokeStyle = colors.temp
    for (const te of tempList) {
      traceEdge(ctx, te)
      ctx.stroke()
    }
    ctx.setLineDash([])
  }
}
