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

export interface SkeletonBlendSample {
  primary: DirectorSkeletonClipSegment
  /** 前序相邻片段（当处于交叉淡入窗口内时存在） */
  previous?: DirectorSkeletonClipSegment
  /** 主片段权重 ∈ (0, 1]；previous 的权重为 1 - primaryWeight */
  primaryWeight: number
}

/**
 * 查找当前激活的骨骼动作片段及与前序相邻片段的 Cross-Fade 混合权重。
 * 若当前片段与前序片段紧邻（间距 ≤ 0.08s）且处于 `crossFadeSec`（默认 0.25s）过渡窗口内，
 * 返回两个片段及平滑混合权重，消除动作切换时的硬切跳变。
 */
export function findActiveSkeletonSegmentsWithBlend(
  trackOrSegments: DirectorAnimTrack | DirectorSkeletonClipSegment[],
  globalTime: number
): SkeletonBlendSample | null {
  const clips = Array.isArray(trackOrSegments)
    ? trackOrSegments
    : directorTrackSkeletonClips(trackOrSegments)
  let hitIndex = -1
  for (let i = 0; i < clips.length; i++) {
    const segment = clips[i]
    if (globalTime >= segment.start - 1e-6 && globalTime <= segment.end + 1e-6) {
      hitIndex = i
    }
  }
  if (hitIndex < 0) return null
  const primary = clips[hitIndex]
  if (hitIndex === 0) {
    return { primary, primaryWeight: 1 }
  }
  const prev = clips[hitIndex - 1]
  const gap = Math.abs(primary.start - prev.end)
  const fadeSec =
    typeof primary.crossFadeSec === 'number' && Number.isFinite(primary.crossFadeSec)
      ? Math.max(0, primary.crossFadeSec)
      : 0.25
  const elapsedInPrimary = globalTime - primary.start
  if (
    fadeSec > 1e-3 &&
    gap <= 0.08 &&
    elapsedInPrimary >= 0 &&
    elapsedInPrimary < fadeSec &&
    prev.clip !== primary.clip
  ) {
    const raw = Math.min(1, Math.max(0, elapsedInPrimary / fadeSec))
    // Smoothstep S-curve for natural weight transition
    const primaryWeight = raw * raw * (3 - 2 * raw)
    return {
      primary,
      previous: prev,
      primaryWeight
    }
  }
  return { primary, primaryWeight: 1 }
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
  const others = existing.filter((item) => item.id !== segmentId).sort((a, b) => a.start - b.start)
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
  nextEnd = Math.min(
    Math.max(MIN_SEGMENT_DURATION, timelineDuration),
    Math.max(nextStart + MIN_SEGMENT_DURATION, nextEnd)
  )
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
