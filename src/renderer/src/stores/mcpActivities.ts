import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { McpActivity } from '@shared/ipc'
import { useProjectStore } from './project'
import { useGraphRunLogsStore } from './graphRunLogs'

/**
 * MCP 旁路生成活动（generate_image / generate_speech / generate_model3d /
 * generate_video 等）的界面可见记录：
 * - 任务列表对话框直接读 activities 渲染「MCP 生成」区块；
 * - 同时桥接到 graphRunLogs store，使每次调用以独立会话出现在「执行日志」面板。
 */

const MAX_ACTIVITIES = 50

export const useMcpActivitiesStore = defineStore('mcpActivities', () => {
  const activities = ref<McpActivity[]>([])
  const project = useProjectStore()

  let stopUpdated: (() => void) | null = null
  let stopCleared: (() => void) | null = null

  function upsert(activity: McpActivity): void {
    const idx = activities.value.findIndex((a) => a.id === activity.id)
    if (idx >= 0) {
      const copy = [...activities.value]
      copy[idx] = activity
      activities.value = copy
    } else {
      activities.value = [activity, ...activities.value].slice(0, MAX_ACTIVITIES)
    }
    bridgeToRunLogs(activity)
  }

  function clear(): void {
    activities.value = []
  }

  /** 把活动桥接到执行日志：running 开会话，终态收尾 */
  function bridgeToRunLogs(activity: McpActivity): void {
    const logs = useGraphRunLogsStore()
    if (activity.status === 'running') {
      logs.beginRun({
        runId: activity.id,
        title: activity.title,
        mode: 'mcp',
        message: `MCP ${activity.tool} · ${activity.model ?? 'default model'}`
      })
      return
    }
    if (activity.status === 'done') {
      const message = activity.relativePath
        ? `Generated · asset saved: ${activity.relativePath}`
        : 'Generation finished'
      logs.append({ runId: activity.id, kind: 'run_message', level: 'info', message })
      if (activity.apiCall) {
        logs.appendApiCall(activity.id, activity.apiCall)
      }
      logs.endRun({ runId: activity.id, status: 'done' })
      return
    }
    logs.append({
      runId: activity.id,
      kind: 'run_message',
      level: 'error',
      message: activity.error ?? 'Generation failed'
    })
    logs.endRun({
      runId: activity.id,
      status: 'error',
      message: activity.error ?? 'Generation failed'
    })
  }

  async function refresh(): Promise<void> {
    if (!project.isOpen || typeof window.studio?.listMcpActivities !== 'function') {
      activities.value = []
      return
    }
    try {
      activities.value = await window.studio.listMcpActivities()
    } catch {
      activities.value = []
    }
  }

  /** 应用启动时调用一次：订阅主进程推送并拉取当前活动（幂等） */
  function setup(): void {
    if (stopUpdated || stopCleared) return
    if (typeof window.studio?.onMcpActivityUpdated === 'function') {
      stopUpdated = window.studio.onMcpActivityUpdated((activity) => upsert(activity))
    }
    if (typeof window.studio?.onMcpActivityCleared === 'function') {
      stopCleared = window.studio.onMcpActivityCleared(() => clear())
    }
    void refresh()
  }

  function teardown(): void {
    stopUpdated?.()
    stopCleared?.()
    stopUpdated = null
    stopCleared = null
  }

  return {
    activities,
    upsert,
    clear,
    refresh,
    setup,
    teardown
  }
})
