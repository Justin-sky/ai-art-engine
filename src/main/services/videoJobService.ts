import { randomUUID } from 'crypto'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { AssetInfo } from '@shared/domain'
import { resolveMediaOutputDir } from '@shared/domain'
import { assetMediaHostDirs } from '@shared/assetPackage/pathname'
import type {
  VideoJobGraphBinding,
  VideoJobRecord,
  VideoJobTosUpload
} from '@shared/videoJob'
import { isVideoJobActive } from '@shared/videoJob'
import { IpcChannels } from '@shared/ipc'
import { findProviderById } from '@shared/modelProvider'
import { broadcastToAllWindows } from '../broadcast'
import { videoJobRepository } from '../repositories/videoJobRepository'
import { deleteTosUploads } from './tosUploadService'
import { projectService } from './projectService'
import { settingsService } from './settingsService'

const POLL_INTERVAL_MS = 5000
const MAX_WAIT_MS = 20 * 60 * 1000

export interface CreateVideoJobInput {
  providerJobId: string
  pollingUrl: string
  providerInstanceId: string
  model: string
  prompt: string
  name?: string
  source: VideoJobRecord['source']
  graphBinding?: VideoJobGraphBinding
  outputDir?: string
  tosUploads?: VideoJobTosUpload[]
  localJobId?: string
}

type Waiter = {
  resolve: (job: VideoJobRecord) => void
  reject: (err: Error) => void
}

function resolveJobVideoOutputDir(job: VideoJobRecord): string {
  const hostAssetId = job.graphBinding?.assetId
  const hostAsset = hostAssetId
    ? projectService.listAssets().find((a) => a.id === hostAssetId)
    : undefined
  const dirs = assetMediaHostDirs(hostAsset, projectService.listFolders())
  return resolveMediaOutputDir({
    mediaOutputDir: job.outputDir,
    hostRelativePath: dirs.hostRelativePath,
    hostFolderDir: dirs.hostFolderDir,
    hostAssetName: dirs.hostAssetName,
    kind: 'video'
  })
}

class VideoJobService {
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private waiters = new Map<string, Waiter[]>()
  /** 防止同一 job 并发 poll */
  private polling = new Set<string>()

  list(): VideoJobRecord[] {
    if (!projectService.isOpen()) return []
    return videoJobRepository.list(projectService.getRoot())
  }

  get(localJobId: string): VideoJobRecord | null {
    if (!projectService.isOpen()) return null
    return videoJobRepository.get(projectService.getRoot(), localJobId)
  }

  create(input: CreateVideoJobInput): VideoJobRecord {
    if (!projectService.isOpen()) throw new Error('未打开工程')
    const now = new Date().toISOString()
    const job: VideoJobRecord = {
      version: 1,
      localJobId: input.localJobId?.trim() || randomUUID(),
      providerJobId: input.providerJobId,
      pollingUrl: input.pollingUrl,
      providerInstanceId: input.providerInstanceId,
      model: input.model,
      prompt: input.prompt,
      name: input.name,
      status: 'submitted',
      progress: 8,
      source: input.source,
      graphBinding: input.graphBinding,
      outputDir: input.outputDir?.trim() || undefined,
      tosUploads: input.tosUploads?.length ? [...input.tosUploads] : undefined,
      createdAt: now,
      submittedAt: now,
      updatedAt: now
    }
    const saved = videoJobRepository.write(projectService.getRoot(), job)
    this.emitUpdated(saved)
    this.schedulePoll(saved.localJobId, 0)
    return saved
  }

  /** 阻塞直到终态（供 generateVideo IPC） */
  waitUntilSettled(localJobId: string): Promise<VideoJobRecord> {
    const current = this.get(localJobId)
    if (!current) return Promise.reject(new Error(`未知视频任务: ${localJobId}`))
    if (!isVideoJobActive(current.status)) {
      if (current.status === 'succeeded') return Promise.resolve(current)
      return Promise.reject(new Error(current.error ?? '视频生成失败'))
    }

    return new Promise((resolve, reject) => {
      const list = this.waiters.get(localJobId) ?? []
      list.push({ resolve, reject })
      this.waiters.set(localJobId, list)

      // 注册 waiter 后再读一次，避免 create 已开的 poll 抢先终态导致永久挂起
      const again = this.get(localJobId)
      if (again && !isVideoJobActive(again.status)) {
        this.finishWaiters(
          again,
          again.status === 'succeeded' ? undefined : new Error(again.error ?? '视频生成失败')
        )
        return
      }

      if (!this.timers.has(localJobId) && !this.polling.has(localJobId)) {
        this.schedulePoll(localJobId, 0)
      }
    })
  }

  cancel(localJobId: string): VideoJobRecord | null {
    this.clearTimer(localJobId)
    const root = projectService.isOpen() ? projectService.getRoot() : null
    if (!root) return null
    const job = videoJobRepository.get(root, localJobId)
    if (!job) return null
    if (!isVideoJobActive(job.status)) return job

    const next = videoJobRepository.write(root, {
      ...job,
      status: 'cancelled',
      progress: 100,
      error: '已取消'
    })
    void this.cleanupTos(next)
    this.finishWaiters(next, new Error('已取消'))
    this.emitUpdated(next)
    videoJobRepository.pruneTerminal(root)
    return next
  }

  /** 打开工程后恢复未完成任务 */
  resumePending(): void {
    if (!projectService.isOpen()) return
    const root = projectService.getRoot()
    const active = videoJobRepository.listActive(root)
    for (const job of active) {
      const provider = findProviderById(
        settingsService.get().models.providers,
        job.providerInstanceId
      )
      if (!provider) {
        const failed = videoJobRepository.write(root, {
          ...job,
          status: 'failed',
          progress: 100,
          error: '视频提供商已移除，无法继续轮询'
        })
        void this.cleanupTos(failed)
        this.emitUpdated(failed)
        continue
      }
      if (this.isTimedOut(job)) {
        void this.failJob(job.localJobId, new Error('视频生成超时'))
        continue
      }
      this.schedulePoll(job.localJobId, 500)
    }
  }

  /** 关闭工程时停止本地 timer（磁盘任务保留） */
  stopAllTimers(): void {
    for (const id of [...this.timers.keys()]) {
      this.clearTimer(id)
    }
    this.polling.clear()
    for (const [id, list] of this.waiters) {
      for (const w of list) w.reject(new Error('工程已关闭'))
      this.waiters.delete(id)
    }
  }

  private isTimedOut(job: VideoJobRecord): boolean {
    const start = Date.parse(job.submittedAt || job.createdAt)
    if (!Number.isFinite(start)) return false
    return Date.now() - start >= MAX_WAIT_MS
  }

  private schedulePoll(localJobId: string, delayMs: number): void {
    this.clearTimer(localJobId)
    const timer = setTimeout(() => {
      this.timers.delete(localJobId)
      void this.pollOnce(localJobId)
    }, delayMs)
    this.timers.set(localJobId, timer)
  }

  private clearTimer(localJobId: string): void {
    const t = this.timers.get(localJobId)
    if (t) clearTimeout(t)
    this.timers.delete(localJobId)
  }

  private async pollOnce(localJobId: string): Promise<void> {
    if (this.polling.has(localJobId)) return
    if (!projectService.isOpen()) return

    const root = projectService.getRoot()
    let job = videoJobRepository.get(root, localJobId)
    if (!job || !isVideoJobActive(job.status)) return

    if (this.isTimedOut(job)) {
      await this.failJob(localJobId, new Error('视频生成超时'))
      return
    }

    this.polling.add(localJobId)
    try {
      const provider = findProviderById(
        settingsService.get().models.providers,
        job.providerInstanceId
      )
      if (!provider) {
        await this.failJob(localJobId, new Error('视频提供商已移除'))
        return
      }

      const { openRouterClient } = await import('./openRouterClient')
      const result = await openRouterClient.pollVideo(provider, {
        jobId: job.providerJobId,
        pollingUrl: job.pollingUrl
      })

      job = videoJobRepository.get(root, localJobId)
      if (!job || !isVideoJobActive(job.status)) return

      if (result.status === 'failed') {
        await this.failJob(localJobId, new Error(result.error ?? '视频生成失败'))
        return
      }

      if (result.status === 'completed') {
        if (!result.downloadUrl) {
          await this.failJob(localJobId, new Error('视频生成完成但未返回下载地址'))
          return
        }
        await this.completeJob(job, provider, result.downloadUrl)
        return
      }

      const progress = Math.max(job.progress, result.progress || 15)
      const updated = videoJobRepository.write(root, {
        ...job,
        status: 'running',
        progress
      })
      this.emitUpdated(updated)
      this.schedulePoll(localJobId, POLL_INTERVAL_MS)
    } catch (err) {
      await this.failJob(localJobId, err instanceof Error ? err : new Error(String(err)))
    } finally {
      this.polling.delete(localJobId)
    }
  }

  private async completeJob(
    job: VideoJobRecord,
    provider: import('@shared/modelProvider').ModelProviderInstance,
    downloadUrl: string
  ): Promise<void> {
    const { openRouterClient } = await import('./openRouterClient')
    const root = projectService.getRoot()
    const tmpDir = join(root, '.aiartengine', 'openrouter-video', job.localJobId)
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })
    const dest = join(tmpDir, 'output.mp4')
    await openRouterClient.downloadVideoToFile(provider, downloadUrl, dest)

    const asset = projectService.attachExternalGeneratedFile({
      type: 'video',
      sourceFilePath: dest,
      name: job.name ?? `生成视频 ${new Date().toLocaleString()}`,
      prompt: job.prompt,
      outputDir: resolveJobVideoOutputDir(job)
    })
    this.bestEffortPatchGraph(job, asset)

    const next = videoJobRepository.write(root, {
      ...job,
      status: 'succeeded',
      progress: 100,
      assetId: asset.id,
      relativePath: asset.relativePath,
      error: undefined,
      tosUploads: undefined
    })
    await this.cleanupTos(job)
    this.finishWaiters(next)
    this.emitUpdated(next)
    broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)
    videoJobRepository.pruneTerminal(root)
  }

  private bestEffortPatchGraph(job: VideoJobRecord, asset: AssetInfo): void {
    const binding = job.graphBinding
    if (!binding?.nodeId || !binding.assetId) return
    try {
      const host = projectService.listAssets().find((a) => a.id === binding.assetId)
      const graphJson = host?.genParams?.graphJson as
        | { nodes?: Array<{ id: string; params?: Record<string, unknown> }> }
        | undefined
      if (!graphJson?.nodes) return
      const node = graphJson.nodes.find((n) => n.id === binding.nodeId)
      if (!node) return
      const createdAt = new Date().toISOString()
      node.params = {
        ...(node.params ?? {}),
        previewRelativePath: asset.relativePath
      }
      const updated: AssetInfo = {
        ...host!,
        genParams: { ...(host!.genParams ?? {}), graphJson },
        updatedAt: createdAt
      }
      projectService.updateAsset(updated)
      broadcastToAllWindows(IpcChannels.ASSET_UPDATED, updated)
    } catch (err) {
      console.warn('[videoJob] 回写图节点失败（已落盘资产）:', err)
    }
  }

  private async failJob(localJobId: string, err: Error): Promise<void> {
    if (!projectService.isOpen()) return
    const root = projectService.getRoot()
    const job = videoJobRepository.get(root, localJobId)
    if (!job || !isVideoJobActive(job.status)) return

    const next = videoJobRepository.write(root, {
      ...job,
      status: 'failed',
      progress: 100,
      error: err.message,
      tosUploads: undefined
    })
    await this.cleanupTos(job)
    this.finishWaiters(next, err)
    this.emitUpdated(next)
    videoJobRepository.pruneTerminal(root)
  }

  private async cleanupTos(job: VideoJobRecord): Promise<void> {
    const uploads = job.tosUploads
    if (!uploads?.length) return
    try {
      await deleteTosUploads(uploads)
    } catch (err) {
      console.warn('[videoJob] 清理 TOS 失败:', err)
    }
    if (projectService.isOpen()) {
      videoJobRepository.patch(projectService.getRoot(), job.localJobId, { tosUploads: undefined })
    }
  }

  private finishWaiters(job: VideoJobRecord, error?: Error): void {
    const list = this.waiters.get(job.localJobId)
    if (!list?.length) return
    this.waiters.delete(job.localJobId)
    for (const w of list) {
      if (error || job.status === 'failed' || job.status === 'cancelled') {
        w.reject(error ?? new Error(job.error ?? '视频生成失败'))
      } else {
        w.resolve(job)
      }
    }
  }

  private emitUpdated(job: VideoJobRecord): void {
    broadcastToAllWindows(IpcChannels.VIDEO_JOB_UPDATED, job)
  }
}

export const videoJobService = new VideoJobService()

/** 供测试读取常量 */
export const __videoJobTest = {
  POLL_INTERVAL_MS,
  MAX_WAIT_MS
}
