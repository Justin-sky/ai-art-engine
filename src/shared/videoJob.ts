/** 工程内持久化的视频生成任务（跨重启可续轮询） */

export type VideoJobStatus =
  | 'submitted'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export type VideoJobSource = 'graph'

/** 可落盘的 TOS 临时参考（终态后删除） */
export interface VideoJobTosUpload {
  objectKey: string
  url: string
  bytes: number
  bucket: string
  providerId: string
  providerLabel: string
  sourceLabel: string
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
  /** @deprecated 旧 GEN_START 任务；新代码不再写入 */
  shotBinding?: { shotId: string }
  /** 视频副本输出目录（相对工程根） */
  outputDir?: string
  tosUploads?: VideoJobTosUpload[]
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
