import type { GraphDocument } from '../types'
import { collectDownstreamNodeIdsFrom } from './topo'

/**
 * 一趟运行的「泳道」：本趟会写 runStates 的节点，以及是否会波及子集外节点。
 * 画布上互不重叠的泳道可并行执行；一旦重叠必须串行，否则同一节点会被两趟同时写状态。
 */
export interface GraphRunLane {
  /** 本趟 publish 状态的节点（即 runGraph 的 subset） */
  nodeIds: ReadonlySet<string>
  /**
   * true = 会对子集外节点发布 skipped（整图运行 preserveOutsideSubset=false），
   * 因而与任何其它泳道互斥。
   */
  exclusive: boolean
}

/** 两条泳道是否冲突（重叠，或任一侧为整图运行） */
export function graphRunLanesConflict(a: GraphRunLane, b: GraphRunLane): boolean {
  if (a.exclusive || b.exclusive) return true
  const [small, large] =
    a.nodeIds.size <= b.nodeIds.size ? [a.nodeIds, b.nodeIds] : [b.nodeIds, a.nodeIds]
  for (const id of small) {
    if (large.has(id)) return true
  }
  return false
}

/** 返回第一条冲突泳道的下标；无冲突返回 -1 */
export function findConflictingGraphRunLane(
  plan: GraphRunLane,
  active: readonly GraphRunLane[]
): number {
  return active.findIndex((lane) => graphRunLanesConflict(plan, lane))
}

/** 与进行中泳道重叠的节点（用于提示「哪条链在跑」） */
export function listGraphRunLaneOverlap(
  plan: GraphRunLane,
  lane: GraphRunLane | undefined
): string[] {
  if (!lane) return []
  if (lane.exclusive && !plan.exclusive) return []
  const overlap: string[] = []
  for (const id of plan.nodeIds) {
    if (lane.nodeIds.has(id)) overlap.push(id)
  }
  return overlap
}

/**
 * 因与进行中泳道冲突而不能单独启动的节点。
 *
 * 判定依据：新运行的目标 X 会重跑 X 的上游，故 X ∈ 泳道某节点的下游闭包 ⟺ 二者重叠。
 * 泳道自身节点同样计入：它们此刻由那一趟写状态，点击语义是「停止该趟」
 * （执行中/待执行的节点在 UI 上仍是可点的停止按钮）。
 * 存在 exclusive 泳道（整图运行）时，全部节点阻塞。
 */
export function collectBlockedNodeIds(
  graph: GraphDocument,
  active: readonly GraphRunLane[],
  allNodeIds?: Iterable<string>
): Set<string> {
  const blocked = new Set<string>()
  if (active.some((lane) => lane.exclusive)) {
    const ids = allNodeIds ?? graph.nodes.map((node) => node.id)
    for (const id of ids) blocked.add(id)
    return blocked
  }
  // 一次多源遍历，避免按泳道节点逐个求下游闭包
  const seeds = new Set<string>()
  for (const lane of active) {
    for (const id of lane.nodeIds) seeds.add(id)
  }
  if (!seeds.size) return blocked
  for (const id of collectDownstreamNodeIdsFrom(graph, seeds)) blocked.add(id)
  return blocked
}
