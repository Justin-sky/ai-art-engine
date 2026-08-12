/**
 * 拖节点靠近时的自动连线（Houdini 风格）：
 * - 节点重合：高亮双方兼容的 in/out 端口
 * - 端口靠近：松手后自动连线（可预览）
 */
import { nodeCanReach, nodesShareUpstream } from './connectShortcut'
import { getNodePortCenter, getNodeSize } from './create'
import { canConnectNodes, getNodePorts } from './ports'
import type { GraphEdge, GraphNode } from './types'

/** 屏幕像素阈值；换算 world 时除以 zoom */
export const SNAP_CONNECT_THRESHOLD_SCREEN_PX = 36

export interface SnapConnectCandidate {
  sourceId: string
  targetId: string
  sourcePort: string
  targetPort: string
  dist: number
}

export interface ResolveSnapConnectOptions {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** 本次拖动的节点；只与集合外节点互连 */
  draggedNodeIds: string[]
  /** world 坐标下的端口距离阈值 */
  thresholdWorld: number
}

export interface SnapDragPreview {
  /** 重合节点上应高亮的兼容端口：`${nodeId}::${portId}` */
  highlightPortKeys: Set<string>
  /** 参与重合高亮的节点（含被拖节点与被叠节点） */
  highlightNodeIds: Set<string>
  /** 已达连线距离、松手将建立的边（供预览线 / 强调高亮） */
  connectCandidates: SnapConnectCandidate[]
}

export function snapPortKey(nodeId: string, portId: string): string {
  return `${nodeId}::${portId}`
}

function edgeKey(
  sourceId: string,
  targetId: string,
  sourcePort: string,
  targetPort: string
): string {
  return `${sourceId}>${sourcePort}->${targetId}>${targetPort}`
}

function incomingKey(targetId: string, targetPort: string): string {
  return `${targetId}>${targetPort}`
}

function boundsOverlap(
  a: GraphNode,
  b: GraphNode,
  pad: number
): boolean {
  const sa = getNodeSize(a)
  const sb = getNodeSize(b)
  const aL = a.position.x - pad
  const aT = a.position.y - pad
  const aR = a.position.x + sa.w + pad
  const aB = a.position.y + sa.h + pad
  const bL = b.position.x
  const bT = b.position.y
  const bR = b.position.x + sb.w
  const bB = b.position.y + sb.h
  return aL <= bR && aR >= bL && aT <= bB && aB >= bT
}

function portDistance(
  source: GraphNode,
  target: GraphNode,
  sourcePort: string,
  targetPort: string
): number {
  const out = getNodePortCenter(source, 'right', sourcePort)
  const inn = getNodePortCenter(target, 'left', targetPort)
  const dx = out.x - inn.x
  const dy = out.y - inn.y
  return Math.hypot(dx, dy)
}

/**
 * 节点叠放/紧贴时，左右端口天然相距约半个节点宽，需放宽阈值，
 * 否则「拖到另一节点上」无法触发自动连线。
 */
function pairPortThreshold(
  source: GraphNode,
  target: GraphNode,
  baseThreshold: number
): number {
  if (!boundsOverlap(source, target, baseThreshold)) return baseThreshold
  const sw = getNodeSize(source).w
  const tw = getNodeSize(target).w
  return Math.max(baseThreshold, (sw + tw) / 2 + baseThreshold)
}

function collectDirectedCandidates(
  source: GraphNode,
  target: GraphNode,
  thresholdWorld: number
): SnapConnectCandidate[] {
  const outPorts = getNodePorts(source).filter((p) => p.direction === 'out')
  const inPorts = getNodePorts(target).filter((p) => p.direction === 'in')
  if (outPorts.length === 0 || inPorts.length === 0) return []
  const maxDist = pairPortThreshold(source, target, thresholdWorld)

  const hits: SnapConnectCandidate[] = []
  for (const outPort of outPorts) {
    for (const inPort of inPorts) {
      if (
        !canConnectNodes(source, target, {
          sourcePort: outPort.id,
          targetPort: inPort.id
        })
      ) {
        continue
      }
      const dist = portDistance(source, target, outPort.id, inPort.id)
      if (dist > maxDist) continue
      hits.push({
        sourceId: source.id,
        targetId: target.id,
        sourcePort: outPort.id,
        targetPort: inPort.id,
        dist
      })
    }
  }
  return hits
}

/** 两节点重合时：收集类型兼容的端口对（不限距离，用于高亮） */
function collectCompatiblePortKeys(a: GraphNode, b: GraphNode, into: Set<string>): void {
  const aOut = getNodePorts(a).filter((p) => p.direction === 'out')
  const aIn = getNodePorts(a).filter((p) => p.direction === 'in')
  const bOut = getNodePorts(b).filter((p) => p.direction === 'out')
  const bIn = getNodePorts(b).filter((p) => p.direction === 'in')

  for (const outPort of aOut) {
    for (const inPort of bIn) {
      if (!canConnectNodes(a, b, { sourcePort: outPort.id, targetPort: inPort.id })) continue
      into.add(snapPortKey(a.id, outPort.id))
      into.add(snapPortKey(b.id, inPort.id))
    }
  }
  for (const outPort of bOut) {
    for (const inPort of aIn) {
      if (!canConnectNodes(b, a, { sourcePort: outPort.id, targetPort: inPort.id })) continue
      into.add(snapPortKey(b.id, outPort.id))
      into.add(snapPortKey(a.id, inPort.id))
    }
  }
}

/**
 * 拖动过程中的重合高亮 + 靠近可连预览。
 */
export function resolveSnapDragPreview(options: ResolveSnapConnectOptions): SnapDragPreview {
  const threshold = Math.max(0, options.thresholdWorld)
  const highlightPortKeys = new Set<string>()
  const highlightNodeIds = new Set<string>()
  const empty: SnapDragPreview = {
    highlightPortKeys,
    highlightNodeIds,
    connectCandidates: []
  }
  if (!(threshold > 0)) return empty

  const dragged = new Set(options.draggedNodeIds.filter(Boolean))
  if (dragged.size === 0) return empty

  const byId = new Map(options.nodes.map((n) => [n.id, n]))
  const draggedNodes = [...dragged]
    .map((id) => byId.get(id))
    .filter((n): n is GraphNode => !!n)
  const others = options.nodes.filter((n) => !dragged.has(n.id))
  if (draggedNodes.length === 0 || others.length === 0) return empty

  for (const moved of draggedNodes) {
    for (const other of others) {
      if (!boundsOverlap(moved, other, threshold)) continue
      highlightNodeIds.add(moved.id)
      highlightNodeIds.add(other.id)
      collectCompatiblePortKeys(moved, other, highlightPortKeys)
    }
  }

  const connectCandidates = resolveSnapConnectEdges(options)
  for (const c of connectCandidates) {
    highlightPortKeys.add(snapPortKey(c.sourceId, c.sourcePort))
    highlightPortKeys.add(snapPortKey(c.targetId, c.targetPort))
    highlightNodeIds.add(c.sourceId)
    highlightNodeIds.add(c.targetId)
  }

  return { highlightPortKeys, highlightNodeIds, connectCandidates }
}

/**
 * 根据拖动结束后的节点位置，解析应自动建立的边（按距离贪心，一口最多一条新入边）。
 */
export function resolveSnapConnectEdges(
  options: ResolveSnapConnectOptions
): SnapConnectCandidate[] {
  const threshold = Math.max(0, options.thresholdWorld)
  if (!(threshold > 0)) return []

  const dragged = new Set(options.draggedNodeIds.filter(Boolean))
  if (dragged.size === 0) return []

  const byId = new Map(options.nodes.map((n) => [n.id, n]))
  const draggedNodes = [...dragged]
    .map((id) => byId.get(id))
    .filter((n): n is GraphNode => !!n)
  const others = options.nodes.filter((n) => !dragged.has(n.id))
  if (draggedNodes.length === 0 || others.length === 0) return []

  const existingKeys = new Set(
    options.edges.map((e) =>
      edgeKey(e.source, e.target, e.sourcePort ?? 'out', e.targetPort ?? 'in')
    )
  )
  const occupiedIn = new Set<string>()
  for (const e of options.edges) {
    const target = byId.get(e.target)
    if (!target) continue
    const portId = e.targetPort ?? 'in'
    const inPort = getNodePorts(target).find((p) => p.direction === 'in' && p.id === portId)
    if (inPort && inPort.multiple === false) {
      occupiedIn.add(incomingKey(e.target, portId))
    }
  }

  const raw: SnapConnectCandidate[] = []
  for (const moved of draggedNodes) {
    for (const other of others) {
      if (!boundsOverlap(moved, other, threshold)) continue
      raw.push(...collectDirectedCandidates(moved, other, threshold))
      raw.push(...collectDirectedCandidates(other, moved, threshold))
    }
  }

  raw.sort((a, b) => a.dist - b.dist || a.sourceId.localeCompare(b.sourceId))

  const accepted: SnapConnectCandidate[] = []
  const usedInThisPass = new Set<string>()
  // 同一轮里，同一 out 口只连最近的一条，避免一次拖动扇出过多
  const usedOutThisPass = new Set<string>()

  for (const cand of raw) {
    const ek = edgeKey(cand.sourceId, cand.targetId, cand.sourcePort, cand.targetPort)
    if (existingKeys.has(ek)) continue

    const inKey = incomingKey(cand.targetId, cand.targetPort)
    const target = byId.get(cand.targetId)
    const inPort = target
      ? getNodePorts(target).find((p) => p.direction === 'in' && p.id === cand.targetPort)
      : undefined
    // 同馈入族 / 已可达：允许顶替目标口原入边（保证单通路）
    const shortcut = nodeCanReach(options.edges, cand.sourceId, cand.targetId)
    const sameFeedFamily = options.edges.some(
      (e) =>
        e.target === cand.targetId &&
        (e.targetPort ?? 'in') === cand.targetPort &&
        nodesShareUpstream(options.edges, cand.sourceId, e.source)
    )
    const canReplaceIn = shortcut || sameFeedFamily
    if (inPort?.multiple === false) {
      if (!canReplaceIn && (occupiedIn.has(inKey) || usedInThisPass.has(inKey))) continue
    } else if (!canReplaceIn && usedInThisPass.has(inKey)) {
      // multiple 口：同一次松手也只自动补一条，避免刷屏
      continue
    } else if (canReplaceIn && usedInThisPass.has(inKey)) {
      continue
    }

    const outKey = `${cand.sourceId}>${cand.sourcePort}`
    if (usedOutThisPass.has(outKey)) continue

    accepted.push(cand)
    existingKeys.add(ek)
    usedInThisPass.add(inKey)
    usedOutThisPass.add(outKey)
    if (inPort?.multiple === false) occupiedIn.add(inKey)
  }

  return accepted
}

/** 将屏幕阈值换算为 world 阈值 */
export function snapConnectThresholdWorld(zoom: number, screenPx = SNAP_CONNECT_THRESHOLD_SCREEN_PX): number {
  return screenPx / Math.max(0.001, zoom)
}
