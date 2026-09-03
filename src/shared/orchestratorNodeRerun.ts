/**
 * Orchestrator 节点级「单跑此节点」的纯逻辑。
 *
 * 语义：失败 / 中止的记录中，用户只想重跑某个节点（而不是整单续跑全部失败节点）时，
 * 以该节点为根做**局部重调度**——目标节点与「因它未完成而被级联跳过 / 阻塞」的下游
 * （直接或间接 dependsOn 它）一起重置为 pending、尝试计数归零后重新进入调度；
 * 已完成（done）节点一律保留产出不重复执行，目标节点的上游也不受影响。
 *
 * 与「断点续跑」（shared/orchestratorRerun.ts）互补：
 * - 续跑 = 重置记录内全部未完成节点（面向「跑完整张图」）；
 * - 单跑 = 只重置目标节点及其被阻塞下游（面向「定点重试一个环节」）。
 *
 * 纯函数、无副作用，便于单测；主进程 `rerunOrchestratorNode` 负责把 job 顶回 running、
 * 重建文件采集基线并重跑调度（复用续跑的 relaunch 收尾）。
 */
import type { OrchestratorJob, OrchestratorNodeState } from './ipc'

/**
 * 单跑目标节点是否可行：
 * - job 须为终态 failed / aborted（running 在调度中、done 无未完成节点）；
 * - 节点存在且自身未完成（done 节点要重做请用「再来一轮」整单重跑）；
 * - 目标节点的直接依赖已全部完成（否则它本就被上游卡住，单独跑没有意义，
 *   应先用 ↻ 续跑处理上游，或直接对失败的上游节点单跑）。
 */
export function canRerunOrchestratorNode(
  job: Pick<OrchestratorJob, 'state' | 'nodes'>,
  nodeId: string
): boolean {
  if (job.state !== 'failed' && job.state !== 'aborted') return false
  const byId = new Map(job.nodes.map((n) => [n.id, n]))
  const node = byId.get(nodeId)
  if (!node || node.state === 'done') return false
  for (const dep of node.dependsOn) {
    const depNode = byId.get(dep)
    if (!depNode || depNode.state !== 'done') return false
  }
  return true
}

/**
 * 计算节点级单跑的受影响集：目标节点 + 全部传递下游中被阻塞的节点（state !== 'done'）。
 * 用反向邻接（depId → 直接依赖它的节点列表）做 BFS，不受 nodes 数组顺序影响。
 */
function affectedIds(
  job: Pick<OrchestratorJob, 'nodes'>,
  rootId: string
): Set<string> {
  const dependents = new Map<string, string[]>()
  for (const n of job.nodes) {
    for (const dep of n.dependsOn) {
      const list = dependents.get(dep) ?? []
      list.push(n.id)
      dependents.set(dep, list)
    }
  }
  const seen = new Set<string>([rootId])
  const queue = [rootId]
  while (queue.length) {
    const id = queue.shift()!
    for (const next of dependents.get(id) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return seen
}

/**
 * 计算单跑后的节点状态集。
 * - 受影响集（目标 + 传递下游中未完成的）重置为 pending，attempts 归零，
 *   清掉错误 / 产出 / 时间戳，等待重新派发；
 * - 其余节点（含目标上游、并行分支、已 done 的其它节点）原样保留产出。
 * job 当前不可单跑时返回 null。
 */
export function resetNodesForNodeRerun(
  job: Pick<OrchestratorJob, 'state' | 'nodes'>,
  nodeId: string
): { nodes: OrchestratorNodeState[]; rerunCount: number } | null {
  if (!canRerunOrchestratorNode(job, nodeId)) return null
  const affected = affectedIds(job, nodeId)
  let rerunCount = 0
  const nodes = job.nodes.map((n) => {
    if (!affected.has(n.id) || n.state === 'done') {
      // done 节点（含受影响集中防御性出现的 done 下游）保留产出；无关节点原样保留
      return { ...n }
    }
    rerunCount += 1
    return {
      id: n.id,
      agentId: n.agentId,
      instruction: n.instruction,
      dependsOn: [...n.dependsOn],
      state: 'pending' as const,
      attempts: 0
    }
  })
  return { nodes, rerunCount }
}
