/** 工程内持久化的视频生成任务（跨重启可续轮询） */

export type VideoJobStatus = 'submitted' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** 任务类型：视频 / 3D 模型 / 空间世界（World Labs Marble）/ 空间世界导出（HQ 网格） */
export type VideoJobKind = 'video' | 'model3d' | 'spatialWorld' | 'spatialWorldExport'

export type VideoJobSource = 'graph'

/** 可落盘的对象存储临时参考（终态后删除） */
export interface VideoJobUpload {
  objectKey: string
  url: string
  bytes: number
  bucket: string
  providerId: string
  providerLabel: string
  sourceLabel: string
}

/**
 * 主产物之外的附加产物（空间世界：`splats` 高斯泼溅 SPZ / `pano` 360 全景图）。
 * 落盘在主产物文件旁边（同名 + 类型后缀），失败时 `relativePath` 留空并只记 warn。
 */
export interface VideoJobExtra {
  kind: string
  url: string
  relativePath?: string
  /**
   * 已登记为资产时的 id（目前只有 `splats` 会登记：泼溅作为模型资产登记后，
   * 导演台可以直接拿它做泼溅渲染，不必再跑一次付费的 PLY 导出）。
   */
  assetId?: string
}

export interface VideoJobGraphBinding {
  hostId?: string
  nodeId?: string
  assetId?: string
  shotId?: string
  canvasField?: string
}

export interface VideoJobRecord {
  version: 1
  /** 任务类型；旧落盘记录无此字段，按 video 兜底 */
  kind?: VideoJobKind
  localJobId: string
  providerJobId: string
  pollingUrl: string
  providerInstanceId: string
  model: string
  prompt: string
  name?: string
  status: VideoJobStatus
  progress: number
  source: VideoJobSource
  graphBinding?: VideoJobGraphBinding
  /** 视频副本输出目录（相对工程根） */
  outputDir?: string
  uploads?: VideoJobUpload[]
  /** 附加产物（空间世界的高斯泼溅 / 全景图）：随主产物一起落盘 */
  extras?: VideoJobExtra[]
  /**
   * 上游资源 id（空间世界的 World.id）。空间世界导出端点只认它，
   * 所以生成阶段就要落进任务记录，随结果透给下游「空间世界导出」节点。
   *
   * 在**下载产物之前**就写进记录：下载失败时这是重新取回产物的唯一钥匙
   *（凭它重新轮询上游 operation 就能再拿一次下载直链，不必再花一次生成积分）。
   */
  resourceId?: string
  /**
   * 失败后「重新取回产物」的尝试次数（成功的任务不记）。
   * 下载失败是瞬时故障（CDN 5xx / 断网），打开工程时按它自动补取，上限见 videoJobService。
   */
  recoveryAttempts?: number
  /** ISO：任务创建时间（超时从此时起算） */
  createdAt: string
  /** ISO：提交到供应商成功时间 */
  submittedAt: string
  updatedAt: string
  assetId?: string
  relativePath?: string
  error?: string
}

export function isVideoJobActive(status: VideoJobStatus): boolean {
  return status === 'submitted' || status === 'running'
}

export function jobKind(job: VideoJobRecord): VideoJobKind {
  return job.kind ?? 'video'
}

/**
 * 找回空间世界 world_id 时用的**候选记录**挑选规则（主进程与渲染端共用一份）。
 *
 * `world_id` 只活在节点出口值（`spatialWorldId`）与任务记录（`resourceId`）两处，
 * 两边都可能在历史版本里缺；而世界生成的积分**已经花过**，不能因为一个字段没存住
 * 就逼用户重新生成一次世界。
 *
 * 挑选必须严：先按**产出这个模型的节点**（生成节点 = 上游 `in-world` 的来源节点），
 * 再按模型资产 id 兜底（同一张图里可能换过生成节点）。对不上返回空数组 ——
 * 拿错记录就是把别人的世界导出给自己，宁可报「没有 world_id」。
 */
export function pickSpatialWorldJobs(
  jobs: readonly VideoJobRecord[],
  input: { nodeId?: string; assetId?: string }
): VideoJobRecord[] {
  const nodeId = input.nodeId?.trim() ?? ''
  const assetId = input.assetId?.trim() ?? ''
  if (!nodeId && !assetId) return []
  const worlds = jobs.filter((job) => jobKind(job) === 'spatialWorld' && job.status === 'succeeded')
  return [
    ...(nodeId ? worlds.filter((job) => job.graphBinding?.nodeId?.trim() === nodeId) : []),
    ...(assetId ? worlds.filter((job) => job.graphBinding?.assetId?.trim() === assetId) : [])
  ]
}

/** 候选记录里已经存住的 world_id（没存住返回 `undefined`，不猜） */
export function pickSpatialWorldIdFromJobs(
  jobs: readonly VideoJobRecord[],
  input: { nodeId?: string; assetId?: string }
): string | undefined {
  const withId = pickSpatialWorldJobs(jobs, input).find((job) => job.resourceId?.trim())
  return withId?.resourceId?.trim() || undefined
}
