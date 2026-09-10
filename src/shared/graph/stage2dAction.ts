/**
 * stage.2d「2D 舞台」动作参数态桥接：承载 5.5「动作与循环预览」产出的
 * 自定义关键帧动作（参考视频逐帧转骨架关键帧动画等），随节点 params 持久化。
 *
 * 数据模型 / 插值采样见 `../gameAssets/stage2dAction.ts`；本文件只做节点参数
 * 读写桥接——编辑器「从视频生成动作」等产出的自定义动作落节点，供动作试播 /
 * 定格 / 导出帧消费；内置预设 `STAGE2D_ACTION_PRESETS` 不落节点（仍随编辑器选择）。
 */
import { normalizeStage2dAction, type Stage2dAction } from '../gameAssets/stage2dAction'

export type { Stage2dAction }

/** 从节点 params 读取自定义动作；缺失 / 无关键帧返回 null */
export function readStage2dActionFromNode(
  params?: { stage2dAction?: Stage2dAction | null } | null
): Stage2dAction | null {
  const action = normalizeStage2dAction(params?.stage2dAction)
  return action.keyframes.length ? action : null
}

/** 自定义动作写回节点 params 的补丁（空动作写 null = 清除不持久化） */
export function stage2dActionToNodePatch(action: Stage2dAction | null | undefined): {
  stage2dAction: Stage2dAction | null
} {
  const normalized = action ? normalizeStage2dAction(action) : null
  return {
    stage2dAction: normalized && normalized.keyframes.length ? normalized : null
  }
}

/* ============================ 动作帧序列导出（节点产物） ============================ */

/**
 * 运行产出「动作帧序列」的输出端口 id：逐帧透明 PNG（图库值）。
 * 与单帧舞台图（out / out-all）分开走独立端口，避免下游「收集上游图片」把一整套
 * 帧当成素材序列吃进去。
 */
export const STAGE2D_FRAMES_OUT_PORT_ID = 'out-frames'
/** 运行产出「帧序列 sheet」的输出端口 id：单张拼版 PNG */
export const STAGE2D_SHEET_OUT_PORT_ID = 'out-sheet'

/** 帧率关闭值：0 = 只合成单帧舞台图，不产出动作帧序列 */
export const STAGE2D_ANIM_FPS_OFF = 0
/** 默认关闭：逐帧合成 + 落盘成本随帧数线性增长，需要时在节点上显式开启 */
export const STAGE2D_ANIM_FPS_DEFAULT = STAGE2D_ANIM_FPS_OFF
/** 帧率上限（与编辑器导出下拉同档：6 / 8 / 10 / 12 / 15 / 24） */
export const STAGE2D_ANIM_FPS_MAX = 24
/** 单次产物帧数上限：超长动作也不会把工程塞爆（超出按均分采样截断） */
export const STAGE2D_ANIM_FRAME_MAX = 240

/** 帧率归一化：非数 / 非正 / 0 → 关闭，超上限夹取为上限 */
export function normalizeStage2dAnimFps(raw: unknown): number {
  const value = Math.floor(Number(raw))
  if (!Number.isFinite(value) || value <= STAGE2D_ANIM_FPS_OFF) return STAGE2D_ANIM_FPS_OFF
  return Math.min(STAGE2D_ANIM_FPS_MAX, value)
}

/** 从节点 params 读取动作帧导出帧率（0 = 关闭） */
export function readStage2dAnimFpsFromNode(params?: { stage2dAnimFps?: unknown } | null): number {
  return normalizeStage2dAnimFps(params?.stage2dAnimFps)
}

/** 动作帧导出帧率写回节点 params 的补丁 */
export function stage2dAnimFpsToNodePatch(fps: unknown): { stage2dAnimFps: number } {
  return { stage2dAnimFps: normalizeStage2dAnimFps(fps) }
}

/**
 * 动作 → 逐帧采样时刻表（秒）。
 *
 * 与编辑器「导出序列帧」同一口径：帧数 = round(duration × fps)（至少 1 帧、上限
 * `STAGE2D_ANIM_FRAME_MAX`），采样点为 `i × duration / count` —— **不含终点**，
 * 因为循环动作的终点与起点同姿态，少采一帧才是无缝循环；时长缺失 / 非正、
 * 或帧率关闭时收敛为单帧 `[0]`。
 */
export function buildStage2dFrameTimes(duration: number, fps: number): number[] {
  const rate = normalizeStage2dAnimFps(fps)
  const total = Number(duration)
  if (rate <= 0 || !Number.isFinite(total) || total <= 0) return [0]
  const count = Math.min(STAGE2D_ANIM_FRAME_MAX, Math.max(1, Math.round(total * rate)))
  const times: number[] = []
  for (let index = 0; index < count; index += 1) {
    times.push((index * total) / count)
  }
  return times
}
