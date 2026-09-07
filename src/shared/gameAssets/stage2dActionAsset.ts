/**
 * 2D 动作资产包（5.5「导出与资产出口」：骨骼动作保存为工程内可复用资产）。
 *
 * 把「动作 + 创作装配上下文」打包成一个可入库（素材库数据型资产 genParams）的
 * 纯 JSON 文档：
 * - action 是跨 rig 复用主体（关节 id → 局部旋转关键帧，播放时 rig 不存在的
 *   关节自然被 FK 消费方忽略，与内置动作预设同一机制）；
 * - rig / pose 为创作快照（可选）：记录动作来源装配，便于同 rig 回放精修、
 *   资产预览，也供后续「动作重定向 / 模板对齐」按命名映射铺路。
 *
 * 纯函数，无 DOM / IPC 依赖，可单测。
 */
import { createHumanoidStage2dRig, type HumanoidStage2dRigOptions } from './stage2dHumanoid'
import { normalizeStage2dAction, type Stage2dAction } from './stage2dAction'
import { normalizeStage2dRig, type Stage2dPose, type Stage2dRig } from './stage2dRig'

/** genParams 里放资产包的稳定字段名 */
export const STAGE2D_ACTION_ASSET_KEY = 'stage2dActionAsset'
/** 资产包格式版本 */
export const STAGE2D_ACTION_ASSET_VERSION = 1

/** 资产包（纯 JSON，可直接落 genParams） */
export interface Stage2dActionAssetPack {
  format: 'stage2d-action-asset'
  version: number
  /** 动作核心 */
  action: Stage2dAction
  /** 创作装配快照（可选） */
  rig?: Stage2dRig | null
  /** 创作初始摆姿（可选；角度制，收敛到 (-180,180]） */
  pose?: Stage2dPose | null
}

/** 宽松入参：兼容手工编辑 / 旧版（null / 缺字段都允许） */
export interface Stage2dActionAssetPackInput {
  format?: unknown
  version?: unknown
  action?: unknown
  rig?: unknown
  pose?: unknown
}

/** 默认资产包：空摆姿动作 + 标准人形装配，作为「新建」占位 / 失败回落 */
export function createDefaultStage2dActionAssetPack(
  options?: HumanoidStage2dRigOptions
): Stage2dActionAssetPack {
  return {
    format: 'stage2d-action-asset',
    version: STAGE2D_ACTION_ASSET_VERSION,
    action: normalizeStage2dAction({
      loop: true,
      duration: 0,
      keyframes: [{ time: 0, pose: {} }]
    }),
    rig: createHumanoidStage2dRig(options),
    pose: {}
  }
}

/** 角度收敛到 (-180, 180]（与 rig / 动作层同一约定）；非法值返回 NaN 供丢弃 */
function wrap180(raw: unknown): number {
  const deg = Number(raw)
  if (!Number.isFinite(deg)) return Number.NaN
  let a = (((deg % 360) + 540) % 360) - 180
  if (a === -180) a = 180
  return a
}

function normalizePose(raw: unknown): Stage2dPose {
  const pose: Stage2dPose = {}
  if (!raw || typeof raw !== 'object') return pose
  for (const [jointId, angle] of Object.entries(raw as Record<string, unknown>)) {
    if (!jointId) continue
    const wrapped = wrap180(angle)
    if (!Number.isFinite(wrapped)) continue
    pose[jointId] = wrapped
  }
  return pose
}

/**
 * 资产包归一化：字段可缺、逐项收敛（动作 / rig / 摆姿分别走各自归一化）。
 * action 必须能被归一化（keyframes 为空也算空包，不在此处判空）。
 */
export function normalizeStage2dActionAssetPack(
  raw?: Stage2dActionAssetPackInput | null
): Stage2dActionAssetPack {
  const src = raw && typeof raw === 'object' ? raw : {}
  const rigRaw = src.rig && typeof src.rig === 'object' ? (src.rig as Stage2dRig) : undefined
  const action = normalizeStage2dAction(
    src.action && typeof src.action === 'object' ? (src.action as Stage2dAction) : undefined
  )
  const rig = rigRaw ? normalizeStage2dRig(rigRaw) : undefined
  return {
    format: 'stage2d-action-asset',
    version:
      Number.isFinite(Number(src.version)) && Number(src.version) > 0
        ? Number(src.version)
        : STAGE2D_ACTION_ASSET_VERSION,
    action,
    ...(rig ? { rig } : {}),
    ...(src.pose !== undefined && src.pose !== null ? { pose: normalizePose(src.pose) } : {})
  }
}

/** 打包：入参动作/装配 → 可入库的纯 JSON 资产包 */
export function packStage2dActionAsset(input: {
  action: Stage2dAction
  rig?: Stage2dRig | null
  pose?: Stage2dPose | null
}): Stage2dActionAssetPack {
  return normalizeStage2dActionAssetPack({
    format: 'stage2d-action-asset',
    version: STAGE2D_ACTION_ASSET_VERSION,
    action: input.action,
    rig: input.rig ?? undefined,
    pose: input.pose ?? undefined
  })
}

/** 读库：从资产 genParams 解出资产包；无 / 格式不符返回 null */
export function readStage2dActionAssetFromGenParams(
  genParams?: Record<string, unknown> | null
): Stage2dActionAssetPack | null {
  if (!genParams || typeof genParams !== 'object') return null
  const raw = genParams[STAGE2D_ACTION_ASSET_KEY]
  if (!raw || typeof raw !== 'object') return null
  const src = raw as Stage2dActionAssetPackInput
  if (src.format !== 'stage2d-action-asset') return null
  return normalizeStage2dActionAssetPack(src)
}

/** 资产包 → genParams 片段（写 createAsset.genParams 用） */
export function stage2dActionAssetGenParams(pack: Stage2dActionAssetPack): Record<string, unknown> {
  return { [STAGE2D_ACTION_ASSET_KEY]: pack }
}
