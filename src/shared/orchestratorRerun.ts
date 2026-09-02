/**
 * Orchestrator 断点续跑（rerun）的纯逻辑。
 *
 * 语义：job 终态为 failed（部分节点失败、下游被跳过）或 aborted（用户中止后想继续）时
 * 允许「续跑」——已完成（done）节点保留其产出不重复执行，失败（failed）/ 跳过（skipped）
 * 等未完成节点重置为 pending、尝试计数归零后由主进程重新进入调度循环。
 *
 * 纯函数、无副作用，便于单测；主进程 `rerunOrchestratorJob` 负责把 job 顶回 running、
 * 重建文件采集基线并重跑调度。
 */
import type { OrchestratorJob, OrchestratorNodeState } from './ipc'

/** 是否可续跑：仅失败 / 中止的终态；running 与 done 不可（已全部完成 / 尚在运行） */
export function canRerunOrchestratorJob(job: Pick<OrchestratorJob, 'state'>): boolean {
  return job.state === 'failed' || job.state === 'aborted'
}

/**
 * 计算续跑后的节点状态集。
 * - done 节点：原样保留（finalText / outputFiles / attempts 等随产出继续供下游读取）；
 * - 其余节点（failed / skipped 等一切未完成态）：重置为 pending，attempts 归零，
 *   清掉错误 / 产出 / 时间戳，等待重新派发。
 * job 当前不可续跑时返回 null。
 */
export function resetNodesForRerun(
  job: Pick<OrchestratorJob, 'state' | 'nodes'>
): OrchestratorNodeState[] | null {
  if (!canRerunOrchestratorJob(job)) return null
  return job.nodes.map((n) => {
    if (n.state === 'done') {
      return { ...n }
    }
    return {
      id: n.id,
      agentId: n.agentId,
      instruction: n.instruction,
      dependsOn: [...n.dependsOn],
      state: 'pending',
      attempts: 0
    }
  })
}
