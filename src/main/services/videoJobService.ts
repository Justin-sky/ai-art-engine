import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { basename, dirname, join } from 'path'
import type { AssetInfo } from '@shared/domain'
import { resolveMediaOutputDir, shouldRegisterOutputInAssetLibrary } from '@shared/domain'
import type {
  VideoJobExtra,
  VideoJobGraphBinding,
  VideoJobKind,
  VideoJobRecord,
  VideoJobUpload
} from '@shared/videoJob'
import { isVideoJobActive, jobKind } from '@shared/videoJob'
import { mergeSpatialWorldMeta } from '@shared/spatialWorldMeta'
import { setWorldMetaJobResolver } from './projectService'
import { IpcChannels } from '@shared/ipc'
import { findProviderById } from '@shared/modelProvider'
import { fail, defErr, defErrSimple, type BiDef } from '@shared/errors/appError'
import { isAuthFailure } from './modelProviders/http'
import { MAIN_ERRORS } from '../errors/messages'
import { broadcastToAllWindows } from '../broadcast'
import { videoJobRepository } from '../repositories/videoJobRepository'
import { deleteUploads } from './objectStorageUploadService'
import { projectService } from './projectService'
import { settingsService } from './settingsService'

// ── 视频任务个性错误（error 会持久化到任务记录并原样展示，两语文案需自然完整）──
const E_VIDEOJOB_UNKNOWN_JOB = defErr<{ jobId: string }>(
  'videoJob.unknownJob',
  ({ jobId }) => `未知视频任务: ${jobId}`,
  ({ jobId }) => `Unknown video job: ${jobId}`
)
const E_VIDEOJOB_GENERATE_FAILED = defErrSimple(
  'videoJob.generateFailed',
  '视频生成失败',
  'Video generation failed'
)
const E_VIDEOJOB_CANCELLED = defErrSimple('videoJob.cancelled', '已取消', 'Cancelled')
const E_VIDEOJOB_PROVIDER_REMOVED = defErrSimple(
  'videoJob.providerRemoved',
  '视频提供商已移除',
  'The video provider has been removed'
)
const E_VIDEOJOB_PROVIDER_REMOVED_RESUMING = defErrSimple(
  'videoJob.providerRemovedResuming',
  '视频提供商已移除，无法继续轮询',
  'The video provider has been removed; polling cannot continue'
)
const E_VIDEOJOB_MISSING_DOWNLOAD_URL = defErrSimple(
  'videoJob.missingDownloadUrl',
  '视频生成完成但未返回下载地址',
  'Video generation finished but returned no download URL'
)
const E_VIDEOJOB_PROJECT_CLOSED = defErrSimple(
  'videoJob.projectClosed',
  '工程已关闭',
  'Project has been closed'
)
const E_VIDEOJOB_POLL_UNSTABLE = defErr<{ count: number; detail?: string }>(
  'videoJob.pollUnstable',
  ({ count, detail }) =>
    `轮询供应商状态连续失败 ${count} 次，已停止。远端任务可能仍在进行，可稍后重试；若反复出现请检查网络与提供商 Base URL` +
    (detail?.trim() ? `（最近错误：${detail.trim()}）` : ''),
  ({ count, detail }) =>
    `Polling the provider failed ${count} consecutive times; stopped. The remote task may still be running — retry later, and check the network and provider Base URL if this repeats` +
    (detail?.trim() ? ` (last error: ${detail.trim()})` : '')
)
/**
 * 产物下载失败：按任务类型说清是什么产物 —— 世界 / 3D 模型不是视频，文案不能串台
 * （实测世界生成失败时曾报「视频已生成但下载失败」）。
 */
const DOWNLOAD_FAILED_BY_KIND: Record<VideoJobKind, BiDef<{ detail: string }>> = {
  video: defErr<{ detail: string }>(
    'videoJob.downloadFailed.video',
    ({ detail }) => `视频已生成但下载失败：${detail}`,
    ({ detail }) => `Video finished but download failed: ${detail}`
  ),
  model3d: defErr<{ detail: string }>(
    'videoJob.downloadFailed.model3d',
    ({ detail }) => `3D 模型已生成但下载失败：${detail}`,
    ({ detail }) => `The 3D model finished but download failed: ${detail}`
  ),
  spatialWorld: defErr<{ detail: string }>(
    'videoJob.downloadFailed.spatialWorld',
    ({ detail }) => `空间世界已生成但下载失败：${detail}`,
    ({ detail }) => `The spatial world finished but download failed: ${detail}`
  ),
  spatialWorldExport: defErr<{ detail: string }>(
    'videoJob.downloadFailed.spatialWorldExport',
    ({ detail }) => `空间世界导出已完成但下载失败：${detail}`,
    ({ detail }) => `The spatial world export finished but download failed: ${detail}`
  )
}

/** 按当前语言取消息（任务记录里存的文案在调用时刻固化） */
function msg(def: BiDef<undefined>): string {
  return fail(def).message
}

const POLL_INTERVAL_MS = 5000

/**
 * 轮询瞬时失败容忍度：一次网络抖动（超时 / DNS / 5xx）不该判死整条生成任务——
 * vendor 远端往往已经在真跑，判死后上游 agent 会重发请求造成重复生成。
 * 连续失败按退避重试，超过预算才判定任务失败；鉴权类错误（Key 失效）立即判死。
 *
 * 3D 模型生成通常比视频更慢（Tripo/Meshy/Rodin 动辄 10~30 分钟），
 * 同样 20 次连续失败≈8 分钟，对 3D 来说太容易误判。故 3D 单独放宽到 120 次，
 * 按退避策略≈58 分钟，覆盖绝大多数慢任务而不致无限等待。
 * 空间世界（World Labs Marble）单次生成约 5 分钟，且上游没有流式进度，
 * 轮询抖动同样不该判死，与 3D 用同一档预算。
 */
const POLL_TRANSIENT_MAX = 20
const POLL_TRANSIENT_MAX_MODEL3D = 120
/** 产物下载重试：vendor 刚完成时 CDN 偶发 5xx / 超时，一次失败不应判死 */
const DOWNLOAD_MAX_ATTEMPTS = 3
const DOWNLOAD_RETRY_DELAY_MS = 5000
/**
 * 一次下载彻底失败后，最多再自动补取几次（每次打开工程算一次机会）。
 * 下载失败几乎都是瞬时故障（CDN 5xx / 断网 / 代理），而生成本身已经花过积分，
 * 值得再试；但也不能无限重试，取一个够用的上限。
 */
const JOB_RECOVERY_MAX_ATTEMPTS = 3
/** 补取的退避：第 n 次补取等 n × 该间隔，避免和刚失败的那次挤在同一时间窗 */
const JOB_RECOVERY_BACKOFF_MS = 15_000

/** 慢任务（3D 模型 / 空间世界 / 空间世界导出）：按任务类型取瞬时失败容忍上限 */
function pollTransientMaxFor(kind: VideoJobKind): number {
  return kind === 'model3d' || kind === 'spatialWorld' || kind === 'spatialWorldExport'
    ? POLL_TRANSIENT_MAX_MODEL3D
    : POLL_TRANSIENT_MAX
}

/** 产物是 3D 网格文件（而非视频）的任务类型：3D 模型 / 空间世界 / 空间世界导出共用下载与登记口径 */
function isMeshJobKind(kind: VideoJobKind): boolean {
  return kind === 'model3d' || kind === 'spatialWorld' || kind === 'spatialWorldExport'
}

/**
 * 3D 产物落盘文件名：按下载直链后缀推断真实格式。
 * 上游可能返回 FBX（如 Tripo 绑骨 / 重定向传 `out_format: fbx`），
 * 一律存成 `.glb` 会让资产库与预览按 GLB 解析失败；拿不到后缀时仍按 GLB。
 */
export function resolveModel3dDownloadName(downloadUrl: string): string {
  const path = (downloadUrl ?? '').split(/[?#]/)[0] ?? ''
  const hit = /\.(glb|gltf|fbx|obj|stl|usdz|ply)$/i.exec(path)
  return `output.${hit?.[1]?.toLowerCase() ?? 'glb'}`
}

/** 附加产物（空间世界）在主产物旁边的文件名后缀：高斯泼溅 SPZ / 360 全景图 */
export function extraDownloadSuffix(kind: string): string {
  if (kind === 'splats') return '.spz'
  if (kind === 'pano') return '.pano.png'
  return `.${kind.replace(/[^a-z0-9]/gi, '') || 'extra'}`
}

/**
 * 直链自身的扩展名（小写、带点）；路径里没有可用后缀时返回空串。
 * 上游按哈希命名、或直链没有后缀，此时由调用方退回按类型的约定后缀。
 */
export function extraDownloadUrlExt(url: string): string {
  const clean = (url ?? '').split(/[?#]/)[0] ?? ''
  const base = clean.slice(clean.lastIndexOf('/') + 1)
  const hit = /\.([a-z0-9]{1,8})$/i.exec(base)
  return hit?.[1] ? `.${hit[1].toLowerCase()}` : ''
}

/**
 * 附加产物是否还没取全：记录里留了条目但没有 `relativePath`（下载失败时只保留直链）。
 * 成功的任务据此判断要不要补取，不必去读磁盘。
 */
export function hasPendingExtras(job: Pick<VideoJobRecord, 'extras'>): boolean {
  return (job.extras ?? []).some((item) => !item.relativePath?.trim())
}

/**
 * 是否值得「补取产物」：只有**上游已经生成好、积分已经花掉、只是文件没下回来**的任务才够格。
 *
 * 判据是记录里存着 `resourceId`（拿到它说明上游 operation 已经 done），而不是去猜 error 文案：
 * - 视频任务没有 resourceId 概念，这条救济通路暂不覆盖；
 * - 正在跑的 / 用户主动取消的不动；
 * - 重试预算用尽后不再打扰（避免每次打开工程都重下一遍）。
 */
export function shouldRecoverJob(
  job: Pick<
    VideoJobRecord,
    | 'status'
    | 'kind'
    | 'resourceId'
    | 'providerJobId'
    | 'pollingUrl'
    | 'recoveryAttempts'
    | 'extras'
  >,
  maxAttempts: number = JOB_RECOVERY_MAX_ATTEMPTS
): boolean {
  if (isVideoJobActive(job.status) || job.status === 'cancelled') return false
  if (jobKind(job as VideoJobRecord) === 'video') return false
  if (!job.resourceId?.trim()) return false
  if (!job.providerJobId?.trim() && !job.pollingUrl?.trim()) return false
  if ((job.recoveryAttempts ?? 0) >= maxAttempts) return false
  // 失败的任务，或「主产物在、附加产物缺项」的任务
  return job.status === 'failed' || hasPendingExtras(job)
}

/** 第 n 次补取的延迟：与刚失败的那次错开，避免挤在同一个时间窗 */
export function recoveryDelayMs(attempt: number): number {
  const n = Math.max(1, Math.trunc(attempt) || 1)
  return JOB_RECOVERY_BACKOFF_MS * n
}

/**
 * 主产物相对路径 → 同目录同名的附加产物相对路径（换后缀）。
 * 与主产物放在一起是刻意的：导入 Blender / Unreal 时一整个文件夹搬过去即可。
 */
export function siblingOutputPath(mainRelativePath: string, suffix: string): string {
  const posix = mainRelativePath.replace(/\\/g, '/')
  const slash = posix.lastIndexOf('/')
  const dir = slash >= 0 ? posix.slice(0, slash + 1) : ''
  const base = slash >= 0 ? posix.slice(slash + 1) : posix
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  return `${dir}${stem}${suffix}`
}

/** 瞬时失败退避：前 2 次 5s，3-5 次 15s，之后 30s */
function pollRetryDelayMs(count: number): number {
  if (count <= 2) return POLL_INTERVAL_MS
  if (count <= 5) return 15_000
  return 30_000
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export interface CreateVideoJobInput {
  kind: VideoJobKind
  providerJobId: string
  pollingUrl: string
  providerInstanceId: string
  model: string
  prompt: string
  name?: string
  source: VideoJobRecord['source']
  graphBinding?: VideoJobGraphBinding
  outputDir?: string
  uploads?: VideoJobUpload[]
  localJobId?: string
}

type Waiter = {
  resolve: (job: VideoJobRecord) => void
  reject: (err: Error) => void
}

function resolveJobOutputDir(job: VideoJobRecord): string {
  return resolveMediaOutputDir({
    mediaOutputDir: job.outputDir,
    cacheOutputDir: projectService.isOpen() ? projectService.getConfig().cacheOutputDir : undefined,
    kind: isMeshJobKind(jobKind(job)) ? 'model' : 'video'
  })
}

class VideoJobService {
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private waiters = new Map<string, Waiter[]>()
  /** 防止同一 job 并发 poll */
  private polling = new Set<string>()
  /** 连续轮询瞬时失败计数（内存态，不落盘；成功一次即清零） */
  private pollFailures = new Map<string, number>()

  list(): VideoJobRecord[] {
    if (!projectService.isOpen()) return []
    return videoJobRepository.list(projectService.getRoot())
  }

  get(localJobId: string): VideoJobRecord | null {
    if (!projectService.isOpen()) return null
    return videoJobRepository.get(projectService.getRoot(), localJobId)
  }

  create(input: CreateVideoJobInput): VideoJobRecord {
    if (!projectService.isOpen()) throw fail(MAIN_ERRORS.noProject)
    const now = new Date().toISOString()
    const job: VideoJobRecord = {
      version: 1,
      kind: input.kind,
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
      uploads: input.uploads?.length ? [...input.uploads] : undefined,
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
    if (!current) return Promise.reject(fail(E_VIDEOJOB_UNKNOWN_JOB, { jobId: localJobId }))
    if (!isVideoJobActive(current.status)) {
      if (current.status === 'succeeded') return Promise.resolve(current)
      return Promise.reject(new Error(current.error ?? msg(E_VIDEOJOB_GENERATE_FAILED)))
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
          again.status === 'succeeded'
            ? undefined
            : new Error(again.error ?? msg(E_VIDEOJOB_GENERATE_FAILED))
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
      error: msg(E_VIDEOJOB_CANCELLED)
    })
    this.pollFailures.delete(localJobId)
    void this.cleanupUploads(next)
    this.finishWaiters(next, new Error(msg(E_VIDEOJOB_CANCELLED)))
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
          error: msg(E_VIDEOJOB_PROVIDER_REMOVED_RESUMING)
        })
        void this.cleanupUploads(failed)
        this.emitUpdated(failed)
        continue
      }
      this.schedulePoll(job.localJobId, 500)
    }
    // 上次因为下载失败判死的任务：产物在上游已经生成好了（积分已经花掉），
    // 只差把文件取回来 —— 拿 resourceId 重新轮询一次即可，不必重新生成。
    // 也覆盖「主产物下回来了、附加产物（泼溅 / 全景）没取全」的补取
    for (const job of this.list()) {
      if (!shouldRecoverJob(job)) continue
      const attempts = (job.recoveryAttempts ?? 0) + 1
      const retried = videoJobRepository.write(root, {
        ...job,
        status: 'submitted',
        progress: 15,
        error: undefined,
        uploads: undefined,
        recoveryAttempts: attempts
      })
      if (job.uploads?.length) void this.cleanupUploads(job)
      this.emitUpdated(retried)
      this.schedulePoll(retried.localJobId, recoveryDelayMs(attempts))
    }
  }

  /** 关闭工程时停止本地 timer（磁盘任务保留） */
  stopAllTimers(): void {
    for (const id of [...this.timers.keys()]) {
      this.clearTimer(id)
    }
    this.polling.clear()
    this.pollFailures.clear()
    for (const [id, list] of this.waiters) {
      for (const w of list) w.reject(new Error(msg(E_VIDEOJOB_PROJECT_CLOSED)))
      this.waiters.delete(id)
    }
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
    // 任务类型在 try 外固定下来：catch 里也要用它挑瞬时失败预算，
    // 而 `job` 在 catch 中已被重新赋值过、类型上可能是 null。
    const kind = jobKind(job)

    this.polling.add(localJobId)
    try {
      const provider = findProviderById(
        settingsService.get().models.providers,
        job.providerInstanceId
      )
      if (!provider) {
        await this.failJob(localJobId, new Error(msg(E_VIDEOJOB_PROVIDER_REMOVED)))
        return
      }

      const { modelProviderFacade } = await import('./modelProviders')
      const pollJob = { jobId: job.providerJobId, pollingUrl: job.pollingUrl }
      const result =
        kind === 'spatialWorldExport'
          ? await modelProviderFacade.pollSpatialWorldExport(provider, pollJob)
          : kind === 'spatialWorld'
            ? await modelProviderFacade.pollWorld(provider, pollJob)
            : kind === 'model3d'
              ? await modelProviderFacade.pollModel3d(provider, pollJob)
              : await modelProviderFacade.pollVideo(provider, pollJob)

      job = videoJobRepository.get(root, localJobId)
      if (!job || !isVideoJobActive(job.status)) return

      if (result.status === 'failed') {
        await this.failJob(localJobId, new Error(result.error ?? msg(E_VIDEOJOB_GENERATE_FAILED)))
        return
      }

      if (result.status === 'completed') {
        if (!result.downloadUrl) {
          await this.failJob(localJobId, new Error(msg(E_VIDEOJOB_MISSING_DOWNLOAD_URL)))
          return
        }
        // 下载失败与轮询瞬时错误分开：否则 OpenRouter content 401 会被凑满 20 次误报成「轮询失败」
        try {
          await this.completeJob(
            job,
            provider,
            result.downloadUrl,
            result.extraDownloads,
            result.resourceId
          )
        } catch (downloadErr) {
          const detail = downloadErr instanceof Error ? downloadErr.message : String(downloadErr)
          await this.failJob(
            localJobId,
            new Error(fail(DOWNLOAD_FAILED_BY_KIND[job.kind ?? 'video'], { detail }).message)
          )
        }
        return
      }

      const progress = Math.max(job.progress, result.progress || 15)
      const updated = videoJobRepository.write(root, {
        ...job,
        status: 'running',
        progress,
        ...(result.pollingUrl && result.pollingUrl !== job.pollingUrl
          ? { pollingUrl: result.pollingUrl }
          : {})
      })
      this.emitUpdated(updated)
      // 本次轮询成功：清零连续失败计数
      this.pollFailures.delete(localJobId)
      this.schedulePoll(localJobId, POLL_INTERVAL_MS)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      // 鉴权类错误立即判死：Key 失效 / 无权限，重试没有意义
      if (isAuthFailure(undefined, error.message)) {
        await this.failJob(localJobId, error)
        return
      }
      // 瞬时错误（超时 / DNS / 5xx / 限流）：退避后重试，超预算才判死
      const count = (this.pollFailures.get(localJobId) ?? 0) + 1
      if (count >= pollTransientMaxFor(kind)) {
        this.pollFailures.delete(localJobId)
        await this.failJob(
          localJobId,
          new Error(fail(E_VIDEOJOB_POLL_UNSTABLE, { count, detail: error.message }).message)
        )
        return
      }
      this.pollFailures.set(localJobId, count)
      this.schedulePoll(localJobId, pollRetryDelayMs(count))
    } finally {
      this.polling.delete(localJobId)
    }
  }

  private async completeJob(
    job: VideoJobRecord,
    provider: import('@shared/modelProvider').ModelProviderInstance,
    downloadUrl: string,
    extraDownloads?: Array<{ kind: string; url: string }>,
    resourceId?: string
  ): Promise<void> {
    const { modelProviderFacade } = await import('./modelProviders')
    const root = projectService.getRoot()
    const kind = jobKind(job)
    const isMeshJob = isMeshJobKind(kind)
    // 与视频一致：显式 outputDir > 缓存根下 {Videos|Models}（3D 模型 / 空间世界缺省 Cache/Models）
    const outputDir = resolveJobOutputDir(job)
    const pendingExtras = extraDownloads?.length
      ? extraDownloads.map((item) => ({ kind: item.kind, url: item.url }))
      : undefined

    /**
     * 先把「上游资源 id + 主产物落点 + 待取附加产物」落盘，再开始下载文件。
     * 下载失败时这三样是重新取回产物的钥匙：凭 resourceId 重轮询就能再拿一次直链；
     * 主产物落点先用计划值占位，登记成功后再回写真实相对路径。
     */
    const checkpoint = videoJobRepository.write(root, {
      ...job,
      status: 'submitted',
      progress: 96,
      error: undefined,
      uploads: undefined,
      ...(resourceId?.trim() ? { resourceId: resourceId.trim() } : {}),
      ...(extraDownloads !== undefined ? { extras: pendingExtras } : {})
    })

    const dest = join(
      root,
      '.aiartengine',
      isMeshJob ? 'model3d-download' : 'video-download',
      job.localJobId,
      isMeshJob ? resolveModel3dDownloadName(downloadUrl) : 'output.mp4'
    )

    // ── 主产物 ──
    // 已经在磁盘上（上一次运行下成功过、只是附加产物没取全）就不再下一遍：
    // 本次只需补齐缺的那几项，末段照常重新登记，登记语义是「就地覆盖同名文件」
    const mainOnDisk = checkpoint.relativePath?.trim()
      ? existsSync(join(root, checkpoint.relativePath.trim()))
      : false
    let asset: AssetInfo
    if (mainOnDisk) {
      // 走一遍登记：产物文件就在原处，等于把上次没写完的记录补全（不改名、不换目录）
      asset = projectService.attachExternalGeneratedFile({
        type: isMeshJob ? 'model' : 'video',
        sourceFilePath: join(root, checkpoint.relativePath!.trim()),
        // 复用已落盘文件的文件名当缺省名（产物就在原处，不改名）
        name: job.name ?? basename(checkpoint.relativePath!.trim()),
        prompt: job.prompt,
        outputDir
      })
    } else {
      if (!existsSync(dirname(dest))) mkdirSync(dirname(dest), { recursive: true })
      // 下载重试：vendor 刚完成时 CDN 偶发 5xx / 超时，一次失败不应判死整条任务
      let downloadErr: unknown
      for (let attempt = 1; attempt <= DOWNLOAD_MAX_ATTEMPTS; attempt++) {
        try {
          await modelProviderFacade.downloadVideoToFile(provider, downloadUrl, dest)
          downloadErr = undefined
          break
        } catch (err) {
          downloadErr = err
          if (attempt < DOWNLOAD_MAX_ATTEMPTS) await sleep(DOWNLOAD_RETRY_DELAY_MS)
        }
      }
      if (downloadErr) throw downloadErr
      asset = projectService.attachExternalGeneratedFile({
        type: isMeshJob ? 'model' : 'video',
        sourceFilePath: dest,
        name:
          job.name ??
          (kind === 'spatialWorldExport'
            ? `空间世界导出 ${new Date().toLocaleString()}`
            : kind === 'spatialWorld'
              ? `生成空间世界 ${new Date().toLocaleString()}`
              : kind === 'model3d'
                ? `生成 3D 模型 ${new Date().toLocaleString()}`
                : `生成视频 ${new Date().toLocaleString()}`),
        prompt: job.prompt,
        outputDir
      })
    }
    this.bestEffortPatchGraph(checkpoint, asset)

    this.pollFailures.delete(job.localJobId)
    // 主产物已登记：先把终态落盘，再补附加产物 —— 附加产物失败或中途崩溃都不会丢主产物
    const next = videoJobRepository.write(root, {
      ...checkpoint,
      status: 'succeeded',
      progress: 100,
      assetId: asset.id,
      relativePath: asset.relativePath,
      error: undefined,
      uploads: undefined,
      extras: pendingExtras
    })
    this.emitUpdated(next)

    const settled =
      (await this.downloadExtras(next, provider, asset.relativePath, pendingExtras, job.extras)) ??
      next
    await this.cleanupUploads(checkpoint)
    this.finishWaiters(settled)
    this.emitUpdated(settled)
    // 只有真的登记进资产库的产物才广播（Cache/ 与库外目录只返回内存 AssetInfo）
    if (shouldRegisterOutputInAssetLibrary(outputDir, projectService.getConfig().cacheOutputDir)) {
      broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)
    }
    videoJobRepository.pruneTerminal(root)
  }

  /**
   * 下载附加产物（空间世界的高斯泼溅 SPZ / 360 全景图）到**主产物旁边的同名文件**，
   * 并把相对路径回写进任务记录。
   *
   * 逐项独立容错：附加产物是锦上添花，任何一项失败都只记 warn 并清掉半截文件，
   * 绝不让整条已成功的生成任务翻成失败；返回带路径的新记录（没有附加产物时返回 null）。
   */
  /**
   * 泼溅产物（SPZ）登记为模型资产：世界生成随世界**免费**返回高斯泼溅，
   * 导演台据此直接做泼溅渲染，不必再跑一次付费的 PLY 导出。
   * 复用主产物的登记口径；失败只记 warn —— 附加产物是锦上添花，不能反噬已成功的任务。
   */
  private registerSplatAsset(
    job: VideoJobRecord,
    absPath: string
  ): ReturnType<typeof projectService.attachExternalGeneratedFile> | null {
    try {
      const asset = projectService.attachExternalGeneratedFile({
        type: 'model',
        sourceFilePath: absPath,
        name: job.name ?? `生成空间世界 ${new Date().toLocaleString()}`,
        prompt: job.prompt,
        outputDir: job.outputDir
      })
      if (
        shouldRegisterOutputInAssetLibrary(job.outputDir, projectService.getConfig().cacheOutputDir)
      ) {
        broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)
      }
      return asset
    } catch (err) {
      console.warn(`[videoJob] 附加产物登记资产失败（不影响主产物）: ${job.localJobId}`, err)
      return null
    }
  }

  private async downloadExtras(
    job: VideoJobRecord,
    provider: import('@shared/modelProvider').ModelProviderInstance,
    mainRelativePath: string,
    extraDownloads?: Array<{ kind: string; url: string }>,
    /** 上一次已经取回来的那些（补取时只处理缺的，别把已有的覆盖一遍） */
    alreadyDownloaded?: VideoJobExtra[]
  ): Promise<VideoJobRecord | null> {
    if (!extraDownloads?.length || !mainRelativePath) return null
    const { modelProviderFacade } = await import('./modelProviders')
    const root = projectService.getRoot()

    // 只把**上次真的落盘了**的那些带过来；上次失败留下的「只有直链」条目要重新下
    const resolved: VideoJobExtra[] = (alreadyDownloaded ?? []).filter((entry) =>
      Boolean(entry.relativePath?.trim())
    )
    for (const item of extraDownloads) {
      // 泼溅只认 .ply / .spz 扩展名：优先按上游直链实际给的后缀落盘，拿不到再按类型约定
      const suffix = extraDownloadUrlExt(item.url) || extraDownloadSuffix(item.kind)
      const relativePath = siblingOutputPath(mainRelativePath, suffix)
      const existing = resolved.find((entry) => entry.kind === item.kind)
      if (existing) {
        // 已经取回来过：只更新本次的直链（直链会过期，记录里留最新的那条）
        existing.url = item.url
        continue
      }
      const absPath = join(root, relativePath)
      try {
        await modelProviderFacade.downloadVideoToFile(provider, item.url, absPath)
        // 泼溅（SPZ）额外登记为模型资产：导演台可直接用它做高斯泼溅渲染，
        // 不必再跑一次付费的 PLY 导出；登记失败不影响附加产物本身
        const extraAsset = item.kind === 'splats' ? this.registerSplatAsset(job, absPath) : null
        resolved.push({
          kind: item.kind,
          url: item.url,
          relativePath,
          ...(extraAsset ? { assetId: extraAsset.id } : {})
        })
      } catch (err) {
        // 半截文件不能留在产物目录里冒充成品
        try {
          if (existsSync(absPath)) rmSync(absPath, { force: true })
        } catch {
          // 清理失败不追加报错
        }
        console.warn(`[videoJob] 附加产物下载失败（不影响主产物）: ${item.kind}`, err)
        resolved.push({ kind: item.kind, url: item.url })
      }
    }

    // 世界的身份与附件**落进资产记录**：此前它们只存在于图的节点参数（运行态），
    // 于是重启应用、或只把产物保存到资产库之后，导出端点拿不到 world_id
    //（再也导不出网格），泼溅 / 全景也没有任何记录说明它们属于这个世界。
    this.persistWorldMetaOnAsset(job, resolved)

    return videoJobRepository.write(root, { ...job, extras: resolved })
  }

  /**
   * 把世界 id 与附件写进主产物资产的 `genParams`（尽力而为，失败只记日志）。
   *
   * 读一次最新资产再合并：资产在任务期间可能被改名 / 移动 / 保存进资产库，
   * 直接拿任务里的快照会覆盖掉这些改动。
   */
  private persistWorldMetaOnAsset(job: VideoJobRecord, extras: VideoJobExtra[]): void {
    if (job.kind !== 'spatialWorld') return
    const assetId = job.assetId?.trim()
    const relativePath = job.relativePath?.trim()
    if (!assetId && !relativePath) return
    try {
      const asset = projectService
        .listAssets()
        .find(
          (item) => item.id === assetId || (!!relativePath && item.relativePath === relativePath)
        )
      if (!asset) return
      const merged = mergeSpatialWorldMeta(asset.genParams, {
        spatialWorldId: job.resourceId,
        spatialWorldExtras: extras
          .filter((item) => !!item.relativePath?.trim())
          .map((item) => ({
            kind: item.kind,
            relativePath: item.relativePath!.trim(),
            ...(item.assetId?.trim() ? { assetId: item.assetId.trim() } : {})
          }))
      })
      const updated = projectService.updateAsset({ ...asset, genParams: merged })
      broadcastToAllWindows(IpcChannels.ASSET_UPDATED, updated)
    } catch (err) {
      console.warn('[videoJob] 世界元数据写回资产失败（不影响产物）:', err) // cjk-ok：主进程开发日志
    }
  }

  private bestEffortPatchGraph(job: VideoJobRecord, asset: AssetInfo): void {
    const binding = job.graphBinding
    if (!binding?.nodeId || !binding.assetId) return
    try {
      const host = projectService.listAssets().find((a) => a.id === binding.assetId)
      const graphJson = host?.genParams?.graphJson as
        { nodes?: Array<{ id: string; params?: Record<string, unknown> }> } | undefined
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
    this.pollFailures.delete(localJobId)

    const next = videoJobRepository.write(root, {
      ...job,
      status: 'failed',
      progress: 100,
      error: err.message,
      uploads: undefined
    })
    await this.cleanupUploads(job)
    this.finishWaiters(next, err)
    this.emitUpdated(next)
    videoJobRepository.pruneTerminal(root)
  }

  private async cleanupUploads(job: VideoJobRecord): Promise<void> {
    const uploads = job.uploads
    if (!uploads?.length) return
    try {
      await deleteUploads(uploads)
    } catch (err) {
      console.warn('[videoJob] 清理对象存储失败:', err)
    }
    if (projectService.isOpen()) {
      videoJobRepository.patch(projectService.getRoot(), job.localJobId, { uploads: undefined })
    }
  }

  private finishWaiters(job: VideoJobRecord, error?: Error): void {
    const list = this.waiters.get(job.localJobId)
    if (!list?.length) return
    this.waiters.delete(job.localJobId)
    for (const w of list) {
      if (error || job.status === 'failed' || job.status === 'cancelled') {
        w.reject(error ?? new Error(job.error ?? msg(E_VIDEOJOB_GENERATE_FAILED)))
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

/**
 * 把「取任务记录」的能力交给 `projectService`，供它做世界附件入库时回查世界 id 与附件。
 *
 * 走注册而不是让 `projectService` 直接 import 本模块：本模块依赖它（读工程、登记资产），
 * 反向再依赖一次就成环；注册发生在**两个模块都定义完成之后**，环断在这里。
 */
setWorldMetaJobResolver(() => videoJobService.list())

/** 供测试读取常量 */
export const __videoJobTest = {
  POLL_INTERVAL_MS
}
