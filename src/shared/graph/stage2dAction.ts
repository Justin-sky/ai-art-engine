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
