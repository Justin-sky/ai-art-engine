import { YOLO_POSE_KEYPOINT_NAMES } from '@shared/yolo'
import type { YoloSkeletonPoint } from '@shared/yolo'
import {
  solveImagePoseToBonePose,
  type ImagePoseBindBone,
  type ImagePoseSolveOptions,
  type ImagePoseSolveResult,
  type KeypointMap
} from './imagePoseSolver'

/**
 * 媒体（图片 / 视频帧）→ 导演台角色姿势 的纯换算层。
 *
 * 只做「YOLO COCO17 输出 ↔ imagePoseSolver 输入」的几何/命名映射，
 * 不接触 DOM / IPC，便于在 Node 环境单测。
 */

/** COCO17 骨架连线（索引对应 YOLO_POSE_KEYPOINT_NAMES） */
export const COCO17_SKELETON_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 4],
  [0, 5],
  [0, 6],
  [5, 7],
  [7, 9],
  [6, 8],
  [8, 10],
  [5, 6],
  [5, 11],
  [6, 12],
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16]
]

/** 单条骨架中实际可见（坐标有限且置信度达阈值）的点索引 */
export function visibleKeypointIndices(
  skeleton: readonly YoloSkeletonPoint[],
  minConfidence = 0
): number[] {
  const out: number[] = []
  for (let i = 0; i < skeleton.length; i++) {
    const p = skeleton[i]
    if (!p) continue
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    if (Number.isFinite(p.confidence) && p.confidence < minConfidence) continue
    out.push(i)
  }
  return out
}

/**
 * YOLO 单人 COCO17 输出 → imagePoseSolver 的 KeypointMap（键名语义见
 * YOLO_POSE_KEYPOINT_NAMES，二者索引一一对应）。
 */
export function keypointMapFromSkeleton(
  skeleton: readonly YoloSkeletonPoint[],
  minConfidence = 0.05
): KeypointMap {
  const out: KeypointMap = {}
  const count = Math.min(skeleton.length, YOLO_POSE_KEYPOINT_NAMES.length)
  for (let i = 0; i < count; i++) {
    const p = skeleton[i]
    const name = YOLO_POSE_KEYPOINT_NAMES[i]
    if (!p || !name) continue
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    if (Number.isFinite(p.confidence) && p.confidence < minConfidence) continue
    out[name] = { x: p.x, y: p.y, confidence: p.confidence }
  }
  return out
}

export interface PoseFromSkeletonOptions {
  /** 目标角色 bind 骨骼（来自 scene.listObjectPoseBindBones） */
  bones: ImagePoseBindBone[]
  /** 单人 COCO17 关键点（已按输出序对齐） */
  skeleton: readonly YoloSkeletonPoint[]
  /** 左右镜像 */
  flip?: boolean
  /** 是否驱动躯干脊柱 */
  driveTorso?: boolean
  /** 单点置信度下限；缺省 0.05 */
  minConfidence?: number
}

/** 单人 YOLO 骨架 → 姿势解算（返回与 solver 同构的完整结果） */
export function solvePoseFromSkeleton(
  options: PoseFromSkeletonOptions
): ImagePoseSolveResult {
  const solverOptions: ImagePoseSolveOptions = {
    bones: options.bones,
    keypoints: keypointMapFromSkeleton(options.skeleton, options.minConfidence),
    flip: options.flip,
    driveTorso: options.driveTorso,
    minConfidence: options.minConfidence
  }
  return solveImagePoseToBonePose(solverOptions)
}

/** 便于 UI 展示的段状态统计 */
export function summarizeSolveResult(
  result: ImagePoseSolveResult
): { ok: number; noBone: number; noKeypoints: number; degenerate: number; total: number } {
  let ok = 0
  let noBone = 0
  let noKeypoints = 0
  let degenerate = 0
  for (const seg of result.segments) {
    if (seg.status === 'ok') ok++
    else if (seg.status === 'no-bone') noBone++
    else if (seg.status === 'no-keypoints') noKeypoints++
    else degenerate++
  }
  return { ok, noBone, noKeypoints, degenerate, total: result.segments.length }
}
