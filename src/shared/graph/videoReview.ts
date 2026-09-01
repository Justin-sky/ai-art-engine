/**
 * 视频级媒体理解：质检视频时按时间均匀抽帧（而非只看首帧），
 * 让视觉模型检查运动 / 动作连贯性 / 转场等时序问题。
 * 纯函数（时间戳采样 / 提示词块 / 图注）。
 */

/** 质检单个视频的抽帧数（含首帧与末帧） */
export const VIDEO_REVIEW_FRAME_COUNT = 4

/** 按时长均匀采样 N 个时间戳（秒，含 0 与末端；时长非法时返回空） */
export function buildVideoFrameTimestamps(
  durationSec: number,
  count: number = VIDEO_REVIEW_FRAME_COUNT
): number[] {
  const n = Math.floor(count)
  if (!Number.isFinite(durationSec) || durationSec <= 0 || !Number.isFinite(n) || n < 1) return []
  if (n === 1) return [0]
  const step = durationSec / (n - 1)
  return Array.from({ length: n }, (_, i) => Math.round(i * step * 100) / 100)
}

/** 质检提示词追加块：说明多帧来自同一视频的不同时间点 */
export function buildVideoReviewFrameBlock(locale?: string): string {
  const zh = !(locale ?? '').toLowerCase().startsWith('en')
  return zh
    ? '注意：以下图片来自同一段视频的不同时间点（抽帧），请把它们当作同一镜头的时间切片来检查运动、动作连贯性与转场是否异常，而不是多张独立图片。'
    : 'Note: the images below are frames sampled from the SAME video at different timestamps. Treat them as time slices of one shot to check motion, continuity and transitions, not as independent images.'
}

/** 质检图注：视频抽帧 */
export function buildVideoReviewFrameCaption(locale?: string): string {
  const zh = !(locale ?? '').toLowerCase().startsWith('en')
  return zh ? '视频抽帧（按时间采样）' : 'Video frames (time-sampled)'
}
