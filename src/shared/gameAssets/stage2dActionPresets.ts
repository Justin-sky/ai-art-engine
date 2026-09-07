/**
 * 2D 骨骼内置动作预设（5.5「2D 导演台」动作与循环预览）。
 *
 * 预设面向 `stage2dHumanoid` 人形模板的关节命名（chest/shoulder/elbow/
 * wrist/hip/knee/ankle + L/R），按「正面平视」编排：
 * - 角度相对绑定姿势（局部旋转，顺时针为正）；`{}` = 回到绑定；
 * - 首尾帧均为 `{}` 保证循环回绕平滑；
 * - 播放到任意非人形 rig 上时，命中的关节照常驱动、其余忽略。
 *
 * 预设数值为初始编排，可在编辑器「动作试播」里人工体验后回填微调。
 */
import {
  normalizeStage2dAction,
  type Stage2dAction,
  type Stage2dActionKeyframe
} from './stage2dAction'

/** 预设：动作数据 + 稳定 id（供编辑器 / i18n 引用） */
export interface Stage2dActionPreset extends Stage2dAction {
  id: string
}

function preset(id: string, keyframes: Stage2dActionKeyframe[]): Stage2dActionPreset {
  return { id, ...normalizeStage2dAction({ name: id, loop: true, keyframes }) }
}

/** 内置动作预设（按 id 索引，编辑器下拉直接消费） */
export const STAGE2D_ACTION_PRESETS: readonly Stage2dActionPreset[] = [
  // 待机呼吸：双臂轻微起落 + 胸廓微倾（约 2.4s 一循环）
  preset('idle', [
    { time: 0, pose: {} },
    { time: 1.2, pose: { chest: -3, shoulderL: 4, shoulderR: -4 } },
    { time: 2.4, pose: {} }
  ]),
  // 挥手：右臂上举过头、前臂在头顶左右摆两下后放下
  preset('wave', [
    { time: 0, pose: {} },
    { time: 0.45, pose: { shoulderR: -100, elbowR: -55 } },
    { time: 0.9, pose: { shoulderR: -100, elbowR: 15 } },
    { time: 1.35, pose: { shoulderR: -100, elbowR: -55 } },
    { time: 1.8, pose: { shoulderR: -100, elbowR: 15 } },
    { time: 2.4, pose: {} }
  ]),
  // 欢呼：双臂 V 形上举 + 前臂交替抖动
  preset('cheer', [
    { time: 0, pose: {} },
    { time: 0.4, pose: { shoulderL: 100, shoulderR: -100, elbowL: -20, elbowR: 20 } },
    { time: 0.8, pose: { shoulderL: 100, shoulderR: -100, elbowL: 20, elbowR: -20 } },
    { time: 1.2, pose: { shoulderL: 100, shoulderR: -100, elbowL: -20, elbowR: 20 } },
    { time: 1.6, pose: {} }
  ]),
  // 节奏摇摆：胯部左右摆 + 胸反向微倾 + 手臂随摆（约 1.5s）
  preset('sway', [
    { time: 0, pose: {} },
    { time: 0.5, pose: { hipL: 12, hipR: -12, chest: -5, shoulderL: 4, shoulderR: -4 } },
    { time: 1.0, pose: { hipL: -12, hipR: 12, chest: 5, shoulderL: -4, shoulderR: 4 } },
    { time: 1.5, pose: {} }
  ])
]

/** 按 id 查内置动作；未命中返回 null */
export function stage2dActionPresetById(id: string | null | undefined): Stage2dActionPreset | null {
  if (!id) return null
  return STAGE2D_ACTION_PRESETS.find((item) => item.id === id) ?? null
}
