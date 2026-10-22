import {
  getNodePortCenter,
  type GraphEdge,
  type GraphNode,
  type GraphViewport
} from '@shared/graph'
import type { CanvasVfxBurst, EdgeSpawnEntry } from './vfx/graphVfxEngine'

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
  vfxCyan?: string
  vfxCyanCore?: string
  vfxForgeA?: string
  vfxForgeB?: string
  vfxDone?: string
  vfxDoneGold?: string
  vfxDestroy?: string
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
  /** 正在 Cook (running) 的节点集合：其入边绘制 SLG 高能锻造脉冲流 */
  cookingNodeIds?: Set<string>
  /** 正在 Cook (running) 的节点世界坐标包围盒：围绕节点四周持续升腾熔炉星火粒子 */
  cookingNodeRects?: Array<{ x: number; y: number; w: number; h: number }>
  /** 新建连线的发射生长进度表 */
  edgeSpawns?: Map<string, EdgeSpawnEntry>
  /** 战术冲击波 / 端口火花 / 拆解残光等 Canvas 粒子爆发列表 */
  canvasBursts?: CanvasVfxBurst[]
  /** 当前视口变换（用于把世界坐标的 canvasBursts 映射到屏幕坐标） */
  viewport?: GraphViewport
  /** 新连线光束命中目标端口时的回调 */
  onEdgeDock?: (edge: EdgeScreenGeometry) => void
  /** 流动动画相位（毫秒时间戳，用于计算 lineDashOffset） */
  flowTimeMs: number
  /** 手势期：跳过流动/发光等高成本效果 */
  reduceEffects: boolean
  colors: EdgeColors
  /** 隐藏时不画已有边；临时拖线仍可画 */
  pathStyle?: GraphEdgePathStyle
  /** 当顶层独立 vfxCanvas 接管节点上层粒子与冲击波时设为 true，避免底层重复绘制 */
  skipOverlayVfx?: boolean
}

export interface DrawVfxOverlayOptions {
  dpr: number
  width: number
  height: number
  offsetX: number
  offsetY: number
  viewport: GraphViewport
  cookingNodeRects?: Array<{ x: number; y: number; w: number; h: number }>
  canvasBursts?: CanvasVfxBurst[]
  nowMs?: number
  flowTimeMs?: number
  reduceEffects: boolean
  colors: EdgeColors
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
    px < minX - tolerance || px > maxX + tolerance || py < minY - tolerance || py > maxY + tolerance
  )
}

function distanceToEdgePath(
  g: EdgeScreenGeometry,
  px: number,
  py: number,
  samples: number
): number {
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

/** 采样边路径上参数 t ∈ [0, 1] 的屏幕坐标（兼容贝塞尔与正交折线） */
export function edgePointAt(g: EdgeScreenGeometry, t: number): { x: number; y: number } {
  const clamped = Math.max(0, Math.min(1, t))
  if (g.pathStyle === 'orthogonal' && g.points.length >= 2) {
    let totalLen = 0
    const segLens: number[] = []
    for (let i = 1; i < g.points.length; i += 1) {
      const a = g.points[i - 1]!
      const b = g.points[i]!
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      segLens.push(len)
      totalLen += len
    }
    if (totalLen <= 0.001) return { x: g.sx, y: g.sy }
    const targetDist = clamped * totalLen
    let acc = 0
    for (let i = 0; i < segLens.length; i += 1) {
      const len = segLens[i]!
      const a = g.points[i]!
      const b = g.points[i + 1]!
      if (acc + len >= targetDist || i === segLens.length - 1) {
        const segT = len > 0.001 ? Math.max(0, Math.min(1, (targetDist - acc) / len)) : 1
        return {
          x: a.x + (b.x - a.x) * segT,
          y: a.y + (b.y - a.y) * segT
        }
      }
      acc += len
    }
    return { x: g.ex, y: g.ey }
  }
  return bezierPointAt(g, clamped)
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

/** 绘制从起点到参数 t ∈ (0, 1] 的生长中边路径（De Casteljau 细分 / 折线截断） */
function tracePartialEdge(ctx: CanvasRenderingContext2D, g: EdgeScreenGeometry, t: number): void {
  const u = Math.max(0, Math.min(1, t))
  ctx.beginPath()
  if (g.pathStyle === 'orthogonal' && g.points.length >= 2) {
    let totalLen = 0
    const segLens: number[] = []
    for (let i = 1; i < g.points.length; i += 1) {
      const a = g.points[i - 1]!
      const b = g.points[i]!
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      segLens.push(len)
      totalLen += len
    }
    ctx.moveTo(g.points[0]!.x, g.points[0]!.y)
    if (totalLen <= 0.001) return
    const targetDist = u * totalLen
    let acc = 0
    for (let i = 0; i < segLens.length; i += 1) {
      const len = segLens[i]!
      const a = g.points[i]!
      const b = g.points[i + 1]!
      if (acc + len >= targetDist) {
        const segT = len > 0.001 ? (targetDist - acc) / len : 1
        ctx.lineTo(a.x + (b.x - a.x) * segT, a.y + (b.y - a.y) * segT)
        return
      }
      ctx.lineTo(b.x, b.y)
      acc += len
    }
    return
  }

  // 三次贝塞尔 De Casteljau 前半段 [0, u]
  const x01 = g.sx + (g.c1x - g.sx) * u
  const y01 = g.sy + (g.c1y - g.sy) * u
  const x12 = g.c1x + (g.c2x - g.c1x) * u
  const y12 = g.c1y + (g.c2y - g.c1y) * u
  const x23 = g.c2x + (g.ex - g.c2x) * u
  const y23 = g.c2y + (g.ey - g.c2y) * u

  const x012 = x01 + (x12 - x01) * u
  const y012 = y01 + (y12 - y01) * u
  const x123 = x12 + (x23 - x12) * u
  const y123 = y12 + (y23 - y12) * u

  const x0123 = x012 + (x123 - x012) * u
  const y0123 = y012 + (y123 - y012) * u

  ctx.moveTo(g.sx, g.sy)
  ctx.bezierCurveTo(x01, y01, x012, y012, x0123, y0123)
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, radius)
    return
  }
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  ctx.lineTo(x + radius, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

/** 绘制四角 SLG 战术锁定准星（Corner Lock Reticles） */
function drawCornerBrackets(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  armLen: number
): void {
  const arm = Math.min(armLen, w * 0.35, h * 0.35)
  ctx.beginPath()
  // 左上
  ctx.moveTo(x, y + arm)
  ctx.lineTo(x, y)
  ctx.lineTo(x + arm, y)
  // 右上
  ctx.moveTo(x + w - arm, y)
  ctx.lineTo(x + w, y)
  ctx.lineTo(x + w, y + arm)
  // 右下
  ctx.moveTo(x + w, y + h - arm)
  ctx.lineTo(x + w, y + h)
  ctx.lineTo(x + w - arm, y + h)
  // 左下
  ctx.moveTo(x + arm, y + h)
  ctx.lineTo(x, y + h)
  ctx.lineTo(x, y + h - arm)
  ctx.stroke()
}

/** 轻量确定性伪随机数（0 ~ 1），使每枚粒子拥有丰富且稳定的方向、速度与闪烁相位，零内存分配 */
function hash01(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453123
  return s - Math.floor(s)
}

/** 沿节点矩形四周外框采样发射锚点与外法线方向（使粒子 100% 从卡片边缘向外迸射，不被卡片遮挡） */
function samplePerimeterAnchor(
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  u: number
): { x: number; y: number; nx: number; ny: number } {
  const t = ((u % 1) + 1) % 1
  const perim = Math.max(1, (sw + sh) * 2)
  const dist = t * perim
  if (dist < sw) {
    // 顶边
    const ratio = dist / Math.max(1, sw)
    return { x: sx + dist, y: sy, nx: (ratio - 0.5) * 0.65, ny: -1 }
  }
  const d2 = dist - sw
  if (d2 < sh) {
    // 右边
    const ratio = d2 / Math.max(1, sh)
    return { x: sx + sw, y: sy + d2, nx: 1, ny: (ratio - 0.5) * 0.65 }
  }
  const d3 = d2 - sh
  if (d3 < sw) {
    // 底边
    const ratio = d3 / Math.max(1, sw)
    return { x: sx + sw - d3, y: sy + sh, nx: (0.5 - ratio) * 0.65, ny: 1 }
  }
  // 左边
  const d4 = d3 - sw
  const ratio = d4 / Math.max(1, sh)
  return { x: sx, y: sy + sh - d4, nx: -1, ny: (0.5 - ratio) * 0.65 }
}

/** 绘制 SLG 科幻四角星芒粒子（✦ 4-Point Starburst） */
function drawFourPointStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  rotation: number
): void {
  ctx.beginPath()
  for (let i = 0; i < 8; i += 1) {
    const r = i % 2 === 0 ? outerR : innerR
    const angle = rotation + (i * Math.PI) / 4
    const x = cx + Math.cos(angle) * r
    const y = cy + Math.sin(angle) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fill()
}

/** 绘制全息菱形晶体粒子（◆ Holographic Diamond Shard） */
function drawDiamondShard(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rotation: number
): void {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  ctx.beginPath()
  ctx.moveTo(cx + cos * rx, cy + sin * rx)
  ctx.lineTo(cx - sin * ry, cy + cos * ry)
  ctx.lineTo(cx - cos * rx, cy - sin * rx)
  ctx.lineTo(cx + sin * ry, cy - cos * ry)
  ctx.closePath()
  ctx.fill()
}

/**
 * 预烘焙 64x64 径向渐变柔光星斑贴图（Bokeh / Photon Bloom Sprite Cache）
 * 游戏引擎标准做法：用离屏 Canvas 预渲染高斯衰减径向渐变（白热中心 -> 核心色 -> 柔光色 -> 0 透明边缘），
 * 随后配合 globalCompositeOperation = 'lighter' 进行硬件加速贴图混合，彻底告别生硬实心圆。
 */
const bloomSpriteCache = new Map<string, HTMLCanvasElement>()

function getBloomSprite(glowColor: string, coreColor: string): HTMLCanvasElement | null {
  const key = `${glowColor}|${coreColor}`
  const cached = bloomSpriteCache.get(key)
  if (cached) return cached
  if (typeof document === 'undefined') return null
  try {
    const size = 64
    const half = size / 2
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const sctx = canvas.getContext('2d')
    if (!sctx || typeof sctx.createRadialGradient !== 'function') return null

    const grad = sctx.createRadialGradient(half, half, 0, half, half, half)
    grad.addColorStop(0, '#ffffff')
    grad.addColorStop(0.16, coreColor)
    grad.addColorStop(0.42, glowColor)
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)')
    sctx.fillStyle = grad
    sctx.fillRect(0, 0, size, size)
    bloomSpriteCache.set(key, canvas)
    return canvas
  } catch {
    return null
  }
}

/** 绘制柔和径向发光星斑（Soft Bokeh Photon Orb） */
function drawSoftBloomOrb(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  glowColor: string,
  coreColor: string,
  alpha: number
): void {
  if (alpha <= 0.01 || radius <= 0.2) return
  const sprite = getBloomSprite(glowColor, coreColor)
  if (sprite && typeof ctx.drawImage === 'function') {
    ctx.globalAlpha = alpha
    const d = radius * 2.4
    ctx.drawImage(sprite, cx - d * 0.5, cy - d * 0.5, d, d)
    return
  }
  // 无 DOM 环境（如 Vitest 单元测试 Mock Context）回退方案
  ctx.fillStyle = glowColor
  ctx.globalAlpha = alpha * 0.34
  ctx.beginPath()
  ctx.arc(cx, cy, radius * 1.8, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = coreColor
  ctx.globalAlpha = alpha
  ctx.beginPath()
  ctx.arc(cx, cy, radius * 0.65, 0, Math.PI * 2)
  ctx.fill()
}

/**
 * 绘制两头尖锐收束的流光针（Razor-Sharp Tapered Light Needle）
 * 彻底替代原本粗线圆头 stroke 造成的“火柴棍/小蝌蚪”伪影：
 * 首尾两端顶点宽度均为 0px，仅在靠前 25% 处微微隆起，形成游戏级锐利光丝。
 */
function drawTaperedLightNeedle(
  ctx: CanvasRenderingContext2D,
  hx: number,
  hy: number,
  tx: number,
  ty: number,
  maxHalfWidth: number,
  glowColor: string,
  coreColor: string,
  alpha: number
): void {
  if (alpha <= 0.01) return
  const dx = hx - tx
  const dy = hy - ty
  const len = Math.hypot(dx, dy)
  if (len < 0.5) {
    drawSoftBloomOrb(ctx, hx, hy, maxHalfWidth * 2, glowColor, coreColor, alpha)
    return
  }
  const nx = -dy / len
  const ny = dx / len
  // 腰部设置在距离头部 28% 处，形成前宽后长的流线型光锥
  const wx = tx + dx * 0.72
  const wy = ty + dy * 0.72
  const tipX = hx + (dx / len) * Math.max(1.5, maxHalfWidth * 1.4)
  const tipY = hy + (dy / len) * Math.max(1.5, maxHalfWidth * 1.4)

  // 外层宽光晕针
  const outerW = maxHalfWidth * 1.85
  ctx.fillStyle = glowColor
  ctx.globalAlpha = alpha * 0.42
  ctx.beginPath()
  ctx.moveTo(tipX, tipY)
  ctx.lineTo(wx + nx * outerW, wy + ny * outerW)
  ctx.lineTo(tx, ty)
  ctx.lineTo(wx - nx * outerW, wy - ny * outerW)
  ctx.closePath()
  ctx.fill()

  // 内层白热核心针
  const innerW = Math.max(0.6, maxHalfWidth * 0.68)
  const midTailX = (tx + wx) * 0.5
  const midTailY = (ty + wy) * 0.5
  ctx.fillStyle = coreColor
  ctx.globalAlpha = alpha * 0.95
  ctx.beginPath()
  ctx.moveTo(tipX, tipY)
  ctx.lineTo(wx + nx * innerW, wy + ny * innerW)
  ctx.lineTo(midTailX, midTailY)
  ctx.lineTo(wx - nx * innerW, wy - ny * innerW)
  ctx.closePath()
  ctx.fill()

  // 针尖叠加一枚柔光星斑
  drawSoftBloomOrb(ctx, hx, hy, maxHalfWidth * 1.6, glowColor, coreColor, alpha * 0.85)
}

/** 绘制游戏级镜头十字星芒（Anamorphic Lens-Flare Star） */
function drawAnamorphicStarFlare(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outerR: number,
  glowColor: string,
  coreColor: string,
  alpha: number,
  rotation: number
): void {
  if (alpha <= 0.01) return
  // 底层柔光光晕
  drawSoftBloomOrb(ctx, cx, cy, outerR * 0.85, glowColor, coreColor, alpha * 0.75)

  // 纤细锐利的四角长星芒（内径仅 0.14，比普通四角星更修长锐利）
  ctx.fillStyle = glowColor
  ctx.globalAlpha = alpha * 0.92
  drawFourPointStar(ctx, cx, cy, outerR * 1.25, Math.max(0.7, outerR * 0.14), rotation)

  // 45 度交错次级短星芒
  ctx.fillStyle = coreColor
  ctx.globalAlpha = alpha * 0.85
  drawFourPointStar(
    ctx,
    cx,
    cy,
    outerR * 0.62,
    Math.max(0.5, outerR * 0.1),
    rotation + Math.PI * 0.25
  )
}

/**
 * 正在 Cook (running) 的节点顶层全息炼成阵特效（Top-Layer Arcane Forge Conduit & Bokeh Photons）：
 * 渲染在节点卡片上层（vfxCanvasEl）：
 * 1) 沿节点圆角边框高速环绕的双子流光彗星轨（Perimeter Dual Comet Streams）
 * 2) 四角微型星芒锚点呼吸闪烁
 * 3) 在卡片表面内部缓缓升腾的柔光散景光子（Bokeh Orbs）与纤细流光针，不遮挡两侧端口文字与顶部标题
 */
function drawCookingNodeEmbers(
  ctx: CanvasRenderingContext2D,
  rects: Array<{ x: number; y: number; w: number; h: number }>,
  viewport: GraphViewport,
  nowMs: number,
  colors: EdgeColors
): void {
  const zoom = viewport.zoom
  const forgeA = colors.vfxForgeA || '#fbbf24'
  const forgeB = colors.vfxForgeB || '#38bdf8'
  const coreColor = colors.vfxCyanCore || '#e0f7ff'

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.setLineDash([])
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0

  for (let rIdx = 0; rIdx < rects.length; rIdx += 1) {
    const rect = rects[rIdx]!
    const sx = toScreenX(rect.x, viewport)
    const sy = toScreenY(rect.y, viewport)
    const sw = rect.w * zoom
    const sh = rect.h * zoom
    const perimeter = Math.max(120, 2 * (sw + sh))

    // 1) 沿卡片圆角边框环绕飞行的双子流光能量弧（Dual Orbiting Perimeter Energy Streams）
    const cometLen = perimeter * 0.18
    const gapLen = perimeter * 0.32
    const speedPxPerMs = (perimeter * 0.55) / 1000
    const dashOffset = -(nowMs * speedPxPerMs) % perimeter

    drawRoundedRectPath(ctx, sx, sy, sw, sh, 10 * zoom)
    ctx.setLineDash([cometLen, gapLen])
    ctx.lineDashOffset = dashOffset
    ctx.strokeStyle = forgeA
    ctx.globalAlpha = 0.42
    ctx.lineWidth = Math.max(2.6, 4.2 * zoom)
    ctx.stroke()

    ctx.strokeStyle = coreColor
    ctx.globalAlpha = 0.88
    ctx.lineWidth = Math.max(1.1, 1.6 * zoom)
    ctx.stroke()

    // 第二道反向青蓝流光弧
    ctx.lineDashOffset = -dashOffset + perimeter * 0.25
    ctx.strokeStyle = forgeB
    ctx.globalAlpha = 0.52
    ctx.lineWidth = Math.max(1.6, 2.4 * zoom)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.lineDashOffset = 0

    // 2) 卡片外围呼吸战术准星与四角星芒锚点
    const bracketPulse = 0.55 + 0.45 * Math.sin(nowMs * 0.005 + rIdx)
    ctx.strokeStyle = forgeA
    ctx.globalAlpha = 0.65 * bracketPulse
    ctx.lineWidth = Math.max(1.5, 2.2 * zoom)
    drawCornerBrackets(ctx, sx - 5 * zoom, sy - 5 * zoom, sw + 10 * zoom, sh + 10 * zoom, 14 * zoom)

    const corners = [
      { x: sx + 2 * zoom, y: sy + 2 * zoom },
      { x: sx + sw - 2 * zoom, y: sy + 2 * zoom },
      { x: sx + sw - 2 * zoom, y: sy + sh - 2 * zoom },
      { x: sx + 2 * zoom, y: sy + sh - 2 * zoom }
    ]
    for (let c = 0; c < corners.length; c += 1) {
      const pulse = 0.5 + 0.5 * Math.sin(nowMs * 0.006 + c * 1.57 + rIdx)
      const pt = corners[c]!
      drawAnamorphicStarFlare(
        ctx,
        pt.x,
        pt.y,
        Math.max(4.5, 7.8 * zoom * (0.75 + 0.25 * pulse)),
        c % 2 === 0 ? forgeA : forgeB,
        coreColor,
        0.88 * pulse,
        nowMs * 0.0018 + c
      )
    }

    // 3) 28 枚高饱和度多层游戏粒子（流光细针 + 虚化散景光子 + 镜头十字星芒）自底向上贯穿卡片表面升腾
    const particleCount = 28
    for (let i = 0; i < particleCount; i += 1) {
      const seed = rIdx * 43 + i * 23 + 11
      const cycleMs = 1350 + hash01(seed + 1) * 850
      const phaseOffset = hash01(seed + 2) * cycleMs
      const localT = ((nowMs + phaseOffset) % cycleMs) / cycleMs
      // 平滑淡入淡出包络
      const env = localT < 0.18 ? localT / 0.18 : localT > 0.76 ? (1 - localT) / 0.24 : 1

      // 分布在节点卡片水平内侧（10% ~ 90% 宽度），从底部/中部向卡片上方高高升腾
      const baseX = sx + (0.1 + hash01(seed + 3) * 0.8) * sw
      const startY = sy + (0.22 + hash01(seed + 4) * 0.74) * sh
      const riseDist = (36 + hash01(seed + 5) * 68) * localT * zoom
      const swayX = Math.sin(localT * Math.PI * 2.4 + seed) * (5 + hash01(seed + 6) * 7) * zoom
      const px = baseX + swayX
      const py = startY - riseDist
      const primaryColor = i % 2 === 0 ? forgeA : forgeB
      const twinkle = 0.72 + 0.28 * Math.sin(nowMs * 0.012 + seed * 2.7)
      const alpha = env * twinkle * 0.96

      const kindMod = i % 3
      if (kindMod === 0) {
        // 类型 A：修长锐利的垂直流光针（Tapered Light Needle）
        const needleLen = (16 + 20 * env) * zoom
        drawTaperedLightNeedle(
          ctx,
          px,
          py,
          px - swayX * 0.3,
          py + needleLen,
          Math.max(1.4, 2.4 * zoom),
          primaryColor,
          coreColor,
          alpha
        )
      } else if (kindMod === 1) {
        // 类型 B：高亮度虚化散景光子（Bokeh Orb，大小层次丰富）
        const orbRadius = (3.5 + hash01(seed + 7) * 5.2) * zoom
        drawSoftBloomOrb(ctx, px, py, orbRadius, primaryColor, coreColor, alpha)
      } else {
        // 类型 C：镜头十字星芒（Anamorphic Star Flare）
        const starR = (5 + hash01(seed + 8) * 4.8) * zoom
        drawAnamorphicStarFlare(
          ctx,
          px,
          py,
          starR,
          primaryColor,
          coreColor,
          alpha,
          localT * Math.PI * 1.6 + seed
        )
      }
    }
  }

  ctx.restore()
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3
}

function drawCanvasVfxBursts(
  ctx: CanvasRenderingContext2D,
  bursts: CanvasVfxBurst[],
  viewport: GraphViewport,
  nowMs: number,
  _dpr: number,
  colors: EdgeColors
): void {
  const zoom = viewport.zoom
  const cyan = colors.vfxCyan || '#56d8ff'
  const cyanCore = colors.vfxCyanCore || '#e0f7ff'
  const doneColor = colors.vfxDone || '#3dd68c'
  const doneGold = colors.vfxDoneGold || '#fde047'
  const destroyColor = colors.vfxDestroy || '#ff5c6c'

  ctx.save()
  // 开启游戏级 Additive 线性减淡发光混合，粒子与冲击波交叠处自动产生高亮能量白芯
  ctx.globalCompositeOperation = 'lighter'
  ctx.setLineDash([])
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0

  for (const b of bursts) {
    const elapsed = nowMs - (b.startedAt + b.delayMs)
    if (elapsed < 0 || elapsed >= b.durationMs) continue
    const progress = Math.max(0, Math.min(1, elapsed / b.durationMs))
    const easeOut = 1 - Math.pow(1 - progress, 2.2)
    const fade = 1 - progress

    if (b.kind === 'spawn-shockwave') {
      const sx = toScreenX(b.x, viewport)
      const sy = toScreenY(b.y, viewport)
      const sw = (b.w ?? 200) * zoom
      const sh = (b.h ?? 160) * zoom

      // 0) 顶层全息激光扫描线（前 48% 周期自顶向下掠过节点表面，带柔和光幕拖尾）
      if (progress < 0.48) {
        const scanT = progress / 0.48
        const scanY = sy + scanT * sh
        const scanAlpha = scanT < 0.15 ? scanT / 0.15 : 1 - (scanT - 0.15) / 0.85
        ctx.strokeStyle = cyan
        ctx.globalAlpha = scanAlpha * 0.42
        ctx.lineWidth = Math.max(3, 6 * zoom)
        ctx.beginPath()
        ctx.moveTo(sx + 4 * zoom, scanY)
        ctx.lineTo(sx + sw - 4 * zoom, scanY)
        ctx.stroke()

        ctx.strokeStyle = cyanCore
        ctx.globalAlpha = scanAlpha * 0.95
        ctx.lineWidth = Math.max(1.2, 1.8 * zoom)
        ctx.beginPath()
        ctx.moveTo(sx + 2 * zoom, scanY)
        ctx.lineTo(sx + sw - 2 * zoom, scanY)
        ctx.stroke()
      }

      // 1) 主冲击波圆角框（前 78% 周期向外从容扩散，带宽柔光 + 锐利亮核）
      if (progress < 0.78) {
        const w1T = progress / 0.78
        const w1Ease = 1 - Math.pow(1 - w1T, 2.1)
        const w1Fade = 1 - w1T
        const pad1 = (2 + 32 * w1Ease) * zoom
        drawRoundedRectPath(ctx, sx - pad1, sy - pad1, sw + pad1 * 2, sh + pad1 * 2, 12 * zoom)
        ctx.strokeStyle = cyan
        ctx.globalAlpha = w1Fade * 0.28
        ctx.lineWidth = Math.max(3, (6.2 - 3 * w1T) * zoom)
        ctx.stroke()

        ctx.strokeStyle = cyanCore
        ctx.globalAlpha = w1Fade * 0.85
        ctx.lineWidth = Math.max(1.2, (2.2 - 1 * w1T) * zoom)
        ctx.stroke()
      }

      // 2) 次级雷达回响波（延迟 20% 启动，形成 SLG 双脉冲波纹层次）
      if (progress > 0.2) {
        const w2T = (progress - 0.2) / 0.8
        const w2Ease = 1 - Math.pow(1 - w2T, 2.1)
        const w2Fade = 1 - w2T
        const pad2 = (1 + 22 * w2Ease) * zoom
        drawRoundedRectPath(ctx, sx - pad2, sy - pad2, sw + pad2 * 2, sh + pad2 * 2, 11 * zoom)
        ctx.strokeStyle = cyan
        ctx.globalAlpha = w2Fade * 0.55
        ctx.lineWidth = Math.max(1.1, 1.7 * (1 - w2T * 0.4) * zoom)
        ctx.stroke()
      }

      // 3) 四角战术准星：前 22% 咔哒缩紧锁定 -> 22%~78% 稳定驻留锁定 -> 后 22% 柔和消散
      const lockIn = Math.min(1, progress / 0.22)
      const lockEase = 1 - Math.pow(1 - lockIn, 2.8)
      const lockPad = (18 * (1 - lockEase) + 3) * zoom
      const bracketAlpha = progress < 0.78 ? 0.92 : Math.max(0, ((1 - progress) / 0.22) * 0.92)
      ctx.globalAlpha = bracketAlpha
      ctx.strokeStyle = cyanCore
      ctx.lineWidth = Math.max(1.6, 2.2 * zoom)
      drawCornerBrackets(
        ctx,
        sx - lockPad,
        sy - lockPad,
        sw + lockPad * 2,
        sh + lockPad * 2,
        15 * zoom
      )

      // 4) 【粒子层 A】16 枚两头尖锐的流光针（Tapered Light Needles，从边框与四角向外高速射出）
      const sparkCount = 16
      for (let i = 0; i < sparkCount; i += 1) {
        const seed = i * 17.3 + 5.1
        const anchor = samplePerimeterAnchor(sx, sy, sw, sh, (i + 0.35 * hash01(seed)) / sparkCount)
        const speed = (18 + 34 * hash01(seed + 1)) * zoom
        const travel = speed * easeOut
        const tailDist = Math.max(0, travel - (10 + 14 * (1 - progress)) * zoom)
        const hx = anchor.x + anchor.nx * travel
        const hy = anchor.y + anchor.ny * travel
        const tx = anchor.x + anchor.nx * tailDist
        const ty = anchor.y + anchor.ny * tailDist
        const twinkle = 0.75 + 0.25 * Math.sin(progress * Math.PI * 6 + i * 2.1)
        drawTaperedLightNeedle(
          ctx,
          hx,
          hy,
          tx,
          ty,
          Math.max(1.1, 1.9 * (1 - progress * 0.5) * zoom),
          cyan,
          cyanCore,
          fade * twinkle * 0.95
        )
      }

      // 5) 【粒子层 B】12 枚全息散景光子与镜头十字星芒（在节点表面及四周缓缓升腾闪烁）
      const shardCount = 12
      for (let i = 0; i < shardCount; i += 1) {
        const seed = i * 29.7 + 11.4
        const px =
          sx +
          (0.08 + 0.84 * hash01(seed)) * sw +
          Math.sin(progress * Math.PI * 3 + seed) * 8 * zoom
        const startY = sy + (0.15 + 0.75 * hash01(seed + 1)) * sh
        const py = startY - (16 + 38 * hash01(seed + 2)) * easeOut * zoom
        const shardAlpha = (progress < 0.15 ? progress / 0.15 : fade) * 0.9
        const rot = progress * Math.PI * 2.2 + seed

        if (i % 2 === 0) {
          drawAnamorphicStarFlare(
            ctx,
            px,
            py,
            Math.max(4, (7.2 - 2 * progress) * zoom),
            cyan,
            cyanCore,
            shardAlpha,
            rot
          )
        } else {
          drawSoftBloomOrb(
            ctx,
            px,
            py,
            Math.max(2.5, (4.8 - 1.5 * progress) * zoom),
            cyan,
            cyanCore,
            shardAlpha
          )
        }
      }
      continue
    }

    if (b.kind === 'buff-burst') {
      const sx = toScreenX(b.x, viewport)
      const sy = toScreenY(b.y, viewport)
      const sw = (b.w ?? 200) * zoom
      const sh = (b.h ?? 160) * zoom

      // 0) 自底向上掠过节点表面的翡翠赋能波面（Rising Empowerment Sweep）
      if (progress < 0.52) {
        const sweepT = progress / 0.52
        const sweepY = sy + sh * (1 - sweepT)
        const sweepAlpha = Math.sin(sweepT * Math.PI)
        ctx.strokeStyle = doneColor
        ctx.globalAlpha = sweepAlpha * 0.45
        ctx.lineWidth = Math.max(3.5, 7 * zoom)
        ctx.beginPath()
        ctx.moveTo(sx + 4 * zoom, sweepY)
        ctx.lineTo(sx + sw - 4 * zoom, sweepY)
        ctx.stroke()

        ctx.strokeStyle = cyanCore
        ctx.globalAlpha = sweepAlpha * 0.9
        ctx.lineWidth = Math.max(1.2, 1.8 * zoom)
        ctx.beginPath()
        ctx.moveTo(sx + 2 * zoom, sweepY)
        ctx.lineTo(sx + sw - 2 * zoom, sweepY)
        ctx.stroke()
      }

      // 1) 翡翠 + 电光青双层强化光环
      const pad = (2 + 26 * easeOut) * zoom
      drawRoundedRectPath(ctx, sx - pad, sy - pad, sw + pad * 2, sh + pad * 2, 12 * zoom)
      ctx.strokeStyle = doneColor
      ctx.globalAlpha = fade * 0.3
      ctx.lineWidth = Math.max(3, 6 * (1 - progress * 0.5) * zoom)
      ctx.stroke()

      ctx.strokeStyle = cyan
      ctx.globalAlpha = fade * 0.85
      ctx.lineWidth = Math.max(1.2, 2.1 * (1 - progress * 0.4) * zoom)
      ctx.stroke()

      // 2) 四角强化锁定准星
      const lockAlpha = progress < 0.76 ? 0.92 : ((1 - progress) / 0.24) * 0.92
      ctx.globalAlpha = lockAlpha
      ctx.strokeStyle = doneColor
      ctx.lineWidth = Math.max(1.6, 2.2 * zoom)
      drawCornerBrackets(ctx, sx - 4 * zoom, sy - 4 * zoom, sw + 8 * zoom, sh + 8 * zoom, 15 * zoom)

      // 3) 【专属粒子】16 枚在节点卡片表面升腾的「战术强化流光针 + 散景光子」
      const buffCount = 16
      for (let i = 0; i < buffCount; i += 1) {
        const seed = i * 23.1 + 3.7
        const delayFrac = (i % 4) * 0.06
        if (progress <= delayFrac) continue
        const localP = Math.min(1, (progress - delayFrac) / (1 - delayFrac))
        const localEase = 1 - Math.pow(1 - localP, 2)
        const localFade = localP < 0.18 ? localP / 0.18 : 1 - (localP - 0.18) / 0.82

        const px = sx + (0.1 + 0.8 * hash01(seed + 1)) * sw
        const startY = sy + (0.25 + 0.7 * hash01(seed + 2)) * sh
        const riseY = (24 + 54 * hash01(seed + 3)) * localEase * zoom
        const py = startY - riseY
        const tailLen = (14 + 20 * (1 - localP * 0.4)) * zoom
        const color = i % 2 === 0 ? doneColor : cyan

        // 垂直向上升腾的锐利光羽流光针
        drawTaperedLightNeedle(
          ctx,
          px,
          py,
          px,
          py + tailLen,
          Math.max(1.1, 1.8 * zoom),
          color,
          cyanCore,
          localFade * 0.92
        )

        // 顶端镶嵌镜头十字星芒
        if (i % 2 === 0) {
          drawAnamorphicStarFlare(
            ctx,
            px,
            py,
            Math.max(3.8, 6.2 * zoom),
            color,
            cyanCore,
            localFade * 0.9,
            localP * Math.PI * 1.6 + seed
          )
        }
      }
      continue
    }

    if (b.kind === 'port-dock') {
      const px = toScreenX(b.x, viewport)
      const py = toScreenY(b.y, viewport)
      const radius = (3 + 26 * easeOut) * zoom

      // 1) 端口中心高能柔光爆点
      drawSoftBloomOrb(ctx, px, py, (6 + 12 * (1 - progress)) * zoom, cyan, cyanCore, fade * 0.88)

      // 2) 端口扩散主能量环
      ctx.beginPath()
      ctx.arc(px, py, radius, 0, Math.PI * 2)
      ctx.strokeStyle = cyan
      ctx.globalAlpha = fade * 0.35
      ctx.lineWidth = Math.max(3, 5.8 * (1 - progress) * zoom)
      ctx.stroke()

      ctx.strokeStyle = cyanCore
      ctx.globalAlpha = fade * 0.94
      ctx.lineWidth = Math.max(1.2, 2.2 * (1 - progress) * zoom)
      ctx.stroke()

      // 3) 中心接驳镜头十字星耀斑
      if (progress < 0.62) {
        const flareFade = 1 - progress / 0.62
        drawAnamorphicStarFlare(
          ctx,
          px,
          py,
          Math.max(6, 13 * flareFade * zoom),
          cyan,
          cyanCore,
          flareFade * 0.95,
          progress * Math.PI * 0.8
        )
      }

      // 4) 【粒子层】14 枚带重力抛物线的锐利电焊火花针（Gravity Arc Plasma Needles）
      const sparkCount = 14
      for (let i = 0; i < sparkCount; i += 1) {
        const seed = i * 19.3 + 2.5
        const angle = (i * Math.PI * 2) / sparkCount + (hash01(seed) - 0.5) * 0.28
        const speed = (16 + 30 * hash01(seed + 1)) * zoom
        const dist = speed * easeOut
        const prevDist = speed * Math.max(0, easeOut - 0.22)
        const gravityY = 16 * progress * progress * zoom
        const prevGravityY = 16 * Math.max(0, progress - 0.12) * Math.max(0, progress - 0.12) * zoom

        const hx = px + Math.cos(angle) * dist
        const hy = py + Math.sin(angle) * dist + gravityY
        const tx = px + Math.cos(angle) * prevDist
        const ty = py + Math.sin(angle) * prevDist + prevGravityY
        const sparkColor = i % 3 === 0 ? doneGold : cyan
        drawTaperedLightNeedle(
          ctx,
          hx,
          hy,
          tx,
          ty,
          Math.max(1, 1.7 * (1 - progress * 0.5) * zoom),
          sparkColor,
          cyanCore,
          fade * 0.96
        )
      }
      continue
    }

    if (b.kind === 'cook-done-burst') {
      const sx = toScreenX(b.x, viewport)
      const sy = toScreenY(b.y, viewport)
      const sw = (b.w ?? 200) * zoom
      const sh = (b.h ?? 160) * zoom

      // 1) 外圈耀金冲击波（宽柔光 + 锐利金线）
      const padOuter = (4 + 42 * easeOut) * zoom
      drawRoundedRectPath(
        ctx,
        sx - padOuter,
        sy - padOuter,
        sw + padOuter * 2,
        sh + padOuter * 2,
        14 * zoom
      )
      ctx.strokeStyle = doneGold
      ctx.globalAlpha = fade * 0.32
      ctx.lineWidth = Math.max(3.2, 6.8 * (1 - progress) * zoom)
      ctx.stroke()

      ctx.strokeStyle = cyanCore
      ctx.globalAlpha = fade * 0.92
      ctx.lineWidth = Math.max(1.4, 2.4 * (1 - progress) * zoom)
      ctx.stroke()

      // 2) 内圈翡翠冲击波
      const padInner = (2 + 24 * easeOut) * zoom
      drawRoundedRectPath(
        ctx,
        sx - padInner,
        sy - padInner,
        sw + padInner * 2,
        sh + padInner * 2,
        12 * zoom
      )
      ctx.strokeStyle = doneColor
      ctx.globalAlpha = fade * 0.9
      ctx.lineWidth = Math.max(1.4, 2.1 * zoom)
      ctx.stroke()

      // 3) 四角耀金锁定准星驻留至 76%
      const lockAlpha = progress < 0.76 ? 0.92 : Math.max(0, ((1 - progress) / 0.24) * 0.92)
      ctx.globalAlpha = lockAlpha
      ctx.strokeStyle = doneGold
      ctx.lineWidth = Math.max(1.6, 2.3 * zoom)
      drawCornerBrackets(ctx, sx - 4 * zoom, sy - 4 * zoom, sw + 8 * zoom, sh + 8 * zoom, 16 * zoom)

      // 4) 【粒子层 A】16 枚庆典流光针（Tapered Light Needles，沿四周边框向外放射绽放）
      const cometCount = 16
      for (let i = 0; i < cometCount; i += 1) {
        const seed = i * 21.7 + 9.3
        const anchor = samplePerimeterAnchor(sx, sy, sw, sh, (i + 0.2) / cometCount)
        const speed = (22 + 40 * hash01(seed + 1)) * zoom
        const dist = speed * easeOut
        const prevDist = speed * Math.max(0, easeOut - 0.2)
        const liftY = -10 * progress * zoom
        const hx = anchor.x + anchor.nx * dist
        const hy = anchor.y + anchor.ny * dist + liftY
        const tx = anchor.x + anchor.nx * prevDist
        const ty = anchor.y + anchor.ny * prevDist + liftY * 0.75
        const color = i % 2 === 0 ? doneGold : doneColor
        drawTaperedLightNeedle(
          ctx,
          hx,
          hy,
          tx,
          ty,
          Math.max(1.2, 2.1 * (1 - progress * 0.45) * zoom),
          color,
          cyanCore,
          fade * 0.95
        )
      }

      // 5) 【粒子层 B】14 枚卡片表面与四周升腾的镜头十字大星芒 & 柔光金斑
      const starCount = 14
      for (let i = 0; i < starCount; i += 1) {
        const seed = i * 31.1 + 4.2
        const px =
          sx +
          (0.06 + 0.88 * hash01(seed)) * sw +
          Math.sin(progress * Math.PI * 2.5 + seed) * 10 * zoom
        const startY = sy + (0.12 + 0.78 * hash01(seed + 1)) * sh
        const py = startY - (18 + 44 * hash01(seed + 2)) * easeOut * zoom
        const twinkle = 0.68 + 0.32 * Math.sin(progress * Math.PI * 7 + i * 1.9)
        const starAlpha = fade * twinkle * 0.96
        const starColor = i % 2 === 0 ? doneGold : doneColor
        const outerR = Math.max(4.5, (8.5 - 2.8 * progress) * zoom)
        const rot = progress * Math.PI * 2.2 + seed

        if (i % 3 !== 2) {
          drawAnamorphicStarFlare(ctx, px, py, outerR, starColor, cyanCore, starAlpha, rot)
        } else {
          drawSoftBloomOrb(ctx, px, py, outerR * 0.75, starColor, cyanCore, starAlpha)
        }
      }
      continue
    }

    if (b.kind === 'cook-error-burst') {
      const sx = toScreenX(b.x, viewport)
      const sy = toScreenY(b.y, viewport)
      const sw = (b.w ?? 200) * zoom
      const sh = (b.h ?? 160) * zoom
      const pad = (3 + 28 * easeOut) * zoom

      drawRoundedRectPath(ctx, sx - pad, sy - pad, sw + pad * 2, sh + pad * 2, 12 * zoom)
      ctx.strokeStyle = destroyColor
      ctx.globalAlpha = fade * 0.3
      ctx.lineWidth = Math.max(3, 6 * (1 - progress) * zoom)
      ctx.stroke()

      ctx.globalAlpha = fade * 0.9
      ctx.lineWidth = Math.max(1.4, 2.4 * (1 - progress) * zoom)
      ctx.stroke()

      const bracketPad = (4 + 10 * easeOut) * zoom
      ctx.globalAlpha = progress < 0.72 ? 0.92 : fade * 3.2
      drawCornerBrackets(
        ctx,
        sx - bracketPad,
        sy - bracketPad,
        sw + bracketPad * 2,
        sh + bracketPad * 2,
        15 * zoom
      )

      // 【粒子层】14 枚量子崩解猩红菱形碎片 + 散景火花
      const shardCount = 14
      for (let i = 0; i < shardCount; i += 1) {
        const seed = i * 19.9 + 6.4
        const anchor = samplePerimeterAnchor(sx, sy, sw, sh, (i + 0.3) / shardCount)
        const dist = (8 + 34 * hash01(seed + 1) * easeOut) * zoom
        const dropY = 16 * progress * progress * zoom
        const px = anchor.x + anchor.nx * dist
        const py = anchor.y + anchor.ny * dist + dropY
        const rot = progress * Math.PI * 3.2 * (i % 2 === 0 ? 1 : -1) + seed
        const color = i % 3 === 0 ? doneGold : destroyColor
        drawSoftBloomOrb(ctx, px, py, Math.max(2.5, 4.2 * zoom), color, cyanCore, fade * 0.65)
        ctx.fillStyle = color
        ctx.globalAlpha = fade * 0.92
        drawDiamondShard(
          ctx,
          px,
          py,
          Math.max(3.4, 5.6 * (1 - progress * 0.4) * zoom),
          Math.max(1.8, 3 * (1 - progress * 0.4) * zoom),
          rot
        )
      }
      continue
    }

    if (b.kind === 'edge-sever' && b.toX !== undefined && b.toY !== undefined) {
      const sx = toScreenX(b.x, viewport)
      const sy = toScreenY(b.y, viewport)
      const ex = toScreenX(b.toX, viewport)
      const ey = toScreenY(b.toY, viewport)
      const ctrlDx = Math.max(40 * zoom, Math.abs(ex - sx) * 0.45)
      const c1x = sx + ctrlDx
      const c1y = sy
      const c2x = ex - ctrlDx
      const c2y = ey
      const mx = cubicAt(sx, c1x, c2x, ex, 0.5)
      const my = cubicAt(sy, c1y, c2y, ey, 0.5)

      // 1) 断线中心 EMP 爆裂环与十字星耀斑
      const snapRadius = (4 + 34 * easeOut) * zoom
      ctx.beginPath()
      ctx.arc(mx, my, snapRadius, 0, Math.PI * 2)
      ctx.strokeStyle = destroyColor
      ctx.globalAlpha = fade * 0.38
      ctx.lineWidth = Math.max(3, 6.2 * (1 - progress) * zoom)
      ctx.stroke()

      ctx.strokeStyle = doneGold
      ctx.globalAlpha = fade * 0.92
      ctx.lineWidth = Math.max(1.2, 2.2 * (1 - progress) * zoom)
      ctx.stroke()

      if (progress < 0.58) {
        const flareT = 1 - progress / 0.58
        drawAnamorphicStarFlare(
          ctx,
          mx,
          my,
          Math.max(7, 15 * flareT * zoom),
          destroyColor,
          doneGold,
          flareT * 0.96,
          progress * Math.PI * 1.2
        )
      }

      // 2) 沿原贝塞尔曲线向左右两端急速抽回的断线电弧鞭梢（Bezier Recoil Whips）
      const leftTipU = Math.max(0.02, 0.5 * (1 - easeOut))
      const rightTipU = Math.min(0.98, 0.5 + 0.5 * easeOut)
      const steps = 10

      // 宽柔光外弧
      ctx.strokeStyle = destroyColor
      ctx.globalAlpha = fade * 0.42
      ctx.lineWidth = Math.max(3.2, 6.4 * (1 - progress * 0.5) * zoom)
      ctx.beginPath()
      ctx.moveTo(sx, sy)
      for (let s = 1; s <= steps; s += 1) {
        const u = (leftTipU * s) / steps
        ctx.lineTo(cubicAt(sx, c1x, c2x, ex, u), cubicAt(sy, c1y, c2y, ey, u))
      }
      ctx.moveTo(ex, ey)
      for (let s = 1; s <= steps; s += 1) {
        const u = 1 - ((1 - rightTipU) * s) / steps
        ctx.lineTo(cubicAt(sx, c1x, c2x, ex, u), cubicAt(sy, c1y, c2y, ey, u))
      }
      ctx.stroke()

      // 高亮金红内芯
      ctx.strokeStyle = doneGold
      ctx.globalAlpha = fade * 0.94
      ctx.lineWidth = Math.max(1.4, 2.4 * (1 - progress * 0.4) * zoom)
      ctx.stroke()

      // 两侧回缩鞭梢末端的电火花耀斑
      const lTipX = cubicAt(sx, c1x, c2x, ex, leftTipU)
      const lTipY = cubicAt(sy, c1y, c2y, ey, leftTipU)
      const rTipX = cubicAt(sx, c1x, c2x, ex, rightTipU)
      const rTipY = cubicAt(sy, c1y, c2y, ey, rightTipU)
      drawAnamorphicStarFlare(
        ctx,
        lTipX,
        lTipY,
        Math.max(4.5, 8.5 * fade * zoom),
        destroyColor,
        doneGold,
        fade * 0.92,
        progress * 4
      )
      drawAnamorphicStarFlare(
        ctx,
        rTipX,
        rTipY,
        Math.max(4.5, 8.5 * fade * zoom),
        destroyColor,
        doneGold,
        fade * 0.92,
        -progress * 4
      )

      // 3) 【粒子层】沿整条断裂轨迹与中点迸射 18 枚锐利短路流光针与散景火花
      const sparkCount = 18
      for (let i = 0; i < sparkCount; i += 1) {
        const seed = i * 15.7 + 1.9
        const sampleU = i < 10 ? 0.5 : 0.12 + 0.76 * hash01(seed + 2)
        const ox = cubicAt(sx, c1x, c2x, ex, sampleU)
        const oy = cubicAt(sy, c1y, c2y, ey, sampleU)
        const angle = (i * Math.PI * 2) / sparkCount + (hash01(seed) - 0.5) * 0.35
        const speed = (18 + 38 * hash01(seed + 1)) * zoom
        const dist = speed * easeOut
        const prevDist = speed * Math.max(0, easeOut - 0.22)
        const gravY = 16 * progress * progress * zoom
        const hx = ox + Math.cos(angle) * dist
        const hy = oy + Math.sin(angle) * dist + gravY
        const tx = ox + Math.cos(angle) * prevDist
        const ty = oy + Math.sin(angle) * prevDist + gravY * 0.7
        drawTaperedLightNeedle(
          ctx,
          hx,
          hy,
          tx,
          ty,
          Math.max(1.2, 2 * zoom),
          i % 2 === 0 ? destroyColor : doneGold,
          cyanCore,
          fade * 0.96
        )
      }
      continue
    }

    if (b.kind === 'group-territory') {
      const sx = toScreenX(b.x, viewport)
      const sy = toScreenY(b.y, viewport)
      const sw = (b.w ?? 260) * zoom
      const sh = (b.h ?? 200) * zoom

      ctx.globalAlpha = (progress < 0.72 ? 0.88 : (1 - progress) / 0.28) * 0.88
      ctx.strokeStyle = cyan
      ctx.lineWidth = Math.max(1.6, 2.4 * zoom)
      ctx.setLineDash([16 * zoom, 8 * zoom])
      drawRoundedRectPath(ctx, sx, sy, sw, sh, 12 * zoom)
      ctx.stroke()
      ctx.setLineDash([])
      drawCornerBrackets(
        ctx,
        sx - 5 * zoom,
        sy - 5 * zoom,
        sw + 10 * zoom,
        sh + 10 * zoom,
        18 * zoom
      )
    }
  }

  ctx.restore()
}

/**
 * 渲染位于节点卡片上层（z-index 高于 .graph-world）的独立全息粒子与冲击波图层
 */
export function drawCanvasVfxOverlay(
  ctx: CanvasRenderingContext2D,
  opts: DrawVfxOverlayOptions
): void {
  const {
    dpr,
    width,
    height,
    offsetX,
    offsetY,
    viewport,
    cookingNodeRects,
    canvasBursts,
    colors,
    reduceEffects
  } = opts
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  if (reduceEffects) return
  // 与 drawGraphEdges 保持一致：Canvas 左上角位于 (-offsetX, -offsetY)，故用 +offsetX * dpr 将屏幕坐标映射入含 overscan 的画布
  ctx.setTransform(dpr, 0, 0, dpr, offsetX * dpr, offsetY * dpr)
  const nowMs = opts.nowMs ?? (typeof performance !== 'undefined' ? performance.now() : Date.now())
  if (cookingNodeRects && cookingNodeRects.length > 0) {
    drawCookingNodeEmbers(ctx, cookingNodeRects, viewport, nowMs, colors)
  }
  if (canvasBursts && canvasBursts.length > 0) {
    drawCanvasVfxBursts(ctx, canvasBursts, viewport, nowMs, dpr, colors)
  }
}

export function drawGraphEdges(
  ctx: CanvasRenderingContext2D,
  geoms: EdgeScreenGeometry[],
  tempEdge: TempEdgeScreen | TempEdgeScreen[] | null,
  opts: DrawEdgesOptions
): void {
  const {
    dpr,
    width,
    height,
    offsetX,
    offsetY,
    zoom,
    selectedEdgeIds,
    flowEdgeIds,
    cookingNodeIds,
    edgeSpawns,
    canvasBursts,
    viewport,
    onEdgeDock,
    colors,
    reduceEffects
  } = opts
  const pathStyle = opts.pathStyle ?? 'curve'
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  // 之后所有绘制坐标 = 视口屏幕坐标 + offset，落入含 overscan 的 Canvas
  ctx.setTransform(dpr, 0, 0, dpr, offsetX * dpr, offsetY * dpr)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const visibleGeoms = pathStyle === 'hidden' ? [] : geoms
  const nowMs = opts.flowTimeMs
  const cyanColor = colors.vfxCyan || 'rgba(86, 216, 255, 0.95)'
  const cyanCoreColor = colors.vfxCyanCore || '#e0f7ff'
  const forgeColorA = colors.vfxForgeA || '#fbbf24'
  const forgeColorB = colors.vfxForgeB || '#38bdf8'

  // 1) 普通边（含选中态与新连线两段式能量建连：激光推进 + 接驳后全线余晖）
  ctx.setLineDash([])
  for (const g of visibleGeoms) {
    const spawn = edgeSpawns?.get(g.id)
    if (spawn) {
      const elapsed = nowMs - (spawn.startedAt + spawn.delayMs)
      if (elapsed <= 0) {
        // 尚在战术编排等待期（上游节点正在空投），暂不画这条线
        continue
      }
      if (elapsed < spawn.durationMs) {
        const rawT = Math.max(0.02, Math.min(1, elapsed / spawn.durationMs))
        const travelSplit = 0.62
        if (rawT <= travelSplit) {
          // 第一阶段（前 62%）：高能激光弹头沿贝塞尔曲线从源端口推进至目标端口
          const travelT = rawT / travelSplit
          const easedT = 1 - Math.pow(1 - travelT, 1.85)
          if (easedT >= 0.94 && !spawn.docked) {
            spawn.docked = true
            onEdgeDock?.(g)
          }
          tracePartialEdge(ctx, g, easedT)
          if (!reduceEffects) {
            ctx.lineWidth = 7.8 * zoom
            ctx.globalAlpha = 0.3
            ctx.strokeStyle = cyanColor
            ctx.stroke()
          }
          ctx.lineWidth = 2.8 * zoom
          ctx.globalAlpha = 1
          ctx.strokeStyle = cyanCoreColor
          ctx.stroke()

          // 弹头高能四角星芒 + 5 枚渐缩彗星尾迹粒子束
          const head = edgePointAt(g, easedT)
          if (!reduceEffects) {
            for (let pIdx = 1; pIdx <= 5; pIdx += 1) {
              const trailU = easedT - pIdx * 0.036
              if (trailU <= 0) continue
              const trailPt = edgePointAt(g, trailU)
              const ratio = 1 - pIdx / 6
              ctx.fillStyle = pIdx % 2 === 0 ? cyanCoreColor : cyanColor
              ctx.globalAlpha = 0.68 * ratio
              ctx.beginPath()
              ctx.arc(trailPt.x, trailPt.y, Math.max(1.4, 3.6 * ratio * zoom), 0, Math.PI * 2)
              ctx.fill()
            }
            ctx.fillStyle = cyanColor
            ctx.globalAlpha = 0.36
            ctx.beginPath()
            ctx.arc(head.x, head.y, Math.max(6, 9.5 * zoom), 0, Math.PI * 2)
            ctx.fill()
          }
          ctx.fillStyle = cyanCoreColor
          ctx.globalAlpha = 1
          drawFourPointStar(
            ctx,
            head.x,
            head.y,
            Math.max(5.2, 8.2 * zoom),
            Math.max(1.8, 2.8 * zoom),
            nowMs * 0.008
          )
          continue
        } else {
          // 第二阶段（62% ~ 100%）：光束抵达目标端口后，整条新连线维持高能青色充能余晖再平滑归位
          if (!spawn.docked) {
            spawn.docked = true
            onEdgeDock?.(g)
          }
          const afterglowFade = 1 - (rawT - travelSplit) / (1 - travelSplit)
          traceEdge(ctx, g)
          ctx.lineWidth = (selectedEdgeIds.has(g.id) ? 3 : 2) * zoom
          ctx.globalAlpha = 0.85
          ctx.strokeStyle = selectedEdgeIds.has(g.id) ? colors.selected : colors.edge
          ctx.stroke()

          if (!reduceEffects) {
            ctx.lineWidth = 7.5 * zoom
            ctx.globalAlpha = 0.28 * afterglowFade
            ctx.strokeStyle = cyanColor
            ctx.stroke()
          }
          ctx.lineWidth = 2.6 * zoom
          ctx.globalAlpha = 0.92 * afterglowFade
          ctx.strokeStyle = cyanCoreColor
          ctx.stroke()
          continue
        }
      } else if (!spawn.docked) {
        spawn.docked = true
        onEdgeDock?.(g)
      }
    }

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
    const spawn = edgeSpawns?.get(g.id)
    if (spawn && nowMs < spawn.startedAt + spawn.delayMs + spawn.durationMs) continue
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

  // 2) 选中节点流动高亮：纯色滚动虚线，配合宽发光层形成沿边移动的流动效果
  if (!reduceEffects && flowEdgeIds.size > 0 && pathStyle !== 'hidden') {
    const period = 500
    const dashTravel = 160 * zoom
    const offset = -((nowMs % period) / period) * dashTravel
    const flowColor = cyanColor
    for (const g of visibleGeoms) {
      if (!flowEdgeIds.has(g.source) && !flowEdgeIds.has(g.target)) continue

      ctx.setLineDash([36 * zoom, 100 * zoom])
      ctx.lineDashOffset = offset

      traceEdge(ctx, g)
      ctx.lineWidth = 6 * zoom
      ctx.globalAlpha = 0.35
      ctx.strokeStyle = flowColor
      ctx.shadowColor = cyanColor
      ctx.shadowBlur = 3.5 * dpr
      ctx.stroke()

      traceEdge(ctx, g)
      ctx.lineWidth = 2 * zoom
      ctx.globalAlpha = 1
      ctx.strokeStyle = flowColor
      ctx.shadowColor = cyanColor
      ctx.shadowBlur = 2 * dpr
      ctx.stroke()

      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
    }
    ctx.setLineDash([])
    ctx.globalAlpha = 1
    ctx.lineDashOffset = 0
  }

  // 3) Cook 熔炉高能输送流：所有汇入/发自 running 节点的边绘制琥珀金 + 电光青脉冲与能量粒子
  if (!reduceEffects && cookingNodeIds && cookingNodeIds.size > 0 && pathStyle !== 'hidden') {
    const period = 360
    const dashTravel = 140 * zoom
    const offset = -((nowMs % period) / period) * dashTravel
    const particlePhase = (nowMs % 720) / 720

    for (const g of visibleGeoms) {
      if (!cookingNodeIds.has(g.target) && !cookingNodeIds.has(g.source)) continue

      ctx.setLineDash([28 * zoom, 84 * zoom])
      ctx.lineDashOffset = offset

      // 宽琥珀金能量底衬（无 shadowBlur 同心柔光）
      traceEdge(ctx, g)
      ctx.lineWidth = 7.5 * zoom
      ctx.globalAlpha = 0.28
      ctx.strokeStyle = forgeColorA
      ctx.stroke()

      // 亮核脉冲流
      ctx.lineWidth = 2.4 * zoom
      ctx.globalAlpha = 0.96
      ctx.strokeStyle = forgeColorB
      ctx.stroke()

      // 沿管线高速奔涌的 2 枚能量球
      ctx.setLineDash([])
      for (let k = 0; k < 2; k += 1) {
        const pt = edgePointAt(g, (particlePhase + k * 0.5) % 1)
        const orbColor = k === 0 ? forgeColorA : cyanCoreColor
        ctx.fillStyle = orbColor
        ctx.globalAlpha = 0.26
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, Math.max(4.5, 6.8 * zoom), 0, Math.PI * 2)
        ctx.fill()

        ctx.globalAlpha = 0.98
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, Math.max(2.2, 3.4 * zoom), 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.setLineDash([])
    ctx.globalAlpha = 1
    ctx.lineDashOffset = 0
  }

  // 4) 临时连线（拖拽建边 / 批量改接）——隐藏样式下仍显示，便于对准端口
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

  // 5) 正在 Cook (running) 节点四周的持续升腾熔炉星火粒子（若已交由顶层 vfxCanvas 渲染则跳过）
  if (
    !reduceEffects &&
    !opts.skipOverlayVfx &&
    opts.cookingNodeRects &&
    opts.cookingNodeRects.length > 0 &&
    viewport
  ) {
    drawCookingNodeEmbers(ctx, opts.cookingNodeRects, viewport, nowMs, colors)
  }

  // 6) SLG 战术冲击波 / 准星锁定 / 端口火花 / 出炉星芒（若已交由顶层 vfxCanvas 渲染则跳过）
  if (
    !reduceEffects &&
    !opts.skipOverlayVfx &&
    canvasBursts &&
    canvasBursts.length > 0 &&
    viewport
  ) {
    drawCanvasVfxBursts(ctx, canvasBursts, viewport, nowMs, dpr, colors)
  }
}
