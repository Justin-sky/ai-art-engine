import type { StageVec3 } from '@shared/domain'

export interface DirectorIncomingModelInfo {
  assetId: string
  relativePath?: string
  name?: string
  bonePose?: Record<string, StageVec3>
  clip?: { name: string; fps: number; frameRange: [number, number] }
  sourceTypeId?: string
}

const SOURCE_TYPE_RANK: Record<string, number> = {
  'model.animation': 4,
  'model.pose': 3,
  'model.rigSkin': 2,
  'asset.model3d': 1,
  'asset.model': 1
}

export function rankDirectorIncomingModel(info: DirectorIncomingModelInfo): number {
  const typeRank = SOURCE_TYPE_RANK[info.sourceTypeId ?? ''] ?? 0
  const overlay =
    (info.clip ? 8 : 0) +
    (info.bonePose && Object.keys(info.bonePose).length ? 4 : 0) +
    (info.relativePath?.trim() ? 1 : 0)
  return typeRank * 10 + overlay
}

/**
 * 导演台 `in-model` 可挂多条线。同一 assetId 只留加工最深的一条
 *（动画 > 姿势 > 蒙皮 > 原模型），避免原模和蒙皮各实例化一次。
 */
export function pickDirectorIncomingModels(
  candidates: DirectorIncomingModelInfo[]
): DirectorIncomingModelInfo[] {
  const byAsset = new Map<string, DirectorIncomingModelInfo>()
  for (const item of candidates) {
    const id = item.assetId.trim()
    if (!id) continue
    const prev = byAsset.get(id)
    if (!prev || rankDirectorIncomingModel(item) > rankDirectorIncomingModel(prev)) {
      byAsset.set(id, item)
    }
  }
  return [...byAsset.values()]
}
