/**
 * Orchestrator 连线图布局：把 job 节点按「最长依赖路径」分层为从左到右的多列，
 * 输出各节点像素坐标与依赖连线端点，供 OrchestratorPanel 以 HTML + SVG 渲染 DAG。
 *
 * 纯函数、无 Vue 依赖：方便后续单测与复用。
 */

/** 连线图节点的最小形状（仅用 id 与 dependsOn 计算拓扑与坐标） */
export interface DagNodeLike {
  id: string
  dependsOn: string[]
}

/** 一条依赖连线的几何（from = 被依赖节点右侧中心 → to = 依赖方左侧中心） */
export interface DagEdge {
  from: string
  to: string
  fromX: number
  fromY: number
  toX: number
  toY: number
}

export interface DagLayout {
  /** 节点 id → 列号（0 基；等于最长依赖路径深度，即层数） */
  columnBy: Map<string, number>
  /** 节点 id → chip 左上角像素坐标 */
  posBy: Map<string, { x: number; y: number }>
  edges: DagEdge[]
  /** 画布尺寸（超出时外层容器滚动） */
  canvasWidth: number
  canvasHeight: number
  columnCount: number
  rowCount: number
}

/** 连线图卡片固定尺寸：锚点依赖固定宽，才能稳定计算连线 */
export const DAG_CHIP_W = 176
export const DAG_CHIP_H = 34
/** 相邻列水平间距 / 同列相邻卡片垂直间距 / 画布内边距 */
const COL_GAP = 96
const ROW_GAP = 18
const PAD = 12

/** 空布局（nodes 为空时返回，避免除零 / NaN） */
function emptyLayout(): DagLayout {
  return {
    columnBy: new Map(),
    posBy: new Map(),
    edges: [],
    canvasWidth: PAD * 2,
    canvasHeight: PAD * 2,
    columnCount: 0,
    rowCount: 0
  }
}

/** 计算 DAG 布局：分层（固定点迭代）→ 定位 → 连线端点 */
export function layoutDag(nodes: DagNodeLike[]): DagLayout {
  if (!nodes.length) return emptyLayout()
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const colOf = new Map<string, number>()
  // 初值全部置 0，避免「无依赖节点（列 0）因与默认值相同而漏存」
  for (const n of nodes) colOf.set(n.id, 0)
  // 固定点迭代求最长路径层号：col = 1 + max(dep 层号)，无依赖为 0
  for (let round = 0; round <= nodes.length; round++) {
    let changed = false
    for (const n of nodes) {
      const deps = n.dependsOn.map((d) => byId.get(d)).filter((d): d is DagNodeLike => d != null)
      const desired = deps.length ? Math.max(...deps.map((d) => colOf.get(d.id) ?? 0)) + 1 : 0
      if (colOf.get(n.id) !== desired) {
        colOf.set(n.id, desired)
        changed = true
      }
    }
    if (!changed) break
  }
  // 按列聚合（保持定义顺序，纵向稳定）
  const cols = new Map<number, DagNodeLike[]>()
  for (const n of nodes) {
    const c = colOf.get(n.id) ?? 0
    const list = cols.get(c) ?? []
    list.push(n)
    cols.set(c, list)
  }
  const columnCount = Math.max(0, ...cols.keys()) + 1
  const rowCount = Math.max(0, ...[...cols.values()].map((arr) => arr.length))
  const rowStep = DAG_CHIP_H + ROW_GAP
  const innerW = columnCount * DAG_CHIP_W + (columnCount - 1) * COL_GAP
  const innerH = rowCount * rowStep - ROW_GAP
  const posBy = new Map<string, { x: number; y: number }>()
  for (const [c, arr] of cols) {
    const columnH = arr.length * rowStep - ROW_GAP
    const top = PAD + (innerH - columnH) / 2
    const left = PAD + c * (DAG_CHIP_W + COL_GAP)
    arr.forEach((n, i) => {
      posBy.set(n.id, { x: left, y: top + i * rowStep })
    })
  }
  // 连线（去重；from → to）
  const edges: DagEdge[] = []
  const seen = new Set<string>()
  for (const n of nodes) {
    for (const depId of n.dependsOn) {
      const key = `${depId}\u0000${n.id}`
      if (seen.has(key)) continue
      seen.add(key)
      const from = posBy.get(depId)
      const to = posBy.get(n.id)
      if (!from || !to) continue
      edges.push({
        from: depId,
        to: n.id,
        fromX: from.x + DAG_CHIP_W,
        fromY: from.y + DAG_CHIP_H / 2,
        toX: to.x,
        toY: to.y + DAG_CHIP_H / 2
      })
    }
  }
  return {
    columnBy: colOf,
    posBy,
    edges,
    canvasWidth: innerW + PAD * 2,
    canvasHeight: innerH + PAD * 2,
    columnCount,
    rowCount
  }
}
