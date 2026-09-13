/**
 * stage.2d「2D 舞台」骨骼装配参数态：承载 5.5「骨骼装配与摆姿」的 rig / pose。
 *
 * 数据模型与平面 FK 见 `../gameAssets/stage2dRig.ts`
 * （Stage2dRig + normalizeStage2dRig + computeStage2dRigTransforms /
 * computeStage2dAttachmentTransforms，纯函数可单测）。
 * 本文件只做节点参数读写桥接：rig 与 pose 随节点 params 持久化，
 * 供 2D 舞台编辑器装配骨骼、拖动关节摆姿，并由像素合成方消费。
 */
import {
  DEFAULT_STAGE2D_RIG,
  normalizeStage2dRig,
  type Stage2dPose,
  type Stage2dRig
} from '../gameAssets/stage2dRig'

export type { Stage2dPose, Stage2dRig }

/** 新建节点时的默认骨骼装配（空骨骼） */
export function createDefaultStage2dRig(): Stage2dRig {
  return normalizeStage2dRig(undefined)
}

/** 从节点 params 读取并归一化骨骼装配；缺失 / 非法字段回落默认 */
export function readStage2dRigFromNode(
  params?: { stage2dRig?: Partial<Stage2dRig> } | null
): Stage2dRig {
  return normalizeStage2dRig(params?.stage2dRig)
}

/** 骨骼装配写回节点 params 的补丁（先归一化，保证落盘合法） */
export function stage2dRigToNodePatch(rig: Stage2dRig): {
  stage2dRig: Stage2dRig
} {
  return { stage2dRig: normalizeStage2dRig(rig) }
}

/**
 * 摆姿归一化：只保留 rig 中存在的关节，且角度为有限数。
 * pose 是「关节局部旋转覆盖值」，不改写 rig 的绑定旋转。
 */
export function normalizeStage2dPose(rig: Stage2dRig, pose?: Stage2dPose | null): Stage2dPose {
  const normalized = normalizeStage2dRig(rig)
  const jointIds = new Set(normalized.joints.map((joint) => joint.id))
  const next: Stage2dPose = {}
  if (!pose) return next
  for (const [jointId, rotation] of Object.entries(pose)) {
    if (!jointIds.has(jointId)) continue
    const value = Number(rotation)
    if (!Number.isFinite(value)) continue
    next[jointId] = value
  }
  return next
}

/** 从节点 params 读取摆姿（结合当前 rig 剔除失效关节） */
export function readStage2dPoseFromNode(
  params: { stage2dPose?: Stage2dPose | null } | null | undefined,
  rig: Stage2dRig
): Stage2dPose {
  return normalizeStage2dPose(rig, params?.stage2dPose)
}

/** 摆姿写回节点 params 的补丁 */
export function stage2dPoseToNodePatch(
  rig: Stage2dRig,
  pose: Stage2dPose
): { stage2dPose: Stage2dPose } {
  return { stage2dPose: normalizeStage2dPose(rig, pose) }
}

/** 空摆姿（回到绑定姿势） */
export function createDefaultStage2dPose(): Stage2dPose {
  return {}
}

export { DEFAULT_STAGE2D_RIG }
