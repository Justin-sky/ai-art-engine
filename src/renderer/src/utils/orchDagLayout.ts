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

/** 新增一条依赖边（depId → dependentId，即 dependentId 依赖 depId）的可行性检查结果 */
export type DependencyCheckResult =
  | { ok: true }
  | { ok: false; reason: 'self' | 'missing' | 'duplicate' | 'cycle' }

/**
 * 检查是否允许新增依赖边 depId → dependentId（让 dependentId 依赖 depId）。
 * 供「迷你 DAG 画布」拖拽建边前校验，规则与主进程 runOrchestrator 校验保持一致：
 * - self：不能依赖自身；
 * - missing：两端必须都是已声明的节点；
 * - duplicate：dependentId 已声明依赖 depId（重复边）；
 * - cycle：若 depId 已（直接或间接）依赖 dependentId，补上这条边会形成环。
 * 纯函数、无 Vue 依赖，可单测。
 */
export function canAddDependency(
  nodes: readonly DagNodeLike[],
  depId: string,
  dependentId: string
): DependencyCheckResult {
  if (depId === dependentId) return { ok: false, reason: 'self' }
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const dep = byId.get(depId)
  const dependent = byId.get(dependentId)
  if (!dep || !dependent) return { ok: false, reason: 'missing' }
  if ((dependent.dependsOn ?? []).includes(depId)) return { ok: false, reason: 'duplicate' }
  // depId 沿 dependsOn 能走到 dependentId → depId 已依赖 dependentId，补边即成环
  const seen = new Set<string>()
  const stack = [depId]
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    if (id === dependentId) return { ok: false, reason: 'cycle' }
    const node = byId.get(id)
    for (const next of node?.dependsOn ?? []) stack.push(next)
  }
  return { ok: true }
}

/* ── 节点集整体校验（提交前 / 自动拆解写回前） ── */

/** 参与整体校验的节点最小形态（dependsOn 可缺省；agentId 显式提供且为空才算未选角色） */
export interface DagCheckNode {
  id: string
  agentId?: string
  dependsOn?: string[]
}

/** 编排节点集校验的单条错误（每条可定位到节点；missing-dep 还携带悬空依赖目标） */
export type DagNodeError =
  | { id: string; kind: 'bad-id' }
  | { id: string; kind: 'dup-id' }
  | { id: string; kind: 'empty-agent' }
  | { id: string; kind: 'self-dep' }
  | { id: string; kind: 'missing-dep'; dep: string }
  | { id: string; kind: 'cycle' }

export interface DagNodesCheck {
  ok: boolean
  /** 按「节点级 → 依赖边 → 环」顺序排列的错误（errors[0] 即首个需修正的问题） */
  errors: DagNodeError[]
  /** 建议剔除的依赖边（self / missing / 破环候选），sanitizeDagDependencies 据此清洗 */
  invalidDeps: Array<{ id: string; dep: string }>
}

/** 节点 id 合法性与主进程 runOrchestrator 一致：字母/数字/._-，1..32 位 */
const NODE_ID_RE = /^[A-Za-z0-9._-]{1,32}$/

/**
 * 拓扑剥离法：返回未能剥除的节点 id（空 → 无环）。
 * 只统计「声明内且非自指」的依赖：自环边与指向未定义节点的悬空边已被
 * validateDagNodes 单独报错，这里忽略它们以免把可修错误误判成环。
 */
function cycleNodes(nodes: readonly DagCheckNode[]): string[] {
  const byId = new Set(nodes.map((n) => String(n?.id ?? '')))
  const indegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()
  for (const node of nodes) {
    const deps = (node.dependsOn ?? []).filter((dep) => dep !== node.id && byId.has(dep))
    indegree.set(node.id, deps.length)
    for (const dep of deps) {
      const list = dependents.get(dep) ?? []
      list.push(node.id)
      dependents.set(dep, list)
    }
  }
  const queue = [...indegree.entries()].filter(([, n]) => n === 0).map(([id]) => id)
  let peeled = 0
  while (queue.length) {
    const id = queue.shift()!
    peeled += 1
    for (const next of dependents.get(id) ?? []) {
      const left = (indegree.get(next) ?? 1) - 1
      indegree.set(next, left)
      if (left === 0) queue.push(next)
    }
  }
  return peeled < nodes.length ? [...indegree.keys()].filter((id) => (indegree.get(id) ?? 0) > 0) : []
}

/** 环上依赖边全集：残余节点（无法剥除，必与环纠缠）之间的互相依赖边 */
function cycleEdges(nodes: readonly DagCheckNode[]): Array<{ id: string; dep: string }> {
  const residual = new Set(cycleNodes(nodes))
  if (!residual.size) return []
  const edges: Array<{ id: string; dep: string }> = []
  for (const node of nodes) {
    if (!residual.has(node.id)) continue
    for (const dep of node.dependsOn ?? []) {
      if (dep !== node.id && residual.has(dep)) edges.push({ id: node.id, dep })
    }
  }
  return edges
}

/**
 * 校验编排节点集是否可直接提交。口径与主进程 runOrchestrator 静态校验保持一致：
 * - bad-id / dup-id：id 非法（字母/数字/._-，≤32 位）或重复；
 * - empty-agent：节点显式提供了 agentId 但为空（未选角色）；
 * - self-dep：依赖自身；missing-dep：依赖了未定义的节点；
 * - cycle：依赖关系成环（invalidDeps 给出破环候选边）。
 * 纯函数、无 Vue 依赖，可单测。
 */
export function validateDagNodes(nodes: readonly DagCheckNode[]): DagNodesCheck {
  const errors: DagNodeError[] = []
  const invalidDeps: Array<{ id: string; dep: string }> = []
  const seen = new Set<string>()
  const byId = new Map<string, DagCheckNode>()
  for (const node of nodes) {
    const id = String(node?.id ?? '')
    if (!NODE_ID_RE.test(id)) {
      errors.push({ id, kind: 'bad-id' })
    } else if (seen.has(id)) {
      errors.push({ id, kind: 'dup-id' })
    } else {
      seen.add(id)
      byId.set(id, node)
    }
    if (
      Object.prototype.hasOwnProperty.call(node, 'agentId') &&
      !String(node.agentId ?? '').trim()
    ) {
      errors.push({ id, kind: 'empty-agent' })
    }
  }
  for (const node of nodes) {
    const id = String(node?.id ?? '')
    for (const dep of node.dependsOn ?? []) {
      if (dep === id) {
        errors.push({ id, kind: 'self-dep' })
        invalidDeps.push({ id, dep })
      } else if (!byId.has(dep)) {
        errors.push({ id, kind: 'missing-dep', dep })
        invalidDeps.push({ id, dep })
      }
    }
  }
  const cyc = cycleNodes(nodes)
  if (cyc.length) {
    // 环错误只报一次：用第一个残余节点定位（剥离法残余必含环上节点）
    errors.push({ id: cyc[0]!, kind: 'cycle' })
    invalidDeps.push(...cycleEdges(nodes))
  }
  return { ok: errors.length === 0, errors, invalidDeps }
}

/**
 * 就地剔除节点集里的全部非法依赖边（self / missing / 破环候选），返回剔除边数。
 * 用于「自动拆解结果写回表单前」的兜底清洗，保证清洗后的节点集可直接提交。
 * 注意：就地修改传入数组各元素的 dependsOn；不处理 id / agent 自身的错误。
 */
export function sanitizeDagDependencies(nodes: DagCheckNode[]): number {
  let removed = 0
  for (let guard = 0; guard < 64; guard++) {
    const check = validateDagNodes(nodes)
    if (check.ok || !check.invalidDeps.length) break
    const drop = new Set(check.invalidDeps.map((d) => `${d.id}\u0000${d.dep}`))
    let changed = false
    for (const node of nodes) {
      const deps = node.dependsOn ?? []
      const kept = deps.filter((dep) => !drop.has(`${node.id}\u0000${dep}`))
      if (kept.length !== deps.length) {
        removed += deps.length - kept.length
        node.dependsOn = kept
        changed = true
      }
    }
    if (!changed) break
  }
  return removed
}
