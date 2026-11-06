/**
 * Machinations v2 独立完整矢量架构图 (SVG) 渲染与精确视觉边界计算引擎。
 *
 * 设计目标：
 * 1. 完全不依赖 DOM `<svg>` 克隆、不依赖外部 `<style scoped>` 或 CSS 变量（避免独立 SVG / Canvas 转 PNG 时文字变黑隐身、胶囊变黑块、foreignObject 丢失）；
 * 2. 不受交互视口平移缩放 (`pan/zoom`)、视口剔除 (`frustum culling`) 或低倍率 LOD 降级影响，完整导出所有可见图层的分组框、连线、公式胶囊、便签与全部图元细节；
 * 3. 精确计算所有可见图元（含中英文标题宽度、底部副标签胶囊、顶部角标、Note 宽高、Group 容器、二次贝塞尔弧线极值点）的真实视觉包围盒，统一留白并将画面像素级居中对齐到 `[0, exportWidth] × [0, exportHeight]`。
 */
import {
  evaluateMxEdgeRuntimeGates,
  evaluateMxExpression,
  mxNodeColor,
  parseMxStateFormula,
  resolveMxParams,
  type MxDocument,
  type MxEdge,
  type MxEdgeRuntimeGateSnapshot,
  type MxGroup,
  type MxNode,
  type MxNodeKind,
  type MxPullMode
} from './machinationsV2'

export type MxDiagramThemeMode = 'dark' | 'light'

export interface MxDiagramBottleneckBadge {
  kind: 'blocked' | 'capped' | 'depleted' | 'starved'
  badge: string
}

export interface MxDiagramEdgeCumulativeFlow {
  total: number
  share: number
}

export interface MxDiagramBoundsOptions {
  padding?: number
  minWidth?: number
  minHeight?: number
  displayFlows?: Record<string, number> | null
  flowHeatmap?: boolean
  showNodeLabels?: boolean
  edgeCumulativeFlows?: Record<string, MxDiagramEdgeCumulativeFlow>
  nodeBottlenecks?: Record<string, MxDiagramBottleneckBadge>
}

export interface MxDiagramRenderOptions extends MxDiagramBoundsOptions {
  theme?: MxDiagramThemeMode
  showGrid?: boolean
  displayValues?: Record<string, number> | null
  playStep?: number
}

export interface MxDiagramBounds {
  /** 所有可见元素真实视觉左边界（世界坐标） */
  contentMinX: number
  /** 所有可见元素真实视觉上边界（世界坐标） */
  contentMinY: number
  /** 所有可见元素真实视觉右边界（世界坐标） */
  contentMaxX: number
  /** 所有可见元素真实视觉下边界（世界坐标） */
  contentMaxY: number
  /** 紧致视觉内容宽度 */
  contentWidth: number
  /** 紧致视觉内容高度 */
  contentHeight: number
  /** 导出画布总宽度（含对称留白与最小尺寸保底） */
  exportWidth: number
  /** 导出画布总高度（含对称留白与最小尺寸保底） */
  exportHeight: number
  /** 将世界坐标平移到导出画布正中心的 X 偏移量 */
  offsetX: number
  /** 将世界坐标平移到导出画布正中心的 Y 偏移量 */
  offsetY: number
  /** 四周基础安全留白 */
  padding: number
}

interface MxDiagramThemePalette {
  canvasBg: string
  gridDot: string
  nodeFill: string
  labelFg: string
  subBg: string
  subFg: string
  pillBg: string
  pillBorder: string
  pillFg: string
  noteBg: string
  noteBorder: string
}

const DARK_PALETTE: MxDiagramThemePalette = {
  canvasBg: '#13161c',
  gridDot: 'rgba(148, 163, 184, 0.18)',
  nodeFill: '#1e232d',
  labelFg: '#e2e8f0',
  subBg: '#262c38',
  subFg: '#94a3b8',
  pillBg: '#1e232d',
  pillBorder: '#334155',
  pillFg: '#e2e8f0',
  noteBg: '#332e1d',
  noteBorder: '#eab308'
}

const LIGHT_PALETTE: MxDiagramThemePalette = {
  canvasBg: '#f8f9fb',
  gridDot: '#cbd5e1',
  nodeFill: '#ffffff',
  labelFg: '#1e293b',
  subBg: '#e2e8f0',
  subFg: '#475569',
  pillBg: '#ffffff',
  pillBorder: '#cbd5e1',
  pillFg: '#334155',
  noteBg: '#fef9c3',
  noteBorder: '#eab308'
}

const SVG_FONT_SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', sans-serif"
const SVG_FONT_MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Microsoft YaHei', monospace"

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * 估算中英文混排 SVG 文本的真实像素宽度（解决纯 `str.length * 6` 低估中文全角字符导致截断的问题）。
 */
export function estimateMxTextWidth(text: string, fontSize = 11, isMono = false): number {
  if (!text) return 0
  let width = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef) ||
      code >= 0x1f300
    ) {
      width += fontSize * 1.06
    } else if (!isMono && 'ilI1.,:;!| '.includes(ch)) {
      width += fontSize * 0.36
    } else if (!isMono && ch >= 'A' && ch <= 'Z') {
      width += fontSize * 0.68
    } else {
      width += fontSize * (isMono ? 0.62 : 0.58)
    }
  }
  return Math.ceil(width * 1.08)
}

function formatMxValue(v: number): string {
  if (Math.abs(v) >= 10000) return `${(v / 1000).toFixed(1)}k`
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

function pullModeBadge(pm?: MxPullMode): string {
  switch (pm) {
    case 'pull_all':
      return 'p&'
    case 'push_any':
      return 'ps'
    case 'push_all':
      return 'ps&'
    default:
      return ''
  }
}

export function getMxNodeSubLabel(node: MxNode): string {
  if (node.kind === 'pool' && node.capacity && node.capacity > 0) return `max ${node.capacity}`
  if (node.kind === 'register' && node.formula)
    return node.formula.length > 18 ? `${node.formula.slice(0, 17)}…` : node.formula
  if (node.kind === 'gate' && node.formula?.trim()) {
    const f = node.formula.trim()
    return f.length > 18 ? `${f.slice(0, 17)}…` : f
  }
  if ((node.kind === 'delay' || node.kind === 'queue') && node.delaySteps)
    return `${node.delaySteps} steps`
  if (node.kind === 'end' && node.formula) return node.formula
  return ''
}

export function getMxNodeSubPillWidth(node: MxNode): number {
  const sub = getMxNodeSubLabel(node)
  if (!sub) return 0
  return Math.max(30, estimateMxTextWidth(sub, 9, true) + 14)
}

function nodeRadius(node: MxNode): number {
  return node.kind === 'note' ? Math.max(node.width ?? 160, node.height ?? 80) / 2 : 21
}

function shapePath(kind: MxNodeKind, r: number): string {
  switch (kind) {
    case 'pool':
      return `M ${-r},0 a ${r},${r} 0 1,0 ${r * 2},0 a ${r},${r} 0 1,0 ${-r * 2},0`
    case 'source':
      return `M 0,${-r} L ${r},${r * 0.8} L ${-r},${r * 0.8} Z`
    case 'drain':
      return `M ${-r},${-r * 0.8} L ${r},${-r * 0.8} L 0,${r} Z`
    case 'gate':
      return `M 0,${-r} L ${r},0 L 0,${r} L ${-r},0 Z`
    case 'converter':
      return `M ${-r * 0.82},${-r} L ${r * 0.88},0 L ${-r * 0.82},${r} Z`
    case 'trader':
      return `M ${-r},${-r * 0.72} L 0,0 L ${-r},${r * 0.72} Z M ${r},${-r * 0.72} L 0,0 L ${r},${r * 0.72} Z`
    case 'register':
    case 'end':
      return `M ${-r * 0.85},${-r * 0.85} H ${r * 0.85} V ${r * 0.85} H ${-r * 0.85} Z`
    case 'delay':
      return `M ${-r},0 a ${r},${r} 0 1,0 ${r * 2},0 a ${r},${r} 0 1,0 ${-r * 2},0 M 0,${-r * 0.6} V 0 H ${r * 0.5}`
    case 'queue':
      return `M ${-r},0 a ${r},${r} 0 1,0 ${r * 2},0 a ${r},${r} 0 1,0 ${-r * 2},0 M ${-r * 0.5},${-r * 0.3} H ${r * 0.5} M ${-r * 0.5},${r * 0.3} H ${r * 0.5}`
    case 'note':
      return `M ${-r},${-r} H ${r * 0.5} L ${r},${-r * 0.5} V ${r} H ${-r} Z`
  }
}

function tokenDots(count: number): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = []
  if (count <= 0) return pts
  const cols = Math.min(4, Math.ceil(Math.sqrt(count)))
  const rows = Math.ceil(count / cols)
  const sp = 5.2
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / cols)
    const c = i % cols
    pts.push({
      x: round2((c - (cols - 1) / 2) * sp),
      y: round2((r - (rows - 1) / 2) * sp)
    })
  }
  return pts
}

function poolLiquidPath(node: MxNode, val: number): string {
  const safeVal = Math.max(0, val)
  if (safeVal <= 0) return ''
  const maxRef = node.capacity && node.capacity > 0 ? node.capacity : Math.max(20, safeVal * 1.5)
  const fillRatio = Math.max(0.14, Math.min(0.88, safeVal / maxRef))
  const r = 16.5
  const yLevel = r - fillRatio * (2 * r)
  const halfChord = Math.sqrt(Math.max(0, r * r - yLevel * yLevel))
  const largeArc = fillRatio > 0.5 ? 1 : 0
  return `M ${round2(-halfChord)},${round2(yLevel)} A ${r},${r} 0 ${largeArc},0 ${round2(halfChord)},${round2(yLevel)} Z`
}

function parseHexRgb(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, '').trim()
  if (clean.length === 3) {
    return [
      parseInt(clean[0]! + clean[0]!, 16) || 0,
      parseInt(clean[1]! + clean[1]!, 16) || 0,
      parseInt(clean[2]! + clean[2]!, 16) || 0
    ]
  }
  if (clean.length >= 6) {
    return [
      parseInt(clean.slice(0, 2), 16) || 0,
      parseInt(clean.slice(2, 4), 16) || 0,
      parseInt(clean.slice(4, 6), 16) || 0
    ]
  }
  return [59, 130, 246]
}

function mixHexColor(hexA: string, hexB: string, weightA: number): string {
  const w = Math.max(0, Math.min(1, weightA))
  const [r1, g1, b1] = parseHexRgb(hexA)
  const [r2, g2, b2] = parseHexRgb(hexB)
  const toHex = (v: number): string =>
    Math.round(Math.max(0, Math.min(255, v)))
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(r1 * w + r2 * (1 - w))}${toHex(g1 * w + g2 * (1 - w))}${toHex(b1 * w + b2 * (1 - w))}`
}

function expEdgeMarkerId(colorHex: string): string {
  return `mx-exp-arr-${colorHex.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}`
}

function splitExportIntervalFormula(
  kind: MxEdge['kind'],
  formulaText: string,
  formulaModified: boolean
): { rateText: string; intervalText: string } {
  if (kind !== 'resource') {
    return { rateText: formulaText, intervalText: '' }
  }
  const m = /^(.*?)\s*(?:\||(?:\bevery\b))\s*(.+)$/i.exec(formulaText)
  if (!m) {
    return { rateText: formulaText, intervalText: '' }
  }
  const rateText = m[1]!.trim() || '1'
  const ivText = m[2]!.trim()
  if (!ivText || (ivText === '1' && !formulaModified)) {
    return { rateText, intervalText: '' }
  }
  return { rateText, intervalText: ivText }
}

interface DiagramEdgeGeo {
  edge: MxEdge
  path: string
  sx: number
  sy: number
  cx: number
  cy: number
  ex: number
  ey: number
  curved: boolean
  mid: { x: number; y: number }
  color: string
  marker: string
  label: string
  caption: string
  rateText: string
  intervalText: string
  dividerX: number
  leftTextX: number
  rightTextX: number
  hourglassX: number
  labelW: number
  formulaModified: boolean
}

function collectVisibleElements(doc: MxDocument): {
  visibleGroups: MxGroup[]
  visibleNodes: MxNode[]
  visibleIds: Set<string>
  nodeById: Map<string, MxNode>
} {
  const layerMap = new Map((doc.layers ?? []).map((l) => [l.id, l]))
  const visibleGroups = (doc.groups ?? []).filter((g) => {
    const layer = g.layerId ? layerMap.get(g.layerId) : undefined
    return !layer || layer.visible
  })
  const visibleNodes = doc.nodes.filter((n) => {
    const layer = n.layerId ? layerMap.get(n.layerId) : undefined
    return !layer || layer.visible
  })
  const visibleIds = new Set(visibleNodes.map((n) => n.id))
  const nodeById = new Map(doc.nodes.map((n) => [n.id, n]))
  return { visibleGroups, visibleNodes, visibleIds, nodeById }
}

function buildExportEdgeGeometries(
  doc: MxDocument,
  visibleIds: Set<string>,
  nodeById: Map<string, MxNode>,
  gateSnap?: MxEdgeRuntimeGateSnapshot | null,
  playStep = 0
): DiagramEdgeGeo[] {
  const out: DiagramEdgeGeo[] = []
  const midByEdgeId = new Map<string, { x: number; y: number; labelW: number }>()
  const pairs = new Set(doc.edges.filter((e) => !e.targetEdgeId).map((e) => `${e.from}>${e.to}`))
  const resColorMap = new Map(doc.resources.map((r) => [r.id, r.color]))
  const convColorById = new Map<string, string>()
  for (const e of doc.edges) {
    if (e.kind === 'resource' && !convColorById.has(e.from)) {
      const tgt = nodeById.get(e.to)
      if (tgt) convColorById.set(e.from, mxNodeColor(doc, tgt))
    }
  }

  const firstPass = doc.edges.filter((e) => !e.targetEdgeId)
  let remainingEdgeTargets = doc.edges.filter((e) => !!e.targetEdgeId)
  const resolvedIds = new Set(firstPass.map((e) => e.id))
  const orderedEdges: MxEdge[] = [...firstPass]
  for (let pass = 0; pass < 5 && remainingEdgeTargets.length > 0; pass++) {
    const nextRem: MxEdge[] = []
    let progressed = false
    for (const e of remainingEdgeTargets) {
      if (e.targetEdgeId && resolvedIds.has(e.targetEdgeId)) {
        orderedEdges.push(e)
        resolvedIds.add(e.id)
        progressed = true
      } else {
        nextRem.push(e)
      }
    }
    remainingEdgeTargets = nextRem
    if (!progressed) break
  }

  for (const e of orderedEdges) {
    if (!visibleIds.has(e.from)) continue
    const a = nodeById.get(e.from)
    if (!a) continue

    let bx = 0
    let by = 0
    let rb = 10
    let targetPillW = 0
    if (e.targetEdgeId) {
      const targetMid = midByEdgeId.get(e.targetEdgeId)
      if (!targetMid) continue
      bx = targetMid.x
      by = targetMid.y
      targetPillW = targetMid.labelW
    } else {
      if (!visibleIds.has(e.to)) continue
      const b = nodeById.get(e.to)
      if (!b) continue
      bx = b.x
      by = b.y
      rb = nodeRadius(b) + 6
    }

    const dx = bx - a.x
    const dy = by - a.y
    const len = Math.max(1, Math.hypot(dx, dy))
    const ux = dx / len
    const uy = dy / len
    const reverse = !e.targetEdgeId && pairs.has(`${e.to}>${e.from}`)
    const defaultBend = reverse ? 28 : e.kind === 'state' ? Math.min(44, len * 0.12) : 0
    const bend = e.bend !== undefined ? e.bend : defaultBend
    const nx = -uy
    const ny = ux
    const ra = nodeRadius(a) + 2
    const sx = a.x + ux * ra
    const sy = a.y + uy * ra

    let ex = bx - ux * rb
    let ey = by - uy * rb
    let cx = (sx + ex) / 2 + nx * bend
    let cy = (sy + ey) / 2 + ny * bend

    if (e.targetEdgeId && targetPillW > 0) {
      const approxCx = (sx + bx) / 2 + nx * bend
      const approxCy = (sy + by) / 2 + ny * bend
      const tdx = bx - approxCx
      const tdy = by - approxCy
      const tlen = Math.max(1, Math.hypot(tdx, tdy))
      const tux = tdx / tlen
      const tuy = tdy / tlen
      const hw = targetPillW / 2 + 5
      const hh = 13.5
      const pillDist = Math.min(
        len * 0.45,
        hw / Math.max(1e-4, Math.abs(tux)),
        hh / Math.max(1e-4, Math.abs(tuy))
      )
      ex = bx - tux * pillDist
      ey = by - tuy * pillDist
      cx = approxCx
      cy = approxCy
    }

    const curved = Math.abs(bend) > 0.5
    const path = curved
      ? `M ${round2(sx)},${round2(sy)} Q ${round2(cx)},${round2(cy)} ${round2(ex)},${round2(ey)}`
      : `M ${round2(sx)},${round2(sy)} L ${round2(ex)},${round2(ey)}`
    const mid = curved
      ? { x: (sx + 2 * cx + ex) / 4, y: (sy + 2 * cy + ey) / 4 }
      : { x: (sx + ex) / 2, y: (sy + ey) / 2 }

    const filterColor = e.resourceFilter && e.resourceId ? resColorMap.get(e.resourceId) : undefined
    const srcColor =
      a.kind === 'converter'
        ? (convColorById.get(a.id) ?? mxNodeColor(doc, a))
        : mxNodeColor(doc, a)
    const color = e.color || filterColor || srcColor
    const marker = expEdgeMarkerId(color)

    const rawFormula = e.formula || (e.kind === 'state' ? '*' : '1')
    const authoredWithIv =
      e.kind === 'resource' &&
      e.interval?.trim() &&
      e.interval.trim() !== '1' &&
      !/\bevery\b|\|/i.test(rawFormula)
        ? `${rawFormula}|${e.interval.trim()}`
        : rawFormula
    const runtimeModFormula = playStep > 0 ? gateSnap?.modifiedEdgeFormulas.get(e.id) : undefined
    const formulaModified = runtimeModFormula !== undefined
    const effectiveFormula = runtimeModFormula ?? authoredWithIv
    const { rateText: splitRate, intervalText } = splitExportIntervalFormula(
      e.kind,
      effectiveFormula,
      formulaModified
    )
    const rateText = e.influencer ? `★ ${splitRate}` : splitRate
    const caption = e.label?.trim() || ''

    let labelW = 24
    let dividerX = 0
    let leftTextX = 0
    let rightTextX = 0
    let hourglassX = 0
    if (intervalText) {
      const leftW = Math.max(24, estimateMxTextWidth(rateText, 10.8, true) + 13)
      const ivTextW = estimateMxTextWidth(intervalText, 10.2, true)
      const rightContentW = ivTextW + 9.5
      const rightW = Math.max(28, rightContentW + 12)
      labelW = leftW + rightW
      dividerX = -labelW / 2 + leftW
      leftTextX = -labelW / 2 + leftW / 2
      const rightStart = dividerX + (rightW - rightContentW) / 2
      rightTextX = rightStart + ivTextW / 2
      hourglassX = rightStart + ivTextW + 6.5
    } else {
      labelW = Math.max(24, estimateMxTextWidth(rateText, 10.8, true) + 14)
    }
    midByEdgeId.set(e.id, { x: mid.x, y: mid.y, labelW })

    out.push({
      edge: e,
      path,
      sx,
      sy,
      cx,
      cy,
      ex,
      ey,
      curved,
      mid,
      color,
      marker,
      label: effectiveFormula,
      caption,
      rateText,
      intervalText,
      dividerX,
      leftTextX,
      rightTextX,
      hourglassX,
      labelW,
      formulaModified
    })
  }
  return out
}

function expandQuadBezierBounds(
  sx: number,
  sy: number,
  cx: number,
  cy: number,
  ex: number,
  ey: number,
  curved: boolean,
  expand: (x: number, y: number) => void
): void {
  expand(sx, sy)
  expand(ex, ey)
  if (!curved) return
  const denomX = sx - 2 * cx + ex
  if (Math.abs(denomX) > 1e-6) {
    const tx = (sx - cx) / denomX
    if (tx > 0 && tx < 1) {
      const u = 1 - tx
      expand(u * u * sx + 2 * u * tx * cx + tx * tx * ex, sy)
    }
  }
  const denomY = sy - 2 * cy + ey
  if (Math.abs(denomY) > 1e-6) {
    const ty = (sy - cy) / denomY
    if (ty > 0 && ty < 1) {
      const u = 1 - ty
      expand(sx, u * u * sy + 2 * u * ty * cy + ty * ty * ey)
    }
  }
}

/**
 * 计算 Machinations 架构图所有可见图元（分组框、节点图形与底部中英文标题/副标签、便签、弧线连线与公式胶囊）的精确视觉包围盒与居中偏移量。
 */
export function computeMxDiagramBounds(
  doc: MxDocument,
  options: MxDiagramBoundsOptions = {}
): MxDiagramBounds {
  const padding = options.padding ?? 52
  const minWidth = options.minWidth ?? 560
  const minHeight = options.minHeight ?? 360
  const showNodeLabels = options.showNodeLabels ?? true

  const { visibleGroups, visibleNodes, visibleIds, nodeById } = collectVisibleElements(doc)
  const edges = buildExportEdgeGeometries(doc, visibleIds, nodeById)

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  const expand = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  for (const grp of visibleGroups) {
    expand(grp.x - 4, grp.y - 4)
    expand(grp.x + grp.width + 4, grp.y + grp.height + 4)
    const hdrLabelRight = grp.x + 16 + estimateMxTextWidth(grp.label || '', 11.5, false)
    expand(hdrLabelRight, grp.y + 26)
  }

  for (const node of visibleNodes) {
    if (node.kind === 'note') {
      const halfW = (node.width ?? 160) / 2 + 4
      const halfH = (node.height ?? 80) / 2 + 4
      expand(node.x - halfW, node.y - halfH)
      expand(node.x + halfW, node.y + halfH)
      continue
    }

    const labelHalfW = showNodeLabels ? estimateMxTextWidth(node.label || '', 11, false) / 2 + 8 : 0
    const subHalfW = getMxNodeSubPillWidth(node) / 2 + 6
    const hasBottleneck = Boolean(options.nodeBottlenecks?.[node.id])
    const leftExtent = Math.max(30, hasBottleneck ? 42 : 0, labelHalfW, subHalfW)
    const rightExtent = Math.max(30, labelHalfW, subHalfW)
    const topExtent = hasBottleneck ? 32 : 28
    const hasSub = Boolean(getMxNodeSubLabel(node))
    const bottomExtent = showNodeLabels ? (hasSub ? 58 : 42) : hasSub ? 45 : 28

    expand(node.x - leftExtent, node.y - topExtent)
    expand(node.x + rightExtent, node.y + bottomExtent)
  }

  for (const geo of edges) {
    expandQuadBezierBounds(geo.sx, geo.sy, geo.cx, geo.cy, geo.ex, geo.ey, geo.curved, expand)
    const hasCumSum =
      Boolean(options.flowHeatmap) &&
      geo.edge.kind === 'resource' &&
      (options.edgeCumulativeFlows?.[geo.edge.id]?.total ?? 0) > 0
    const capHalfW = geo.caption ? estimateMxTextWidth(geo.caption, 10, false) / 2 + 6 : 0
    const halfW = Math.max(geo.labelW / 2 + 4, capHalfW)
    expand(geo.mid.x - halfW, geo.mid.y - (geo.caption ? 25 : 13))
    expand(geo.mid.x + halfW, geo.mid.y + (hasCumSum ? 24 : 13))
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    minX = 0
    minY = 0
    maxX = minWidth - padding * 2
    maxY = minHeight - padding * 2
  }

  const contentWidth = Math.max(1, maxX - minX)
  const contentHeight = Math.max(1, maxY - minY)
  const exportWidth = Math.ceil(Math.max(minWidth, contentWidth + padding * 2))
  const exportHeight = Math.ceil(Math.max(minHeight, contentHeight + padding * 2))
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const offsetX = exportWidth / 2 - centerX
  const offsetY = exportHeight / 2 - centerY

  return {
    contentMinX: round2(minX),
    contentMinY: round2(minY),
    contentMaxX: round2(maxX),
    contentMaxY: round2(maxY),
    contentWidth: round2(contentWidth),
    contentHeight: round2(contentHeight),
    exportWidth,
    exportHeight,
    offsetX: round2(offsetX),
    offsetY: round2(offsetY),
    padding
  }
}

/**
 * 将长便签文本按像素宽度自动折行为多行纯 SVG `<tspan>`，彻底规避 `<foreignObject>` 在独立 SVG 与 Canvas 转 PNG 中的兼容性缺陷。
 */
function wrapNoteTextLines(rawText: string, maxWidthPx: number, maxLines: number): string[] {
  const paragraphs = rawText.replace(/\r\n/g, '\n').split('\n')
  const lines: string[] = []
  const safeMaxW = Math.max(48, maxWidthPx)

  for (const para of paragraphs) {
    if (!para.trim()) {
      lines.push('')
      if (lines.length >= maxLines) break
      continue
    }
    let current = ''
    let currentW = 0
    for (const ch of para) {
      const chW = estimateMxTextWidth(ch, 11, false) / 1.08
      if (current && currentW + chW > safeMaxW) {
        lines.push(current)
        if (lines.length >= maxLines) break
        current = ch
        currentW = chW
      } else {
        current += ch
        currentW += chW
      }
    }
    if (lines.length >= maxLines) break
    if (current) lines.push(current)
    if (lines.length >= maxLines) break
  }

  return lines.slice(0, maxLines)
}

function isDormantStateCondition(
  doc: MxDocument,
  edge: MxEdge,
  nodeById: Map<string, MxNode>,
  resolvedParams: Record<string, number>,
  displayValues?: Record<string, number> | null,
  playStep = 0
): boolean {
  const spec = parseMxStateFormula(edge.formula)
  const srcNode = nodeById.get(edge.from)
  const srcVal =
    displayValues?.[edge.from] ??
    (srcNode?.kind === 'pool' || srcNode?.kind === 'register' ? (srcNode.initial ?? 0) : 0)

  switch (spec.type) {
    case 'activator':
      switch (spec.op) {
        case '>':
          return !(srcVal > spec.value)
        case '<':
          return !(srcVal < spec.value)
        case '>=':
          return !(srcVal >= spec.value)
        case '<=':
          return !(srcVal <= spec.value)
        case '==':
          return !(Math.abs(srcVal - spec.value) < 1e-9)
        case '!=':
          return !(Math.abs(srcVal - spec.value) >= 1e-9)
      }
      return false
    case 'range':
      return !(srcVal >= spec.lo && srcVal <= spec.hi)
    case 'expr': {
      if (!/[<>=!]/.test(spec.expr)) return false
      void doc
      return (
        evaluateMxExpression(
          spec.expr,
          {
            vars: {
              ...resolvedParams,
              ...(displayValues ?? {}),
              step: playStep,
              t: playStep,
              a: srcVal,
              self: srcVal
            },
            rng: () => 0.5
          },
          0
        ) === 0
      )
    }
    default:
      return false
  }
}

/**
 * 渲染独立完整、自动居中适配的 Machinations 矢量架构图 SVG。
 */
export function exportMxDiagramSvg(
  doc: MxDocument,
  options: MxDiagramRenderOptions = {}
): { svgText: string; width: number; height: number; bounds: MxDiagramBounds } {
  const themeMode: MxDiagramThemeMode = options.theme ?? 'dark'
  const palette = themeMode === 'light' ? LIGHT_PALETTE : DARK_PALETTE
  const showGrid = options.showGrid ?? true
  const showNodeLabels = options.showNodeLabels ?? true

  const bounds = computeMxDiagramBounds(doc, options)
  const { exportWidth: width, exportHeight: height, offsetX, offsetY } = bounds
  const { visibleGroups, visibleNodes, visibleIds, nodeById } = collectVisibleElements(doc)
  const resolvedParams = resolveMxParams(doc)
  const gateSnap = evaluateMxEdgeRuntimeGates(doc, {
    values: options.displayValues,
    step: options.playStep ?? 0,
    params: resolvedParams
  })
  const edges = buildExportEdgeGeometries(
    doc,
    visibleIds,
    nodeById,
    gateSnap,
    options.playStep ?? 0
  )

  const converterColorById = new Map<string, string>()
  const condGateOutRe = /^(?:>=|<=|==|!=|<>|>|<|=|-?\d+(?:\.\d+)?\s*\.\.\s*-?\d+(?:\.\d+)?$)/
  const conditionalGateIds = new Set<string>()
  for (const n of doc.nodes) {
    if (n.kind === 'gate' && n.formula?.trim()) conditionalGateIds.add(n.id)
  }
  for (const e of doc.edges) {
    if (e.kind === 'resource' && !converterColorById.has(e.from)) {
      const tgt = nodeById.get(e.to)
      if (tgt) converterColorById.set(e.from, mxNodeColor(doc, tgt))
    }
    const s = e.formula.replace(/\s*(?:\||every\b).*$/i, '').trim()
    if (condGateOutRe.test(s)) conditionalGateIds.add(e.from)
  }

  const controllingAgentByNodeId = new Map<string, { id: string; name: string; color?: string }>()
  const activeAgents = (doc.agents ?? []).filter((a) => a.enabled)
  if (activeAgents.length > 0) {
    const interactiveIds = doc.nodes.filter((n) => n.trigger === 'interactive').map((n) => n.id)
    for (const ag of activeAgents) {
      const targets = ag.controlledNodeIds.length ? ag.controlledNodeIds : interactiveIds
      for (const nid of targets) {
        if (!controllingAgentByNodeId.has(nid)) {
          controllingAgentByNodeId.set(nid, { id: ag.id, name: ag.name, color: ag.color })
        }
      }
    }
  }

  const getNodeVal = (node: MxNode): number => {
    if (options.displayValues && node.id in options.displayValues) {
      return options.displayValues[node.id] ?? 0
    }
    if (node.kind === 'pool' || node.kind === 'register') {
      return node.initial ?? 0
    }
    return 0
  }

  const gridPhaseX = round2(((offsetX % 20) + 20) % 20)
  const gridPhaseY = round2(((offsetY % 20) + 20) % 20)

  const out: string[] = []
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${escapeXml(SVG_FONT_SANS)}">`
  )
  out.push('  <defs>')
  if (showGrid) {
    out.push(
      `    <pattern id="mx-exp-grid" width="20" height="20" patternUnits="userSpaceOnUse" x="${gridPhaseX}" y="${gridPhaseY}">`,
      `      <circle cx="1.2" cy="1.2" r="1.15" fill="${palette.gridDot}" />`,
      '    </pattern>'
    )
  }
  const uniqueEdgeMarkers = new Map<string, string>()
  for (const geo of edges) {
    if (!uniqueEdgeMarkers.has(geo.marker)) {
      uniqueEdgeMarkers.set(geo.marker, geo.color)
    }
  }
  for (const [mId, mColor] of uniqueEdgeMarkers.entries()) {
    out.push(
      `    <marker id="${escapeXml(mId)}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">`,
      `      <path d="M0,1.2 L10,5 L0,8.8 z" fill="${escapeXml(mColor)}" />`,
      '    </marker>'
    )
  }

  visibleNodes.forEach((node, idx) => {
    if (node.kind === 'note') {
      const nw = node.width ?? 160
      const nh = node.height ?? 80
      out.push(
        `    <clipPath id="mx-note-clip-${idx}">`,
        `      <rect x="${round2(-nw / 2 + 6)}" y="${round2(-nh / 2 + 4)}" width="${round2(Math.max(16, nw - 12))}" height="${round2(Math.max(16, nh - 8))}" rx="4" />`,
        '    </clipPath>'
      )
    }
  })
  out.push('  </defs>')

  // 1. 画布背景与对齐点阵网格
  out.push(`  <rect x="0" y="0" width="${width}" height="${height}" fill="${palette.canvasBg}" />`)
  if (showGrid) {
    out.push(`  <rect x="0" y="0" width="${width}" height="${height}" fill="url(#mx-exp-grid)" />`)
  }

  // 2. 居中世界坐标容器
  out.push(`  <g class="mx-world" transform="translate(${offsetX}, ${offsetY})">`)

  // 2.1 子系统分组框 (Groups)
  for (const grp of visibleGroups) {
    const gColor = grp.color || '#3b82f6'
    out.push(`    <g class="mx-group" transform="translate(${round2(grp.x)}, ${round2(grp.y)})">`)
    out.push(
      `      <rect x="0" y="0" width="${round2(grp.width)}" height="${round2(grp.height)}" rx="10" fill="${escapeXml(gColor)}" fill-opacity="0.08" stroke="${escapeXml(gColor)}" stroke-width="1.5" stroke-dasharray="6 4" />`,
      `      <rect x="0" y="0" width="${round2(grp.width)}" height="26" rx="10" fill="${palette.nodeFill}" />`,
      `      <rect x="0" y="0" width="${round2(grp.width)}" height="26" rx="10" fill="${escapeXml(gColor)}" fill-opacity="0.22" />`,
      `      <text x="12" y="17" fill="${palette.labelFg}" font-size="11.5" font-weight="700">${escapeXml(grp.label)}</text>`
    )
    out.push('    </g>')
  }

  // 2.2 连线与公式胶囊 (Edges)
  for (const geo of edges) {
    const cumFlow = options.edgeCumulativeFlows?.[geo.edge.id]
    const activeFlow = options.displayFlows?.[geo.edge.id] ?? 0
    const gatedOffRes =
      geo.edge.kind === 'resource' &&
      (options.playStep ?? 0) > 0 &&
      activeFlow <= 0 &&
      gateSnap.gatedOffEdgeIds.has(geo.edge.id)
    const dormant =
      gatedOffRes ||
      (geo.edge.kind === 'state' &&
        (gateSnap.dormantStateEdgeIds.has(geo.edge.id) ||
          isDormantStateCondition(
            doc,
            geo.edge,
            nodeById,
            resolvedParams,
            options.displayValues,
            options.playStep ?? 0
          )))
    const strokeOpacity = dormant ? 0.36 : 1
    const dashAttr =
      geo.edge.kind === 'state'
        ? ' stroke-dasharray="6 4"'
        : gatedOffRes
          ? ' stroke-dasharray="5 4"'
          : ''
    const strokeWidth =
      options.flowHeatmap && geo.edge.kind === 'resource' && (cumFlow?.total ?? 0) > 0
        ? round2(1.8 + (cumFlow?.share ?? 0) * 3.5)
        : activeFlow > 0
          ? 2.3
          : 1.75

    out.push(`    <g class="mx-edge" data-edge-id="${escapeXml(geo.edge.id)}">`)
    if (options.flowHeatmap && geo.edge.kind === 'resource' && (cumFlow?.total ?? 0) > 0) {
      out.push(
        `      <path d="${geo.path}" fill="none" stroke="${escapeXml(geo.color)}" stroke-width="${round2(3 + (cumFlow?.share ?? 0) * 10)}" stroke-opacity="0.26" stroke-linecap="round" />`
      )
    }
    out.push(
      `      <path d="${geo.path}" fill="none" stroke="${escapeXml(geo.color)}" stroke-opacity="${strokeOpacity}" stroke-width="${strokeWidth}"${dashAttr} marker-end="url(#${geo.marker})" />`
    )

    const pillBg =
      themeMode === 'light'
        ? mixHexColor(geo.color, '#ffffff', geo.formulaModified ? 0.18 : 0.09)
        : mixHexColor(geo.color, palette.canvasBg, geo.formulaModified ? 0.26 : 0.15)
    const pillBorder = geo.color
    const pillTextFg =
      themeMode === 'light'
        ? mixHexColor(geo.color, '#0f172a', geo.formulaModified ? 0.94 : 0.86)
        : mixHexColor(geo.color, '#ffffff', geo.formulaModified ? 0.62 : 0.78)
    const pillStrokeW = geo.formulaModified ? '1.65' : '1.3'
    const pillFontW = geo.formulaModified ? '700' : '600'
    const pillOpacityAttr = dormant ? ' opacity="0.45"' : ''
    const pillDashAttr = gatedOffRes ? ' stroke-dasharray="3 2"' : ''
    out.push(
      `      <g class="mx-edge-pill"${pillOpacityAttr} transform="translate(${round2(geo.mid.x)}, ${round2(geo.mid.y)})">`
    )
    if (geo.caption) {
      out.push(
        `        <text text-anchor="middle" y="-13.5" fill="${pillTextFg}" font-size="10" font-weight="600">${escapeXml(geo.caption)}</text>`
      )
    }
    out.push(
      `        <rect x="${round2(-geo.labelW / 2)}" y="-9.25" width="${round2(geo.labelW)}" height="18.5" rx="9.25" fill="${pillBg}" stroke="${escapeXml(pillBorder)}" stroke-width="${pillStrokeW}"${pillDashAttr} />`
    )
    if (geo.intervalText) {
      out.push(
        `        <line x1="${round2(geo.dividerX)}" y1="-9" x2="${round2(geo.dividerX)}" y2="9" stroke="${escapeXml(pillBorder)}" stroke-width="1.15" />`,
        `        <text text-anchor="middle" x="${round2(geo.leftTextX)}" y="3.8" fill="${pillTextFg}" font-size="10.8" font-weight="${pillFontW}">${escapeXml(geo.rateText)}</text>`,
        `        <text text-anchor="middle" x="${round2(geo.rightTextX)}" y="3.7" fill="${pillTextFg}" font-size="10.2" font-weight="${pillFontW}">${escapeXml(geo.intervalText)}</text>`,
        `        <g transform="translate(${round2(geo.hourglassX)}, 0)">`,
        `          <path d="M-2.4,-3.6 H2.4 L0.4,0 L2.4,3.6 H-2.4 L-0.4,0 Z" fill="none" stroke="${pillTextFg}" stroke-width="1.1" stroke-linejoin="round" />`,
        `          <path d="M-1.45,3.05 H1.45 L0,0.95 Z" fill="${pillTextFg}" />`,
        '        </g>'
      )
    } else {
      out.push(
        `        <text text-anchor="middle" y="3.8" fill="${pillTextFg}" font-size="10.8" font-weight="${pillFontW}">${escapeXml(geo.rateText)}</text>`
      )
    }
    if (options.flowHeatmap && geo.edge.kind === 'resource' && (cumFlow?.total ?? 0) > 0) {
      out.push(
        `        <text text-anchor="middle" y="19" fill="${escapeXml(geo.color)}" font-size="9" font-weight="700">∑ ${escapeXml(String(cumFlow?.total ?? 0))}</text>`
      )
    }
    out.push('      </g>')
    out.push('    </g>')
  }

  // 2.3 节点图元、数值、角标与主副标题 (Nodes)
  visibleNodes.forEach((node, idx) => {
    out.push(
      `    <g class="mx-node" data-node-id="${escapeXml(node.id)}" transform="translate(${round2(node.x)}, ${round2(node.y)})">`
    )

    if (node.kind === 'note') {
      const nw = node.width ?? 160
      const nh = node.height ?? 80
      const maxLines = Math.max(1, Math.floor((nh - 14) / 15))
      const wrappedLines = wrapNoteTextLines(node.text || node.label || '', nw - 20, maxLines)
      out.push(
        `      <rect x="${round2(-nw / 2)}" y="${round2(-nh / 2)}" width="${round2(nw)}" height="${round2(nh)}" rx="6" fill="${palette.noteBg}" stroke="${palette.noteBorder}" stroke-width="1.4" />`,
        `      <g clip-path="url(#mx-note-clip-${idx})">`
      )
      const startY = round2(-nh / 2 + 18)
      wrappedLines.forEach((ln, lineIdx) => {
        if (!ln) return
        out.push(
          `        <text x="${round2(-nw / 2 + 10)}" y="${round2(startY + lineIdx * 15)}" fill="${palette.labelFg}" font-size="11">${escapeXml(ln)}</text>`
        )
      })
      out.push('      </g>')
      out.push('    </g>')
      return
    }

    const color = mxNodeColor(doc, node)
    const filled = node.kind === 'register' || node.kind === 'end'
    const val = getNodeVal(node)

    // Pool 容量进度环
    if (node.kind === 'pool' && node.capacity && node.capacity > 0) {
      const arcLen = round2(Math.min(1, Math.max(0, val / node.capacity)) * 141.37)
      out.push(
        '      <circle r="22.5" fill="none" stroke="rgba(148, 163, 184, 0.22)" stroke-width="2.5" />',
        `      <circle r="22.5" fill="none" stroke="${escapeXml(color)}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${arcLen} 141.37" transform="rotate(-90)" />`
      )
    }

    // Interactive 双层外圈
    if (node.trigger === 'interactive') {
      out.push(
        `      <path d="${shapePath(node.kind, 23)}" fill="none" stroke="${escapeXml(color)}" stroke-width="1.35" />`
      )
    }

    // 主体几何图形
    out.push(
      `      <path d="${shapePath(node.kind, 18)}" fill="${filled ? escapeXml(color) : palette.nodeFill}" stroke="${escapeXml(color)}" stroke-width="2.3" />`
    )

    // Pool 内部液面填充与微缩资源球
    if (node.kind === 'pool' && val > 0) {
      const liq = poolLiquidPath(node, val)
      if (liq) {
        out.push(`      <path d="${liq}" fill="${escapeXml(color)}" fill-opacity="0.18" />`)
      }
      const dots = tokenDots(Math.min(12, Math.floor(val)))
      const dotR = node.showAs === 'tokens' || node.showAs === 'both' ? 2.3 : 1.75
      const dotOpacity = node.showAs === 'tokens' || node.showAs === 'both' ? 0.95 : 0.55
      for (const pt of dots) {
        const cy = round2(node.showAs === 'tokens' ? pt.y : pt.y * 0.55 + 8.5)
        out.push(
          `      <circle cx="${pt.x}" cy="${cy}" r="${dotR}" fill="${escapeXml(color)}" fill-opacity="${dotOpacity}" />`
        )
      }
    }

    // Converter 右侧输出资源色条
    if (node.kind === 'converter') {
      const outColor = converterColorById.get(node.id) ?? color
      out.push(
        `      <line x1="18" y1="-16" x2="18" y2="16" stroke="${escapeXml(outColor)}" stroke-width="3.4" stroke-linecap="round" />`
      )
    }

    // 中心数值或符号
    if (
      (node.kind === 'pool' && node.showAs !== 'tokens') ||
      node.kind === 'register' ||
      node.kind === 'delay' ||
      node.kind === 'queue'
    ) {
      const valY = node.kind === 'pool' && node.showAs === 'both' ? -1 : 4
      out.push(
        `      <text text-anchor="middle" y="${valY}" fill="${filled ? '#ffffff' : escapeXml(color)}" font-size="11" font-weight="700">${escapeXml(formatMxValue(val))}</text>`
      )
    } else if (node.kind === 'gate') {
      const glyph =
        node.gateMode === 'skill'
          ? '🎯'
          : node.gateMode === 'deterministic'
            ? '⚖'
            : conditionalGateIds.has(node.id)
              ? '🎲'
              : '%'
      out.push(
        `      <text text-anchor="middle" y="3.5" fill="${escapeXml(color)}" font-size="11" font-weight="700">${glyph}</text>`
      )
    } else if (node.kind === 'end') {
      out.push(
        '      <text text-anchor="middle" y="3.5" fill="#ffffff" font-size="11" font-weight="700">■</text>'
      )
    }

    // Pull Mode 角标
    const pmBadge = pullModeBadge(node.pullMode)
    if (pmBadge) {
      out.push(
        `      <text x="-16" y="-13" fill="${escapeXml(color)}" font-family="${escapeXml(SVG_FONT_MONO)}" font-size="8.5" font-weight="700">${escapeXml(pmBadge)}</text>`
      )
    }

    // Trigger 角标 (* / e) 或 AI Agent 接管角标
    if (node.trigger === 'automatic') {
      out.push(
        `      <text x="15" y="-13" fill="${escapeXml(color)}" font-size="13" font-weight="800">*</text>`
      )
    } else if (node.trigger === 'enabling') {
      out.push(
        `      <text x="14" y="-13" fill="${escapeXml(color)}" font-size="13" font-weight="800">e</text>`
      )
    } else if (node.trigger === 'interactive' && controllingAgentByNodeId.has(node.id)) {
      const ag = controllingAgentByNodeId.get(node.id)!
      out.push(
        '      <g transform="translate(17, -17)">',
        `        <circle r="7.5" fill="${escapeXml(ag.color || '#4f46e5')}" stroke="${palette.nodeFill}" stroke-width="1.4" />`,
        '        <text text-anchor="middle" y="2.8" fill="#ffffff" font-size="8" font-weight="800">AI</text>',
        '      </g>'
      )
    }

    // 瓶颈告警徽标
    const bottleneck = options.nodeBottlenecks?.[node.id]
    if (bottleneck) {
      const bFill =
        bottleneck.kind === 'blocked'
          ? '#d97706'
          : bottleneck.kind === 'capped'
            ? '#db2777'
            : '#dc2626'
      out.push(
        '      <g transform="translate(-22, -20)">',
        `        <rect x="-17" y="-8" width="34" height="14" rx="7" fill="${bFill}" />`,
        `        <text text-anchor="middle" y="2.5" fill="#ffffff" font-size="8" font-weight="800">${escapeXml(bottleneck.badge)}</text>`,
        '      </g>'
      )
    }

    // 节点主标题（加细微画布背景描边光晕，防止与斜向连线重叠时字迹糊成一团）
    if (showNodeLabels) {
      out.push(
        `      <text text-anchor="middle" y="34" fill="${palette.labelFg}" stroke="${palette.canvasBg}" stroke-width="3.5" stroke-linejoin="round" paint-order="stroke" font-size="11" font-weight="600">${escapeXml(node.label)}</text>`
      )
    }

    // 节点副标签胶囊 (max capacity / formula / delay steps)
    const subLabel = getMxNodeSubLabel(node)
    if (subLabel) {
      const sw = getMxNodeSubPillWidth(node)
      const subY = showNodeLabels ? 47 : 34
      out.push(
        `      <g transform="translate(0, ${subY})">`,
        `        <rect x="${round2(-sw / 2)}" y="-7.5" width="${round2(sw)}" height="15" rx="7.5" fill="${palette.subBg}" stroke="${palette.pillBorder}" stroke-width="0.8" />`,
        `        <text text-anchor="middle" y="3" fill="${palette.subFg}" font-family="${escapeXml(SVG_FONT_MONO)}" font-size="9">${escapeXml(subLabel)}</text>`,
        '      </g>'
      )
    }

    out.push('    </g>')
  })

  out.push('  </g>')
  out.push('</svg>')

  return {
    svgText: out.join('\n'),
    width,
    height,
    bounds
  }
}
