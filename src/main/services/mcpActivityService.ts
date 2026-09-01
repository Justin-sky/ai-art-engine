import { randomUUID } from 'node:crypto'
import { IpcChannels, type McpActivity, type McpActivityTool } from '@shared/ipc'
import type { GraphRunLogApiCall } from '@shared/graph'
import { broadcastToAllWindows } from '../broadcast'

/**
 * MCP 旁路生成活动记录：generate_image / generate_speech / generate_model3d /
 * generate_video 等不进入工作流任务系统的直接生成，在这里登记为界面可见的
 * 「MCP 生成」活动（任务列表 + 执行日志），随状态变化广播到所有渲染窗口。
 * 仅内存保留（上限 MAX_ACTIVITIES 条），工程关闭时清空。
 */

const MAX_ACTIVITIES = 50

class McpActivityService {
  private activities: McpActivity[] = []

  /** 当前活动列表（最新的在前） */
  list(): McpActivity[] {
    return [...this.activities]
  }

  /** 开始一次活动，返回 activityId（调用方负责在终态时 end） */
  begin(input: { tool: McpActivityTool; title: string; model?: string }): string {
    const activity: McpActivity = {
      id: `mcp-activity-${randomUUID()}`,
      tool: input.tool,
      title: input.title,
      model: input.model,
      status: 'running',
      startedAt: Date.now()
    }
    this.activities = [activity, ...this.activities].slice(0, MAX_ACTIVITIES)
    this.emit(activity)
    return activity.id
  }

  /** 结束一次活动（成功 / 失败） */
  end(
    activityId: string,
    input: {
      ok: boolean
      assetId?: string
      relativePath?: string
      error?: string
      apiCall?: Omit<GraphRunLogApiCall, 'id' | 'ts'>
    }
  ): void {
    const index = this.activities.findIndex((a) => a.id === activityId)
    if (index < 0) return
    const prev = this.activities[index]
    if (prev.status !== 'running') return
    const finishedAt = Date.now()
    const next: McpActivity = {
      ...prev,
      status: input.ok ? 'done' : 'error',
      finishedAt,
      assetId: input.assetId,
      relativePath: input.relativePath,
      error: input.error,
      apiCall: input.apiCall
        ? {
            ...input.apiCall,
            durationMs: input.apiCall.durationMs ?? Math.max(0, finishedAt - prev.startedAt)
          }
        : undefined
    }
    const copy = [...this.activities]
    copy[index] = next
    this.activities = copy
    this.emit(next)
  }

  /** 工程关闭时清空，并通知渲染层同步清空 */
  clear(): void {
    if (!this.activities.length) return
    this.activities = []
    broadcastToAllWindows(IpcChannels.MCP_ACTIVITY_CLEARED, {})
  }

  private emit(activity: McpActivity): void {
    broadcastToAllWindows(IpcChannels.MCP_ACTIVITY_UPDATED, activity)
  }
}

export const mcpActivityService = new McpActivityService()
