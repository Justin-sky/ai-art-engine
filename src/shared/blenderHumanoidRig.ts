/**
 * 人形简单骨架：导入后按网格端点 + 边连通估计关节 Empty，再从 Empty 建骨 + ARMATURE_AUTO。
 * 固定比例兜底已移除——关节不可靠时脚本直接失败，由应用 QA / 下一轮返工处理。
 */
import { HUMANOID_BONE_NAMES, type HumanoidBoneSpec } from './blenderHumanoidLandmarks'
import {
  BLENDER_HUMANOID_BIND_FROM_LANDMARKS_CODE,
  BLENDER_HUMANOID_LANDMARKS_CODE,
  BLENDER_HUMANOID_RIG_PIPELINE_CODE,
  humanoidIterativeRecipe
} from './blenderRigSkinPipeline'

export const BLENDER_HUMANOID_RIG_MARKER = 'AIAE_HUMANOID_RIG'
export const BLENDER_HUMANOID_BONE_NAMES = HUMANOID_BONE_NAMES

/** 仅供 Inspector 合成预览；Cook 路径不再用固定比例写骨。 */
export const BLENDER_HUMANOID_BONE_SPECS: ReadonlyArray<HumanoidBoneSpec> = [
  { name: 'Hips', parent: '', head: [0, 0.02, 0.5], tail: [0, 0.0, 0.56] },
  { name: 'Spine', parent: 'Hips', head: [0, 0.0, 0.56], tail: [0, 0.0, 0.66] },
  { name: 'Chest', parent: 'Spine', head: [0, 0.0, 0.66], tail: [0, 0.0, 0.76] },
  { name: 'Neck', parent: 'Chest', head: [0, 0.0, 0.76], tail: [0, 0.0, 0.84] },
  { name: 'Head', parent: 'Neck', head: [0, 0.0, 0.84], tail: [0, 0.02, 0.98] },
  { name: 'L_Shoulder', parent: 'Chest', head: [0.1, 0.02, 0.8], tail: [0.2, 0.02, 0.8] },
  { name: 'L_UpperArm', parent: 'L_Shoulder', head: [0.2, 0.02, 0.8], tail: [0.38, 0.04, 0.72] },
  { name: 'L_ForeArm', parent: 'L_UpperArm', head: [0.38, 0.04, 0.72], tail: [0.54, 0.04, 0.6] },
  { name: 'L_Hand', parent: 'L_ForeArm', head: [0.54, 0.04, 0.6], tail: [0.66, 0.04, 0.54] },
  { name: 'R_Shoulder', parent: 'Chest', head: [-0.1, 0.02, 0.8], tail: [-0.2, 0.02, 0.8] },
  { name: 'R_UpperArm', parent: 'R_Shoulder', head: [-0.2, 0.02, 0.8], tail: [-0.38, 0.04, 0.72] },
  { name: 'R_ForeArm', parent: 'R_UpperArm', head: [-0.38, 0.04, 0.72], tail: [-0.54, 0.04, 0.6] },
  { name: 'R_Hand', parent: 'R_ForeArm', head: [-0.54, 0.04, 0.6], tail: [-0.66, 0.04, 0.54] },
  { name: 'L_UpLeg', parent: 'Hips', head: [0.11, 0.02, 0.5], tail: [0.12, 0.03, 0.28] },
  { name: 'L_LoLeg', parent: 'L_UpLeg', head: [0.12, 0.03, 0.28], tail: [0.11, 0.04, 0.06] },
  { name: 'L_Foot', parent: 'L_LoLeg', head: [0.11, 0.04, 0.06], tail: [0.11, 0.16, 0.02] },
  { name: 'L_Toes', parent: 'L_Foot', head: [0.11, 0.16, 0.02], tail: [0.11, 0.24, 0.02] },
  { name: 'R_UpLeg', parent: 'Hips', head: [-0.11, 0.02, 0.5], tail: [-0.12, 0.03, 0.28] },
  { name: 'R_LoLeg', parent: 'R_UpLeg', head: [-0.12, 0.03, 0.28], tail: [-0.11, 0.04, 0.06] },
  { name: 'R_Foot', parent: 'R_LoLeg', head: [-0.11, 0.04, 0.06], tail: [-0.11, 0.16, 0.02] },
  { name: 'R_Toes', parent: 'R_Foot', head: [-0.11, 0.16, 0.02], tail: [-0.11, 0.24, 0.02] }
]

export const BLENDER_HUMANOID_LANDMARKS_CODE_EXPORT = BLENDER_HUMANOID_LANDMARKS_CODE
export const BLENDER_HUMANOID_BIND_CODE = BLENDER_HUMANOID_BIND_FROM_LANDMARKS_CODE

/** 兼容旧调用：landmarks + bind 连续跑 */
export const BLENDER_HUMANOID_RIG_CODE = BLENDER_HUMANOID_RIG_PIPELINE_CODE

export function humanoidSimpleRecipe(): string {
  return humanoidIterativeRecipe()
}
