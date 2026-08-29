import type { GraphDocument } from '@shared/graph'
import { useGraphTaskStore } from '../../stores/graphTasks'
import { useProjectStore } from '../../stores/project'

/**
 * MCP task_run 的渲染层执行入口：
 * 主进程经 broadcast 派发「运行宿主资产工作流」，这里从工程 store 读取
 * 落盘的图文档（genParams.graphJson），交任务 store 按拓扑序执行，
 * 受理与终态经 reportMcpTask 回报主进程（供 MCP task_status 轮询）。
 */

type ReportPhase = 'accepted' | 'finished' | 'failed'

function report(mcpTaskId: string, phase: ReportPhase, extra: { taskId?: string; status?: 'done' | 'error' | 'stopped'; error?: string } = {}): void {
  void window.studio?.reportMcpTask?.({ mcpTaskId, phase, ...extra })
}

async function handleTaskRun(payload: { mcpTaskId: string; assetId: string }): Promise<void> {
  const project = useProjectStore()
  const taskStore = useGraphTaskStore()
  const asset = project.assets.find((item) => item.id === payload.assetId)
  const graphJson = (asset?.genParams as Record<string, unknown> | undefined)?.graphJson as
    | GraphDocument
    | undefined

  if (!asset || !graphJson || !Array.isArray(graphJson.nodes)) {
    report(payload.mcpTaskId, 'failed', {
      error: '资产不存在或不含图文档（task_run 仅支持宿主资产子图，如一键工作流产出的资产）'
    })
    return
  }

  const result = taskStore.enqueueWorkflow({
    title: `${asset.name} · MCP`,
    graph: graphJson,
    target: { kind: 'asset', assetId: payload.assetId, hostId: `asset:${payload.assetId}` },
    priorNodeStates: graphJson.runStates,
    skipCompletedNodes: true
  })

  if (!result.ok) {
    report(payload.mcpTaskId, 'failed', { error: '该图已有进行中的同目标任务' })
    return
  }

  report(payload.mcpTaskId, 'accepted', { taskId: result.id })

  // 轮询任务状态直到终态（任务数量有限，轮询开销可忽略）
  const timer = window.setInterval(() => {
    const task = taskStore.tasks.find((item) => item.id === result.id)
    if (!task) {
      window.clearInterval(timer)
      report(payload.mcpTaskId, 'finished', { taskId: result.id, status: 'stopped' })
      return
    }
    if (task.status === 'done' || task.status === 'error' || task.status === 'stopped') {
      window.clearInterval(timer)
      report(payload.mcpTaskId, 'finished', {
        taskId: result.id,
        status: task.status,
        error: task.status === 'error' ? task.message || undefined : undefined
      })
    }
  }, 1500)
}

let registered = false

export function registerMcpTaskRunner(): void {
  if (registered) return
  registered = true
  if (typeof window.studio?.onMcpTaskRun !== 'function') return
  window.studio.onMcpTaskRun((payload) => {
    void handleTaskRun(payload)
  })
}
