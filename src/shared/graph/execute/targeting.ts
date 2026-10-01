import { findOutputNode } from '../query'
import type { GraphDocument, GraphNode } from '../types'
import { collectUpstreamNodeIds } from './topo'
import type { GraphRunOptions } from './types'

/**
 * 一趟运行的目标解析结果。
 * runGraph 与前端运行会话共用，避免「哪些节点会被写状态」两处各算一遍而漂移。
 */
export interface GraphRunTargeting {
  /** 主汇点；多汇点时为第一个 */
  target: GraphNode
  /** 显式指定的多汇点（targetNodeIds 命中项） */
  multiTargets: GraphNode[]
  /** 只跑 target 自身、不重跑上游 */
  onlyTarget: boolean
  /** 无论 skipCompletedNodes 如何都必须执行的节点 */
  forceRunIds: Set<string>
  /** 本趟会 publish runStates 的节点集合 */
  subset: Set<string>
}

/**
 * 解析运行的汇点与执行子集；无可用汇点（无输出节点）返回 null。
 * 与 runGraph 内部行为一一对应。
 */
export function resolveGraphRunTargeting(
  graph: GraphDocument,
  options: Pick<GraphRunOptions, 'targetNodeId' | 'targetNodeIds' | 'onlyTargetNode'>
): GraphRunTargeting | null {
  const multiTargets =
    options.targetNodeIds
      ?.map((id) => graph.nodes.find((node) => node.id === id))
      .filter((node): node is GraphNode => !!node) ?? []
  const target =
    multiTargets[0] ??
    (options.targetNodeId
      ? graph.nodes.find((node) => node.id === options.targetNodeId)
      : findOutputNode(graph)) ??
    null
  if (!target) return null

  const onlyTarget =
    options.onlyTargetNode === true && !!options.targetNodeId && !multiTargets.length
  const subset = onlyTarget
    ? new Set<string>([target.id])
    : multiTargets.length
      ? (() => {
          const ids = new Set<string>()
          for (const item of multiTargets) {
            for (const id of collectUpstreamNodeIds(graph, item.id)) ids.add(id)
          }
          return ids
        })()
      : collectUpstreamNodeIds(graph, target.id)

  return {
    target,
    multiTargets,
    onlyTarget,
    forceRunIds: new Set(multiTargets.length ? multiTargets.map((node) => node.id) : [target.id]),
    subset
  }
}
