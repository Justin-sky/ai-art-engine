import { jobKind, type VideoJobRecord } from '@shared/videoJob'

const THROTTLE_MS = 1500
const PROGRESS_STEP = 5

/**
 * 在 await generateVideo / generateModel3d 期间订阅轮询进度，写入执行日志。
 * 按 graphBinding.nodeId 过滤；节流避免刷爆日志上限。
 */
export function subscribeVideoJobProgress(input: {
  nodeId?: string
  onMessage: (message: string) => void
  format: (job: VideoJobRecord) => string
}): () => void {
  if (typeof window === 'undefined' || typeof window.studio?.onVideoJobUpdated !== 'function') {
    return () => {}
  }
  const filterNode = input.nodeId?.trim() || ''
  let lastProgress = -1
  let lastAt = 0
  let lastStatus = ''

  return window.studio.onVideoJobUpdated((job) => {
    const boundNode = job.graphBinding?.nodeId?.trim() || ''
    if (filterNode) {
      if (boundNode && boundNode !== filterNode) return
      if (!boundNode) return
    }

    const progress = Math.max(0, Math.min(100, Math.round(Number(job.progress) || 0)))
    const status = String(job.status || '')
    const now = Date.now()
    const statusChanged = status !== lastStatus
    const progressed =
      lastProgress < 0 || progress - lastProgress >= PROGRESS_STEP || progress >= 100
    const timed = now - lastAt >= THROTTLE_MS
    const terminal = status === 'succeeded' || status === 'failed' || status === 'cancelled'

    if (!statusChanged && !progressed && !timed && !terminal) return

    lastProgress = progress
    lastAt = now
    lastStatus = status
    const text = input.format(job)
    if (text.trim()) input.onMessage(text)
  })
}

export function formatVideoJobProgressMessage(
  job: VideoJobRecord,
  t: (key: string, params?: Record<string, unknown>) => string
): string {
  const progress = Math.max(0, Math.min(100, Math.round(Number(job.progress) || 0)))
  const status = String(job.status || 'running')
  const key = jobKind(job) === 'model3d' ? 'graph.logs.model3dProgress' : 'graph.logs.videoProgress'
  return t(key, { progress, status })
}
