import { randomUUID } from 'node:crypto'
import {
  IpcChannels,
  type McpActivity,
  type McpActivityTool,
  type OneSentenceGameCardInfo
} from '@shared/ipc'
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
  begin(input: {
    tool: McpActivityTool
    title: string
    model?: string
    /** 运行中补充说明（如精修的修正点），界面优先于 model 展示 */
    detail?: string
    /** 运行中即可定位的关联资产（精修的目标资产已存在）：素材库卡片据此显示「进行中」角标 */
    assetId?: string
  }): string {
    const activity: McpActivity = {
      id: `mcp-activity-${randomUUID()}`,
      tool: input.tool,
      title: input.title,
      model: input.model,
      detail: input.detail,
      assetId: input.assetId,
      status: 'running',
      startedAt: Date.now()
    }
    this.activities = [activity, ...this.activities].slice(0, MAX_ACTIVITIES)
    this.emit(activity)
    return activity.id
  }

  /** 运行中增量更新阶段性产物或说明（如画布工作流逐节点落盘后实时流式推送预览卡） */
  update(
    activityId: string,
    input: {
      detail?: string
      assetId?: string
      relativePath?: string
      relativePaths?: string[]
      relatedPaths?: string[]
    }
  ): void {
    const index = this.activities.findIndex((a) => a.id === activityId)
    if (index < 0) return
    const prev = this.activities[index]
    if (prev.status !== 'running') return
    const relativePaths = input.relativePaths?.filter((path) => !!path?.trim())
    const relatedPaths = input.relatedPaths?.filter((path) => !!path?.trim())
    const nextRelativePaths = relativePaths?.length ? [...relativePaths] : prev.relativePaths
    const nextRelativePath = input.relativePath ?? nextRelativePaths?.[0] ?? prev.relativePath
    const next: McpActivity = {
      ...prev,
      detail: input.detail ?? prev.detail,
      assetId: input.assetId ?? prev.assetId,
      relativePath: nextRelativePath,
      relativePaths: nextRelativePaths,
      relatedPaths: relatedPaths?.length ? [...relatedPaths] : prev.relatedPaths
    }
    const copy = [...this.activities]
    copy[index] = next
    this.activities = copy
    this.emit(next)
  }

  /** 结束一次活动（成功 / 失败） */
  end(
    activityId: string,
    input: {
      ok: boolean
      assetId?: string
      relativePath?: string
      /** 多件产物时的完整清单（relativePath 通常取其首条） */
      relativePaths?: string[]
      /** 与主产物同批、折叠进同一张卡的附件（如世界随包返回的泼溅 / 全景） */
      relatedPaths?: string[]
      detail?: string
      error?: string
      apiCall?: Omit<GraphRunLogApiCall, 'id' | 'ts'>
      /** 仅 game_one_sentence_create：对话一句话游戏卡的规格摘要 */
      oneSentenceGame?: OneSentenceGameCardInfo
    }
  ): void {
    const index = this.activities.findIndex((a) => a.id === activityId)
    if (index < 0) return
    const prev = this.activities[index]
    if (prev.status !== 'running' && !(prev.status === 'error' && input.ok)) return
    const finishedAt = Date.now()
    const relativePaths = input.relativePaths?.filter((path) => !!path?.trim())
    const relatedPaths = input.relatedPaths?.filter((path) => !!path?.trim())
    const nextRelativePaths = relativePaths?.length ? [...relativePaths] : prev.relativePaths
    const nextRelativePath = input.relativePath ?? nextRelativePaths?.[0] ?? prev.relativePath
    const next: McpActivity = {
      ...prev,
      status: input.ok ? 'done' : 'error',
      finishedAt,
      detail: input.detail ?? prev.detail,
      assetId: input.assetId ?? prev.assetId,
      relativePath: nextRelativePath,
      relativePaths: nextRelativePaths?.length ? [...nextRelativePaths] : undefined,
      relatedPaths: relatedPaths?.length ? [...relatedPaths] : prev.relatedPaths,
      error: input.ok ? undefined : input.error,
      oneSentenceGame: input.oneSentenceGame ?? prev.oneSentenceGame,
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
