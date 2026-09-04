/**
 * Orchestrator 记录 → 新建表单快照 / 直接提交入参的纯转换。
 *
 * 两种消费：
 * - `orchestratorJobToDraft`：「再来一轮」把一条已结束的编排记录（done / failed / aborted）
 *   整单回填到上方新建表单，用户可微调后重新提交；
 * - `orchestratorJobToRunInput`：「整单重跑直接提交」跳过表单环节，直接把该记录的
 *   goal / title / nodes 原样提交一轮新 job（不动当前草稿）。
 *
 * 两者都只收敛 job 快照里的「静态定义」字段（goal / title / id / agentId / instruction /
 * dependsOn），剥离运行态字段（state / attempts / finalText / outputFiles / error /
 * 时间戳等）；依赖数组浅拷贝，保证与表单撤销栈的快照语义一致。
 */
import type { OrchestratorJob, OrchestratorRunInput } from '@shared/ipc'
import type { DraftSnapshot } from './draftHistory'

/**
 * 把一条编排记录转成可直接 apply 到表单的草稿快照。
 * - 节点超出 maxNodes 时截断（保留定义顺序头部，与表单上限一致）；
 * - 节点只保留静态定义字段，运行态不回流到编辑表单。
 */
export function orchestratorJobToDraft(
  job: OrchestratorJob,
  maxNodes: number
): DraftSnapshot {
  const cap = Math.max(0, maxNodes)
  return {
    goal: job.goal,
    jobTitle: job.title ?? '',
    nodes: job.nodes.slice(0, cap).map((n) => ({
      id: n.id,
      agentId: n.agentId,
      instruction: n.instruction ?? '',
      dependsOn: [...(n.dependsOn ?? [])]
    }))
  }
}

/**
 * 把一条编排记录转成可直接提交新 job 的 `runOrchestrator` 入参（整单重跑直接提交）。
 * - 与草稿回填不同：不截断节点（job 创建时已通过主进程 MAX_NODES 校验，原样重跑
 *   应保留完整定义，不因表单上限再次截断）；
 * - 只保留静态定义字段，运行态（state / attempts / finalText / outputFiles / error）不回流。
 */
export function orchestratorJobToRunInput(job: OrchestratorJob): OrchestratorRunInput {
  return {
    goal: job.goal,
    ...(job.title ? { title: job.title } : {}),
    nodes: job.nodes.map((n) => ({
      id: n.id,
      agentId: n.agentId,
      instruction: n.instruction ?? '',
      dependsOn: [...(n.dependsOn ?? [])]
    }))
  }
}
