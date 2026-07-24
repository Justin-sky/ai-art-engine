import type { DirectorAnimTrack, DirectorSkeletonClipSegment } from '@shared/domain'
import { directorTrackSkeletonClips } from '@shared/domain'

export type SkeletonSeekResult = { active: false } | { active: true; time: number }

const MIN_SEGMENT_DURATION = 0.1

/**
 * 将全局时间轴时间映射为骨骼 clip 片段内的 seek 时间。
 * 片段外返回 inactive；片段内按 speed 缩放，loop 则取模，否则 clamp。
 */
export function skeletonSegmentLocalTime(
  globalTime: number,
  segment: Pick<DirectorSkeletonClipSegment, 'start' | 'end' | 'speed' | 'loop'>,
  clipDuration: number
): SkeletonSeekResult {
  if (globalTime < segment.start - 1e-6 || globalTime > segment.end + 1e-6) {
    return { active: false }
  }
  const speed =
    typeof segment.speed === 'number' && Number.isFinite(segment.speed) && segment.speed > 0
      ? segment.speed
      : 1
  let local = (globalTime - segment.start) * speed
  const duration = Math.max(1e-6, clipDuration)
  if (segment.loop === false) {
    local = Math.min(duration, Math.max(0, local))
  } else {
    local = ((local % duration) + duration) % duration
  }
  return { active: true, time: local }
}

/**
 * @deprecated 使用 skeletonSegmentLocalTime；保留给旧单 clip 轨兼容
 */
export function skeletonLocalTime(
  globalTime: number,
  track: Pick<DirectorAnimTrack, 'start' | 'end' | 'skeletonSpeed' | 'skeletonLoop'>,
  clipDuration: number
): SkeletonSeekResult {
  return skeletonSegmentLocalTime(
    globalTime,
    {
      start: track.start,
      end: track.end,
      speed: track.skeletonSpeed,
      loop: track.skeletonLoop
    },
    clipDuration
  )
}

/** 在全局时间点上找到当前应播放的骨骼片段（后写优先：取覆盖该时刻的最后一段） */
export function findActiveSkeletonSegment(
  track: DirectorAnimTrack,
  globalTime: number
): DirectorSkeletonClipSegment | null {
  const clips = directorTrackSkeletonClips(track)
  let hit: DirectorSkeletonClipSegment | null = null
  for (const segment of clips) {
    if (globalTime >= segment.start - 1e-6 && globalTime <= segment.end + 1e-6) {
      hit = segment
    }
  }
  return hit
}

/**
 * 为新片段找不重叠的放置区间。
 * 优先从 preferredStart 起放 duration 秒；若撞车则接到后续空隙。
 */
export function placeSkeletonSegmentRange(
  existing: DirectorSkeletonClipSegment[],
  preferredStart: number,
  duration: number,
  timelineDuration: number
): { start: number; end: number } | null {
  const span = Math.max(MIN_SEGMENT_DURATION, duration)
  const limit = Math.max(MIN_SEGMENT_DURATION, timelineDuration)
  const sorted = [...existing].sort((a, b) => a.start - b.start)

  let start = Math.max(0, preferredStart)
  let end = Math.min(limit, start + span)

  for (const seg of sorted) {
    if (end <= seg.start + 1e-6) break
    if (start < seg.end - 1e-6) {
      start = seg.end
      end = Math.min(limit, start + span)
    }
  }

  if (end - start < MIN_SEGMENT_DURATION - 1e-6) return null
  return { start, end }
}

/** 拖动/缩放片段时夹到邻居与时间轴范围内 */
export function clampSkeletonSegmentRange(
  existing: DirectorSkeletonClipSegment[],
  segmentId: string,
  start: number,
  end: number,
  timelineDuration: number
): { start: number; end: number } {
  const others = existing
    .filter((item) => item.id !== segmentId)
    .sort((a, b) => a.start - b.start)
  let nextStart = Math.max(0, start)
  let nextEnd = Math.max(nextStart + MIN_SEGMENT_DURATION, end)
  nextEnd = Math.min(Math.max(MIN_SEGMENT_DURATION, timelineDuration), nextEnd)
  nextStart = Math.min(nextStart, nextEnd - MIN_SEGMENT_DURATION)

  for (const seg of others) {
    // 完全在左侧
    if (nextEnd <= seg.start + 1e-6) continue
    // 完全在右侧
    if (nextStart >= seg.end - 1e-6) continue
    // 与邻居重叠：按中点决定推向哪一侧
    const mid = (nextStart + nextEnd) / 2
    const segMid = (seg.start + seg.end) / 2
    if (mid <= segMid) {
      nextEnd = Math.min(nextEnd, seg.start)
    } else {
      nextStart = Math.max(nextStart, seg.end)
    }
  }

  if (nextEnd - nextStart < MIN_SEGMENT_DURATION) {
    // 缩到最小后仍冲突：贴在最近一侧
    const left = others.filter((s) => s.end <= start + 1e-6).pop()
    const right = others.find((s) => s.start >= end - 1e-6)
    nextStart = left?.end ?? 0
    nextEnd = Math.min(
      right?.start ?? Math.max(MIN_SEGMENT_DURATION, timelineDuration),
      nextStart + MIN_SEGMENT_DURATION
    )
    if (nextEnd - nextStart < MIN_SEGMENT_DURATION) {
      nextEnd = nextStart + MIN_SEGMENT_DURATION
    }
  }

  nextStart = Math.max(0, nextStart)
  nextEnd = Math.min(Math.max(MIN_SEGMENT_DURATION, timelineDuration), Math.max(nextStart + MIN_SEGMENT_DURATION, nextEnd))
  return { start: nextStart, end: nextEnd }
}

export type SkeletonClipOption = { name: string; label: string }

/**
 * Clip 显示名。Mixamo / Blender 常见 `Armature|mixamo.com|Walk` 管道名，
 * 只取末段，避免下拉里被 `|` 撑成乱条。
 */
export function skeletonClipLabel(clipName: string, index: number): string {
  const trimmed = clipName.trim()
  if (!trimmed) return `Clip ${index + 1}`
  if (!trimmed.includes('|')) return trimmed
  const parts = trimmed
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
  const last = parts[parts.length - 1]
  if (!last) return trimmed
  // 末段若是域名占位，退回上一段
  if (parts.length >= 2 && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(last)) {
    return parts[parts.length - 2] || last
  }
  return last
}

/** 选项：value 用原始 clip.name，label 用可读短名 */
export function skeletonClipOption(clipName: string, index: number): SkeletonClipOption {
  const label = skeletonClipLabel(clipName, index)
  const name = clipName.trim() || label
  return { name, label }
}

export { MIN_SEGMENT_DURATION }
