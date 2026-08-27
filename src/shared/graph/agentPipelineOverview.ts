/**
 * 通用 Agent 流水线编排总览：把图中的 media.review（质检）/ media.rework（返工）节点
 * 投影成「规划 → 生成 → 质检 → 返工」流水线的可渲染视图。纯函数、无渲染环境依赖，
 * 供 NodeGraphEditor 顶栏「Agent 流水线」总览窗口消费。
 */
import type { GraphNode } from './types'
import { parseMediaReworkState, type MediaReworkStatus } from './mediaRework'

export type AgentReviewStatus = 'pending' | 'PASS' | 'FAIL'

export interface AgentReviewRow {
  nodeId: string
  title: string
  status: AgentReviewStatus
  reason: string
}

export interface AgentReworkRow {
  nodeId: string
  title: string
  status: MediaReworkStatus
  /** 已完成的尝试次数 */
  attempt: number
  maxAttempts: number
  /** 最近一次 FAIL 原因（供展示 / 下一轮注入） */
  lastReason: string
  /** 最终质检结论（PASS / FAIL / 空） */
  finalResult: 'PASS' | 'FAIL' | ''
}

export interface AgentPipelineOverview {
  reviewRows: AgentReviewRow[]
  reworkRows: AgentReworkRow[]
  /** 待审核（质检 pending + 返工 running）节点数 */
  pendingCount: number
  /** 质检 FAIL 节点数 */
  failCount: number
  /** 达上限仍未通过的返工节点数 */
  exhaustedCount: number
  /** 最近一次 FAIL / exhausted 原因（顶栏展示） */
  lastFailReason: string
  /** 图中是否存在 Agent 流水线节点（media.review / media.rework） */
  hasPipeline: boolean
}

/** 是否 Agent 流水线节点（质检 / 返工） */
export function isAgentPipelineNode(node: GraphNode): boolean {
  return node.typeId === 'media.review' || node.typeId === 'media.rework'
}

function reviewStatusOf(node: GraphNode): AgentReviewStatus {
  if (node.params.mediaReviewPending === true) return 'pending'
  if (node.params.mediaReviewStatus === 'PASS' || node.params.mediaReviewStatus === 'FAIL') {
    return node.params.mediaReviewStatus
  }
  return 'pending'
}

/** 收集图中 media.review 质检节点 → 质检行 */
export function collectAgentReviewRows(nodes: readonly GraphNode[]): AgentReviewRow[] {
  return nodes
    .filter((node) => node.typeId === 'media.review')
    .map((node) => ({
      nodeId: node.id,
      title: node.title?.trim() || 'Media review',
      status: reviewStatusOf(node),
      reason: String(node.params.mediaReviewReason ?? '').trim()
    }))
}

/** 收集图中 media.rework 返工节点 → 返工行（回退解析序列化状态） */
export function collectAgentReworkRows(nodes: readonly GraphNode[]): AgentReworkRow[] {
  return nodes
    .filter((node) => node.typeId === 'media.rework')
    .map((node) => {
      const state = parseMediaReworkState(node.params.mediaReworkState)
      const status: MediaReworkStatus =
        node.params.mediaReworkStatus === 'passed' || node.params.mediaReworkStatus === 'exhausted'
          ? node.params.mediaReworkStatus
          : (state?.status ?? 'running')
      const attempt = state?.attempt ?? 0
      const maxAttempts = state?.maxAttempts ?? node.params.mediaReworkMaxAttempts ?? 3
      const lastReason = String(node.params.mediaReviewReason ?? state?.lastReason ?? '').trim()
      const finalResult: 'PASS' | 'FAIL' | '' =
        node.params.mediaReviewStatus === 'PASS' || node.params.mediaReviewStatus === 'FAIL'
          ? node.params.mediaReviewStatus
          : ''
      return {
        nodeId: node.id,
        title: node.title?.trim() || 'Media rework',
        status,
        attempt,
        maxAttempts,
        lastReason,
        finalResult
      }
    })
}

/** 汇总质检 + 返工节点为流水线总览 */
export function buildAgentPipelineOverview(nodes: readonly GraphNode[]): AgentPipelineOverview {
  const reviewRows = collectAgentReviewRows(nodes)
  const reworkRows = collectAgentReworkRows(nodes)

  let pendingCount = 0
  let failCount = 0
  let exhaustedCount = 0
  let lastFailReason = ''

  for (const row of reviewRows) {
    if (row.status === 'pending') pendingCount += 1
    else if (row.status === 'FAIL') {
      failCount += 1
      if (row.reason) lastFailReason = row.reason
    }
  }
  for (const row of reworkRows) {
    if (row.status === 'running') pendingCount += 1
    else if (row.status === 'exhausted') {
      exhaustedCount += 1
      if (row.lastReason) lastFailReason = row.lastReason
    }
  }

  return {
    reviewRows,
    reworkRows,
    pendingCount,
    failCount,
    exhaustedCount,
    lastFailReason,
    hasPipeline: reviewRows.length > 0 || reworkRows.length > 0
  }
}
