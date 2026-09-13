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
  ]),
  // 深呼吸：双臂随吸气缓缓上抬外展、呼气回落（约 3.2s 一循环）
  preset('breathe', [
    { time: 0, pose: {} },
    { time: 1.1, pose: { shoulderL: 14, shoulderR: -14, chest: 3 } },
    { time: 2.2, pose: { shoulderL: 6, shoulderR: -6, chest: 1 } },
    { time: 3.2, pose: {} }
  ]),
  // 伸展：双臂上举过头、躯干轻侧倾，再经体侧放下（约 4.3s）
  preset('stretch', [
    { time: 0, pose: {} },
    { time: 0.9, pose: { shoulderL: 75, shoulderR: -75 } },
    { time: 1.7, pose: { shoulderL: 88, shoulderR: -88, chest: 6 } },
    { time: 2.5, pose: { shoulderL: 75, shoulderR: -75 } },
    { time: 3.3, pose: { shoulderL: -60, shoulderR: 60 } },
    { time: 4.3, pose: {} }
  ]),
  // 振臂：双臂快速举过头顶再放下，配合胸廓起伏（约 1.6s）
  preset('shakeArms', [
    { time: 0, pose: {} },
    { time: 0.3, pose: { shoulderL: 70, shoulderR: -70, chest: 3 } },
    { time: 0.6, pose: { shoulderL: -35, shoulderR: 35, chest: -2 } },
    { time: 0.9, pose: { shoulderL: 80, shoulderR: -80, chest: 4 } },
    { time: 1.2, pose: { shoulderL: -25, shoulderR: 25 } },
    { time: 1.6, pose: {} }
  ]),
  // 摇头：头部快速左右摆三下（像拒绝/否认），颈肩微微反向补动
  preset('headShake', [
    { time: 0, pose: {} },
    { time: 0.18, pose: { head: 20, neck: -8 } },
    { time: 0.36, pose: { head: -20, neck: 8 } },
    { time: 0.54, pose: { head: 12, neck: -5 } },
    { time: 0.8, pose: {} }
  ]),
  // 歪头：头向左歪一下再向右（卖萌 / 好奇），颈部轻带
  preset('headTilt', [
    { time: 0, pose: {} },
    { time: 0.7, pose: { head: 22 } },
    { time: 1.5, pose: { head: -12, neck: 6, chest: 3 } },
    { time: 2.4, pose: {} }
  ]),
  // 原地踏步：左右腿交替外抬、手臂反向小摆（约 1.35s 两步）
  preset('march', [
    { time: 0, pose: {} },
    { time: 0.45, pose: { hipL: 26, shoulderL: 12, shoulderR: 20, chest: 2 } },
    { time: 0.9, pose: { hipR: -26, shoulderL: -20, shoulderR: -12, chest: -2 } },
    { time: 1.35, pose: {} }
  ]),
  // 原地跑：双腿交替大幅外摆、膝盖带动小腿，手臂像跑步一样前后摆（约 1s 两步）
  preset('run', [
    { time: 0, pose: {} },
    { time: 0.25, pose: { hipL: 42, kneeL: -18, shoulderL: 20, shoulderR: 35, chest: 3 } },
    { time: 0.5, pose: { hipR: -42, kneeR: 18, shoulderL: -35, shoulderR: -20, chest: -3 } },
    { time: 0.75, pose: { hipL: 42, kneeL: -18, shoulderL: 20, shoulderR: 35, chest: 3 } },
    { time: 1.0, pose: {} }
  ]),
  // 原地蹦跳：起跳瞬间双臂上举、双腿微张，落下时手臂回落（约 1.5s）
  preset('jump', [
    { time: 0, pose: {} },
    {
      time: 0.5,
      pose: { hipL: 28, hipR: -28, kneeL: 12, kneeR: -12, shoulderL: 80, shoulderR: -80, chest: 2 }
    },
    { time: 1.0, pose: { hipL: -8, hipR: 8, shoulderL: -30, shoulderR: 30 } },
    { time: 1.5, pose: {} }
  ]),
  // 开合跳：双腿分开双臂上举 ↔ 双腿并拢双臂放下的节奏（约 1.4s 一组）
  preset('jumpJacks', [
    { time: 0, pose: {} },
    { time: 0.35, pose: { hipL: 45, hipR: -45, shoulderL: 85, shoulderR: -85 } },
    { time: 0.7, pose: { hipL: -15, hipR: 15, shoulderL: -80, shoulderR: 80 } },
    { time: 1.05, pose: { hipL: 45, hipR: -45, shoulderL: 85, shoulderR: -85 } },
    { time: 1.4, pose: {} }
  ]),
  // 侧踢：右腿向右外摆高踢、再左腿向左踢，双臂张开保持平衡（约 1.3s 一组）
  preset('sideKick', [
    { time: 0, pose: {} },
    { time: 0.45, pose: { hipR: -60, shoulderL: -45, shoulderR: 45, chest: -6 } },
    { time: 0.8, pose: { hipL: 60, shoulderL: 45, shoulderR: -45, chest: 6 } },
    { time: 1.3, pose: {} }
  ]),
  // 扭胯律动：胯左右摆 + 胸反向摆动（约 1.5s）
  preset('hipGroove', [
    { time: 0, pose: {} },
    { time: 0.5, pose: { hipL: 16, hipR: -16, chest: -6, shoulderL: 5, shoulderR: -5 } },
    { time: 1.0, pose: { hipL: -16, hipR: 16, chest: 6, shoulderL: -5, shoulderR: 5 } },
    { time: 1.5, pose: {} }
  ]),
  // 即兴舞：胯、胸、头与手臂组合的 4 拍律动（约 2.2s）
  preset('dance', [
    { time: 0, pose: {} },
    { time: 0.55, pose: { hipL: 18, hipR: -18, chest: -6, shoulderL: 35, shoulderR: -35 } },
    { time: 1.1, pose: { hipL: -14, hipR: 14, chest: 5, shoulderL: 80, shoulderR: -80, head: 6 } },
    {
      time: 1.65,
      pose: { hipL: 14, hipR: -14, chest: -5, shoulderL: -15, shoulderR: 15, head: -4 }
    },
    { time: 2.2, pose: {} }
  ]),
  // 大笑：双臂小幅抖动 + 头胸快速起伏（约 1.3s）
  preset('laugh', [
    { time: 0, pose: {} },
    { time: 0.22, pose: { chest: -5, shoulderL: 28, shoulderR: -28, head: 5 } },
    { time: 0.44, pose: { chest: 4, shoulderL: -14, shoulderR: 14, head: -3 } },
    { time: 0.66, pose: { chest: -4, shoulderL: 24, shoulderR: -24 } },
    { time: 0.88, pose: { chest: 5, shoulderL: -10, shoulderR: 10, head: 4 } },
    { time: 1.3, pose: {} }
  ]),
  // 低落：双臂垂放身侧、头微垂缓缓摆动（约 4s）
  preset('sad', [
    { time: 0, pose: {} },
    { time: 1.0, pose: { shoulderL: -58, shoulderR: 58, chest: 4, head: -7 } },
    { time: 2.0, pose: { shoulderL: -42, shoulderR: 42, chest: 1, head: 5 } },
    { time: 3.0, pose: { shoulderL: -55, shoulderR: 55, chest: 3, head: -5 } },
    { time: 4.0, pose: {} }
  ])
]

/** 按 id 查内置动作；未命中返回 null */
export function stage2dActionPresetById(id: string | null | undefined): Stage2dActionPreset | null {
  if (!id) return null
  return STAGE2D_ACTION_PRESETS.find((item) => item.id === id) ?? null
}
