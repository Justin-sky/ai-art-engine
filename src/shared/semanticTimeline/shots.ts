/**
 * 镜头切分纯逻辑：把切点秒列表变成 ShotEvidence；合并过短镜头。
 */
import { makeTimeRange, shotId } from './ids'
import type { ShotEvidence } from './types'

export const DEFAULT_MIN_SHOT_SEC = 0.4
export const DEFAULT_SCENE_THRESHOLD = 0.35

/**
 * 从场景切点（秒）构建镜头列表。
 * cutPoints 不含 0 与 duration 时会自动补上。
 */
export function buildShotsFromCutPoints(
  cutPointsSec: number[],
  durationSec: number,
  fps: number,
  options?: { minShotSec?: number; confidence?: number }
): ShotEvidence[] {
  const minShot = options?.minShotSec ?? DEFAULT_MIN_SHOT_SEC
  const confidence = options?.confidence ?? 0.7
  if (!Number.isFinite(durationSec) || durationSec <= 0 || fps <= 0) return []

  const pts = [0, ...cutPointsSec.filter((t) => t > 0.05 && t < durationSec - 0.05), durationSec]
  pts.sort((a, b) => a - b)
  // 去重（相邻 < 1 帧）
  const unique: number[] = [pts[0]!]
  for (let i = 1; i < pts.length; i++) {
    if (pts[i]! - unique[unique.length - 1]! >= 1 / fps) unique.push(pts[i]!)
  }

  const raw: Array<{ start: number; end: number }> = []
  for (let i = 0; i < unique.length - 1; i++) {
    raw.push({ start: unique[i]!, end: unique[i + 1]! })
  }

  // 合并过短镜头到前一段
  const merged: Array<{ start: number; end: number }> = []
  for (const seg of raw) {
    if (merged.length === 0) {
      merged.push({ ...seg })
      continue
    }
    if (seg.end - seg.start < minShot) {
      merged[merged.length - 1]!.end = seg.end
    } else {
      merged.push({ ...seg })
    }
  }
  // 若首段仍过短且有下一段，并入下一段
  if (merged.length >= 2 && merged[0]!.end - merged[0]!.start < minShot) {
    merged[1]!.start = merged[0]!.start
    merged.shift()
  }

  return merged.map((seg, index) => {
    const range = makeTimeRange(seg.start, seg.end, fps)
    return {
      id: shotId(index, range.startFrame),
      range,
      keyframes: {},
      confidence
    }
  })
}

/** 单镜兜底：整段视频一个镜头 */
export function singleShot(durationSec: number, fps: number): ShotEvidence[] {
  return buildShotsFromCutPoints([], durationSec, fps, { confidence: 1 })
}

/** L0 往返：镜头裁切参数列表（供 ffmpeg -ss/-t 或 concat） */
export interface ShotTrimSpec {
  shotId: string
  startSec: number
  durationSec: number
  startFrame: number
  endFrame: number
}

export function shotsToTrimSpecs(shots: ShotEvidence[]): ShotTrimSpec[] {
  return shots.map((s) => ({
    shotId: s.id,
    startSec: s.range.start,
    durationSec: Math.max(0, s.range.end - s.range.start),
    startFrame: s.range.startFrame,
    endFrame: s.range.endFrame
  }))
}

/** 校验往返后总时长是否与原片一致（允许 1 帧误差） */
export function roundtripDurationOk(
  originalDurationSec: number,
  shots: ShotEvidence[],
  fps: number
): { ok: boolean; rebuiltSec: number; deltaFrames: number } {
  const rebuiltSec = shots.reduce((acc, s) => acc + (s.range.end - s.range.start), 0)
  const deltaFrames = Math.round(Math.abs(rebuiltSec - originalDurationSec) * fps)
  return {
    ok: deltaFrames <= 1,
    rebuiltSec,
    deltaFrames
  }
}

/**
 * 解析 ffmpeg showinfo / scene 检测 stderr 中的 pts_time。
 * 兼容 `pts_time:1.234` 与 `pts_time=1.234`。
 */
export function parseSceneCutPtsTimes(stderr: string): number[] {
  const out: number[] = []
  const re = /pts_time[=:]([0-9]+(?:\.[0-9]+)?)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stderr)) !== null) {
    const t = Number(m[1])
    if (Number.isFinite(t) && t > 0) out.push(t)
  }
  return out
}

/** 自适应阈值：短视频略低、长视频略高，夹在 [0.25, 0.45] */
export function adaptiveSceneThreshold(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return DEFAULT_SCENE_THRESHOLD
  if (durationSec < 20) return 0.28
  if (durationSec > 90) return 0.4
  return DEFAULT_SCENE_THRESHOLD
}
