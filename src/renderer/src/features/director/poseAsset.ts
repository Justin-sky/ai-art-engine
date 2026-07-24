import type { StageVec3 } from '@shared/domain'
import { normalizeBoneName } from './skeletonRetarget'

/** 将物体本地骨骼名姿势编码为规范化键（跨模型共用） */
export function encodeBonePoseNormalized(
  bonePose: Record<string, StageVec3> | undefined | null
): Record<string, StageVec3> {
  if (!bonePose) return {}
  const out: Record<string, StageVec3> = {}
  for (const [name, rot] of Object.entries(bonePose)) {
    const raw = name.trim()
    if (!raw || !rot) continue
    const key = normalizeBoneName(raw)
    if (!key) continue
    const x = Number.isFinite(rot.x) ? rot.x : 0
    const y = Number.isFinite(rot.y) ? rot.y : 0
    const z = Number.isFinite(rot.z) ? rot.z : 0
    if (x === 0 && y === 0 && z === 0) continue
    // 同名规范化键保留首次写入，避免后写覆盖
    if (out[key]) continue
    out[key] = { x, y, z }
  }
  return out
}

export type MappedPoseResult = {
  bonePose: Record<string, StageVec3>
  matched: number
  total: number
}

/** 将规范化姿势映射到目标模型的原始骨骼名 */
export function mapNormalizedPoseToTargetBones(
  normalizedBones: Record<string, StageVec3>,
  targetBoneNames: string[]
): MappedPoseResult {
  const total = Object.keys(normalizedBones).length
  const bonePose: Record<string, StageVec3> = {}
  let matched = 0
  for (const targetName of targetBoneNames) {
    const key = normalizeBoneName(targetName)
    if (!key) continue
    const rot = normalizedBones[key]
    if (!rot) continue
    bonePose[targetName] = { x: rot.x, y: rot.y, z: rot.z }
    matched += 1
  }
  return { bonePose, matched, total }
}
