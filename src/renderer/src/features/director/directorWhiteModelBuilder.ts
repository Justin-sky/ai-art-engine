import {
  STAGE_PRIMITIVE_VALUES,
  type StageMannequinPreset,
  type StageObjectState,
  type StagePrimitive,
  type StageVec3
} from '@shared/domain'
import { filmNameKey, type FilmShot, type FilmStoryboard } from '@shared/graph/film/storyboard'

const DEG = Math.PI / 180
const VALID_PRIMITIVES: ReadonlySet<string> = new Set(STAGE_PRIMITIVE_VALUES)

export type StoryboardActorPosture =
  | 'standing'
  | 'sitting'
  | 'slumped_sitting'
  | 'walking'
  | 'running'
  | 'fighting'
  | 'kneeling'
  | 'crouching'
  | 'lying_down'
  | 'jumping'
  | 'bowing'
  | 'cheering'
  | 'dancing'
  | 'thinking'
  | 'phone'
  | 'drinking'
  | 'falling'

export interface StoryboardWhiteModelPartSpec {
  label: string
  primitive: StagePrimitive
  /** 相对于父对象底部原点的局部偏移（米，Y 向上） */
  offset: StageVec3
  /** 局部欧拉旋转（弧度） */
  rotation?: StageVec3
  /** 部件真实物理尺寸（米：宽 X / 高 Y / 深 Z） */
  size: StageVec3
  color: string
}

export type StoryboardObjectCategory = 'surface' | 'seat' | 'tabletop' | 'floor' | 'architecture'

export interface StoryboardWhiteModelObjectSpec {
  id: string
  name: string
  category: StoryboardObjectCategory
  /** 世界空间底部基准坐标（其中 y 为相对于舞台地面 baseY 的高度，单位：米） */
  position: StageVec3
  /** 绕 Y 轴朝向（弧度） */
  rotationY: number
  /** 当 category === 'surface' 时，台面顶部的高度（米） */
  surfaceHeight?: number
  parts: StoryboardWhiteModelPartSpec[]
}

export interface StoryboardActorPlacementSpec {
  name: string
  mannequinPreset: StageMannequinPreset
  posture: StoryboardActorPosture
  /** 相对于舞台地面 baseY 的位置（米） */
  position: StageVec3
  /** 绕 Y 轴朝向（弧度，0 表示面朝 +Z） */
  rotationY: number
  bonePose: Record<string, StageVec3>
}

export interface StoryboardShotCameraOverrideSpec {
  shotId: string
  /** 相对于舞台地面 baseY 的相机起点坐标（米） */
  position?: StageVec3
  /** 相对于舞台地面 baseY 的注视点坐标（米） */
  lookAt?: StageVec3
  /** 运镜终点相机坐标（相对于 baseY，米） */
  endPosition?: StageVec3
  focalLengthMm?: number
}

export interface StoryboardSceneLayoutPlan {
  actors: StoryboardActorPlacementSpec[]
  objects: StoryboardWhiteModelObjectSpec[]
  shotCameras?: Record<string, StoryboardShotCameraOverrideSpec>
  usedLlm?: boolean
}

export interface ArchetypeDefinition {
  category: StoryboardObjectCategory
  surfaceHeight?: number
  footprint: { width: number; depth: number; height: number }
  parts: StoryboardWhiteModelPartSpec[]
}

/**
 * 根据角色体态生成内置人偶骨骼姿态（局部欧拉角弧度）与根部高度偏移（米）。
 */
export function resolveActorPosturePose(
  posture: StoryboardActorPosture,
  actorIndex = 0,
  totalActors = 1
): { yOffset: number; bonePose: Record<string, StageVec3> } {
  if (posture === 'slumped_sitting') {
    return {
      yOffset: -0.43,
      bonePose: {
        Hips: { x: -8 * DEG, y: 0, z: 0 },
        Spine: { x: 22 * DEG, y: 0, z: 0 },
        Chest: { x: 18 * DEG, y: 0, z: 0 },
        Neck: { x: -14 * DEG, y: 0, z: 0 },
        Head: { x: -10 * DEG, y: 0, z: 0 },
        LeftUpperArm: { x: -34 * DEG, y: 12 * DEG, z: -10 * DEG },
        RightUpperArm: { x: -34 * DEG, y: -12 * DEG, z: 10 * DEG },
        LeftForeArm: { x: -54 * DEG, y: 0, z: 0 },
        RightForeArm: { x: -54 * DEG, y: 0, z: 0 },
        LeftUpLeg: { x: -82 * DEG, y: 8 * DEG, z: -4 * DEG },
        RightUpLeg: { x: -82 * DEG, y: -8 * DEG, z: 4 * DEG },
        LeftLeg: { x: 78 * DEG, y: 0, z: 0 },
        RightLeg: { x: 78 * DEG, y: 0, z: 0 }
      }
    }
  }

  if (posture === 'sitting') {
    return {
      yOffset: -0.42,
      bonePose: {
        Spine: { x: 6 * DEG, y: 0, z: 0 },
        Chest: { x: 4 * DEG, y: 0, z: 0 },
        LeftUpperArm: { x: -26 * DEG, y: 10 * DEG, z: -12 * DEG },
        RightUpperArm: { x: -26 * DEG, y: -10 * DEG, z: 12 * DEG },
        LeftForeArm: { x: -56 * DEG, y: 0, z: 0 },
        RightForeArm: { x: -56 * DEG, y: 0, z: 0 },
        LeftUpLeg: { x: -86 * DEG, y: 5 * DEG, z: -3 * DEG },
        RightUpLeg: { x: -86 * DEG, y: -5 * DEG, z: 3 * DEG },
        LeftLeg: { x: 86 * DEG, y: 0, z: 0 },
        RightLeg: { x: 86 * DEG, y: 0, z: 0 }
      }
    }
  }

  if (posture === 'kneeling') {
    return {
      yOffset: -0.44,
      bonePose: {
        Spine: { x: 10 * DEG, y: 0, z: 0 },
        Head: { x: -12 * DEG, y: 0, z: 0 },
        LeftUpLeg: { x: -20 * DEG, y: 0, z: 0 },
        RightUpLeg: { x: -20 * DEG, y: 0, z: 0 },
        LeftLeg: { x: 115 * DEG, y: 0, z: 0 },
        RightLeg: { x: 115 * DEG, y: 0, z: 0 }
      }
    }
  }

  if (posture === 'crouching') {
    return {
      yOffset: -0.4,
      bonePose: {
        Spine: { x: 24 * DEG, y: 0, z: 0 },
        Chest: { x: 16 * DEG, y: 0, z: 0 },
        Head: { x: -22 * DEG, y: 0, z: 0 },
        LeftUpperArm: { x: -28 * DEG, y: 0, z: -12 * DEG },
        RightUpperArm: { x: -28 * DEG, y: 0, z: 12 * DEG },
        LeftForeArm: { x: -58 * DEG, y: 0, z: 0 },
        RightForeArm: { x: -58 * DEG, y: 0, z: 0 },
        LeftUpLeg: { x: -98 * DEG, y: 12 * DEG, z: -6 * DEG },
        RightUpLeg: { x: -98 * DEG, y: -12 * DEG, z: 6 * DEG },
        LeftLeg: { x: 112 * DEG, y: 0, z: 0 },
        RightLeg: { x: 112 * DEG, y: 0, z: 0 }
      }
    }
  }

  if (posture === 'lying_down') {
    return {
      yOffset: -0.82,
      bonePose: {
        Hips: { x: -88 * DEG, y: 0, z: 0 },
        Spine: { x: 4 * DEG, y: 0, z: 0 },
        Head: { x: 10 * DEG, y: 0, z: 0 },
        LeftUpperArm: { x: 6 * DEG, y: 0, z: -16 * DEG },
        RightUpperArm: { x: 6 * DEG, y: 0, z: 16 * DEG },
        LeftForeArm: { x: -14 * DEG, y: 0, z: 0 },
        RightForeArm: { x: -14 * DEG, y: 0, z: 0 },
        LeftLeg: { x: 6 * DEG, y: 0, z: 0 },
        RightLeg: { x: 6 * DEG, y: 0, z: 0 }
      }
    }
  }

  if (posture === 'jumping') {
    return {
      yOffset: 0.25,
      bonePose: {
        Spine: { x: -8 * DEG, y: 0, z: 0 },
        Chest: { x: -10 * DEG, y: 0, z: 0 },
        LeftUpperArm: { x: -135 * DEG, y: 0, z: -24 * DEG },
        RightUpperArm: { x: -135 * DEG, y: 0, z: 24 * DEG },
        LeftForeArm: { x: -25 * DEG, y: 0, z: 0 },
        RightForeArm: { x: -25 * DEG, y: 0, z: 0 },
        LeftUpLeg: { x: -42 * DEG, y: 8 * DEG, z: -6 * DEG },
        RightUpLeg: { x: -25 * DEG, y: -8 * DEG, z: 6 * DEG },
        LeftLeg: { x: 68 * DEG, y: 0, z: 0 },
        RightLeg: { x: 48 * DEG, y: 0, z: 0 }
      }
    }
  }

  if (posture === 'bowing') {
    return {
      yOffset: 0,
      bonePose: {
        Spine: { x: 35 * DEG, y: 0, z: 0 },
        Chest: { x: 25 * DEG, y: 0, z: 0 },
        Neck: { x: 12 * DEG, y: 0, z: 0 },
        LeftUpperArm: { x: 8 * DEG, y: 0, z: -6 * DEG },
        RightUpperArm: { x: 8 * DEG, y: 0, z: 6 * DEG }
      }
    }
  }

  if (posture === 'cheering') {
    return {
      yOffset: 0,
      bonePose: {
        Spine: { x: -8 * DEG, y: 0, z: 0 },
        Chest: { x: -10 * DEG, y: 0, z: 0 },
        Head: { x: -10 * DEG, y: 0, z: 0 },
        LeftUpperArm: { x: -145 * DEG, y: 0, z: -26 * DEG },
        RightUpperArm: { x: -145 * DEG, y: 0, z: 26 * DEG },
        LeftForeArm: { x: -22 * DEG, y: 0, z: 0 },
        RightForeArm: { x: -22 * DEG, y: 0, z: 0 }
      }
    }
  }

  if (posture === 'dancing') {
    return {
      yOffset: 0,
      bonePose: {
        Hips: { x: 0, y: 14 * DEG, z: -8 * DEG },
        Spine: { x: -6 * DEG, y: -12 * DEG, z: 8 * DEG },
        LeftUpperArm: { x: -115 * DEG, y: 12 * DEG, z: -32 * DEG },
        LeftForeArm: { x: -38 * DEG, y: 0, z: 0 },
        RightUpperArm: { x: -32 * DEG, y: -16 * DEG, z: 28 * DEG },
        RightForeArm: { x: -68 * DEG, y: 0, z: 0 },
        LeftUpLeg: { x: -26 * DEG, y: 12 * DEG, z: -8 * DEG },
        LeftLeg: { x: 42 * DEG, y: 0, z: 0 }
      }
    }
  }

  if (posture === 'thinking') {
    return {
      yOffset: 0,
      bonePose: {
        Spine: { x: 6 * DEG, y: -5 * DEG, z: 0 },
        Head: { x: 14 * DEG, y: -8 * DEG, z: 4 * DEG },
        RightUpperArm: { x: -52 * DEG, y: -18 * DEG, z: 14 * DEG },
        RightForeArm: { x: -108 * DEG, y: -12 * DEG, z: 0 },
        LeftUpperArm: { x: -20 * DEG, y: 24 * DEG, z: -12 * DEG },
        LeftForeArm: { x: -75 * DEG, y: 20 * DEG, z: 0 }
      }
    }
  }

  if (posture === 'phone') {
    return {
      yOffset: 0,
      bonePose: {
        Spine: { x: 8 * DEG, y: 0, z: 0 },
        Neck: { x: 18 * DEG, y: 0, z: 0 },
        Head: { x: 14 * DEG, y: -4 * DEG, z: 0 },
        RightUpperArm: { x: -42 * DEG, y: -16 * DEG, z: 12 * DEG },
        RightForeArm: { x: -86 * DEG, y: -14 * DEG, z: 0 }
      }
    }
  }

  if (posture === 'drinking') {
    return {
      yOffset: 0,
      bonePose: {
        Head: { x: -10 * DEG, y: 0, z: 0 },
        RightUpperArm: { x: -68 * DEG, y: -16 * DEG, z: 14 * DEG },
        RightForeArm: { x: -98 * DEG, y: -12 * DEG, z: 0 }
      }
    }
  }

  if (posture === 'falling') {
    return {
      yOffset: -0.35,
      bonePose: {
        Hips: { x: -38 * DEG, y: 12 * DEG, z: -14 * DEG },
        Spine: { x: -18 * DEG, y: -10 * DEG, z: 8 * DEG },
        Head: { x: 20 * DEG, y: 0, z: 0 },
        LeftUpperArm: { x: -75 * DEG, y: 20 * DEG, z: -42 * DEG },
        RightUpperArm: { x: -62 * DEG, y: -20 * DEG, z: 48 * DEG },
        LeftUpLeg: { x: -36 * DEG, y: 12 * DEG, z: -10 * DEG },
        RightUpLeg: { x: 16 * DEG, y: -10 * DEG, z: 8 * DEG },
        LeftLeg: { x: 48 * DEG, y: 0, z: 0 },
        RightLeg: { x: 32 * DEG, y: 0, z: 0 }
      }
    }
  }

  if (posture === 'fighting') {
    return {
      yOffset: 0,
      bonePose: {
        Hips: { x: 8 * DEG, y: -20 * DEG, z: 0 },
        Spine: { x: 12 * DEG, y: 10 * DEG, z: 0 },
        Chest: { x: 10 * DEG, y: 12 * DEG, z: 0 },
        Head: { x: -12 * DEG, y: 18 * DEG, z: 0 },
        LeftUpperArm: { x: -45 * DEG, y: 15 * DEG, z: -22 * DEG },
        LeftForeArm: { x: -85 * DEG, y: 0, z: 0 },
        RightUpperArm: { x: -35 * DEG, y: -15 * DEG, z: 22 * DEG },
        RightForeArm: { x: -95 * DEG, y: 0, z: 0 },
        LeftUpLeg: { x: -22 * DEG, y: 12 * DEG, z: -5 * DEG },
        LeftLeg: { x: 38 * DEG, y: 0, z: 0 },
        RightUpLeg: { x: 18 * DEG, y: -12 * DEG, z: 5 * DEG },
        RightLeg: { x: 24 * DEG, y: 0, z: 0 }
      }
    }
  }

  // 默认站姿（带轻微自然体态）
  const turnSign = totalActors > 1 && actorIndex === 0 ? -1 : 1
  return {
    yOffset: 0,
    bonePose: {
      Spine: { x: -3 * DEG, y: 4 * turnSign * DEG, z: 0 },
      Chest: { x: -4 * DEG, y: 4 * turnSign * DEG, z: 0 },
      LeftUpperArm: { x: 4 * DEG, y: 0, z: -12 * DEG },
      RightUpperArm: { x: 4 * DEG, y: 0, z: 12 * DEG },
      LeftForeArm: { x: -18 * DEG, y: 0, z: 0 },
      RightForeArm: { x: -18 * DEG, y: 0, z: 0 }
    }
  }
}

/**
 * 内置高辨识度组合白模库（Compound White-Model Archetypes）：
 * 当场景中缺少现成 3D 模型资产时，使用多部件基础几何体拼装具有真实物理比例的白模。
 */
export function inferCompoundWhiteModelArchetype(name: string): ArchetypeDefinition {
  const lower = name.trim().toLowerCase()

  // 1. 电脑显示器 / 台式机屏幕
  if (/显示器|电脑屏幕|台式机|屏幕|monitor|display|desktop\s*pc|computer/.test(lower)) {
    return {
      category: 'tabletop',
      footprint: { width: 0.56, depth: 0.28, height: 0.44 },
      parts: [
        {
          label: '底座',
          primitive: 'box',
          offset: { x: 0, y: 0.01, z: -0.02 },
          size: { x: 0.22, y: 0.02, z: 0.16 },
          color: '#475569'
        },
        {
          label: '支架',
          primitive: 'cylinder',
          offset: { x: 0, y: 0.1, z: -0.05 },
          size: { x: 0.045, y: 0.18, z: 0.045 },
          color: '#64748b'
        },
        {
          label: '屏幕面板',
          primitive: 'box',
          offset: { x: 0, y: 0.27, z: 0 },
          size: { x: 0.56, y: 0.34, z: 0.032 },
          color: '#1e293b'
        },
        {
          label: '显示画面',
          primitive: 'box',
          offset: { x: 0, y: 0.27, z: 0.018 },
          size: { x: 0.52, y: 0.3, z: 0.008 },
          color: '#93c5fd'
        },
        {
          label: '键盘',
          primitive: 'box',
          offset: { x: 0, y: 0.01, z: 0.16 },
          size: { x: 0.36, y: 0.016, z: 0.13 },
          color: '#334155'
        }
      ]
    }
  }

  // 2. 笔记本电脑
  if (/笔记本电脑|笔电|laptop|notebook/.test(lower)) {
    return {
      category: 'tabletop',
      footprint: { width: 0.36, depth: 0.26, height: 0.24 },
      parts: [
        {
          label: '机身键盘',
          primitive: 'box',
          offset: { x: 0, y: 0.009, z: 0.04 },
          size: { x: 0.34, y: 0.018, z: 0.23 },
          color: '#64748b'
        },
        {
          label: '显示屏',
          primitive: 'box',
          offset: { x: 0, y: 0.115, z: -0.075 },
          rotation: { x: -14 * DEG, y: 0, z: 0 },
          size: { x: 0.34, y: 0.22, z: 0.012 },
          color: '#94a3b8'
        }
      ]
    }
  }

  // 3. 文件堆 / 书堆 / 资料堆 / 试卷堆
  if (
    /文件堆|文件|资料|卷宗|书堆|书籍|档案|报表|试卷|files|paper\s*stack|documents|books/.test(lower)
  ) {
    return {
      category: 'tabletop',
      footprint: { width: 0.3, depth: 0.34, height: 0.26 },
      parts: [
        {
          label: '底层文件叠',
          primitive: 'box',
          offset: { x: 0, y: 0.045, z: 0 },
          size: { x: 0.25, y: 0.09, z: 0.32 },
          color: '#cbd5e1'
        },
        {
          label: '中层错位文件叠',
          primitive: 'box',
          offset: { x: 0.012, y: 0.13, z: -0.01 },
          rotation: { x: 0, y: 8 * DEG, z: 0 },
          size: { x: 0.24, y: 0.08, z: 0.31 },
          color: '#e2e8f0'
        },
        {
          label: '顶层卷宗夹',
          primitive: 'box',
          offset: { x: -0.01, y: 0.2, z: 0.01 },
          rotation: { x: 0, y: -11 * DEG, z: 0 },
          size: { x: 0.23, y: 0.06, z: 0.3 },
          color: '#94a3b8'
        }
      ]
    }
  }

  // 4. 办公桌 / 书桌 / 审讯桌 / 桌子 / 工位桌
  if (/办公桌|书桌|审讯桌|会议桌|餐桌|工位桌|长桌|桌子|工作台|desk|table|workstation/.test(lower)) {
    return {
      category: 'surface',
      surfaceHeight: 0.74,
      footprint: { width: 1.4, depth: 0.72, height: 0.74 },
      parts: [
        {
          label: '桌面',
          primitive: 'box',
          offset: { x: 0, y: 0.715, z: 0 },
          size: { x: 1.4, y: 0.05, z: 0.72 },
          color: '#94a3b8'
        },
        {
          label: '左侧支撑板',
          primitive: 'box',
          offset: { x: -0.65, y: 0.35, z: 0 },
          size: { x: 0.05, y: 0.7, z: 0.66 },
          color: '#64748b'
        },
        {
          label: '右侧支撑板',
          primitive: 'box',
          offset: { x: 0.65, y: 0.35, z: 0 },
          size: { x: 0.05, y: 0.7, z: 0.66 },
          color: '#64748b'
        },
        {
          label: '前挡板',
          primitive: 'box',
          offset: { x: 0, y: 0.52, z: 0.28 },
          size: { x: 1.26, y: 0.34, z: 0.03 },
          color: '#475569'
        }
      ]
    }
  }

  // 5. 工位椅 / 办公椅 / 椅子
  if (/工位椅|办公椅|转椅|审讯椅|座椅|椅子|凳子|chair|stool|seat/.test(lower)) {
    return {
      category: 'seat',
      surfaceHeight: 0.46,
      footprint: { width: 0.52, depth: 0.52, height: 0.94 },
      parts: [
        {
          label: '底座',
          primitive: 'disc',
          offset: { x: 0, y: 0.02, z: 0 },
          size: { x: 0.52, y: 0.04, z: 0.52 },
          color: '#334155'
        },
        {
          label: '气压升降杆',
          primitive: 'cylinder',
          offset: { x: 0, y: 0.22, z: 0 },
          size: { x: 0.06, y: 0.4, z: 0.06 },
          color: '#475569'
        },
        {
          label: '坐垫',
          primitive: 'box',
          offset: { x: 0, y: 0.44, z: 0 },
          size: { x: 0.48, y: 0.06, z: 0.46 },
          color: '#475569'
        },
        {
          label: '靠背',
          primitive: 'box',
          offset: { x: 0, y: 0.71, z: -0.21 },
          rotation: { x: -6 * DEG, y: 0, z: 0 },
          size: { x: 0.44, y: 0.48, z: 0.05 },
          color: '#334155'
        }
      ]
    }
  }

  // 6. 办公室格子间 / 隔断群（成排向纵深延伸）
  if (/格子间|办公区|工位隔断|隔断|cubicle|office\s*partition/.test(lower)) {
    return {
      category: 'architecture',
      footprint: { width: 4.8, depth: 5.5, height: 1.25 },
      parts: [
        {
          label: '主工位左侧隔断',
          primitive: 'box',
          offset: { x: -0.76, y: 0.58, z: 0.15 },
          size: { x: 0.06, y: 1.16, z: 1.35 },
          color: '#64748b'
        },
        {
          label: '主工位右侧低隔断',
          primitive: 'box',
          offset: { x: 0.76, y: 0.58, z: 0.15 },
          size: { x: 0.06, y: 1.16, z: 1.35 },
          color: '#64748b'
        },
        {
          label: '前排左侧格子间屏风',
          primitive: 'box',
          offset: { x: -1.95, y: 0.62, z: 1.2 },
          size: { x: 1.55, y: 1.24, z: 0.06 },
          color: '#475569'
        },
        {
          label: '前排右侧格子间屏风',
          primitive: 'box',
          offset: { x: 1.95, y: 0.62, z: 1.2 },
          size: { x: 1.55, y: 1.24, z: 0.06 },
          color: '#475569'
        },
        {
          label: '中排左侧格子间屏风',
          primitive: 'box',
          offset: { x: -1.95, y: 0.62, z: -0.8 },
          size: { x: 1.55, y: 1.24, z: 0.06 },
          color: '#475569'
        },
        {
          label: '中排右侧格子间屏风',
          primitive: 'box',
          offset: { x: 1.95, y: 0.62, z: -0.8 },
          size: { x: 1.55, y: 1.24, z: 0.06 },
          color: '#475569'
        },
        {
          label: '后排左侧远景屏风',
          primitive: 'box',
          offset: { x: -1.95, y: 0.62, z: -2.6 },
          size: { x: 1.55, y: 1.24, z: 0.06 },
          color: '#334155'
        },
        {
          label: '后排右侧远景屏风',
          primitive: 'box',
          offset: { x: 1.95, y: 0.62, z: -2.6 },
          size: { x: 1.55, y: 1.24, z: 0.06 },
          color: '#334155'
        }
      ]
    }
  }

  // 7. 咖啡杯 / 水杯 / 茶杯
  if (/咖啡杯|水杯|茶杯|酒杯|马克杯|杯子|杯|瓶|cup|mug|glass|bottle/.test(lower)) {
    return {
      category: 'tabletop',
      footprint: { width: 0.12, depth: 0.12, height: 0.12 },
      parts: [
        {
          label: '杯身',
          primitive: 'cylinder',
          offset: { x: 0, y: 0.055, z: 0 },
          size: { x: 0.085, y: 0.11, z: 0.085 },
          color: '#f1f5f9'
        },
        {
          label: '杯口环',
          primitive: 'ring',
          offset: { x: 0, y: 0.111, z: 0 },
          size: { x: 0.086, y: 0.01, z: 0.086 },
          color: '#94a3b8'
        }
      ]
    }
  }

  // 8. 手机 / 平板
  if (/手机|智能手机|平板|对讲机|phone|smartphone|tablet/.test(lower)) {
    return {
      category: 'tabletop',
      footprint: { width: 0.09, depth: 0.17, height: 0.02 },
      parts: [
        {
          label: '机身',
          primitive: 'box',
          offset: { x: 0, y: 0.007, z: 0 },
          size: { x: 0.08, y: 0.014, z: 0.16 },
          color: '#1e293b'
        },
        {
          label: '屏幕',
          primitive: 'box',
          offset: { x: 0, y: 0.015, z: 0 },
          size: { x: 0.072, y: 0.004, z: 0.145 },
          color: '#60a5fa'
        }
      ]
    }
  }

  // 9. 信件 / 辞职信 / 合同 / 纸张
  if (/辞职信|信封|信件|信纸|合同|通知书|报告单|纸张|letter|envelope|contract/.test(lower)) {
    return {
      category: 'tabletop',
      footprint: { width: 0.22, depth: 0.3, height: 0.02 },
      parts: [
        {
          label: '信纸',
          primitive: 'box',
          offset: { x: 0, y: 0.005, z: 0 },
          size: { x: 0.21, y: 0.01, z: 0.29 },
          color: '#fef3c7'
        }
      ]
    }
  }

  // 10. 台灯
  if (/台灯|阅读灯|lamp/.test(lower)) {
    return {
      category: 'tabletop',
      footprint: { width: 0.22, depth: 0.22, height: 0.42 },
      parts: [
        {
          label: '灯座',
          primitive: 'cylinder',
          offset: { x: 0, y: 0.015, z: 0 },
          size: { x: 0.16, y: 0.03, z: 0.16 },
          color: '#475569'
        },
        {
          label: '灯杆',
          primitive: 'cylinder',
          offset: { x: 0, y: 0.18, z: 0 },
          size: { x: 0.025, y: 0.32, z: 0.025 },
          color: '#64748b'
        },
        {
          label: '灯罩',
          primitive: 'cone',
          offset: { x: 0, y: 0.34, z: 0.03 },
          rotation: { x: 18 * DEG, y: 0, z: 0 },
          size: { x: 0.2, y: 0.14, z: 0.2 },
          color: '#fde68a'
        }
      ]
    }
  }

  // 11. 沙发
  if (/沙发|couch|sofa/.test(lower)) {
    return {
      category: 'seat',
      surfaceHeight: 0.42,
      footprint: { width: 1.8, depth: 0.85, height: 0.82 },
      parts: [
        {
          label: '座垫底座',
          primitive: 'box',
          offset: { x: 0, y: 0.21, z: 0 },
          size: { x: 1.75, y: 0.42, z: 0.8 },
          color: '#64748b'
        },
        {
          label: '沙发靠背',
          primitive: 'box',
          offset: { x: 0, y: 0.56, z: -0.32 },
          size: { x: 1.75, y: 0.48, z: 0.18 },
          color: '#475569'
        },
        {
          label: '左扶手',
          primitive: 'box',
          offset: { x: -0.82, y: 0.38, z: 0 },
          size: { x: 0.16, y: 0.52, z: 0.82 },
          color: '#475569'
        },
        {
          label: '右扶手',
          primitive: 'box',
          offset: { x: 0.82, y: 0.38, z: 0 },
          size: { x: 0.16, y: 0.52, z: 0.82 },
          color: '#475569'
        }
      ]
    }
  }

  // 12. 床 / 病床
  if (/床|病床|榻|bed/.test(lower)) {
    return {
      category: 'surface',
      surfaceHeight: 0.5,
      footprint: { width: 1.5, depth: 2.0, height: 0.95 },
      parts: [
        {
          label: '床垫与床架',
          primitive: 'box',
          offset: { x: 0, y: 0.25, z: 0 },
          size: { x: 1.5, y: 0.5, z: 2.0 },
          color: '#cbd5e1'
        },
        {
          label: '床头板',
          primitive: 'box',
          offset: { x: 0, y: 0.55, z: -0.96 },
          size: { x: 1.52, y: 0.95, z: 0.08 },
          color: '#64748b'
        },
        {
          label: '枕头',
          primitive: 'box',
          offset: { x: 0, y: 0.56, z: -0.72 },
          size: { x: 0.65, y: 0.12, z: 0.36 },
          color: '#f8fafc'
        }
      ]
    }
  }

  // 13. 门 / 拱门 / 窗
  if (/门|拱门|大门|房门|窗|窗户|落地窗|door|arch|gate|window/.test(lower)) {
    return {
      category: 'architecture',
      footprint: { width: 1.2, depth: 0.25, height: 2.1 },
      parts: [
        {
          label: '门框主体',
          primitive: 'arch',
          offset: { x: 0, y: 1.05, z: 0 },
          size: { x: 1.2, y: 2.1, z: 0.22 },
          color: '#64748b'
        }
      ]
    }
  }

  // 14. 柜子 / 书架 / 货架
  if (/柜|书架|货架|衣柜|文件柜|cabinet|shelf|bookshelf|locker/.test(lower)) {
    return {
      category: 'floor',
      footprint: { width: 0.9, depth: 0.42, height: 1.75 },
      parts: [
        {
          label: '柜体',
          primitive: 'box',
          offset: { x: 0, y: 0.88, z: 0 },
          size: { x: 0.9, y: 1.76, z: 0.42 },
          color: '#64748b'
        }
      ]
    }
  }

  // 15. 汽车 / 载具
  if (/汽车|轿车|警车|出租车|面包车|车辆|car|vehicle|sedan|suv/.test(lower)) {
    return {
      category: 'floor',
      footprint: { width: 1.85, depth: 4.2, height: 1.48 },
      parts: [
        {
          label: '底盘车身',
          primitive: 'box',
          offset: { x: 0, y: 0.52, z: 0 },
          size: { x: 1.82, y: 0.68, z: 4.1 },
          color: '#475569'
        },
        {
          label: '车厢顶棚',
          primitive: 'box',
          offset: { x: 0, y: 1.12, z: -0.15 },
          size: { x: 1.56, y: 0.56, z: 2.1 },
          color: '#64748b'
        }
      ]
    }
  }

  // 16. 树木 / 绿植 / 盆栽
  if (/树|绿植|盆栽|植物|tree|plant|bush/.test(lower)) {
    return {
      category: 'floor',
      footprint: { width: 0.9, depth: 0.9, height: 1.8 },
      parts: [
        {
          label: '树干/花盆',
          primitive: 'cylinder',
          offset: { x: 0, y: 0.45, z: 0 },
          size: { x: 0.24, y: 0.9, z: 0.24 },
          color: '#78716c'
        },
        {
          label: '树冠',
          primitive: 'sphere',
          offset: { x: 0, y: 1.25, z: 0 },
          size: { x: 0.95, y: 1.05, z: 0.95 },
          color: '#86efac'
        }
      ]
    }
  }

  // 默认通用道具白模
  return {
    category: 'floor',
    footprint: { width: 0.45, depth: 0.45, height: 0.45 },
    parts: [
      {
        label: '主体',
        primitive: 'box',
        offset: { x: 0, y: 0.225, z: 0 },
        size: { x: 0.45, y: 0.45, z: 0.45 },
        color: '#94a3b8'
      }
    ]
  }
}

/**
 * 将 StoryboardWhiteModelObjectSpec 编译为舞台 StageObjectState 列表：
 * - 单部件：直接生成一个 `kind: 'primitive'` 物体；
 * - 多部件：生成一个 `kind: 'empty'` 根组（`nameVisible: true`，`scale: 1,1,1`）+ 多个 `parentId` 挂在根组下的 `kind: 'primitive'` 子部件（`nameVisible: false`）。
 */
export function buildStageObjectsFromWhiteModelSpec(
  spec: StoryboardWhiteModelObjectSpec,
  baseY: number
): StageObjectState[] {
  const worldPos: StageVec3 = {
    x: Number(spec.position.x.toFixed(3)),
    y: Number((baseY + spec.position.y).toFixed(3)),
    z: Number(spec.position.z.toFixed(3))
  }
  const parts =
    spec.parts.length > 0 ? spec.parts : inferCompoundWhiteModelArchetype(spec.name).parts

  if (parts.length === 1) {
    const p = parts[0]
    const rotX = p.rotation?.x ?? 0
    const rotY = (p.rotation?.y ?? 0) + spec.rotationY
    const rotZ = p.rotation?.z ?? 0
    return [
      {
        id: spec.id,
        name: spec.name,
        kind: 'primitive',
        primitive: p.primitive,
        color: p.color,
        visible: true,
        locked: false,
        nameVisible: true,
        position: {
          x: Number((worldPos.x + p.offset.x).toFixed(3)),
          y: Number((worldPos.y + p.offset.y).toFixed(3)),
          z: Number((worldPos.z + p.offset.z).toFixed(3))
        },
        rotation: { x: rotX, y: rotY, z: rotZ },
        scale: { ...p.size }
      }
    ]
  }

  const rootObj: StageObjectState = {
    id: spec.id,
    name: spec.name,
    kind: 'empty',
    visible: true,
    locked: false,
    nameVisible: true,
    position: worldPos,
    rotation: { x: 0, y: spec.rotationY, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
  }

  const childObjs: StageObjectState[] = parts.map((p, idx) => ({
    id: `${spec.id}:part:${idx + 1}`,
    name: `${spec.name} · ${p.label || idx + 1}`,
    kind: 'primitive',
    primitive: p.primitive,
    color: p.color,
    parentId: spec.id,
    visible: true,
    locked: false,
    nameVisible: false,
    position: {
      x: Number(p.offset.x.toFixed(3)),
      y: Number(p.offset.y.toFixed(3)),
      z: Number(p.offset.z.toFixed(3))
    },
    rotation: {
      x: p.rotation?.x ?? 0,
      y: p.rotation?.y ?? 0,
      z: p.rotation?.z ?? 0
    },
    scale: {
      x: Math.max(0.005, Number(p.size.x.toFixed(3))),
      y: Math.max(0.005, Number(p.size.y.toFixed(3))),
      z: Math.max(0.005, Number(p.size.z.toFixed(3)))
    }
  }))

  return [rootObj, ...childObjs]
}

function detectActorMannequinPreset(name: string, desc: string): StageMannequinPreset {
  const combined = `${name} ${desc}`.toLowerCase()
  if (
    /四足|小狗|恶犬|猎犬|猫咪|战马|巨狼|野兽|quadruped|dog|wolf|horse|cat|tiger|lion/.test(combined)
  ) {
    return 'quadruped'
  }
  if (/q版|二头身|孩童|小精灵|chibi/.test(combined)) {
    return 'chibi'
  }
  return 'humanoid'
}

function detectActorPostureFromShots(
  actorName: string,
  shots: readonly FilmShot[]
): StoryboardActorPosture {
  const text = shots
    .map((s) => `${s.action ?? ''} ${s.imagePrompt ?? ''} ${s.videoPrompt ?? ''}`)
    .join(' ')
    .toLowerCase()
  if (/瘫坐|趴在桌|伏案|瘫在|slump|hunch/.test(text)) return 'slumped_sitting'
  if (/坐在|坐着|端坐|盘腿|盘坐|工位上|办公桌前|审讯椅|sit|seated/.test(text)) return 'sitting'
  if (/平躺|躺下|躺在|卧倒|昏迷|lie down|lying|sleeping/.test(text)) return 'lying_down'
  if (/跪|半跪|单膝跪|kneel/.test(text)) return 'kneeling'
  if (/蹲下|下蹲|潜伏|隐蔽|crouch|squat/.test(text)) return 'crouching'
  if (/跌倒|摔倒|倒地|击倒|中弹|fall|trip|stumble|collapse/.test(text)) return 'falling'
  if (/跳跃|跳起|起跳|跃过|腾空|jump|leap|hop/.test(text)) return 'jumping'
  if (/奔跑|狂奔|追逐|冲刺|逃离|run|sprint|chase/.test(text)) return 'running'
  if (/行走|走近|迈步|漫步|穿行|walk|step/.test(text)) return 'walking'
  if (/格斗|战斗|攻击|挥拳|拔剑|侧踢|fight|combat|attack/.test(text)) return 'fighting'
  if (/跳舞|舞蹈|起舞|律动|dance|dancing/.test(text)) return 'dancing'
  if (/欢呼|庆祝|高呼|振臂|cheer|celebrate/.test(text)) return 'cheering'
  if (/鞠躬|敬礼|行礼|致谢|作揖|bow|salute/.test(text)) return 'bowing'
  if (/看手机|刷手机|低头看|查看手机|phone|texting/.test(text)) return 'phone'
  if (/喝水|喝酒|干杯|举杯|饮用|品茶|咖啡|drink|sip|toast/.test(text)) return 'drinking'
  if (/思考|沉思|思索|托腮|犹豫|think|ponder/.test(text)) return 'thinking'
  void actorName
  return 'standing'
}

export interface StoryboardActorSpatialHint {
  entersFrom?: 'left' | 'right'
  startsOffFrame?: boolean
  approachesCamera?: boolean
  holdsGround?: boolean
  rightOfActorKey?: string
  leftOfActorKey?: string
  companionActorKey?: string
}

export interface StoryboardSpatialRoleAnalysis {
  /** 过肩镜头前景肩部锚点角色名（如「过肩（周敏肩前拍苏念）」中的「周敏」） */
  otsShoulderActorName: string | null
  /** 过肩镜头或主视角被拍焦点角色名（如「过肩（周敏肩前拍苏念）」中的「苏念」） */
  otsTargetActorName: string | null
  /** 是否属于多角色对峙/压迫三角/过肩博弈纵深场景 */
  isDepthStandoff: boolean
  /** 角色相对方位提示（如某角色从左侧入画、某角色在另一角色右侧） */
  actorHints: Map<string, StoryboardActorSpatialHint>
}

export function parseStoryboardSpatialRoles(
  targetShots: readonly FilmShot[],
  characterNames: readonly string[]
): StoryboardSpatialRoleAnalysis {
  const actorEntries = characterNames
    .map((name) => ({ name: name.trim(), key: filmNameKey(name) }))
    .filter((e) => Boolean(e.name && e.key))

  const matchActor = (fragment: string | undefined): { name: string; key: string } | null => {
    const raw = (fragment ?? '').trim()
    if (!raw) return null
    const fragKey = filmNameKey(raw)
    return (
      actorEntries.find((a) => a.key === fragKey) ??
      actorEntries.find((a) => raw.includes(a.name) || a.name.includes(raw)) ??
      null
    )
  }

  let otsShoulderActorName: string | null = null
  let otsTargetActorName: string | null = null

  for (const shot of targetShots) {
    const searchPool = [
      shot.angle ?? '',
      shot.title ?? '',
      shot.action ?? '',
      shot.imagePrompt ?? '',
      shot.videoPrompt ?? ''
    ].join(' ')
    const otsMatch = searchPool.match(
      /(?:过肩|越肩)\s*[（(]?\s*([^）)\s，,。；;：:]+?)\s*(?:肩前|左肩|右肩|肩后|背后|身后|越肩)?\s*(?:拍|看向|望向|对准)\s*([^）)\s，,。；;：:]+)\s*[）)]?/
    )
    if (otsMatch) {
      const shoulder = matchActor(otsMatch[1])
      const target = matchActor(otsMatch[2])
      if (shoulder && target && shoulder.key !== target.key) {
        otsShoulderActorName = shoulder.name
        otsTargetActorName = target.name
        break
      }
    }
  }

  const actorHints = new Map<string, StoryboardActorSpatialHint>()
  for (const entry of actorEntries) {
    actorHints.set(entry.key, {})
  }

  const fullText = targetShots
    .map((s) => `${s.angle ?? ''} ${s.action ?? ''} ${s.imagePrompt ?? ''} ${s.videoPrompt ?? ''}`)
    .join('；')

  const clauses = fullText
    .split(/[；;。\n，,]+/)
    .map((c) => c.trim())
    .filter(Boolean)

  let currentSubject: { name: string; key: string } | null = null
  for (const clause of clauses) {
    if (/^(?:机位|镜头|运镜|背景|画面|暖金色|冷色调|三人|两人|众人)/.test(clause)) {
      currentSubject = null
    } else {
      // 检查子句开头或主语位置是否出现角色名
      let bestHit: { name: string; key: string; idx: number } | null = null
      for (const entry of actorEntries) {
        const idx = clause.indexOf(entry.name)
        if (idx >= 0 && (bestHit === null || idx < bestHit.idx)) {
          bestHit = { ...entry, idx }
        }
      }
      if (bestHit && bestHit.idx <= 4) {
        currentSubject = { name: bestHit.name, key: bestHit.key }
      }
    }

    if (!currentSubject) continue
    const hint = actorHints.get(currentSubject.key) ?? {}

    if (/未入画|画面外|场外|画外|off[-\s]*screen|out\s*of\s*frame/i.test(clause)) {
      hint.startsOffFrame = true
    }
    if (/从(?:画面)?左侧入画|从左(?:侧|边)?(?:入画|走入|进入)|enter.*from\s*left/i.test(clause)) {
      hint.entersFrom = 'left'
      hint.startsOffFrame = true
    } else if (
      /从(?:画面)?右侧入画|从右(?:侧|边)?(?:入画|走入|进入)|enter.*from\s*right/i.test(clause)
    ) {
      hint.entersFrom = 'right'
      hint.startsOffFrame = true
    }
    if (/迎着镜头逼近|向镜头逼近|逼近镜头|上前一步|往前一步|逼近|步步紧逼/i.test(clause)) {
      hint.approachesCamera = true
    }
    if (/仍不后退|不退让|站在原地|未动|纹丝不动/i.test(clause)) {
      hint.holdsGround = true
    }

    // 识别「A在B右侧」「挽住右侧B」「搂紧B」等双人相对方位
    const rightRel = clause.match(/在\s*([^，,。；;\s]+?)\s*(?:的)?右侧/)
    if (rightRel) {
      const other = matchActor(rightRel[1])
      if (other && other.key !== currentSubject.key) {
        hint.rightOfActorKey = other.key
        hint.companionActorKey = other.key
        const otherHint = actorHints.get(other.key) ?? {}
        otherHint.leftOfActorKey = currentSubject.key
        otherHint.companionActorKey = currentSubject.key
        actorHints.set(other.key, otherHint)
      }
    }
    const leftRel = clause.match(/在\s*([^，,。；;\s]+?)\s*(?:的)?左侧/)
    if (leftRel) {
      const other = matchActor(leftRel[1])
      if (other && other.key !== currentSubject.key) {
        hint.leftOfActorKey = other.key
        hint.companionActorKey = other.key
        const otherHint = actorHints.get(other.key) ?? {}
        otherHint.rightOfActorKey = currentSubject.key
        otherHint.companionActorKey = currentSubject.key
        actorHints.set(other.key, otherHint)
      }
    }
    const holdRightRel = clause.match(/(?:挽住|靠近|走向|站在)\s*右侧\s*([^，,。；;\s]+)/)
    if (holdRightRel) {
      const other = matchActor(holdRightRel[1])
      if (other && other.key !== currentSubject.key) {
        hint.leftOfActorKey = other.key
        hint.companionActorKey = other.key
        const otherHint = actorHints.get(other.key) ?? {}
        otherHint.rightOfActorKey = currentSubject.key
        otherHint.companionActorKey = currentSubject.key
        actorHints.set(other.key, otherHint)
      }
    }
    const embraceRel = clause.match(/(?:搂紧|揽住|挽住|拥抱|靠拢)\s*([^，,。；;\s]+)/)
    if (embraceRel && !holdRightRel) {
      const other = matchActor(embraceRel[1])
      if (other && other.key !== currentSubject.key) {
        hint.companionActorKey = other.key
        const otherHint = actorHints.get(other.key) ?? {}
        if (!otherHint.companionActorKey) otherHint.companionActorKey = currentSubject.key
        actorHints.set(other.key, otherHint)
      }
    }

    actorHints.set(currentSubject.key, hint)
  }

  const isDepthStandoff =
    Boolean(otsShoulderActorName && otsTargetActorName) ||
    /压迫三角|三角对峙|对峙|逼问|逼近|围住|包围/.test(fullText)

  return {
    otsShoulderActorName,
    otsTargetActorName,
    isDepthStandoff,
    actorHints
  }
}

/**
 * 启发式空间布局求解器（0 延迟确定性生成 + LLM 兜底）：
 * - 自动识别工位/桌面场景，补全支撑家具（办公桌 + 工位椅）；
 * - 将桌面道具（显示器、文件堆、咖啡杯、手机等）放置在桌面高度 `y = 0.74m` 上并合理排布；
 * - 将场景建筑结构（如成排办公室格子间）沿纵深排布在背景与通道两侧；
 * - 自动识别过肩（OTS）/ 多角色对峙 / 压迫三角场景，按前景、中景焦点、远景纵深分层站位。
 */
export function buildHeuristicStoryboardLayout(
  storyboard: FilmStoryboard,
  targetShots: readonly FilmShot[],
  characterNames: readonly string[],
  propNames: readonly string[],
  locationNames: readonly string[],
  isZh = true
): StoryboardSceneLayoutPlan {
  const combinedText = targetShots
    .map(
      (s) => `${s.location ?? ''} ${s.action ?? ''} ${s.imagePrompt ?? ''} ${s.videoPrompt ?? ''}`
    )
    .join(' ')
    .toLowerCase()

  const hasDeskContext =
    /工位|办公桌|书桌|审讯桌|桌上|桌前|盯着屏幕|电脑前|瘫坐|坐在|desk|workstation|table/.test(
      combinedText
    )

  const spatialRoles = parseStoryboardSpatialRoles(targetShots, characterNames)
  const totalActors = characterNames.length
  const useDepthStandoffLayout =
    !hasDeskContext &&
    spatialRoles.isDepthStandoff &&
    (totalActors >= 3 ||
      (totalActors === 2 &&
        targetShots.length === 1 &&
        Boolean(spatialRoles.otsShoulderActorName && spatialRoles.otsTargetActorName)))

  let standoffTargetKey: string | null = null
  let standoffShoulderKey: string | null = null
  let standoffRestKeys: string[] = []

  if (useDepthStandoffLayout) {
    const allKeys = characterNames.map((n) => filmNameKey(n))
    standoffTargetKey =
      (spatialRoles.otsTargetActorName ? filmNameKey(spatialRoles.otsTargetActorName) : null) ??
      allKeys.find((k) => spatialRoles.actorHints.get(k)?.holdsGround) ??
      allKeys[0] ??
      null
    standoffShoulderKey =
      (spatialRoles.otsShoulderActorName ? filmNameKey(spatialRoles.otsShoulderActorName) : null) ??
      allKeys.find(
        (k) => k !== standoffTargetKey && spatialRoles.actorHints.get(k)?.approachesCamera
      ) ??
      allKeys.find((k) => k !== standoffTargetKey) ??
      null
    standoffRestKeys = allKeys.filter((k) => k !== standoffTargetKey && k !== standoffShoulderKey)
    standoffRestKeys.sort((a, b) => {
      const ha = spatialRoles.actorHints.get(a)
      const hb = spatialRoles.actorHints.get(b)
      if (ha?.leftOfActorKey === b || hb?.rightOfActorKey === a) return -1
      if (ha?.rightOfActorKey === b || hb?.leftOfActorKey === a) return 1
      return 0
    })
  }

  // 1. 角色排布与姿态
  const actors: StoryboardActorPlacementSpec[] = []
  for (let i = 0; i < totalActors; i++) {
    const name = characterNames[i]
    const actorKey = filmNameKey(name)
    const entityDesc =
      (storyboard.entities ?? []).find(
        (e) => e.kind === 'character' && filmNameKey(e.name) === actorKey
      )?.description ?? ''
    const mannequinPreset = detectActorMannequinPreset(name, entityDesc)
    const posture = i === 0 ? detectActorPostureFromShots(name, targetShots) : 'standing'
    const { yOffset, bonePose } = resolveActorPosturePose(posture, i, totalActors)

    let pos: StageVec3
    let rotationY = 0
    if (totalActors === 1) {
      if (posture === 'sitting' || posture === 'slumped_sitting') {
        pos = { x: 0, y: yOffset, z: -0.18 }
        rotationY = 0
      } else {
        pos = { x: 0, y: yOffset, z: 0 }
        rotationY = 0
      }
    } else if (useDepthStandoffLayout) {
      if (actorKey === standoffTargetKey) {
        // 中景视觉中心主角色（如「苏念」）：位于中景中央，面朝左前方的前景逼问者
        pos = { x: -0.02, y: yOffset, z: -0.15 }
        rotationY = -0.28
      } else if (actorKey === standoffShoulderKey) {
        // 前景过肩/施压角色（如「周敏」）：位于前景左侧视锥内，侧背镜头面朝中景主角色
        pos = { x: -0.28, y: yOffset, z: 0.68 }
        rotationY = Number((Math.PI * 0.82).toFixed(2))
      } else {
        // 远景右侧配角组（如「林薇」「陆景明」）：位于远景右侧纵深层（兼顾 9:16 竖屏与 16:9 横屏视锥），与前景、中景构成三角压迫关系
        const restIdx = Math.max(0, standoffRestKeys.indexOf(actorKey))
        pos = {
          x: Number((0.36 + restIdx * 0.25).toFixed(2)),
          y: yOffset,
          z: Number((-1.0 - restIdx * 0.15).toFixed(2))
        }
        rotationY = -0.38
      }
    } else if (totalActors === 2) {
      if (hasDeskContext && (posture === 'sitting' || posture === 'slumped_sitting')) {
        // 隔桌对坐或一坐一站（如审讯室 / 办公桌对谈）
        pos = {
          x: i === 0 ? -0.95 : 0.95,
          y: yOffset,
          z: 0
        }
        rotationY = i === 0 ? Math.PI * 0.42 : -Math.PI * 0.42
      } else {
        pos = { x: i === 0 ? -1.15 : 1.15, y: yOffset, z: 0 }
        rotationY = i === 0 ? Math.PI * 0.42 : -Math.PI * 0.42
      }
    } else {
      const t = totalActors > 1 ? i / (totalActors - 1) : 0.5
      const angle = (t - 0.5) * Math.PI * 0.72
      const radius = 1.65
      pos = {
        x: Number((Math.sin(angle) * radius).toFixed(2)),
        y: yOffset,
        z: Number((-Math.cos(angle) * 0.55).toFixed(2))
      }
      rotationY = -angle * 0.85
    }

    actors.push({
      name,
      mannequinPreset,
      posture,
      position: pos,
      rotationY,
      bonePose
    })
  }

  // 2. 道具、支撑家具与环境白模组装
  const objects: StoryboardWhiteModelObjectSpec[] = []
  const seenKeys = new Set<string>()

  const allPropEntries: Array<{ name: string; arch: ArchetypeDefinition }> = []
  for (const rawName of propNames) {
    const k = filmNameKey(rawName)
    if (!k || seenKeys.has(k)) continue
    seenKeys.add(k)
    allPropEntries.push({
      name: rawName,
      arch: inferCompoundWhiteModelArchetype(rawName)
    })
  }

  const hasExplicitSurface = allPropEntries.some((p) => p.arch.category === 'surface')
  const hasExplicitSeat = allPropEntries.some((p) => p.arch.category === 'seat')
  const hasTabletopProps = allPropEntries.some((p) => p.arch.category === 'tabletop')
  const primarySitting =
    actors[0]?.posture === 'sitting' || actors[0]?.posture === 'slumped_sitting'

  // 当存在桌面物体（如电脑显示器、文件堆）或剧本描述了工位/桌前坐姿，自动补全办公桌与工位椅
  let activeSurfaceHeight = 0
  let deskCenterZ = 0.36
  if ((hasDeskContext || hasTabletopProps || primarySitting) && !hasExplicitSurface) {
    const deskName = isZh ? '办公桌' : 'Office Desk'
    const deskKey = filmNameKey(deskName)
    seenKeys.add(deskKey)
    const deskArch = inferCompoundWhiteModelArchetype(deskName)
    activeSurfaceHeight = deskArch.surfaceHeight ?? 0.74
    deskCenterZ = totalActors === 1 ? 0.34 : 0
    objects.push({
      id: `sb-prop:${deskKey}`,
      name: deskName,
      category: 'surface',
      position: { x: 0, y: 0, z: deskCenterZ },
      rotationY: 0,
      surfaceHeight: activeSurfaceHeight,
      parts: deskArch.parts
    })
  } else if (hasExplicitSurface) {
    const surfEntry = allPropEntries.find((p) => p.arch.category === 'surface')!
    activeSurfaceHeight = surfEntry.arch.surfaceHeight ?? 0.74
    deskCenterZ = totalActors === 1 ? 0.34 : 0
  }

  if (primarySitting && !hasExplicitSeat) {
    const chairName = isZh ? '工位椅' : 'Office Chair'
    const chairKey = filmNameKey(chairName)
    seenKeys.add(chairKey)
    const chairArch = inferCompoundWhiteModelArchetype(chairName)
    objects.push({
      id: `sb-prop:${chairKey}`,
      name: chairName,
      category: 'seat',
      position: {
        x: actors[0]?.position.x ?? 0,
        y: 0,
        z: (actors[0]?.position.z ?? -0.18) - 0.04
      },
      rotationY: actors[0]?.rotationY ?? 0,
      parts: chairArch.parts
    })
  }

  // 排列所有显式道具（区分支撑台面、桌面小道具、地面道具）
  const tabletopSlots: Array<{ x: number; z: number; rotY: number }> = [
    { x: -0.4, z: deskCenterZ + 0.02, rotY: 0.12 },
    { x: 0.4, z: deskCenterZ + 0.04, rotY: -0.15 },
    { x: -0.22, z: deskCenterZ + 0.14, rotY: 0.05 },
    { x: 0.24, z: deskCenterZ + 0.15, rotY: -0.08 },
    { x: -0.52, z: deskCenterZ - 0.12, rotY: 0.2 },
    { x: 0.52, z: deskCenterZ - 0.12, rotY: -0.2 }
  ]
  let tabletopSlotIdx = 0
  let floorSlotIdx = 0

  for (const item of allPropEntries) {
    const key = filmNameKey(item.name)
    const propId = `sb-prop:${key}`
    const { arch } = item

    if (arch.category === 'surface') {
      objects.push({
        id: propId,
        name: item.name,
        category: 'surface',
        position: { x: 0, y: 0, z: deskCenterZ },
        rotationY: 0,
        surfaceHeight: arch.surfaceHeight ?? 0.74,
        parts: arch.parts
      })
      continue
    }

    if (arch.category === 'tabletop') {
      const yBase = activeSurfaceHeight > 0 ? activeSurfaceHeight : 0.74
      const isMonitor = /显示器|屏幕|电脑|笔电|monitor|display|laptop|computer/i.test(item.name)
      if (isMonitor) {
        // 显示器居中摆在桌面上，屏幕朝向角色（角色在 z = -0.18 面朝 +Z，故显示器旋转 180° 面朝 -Z）
        objects.push({
          id: propId,
          name: item.name,
          category: 'tabletop',
          position: { x: 0, y: yBase, z: deskCenterZ - 0.04 },
          rotationY: Math.PI,
          parts: arch.parts
        })
      } else {
        const slot = tabletopSlots[tabletopSlotIdx % tabletopSlots.length]
        tabletopSlotIdx += 1
        objects.push({
          id: propId,
          name: item.name,
          category: 'tabletop',
          position: { x: slot.x, y: yBase, z: slot.z },
          rotationY: slot.rotY,
          parts: arch.parts
        })
      }
      continue
    }

    if (arch.category === 'architecture') {
      objects.push({
        id: propId,
        name: item.name,
        category: 'architecture',
        position: { x: 0, y: 0, z: 0 },
        rotationY: 0,
        parts: arch.parts
      })
      continue
    }

    // 常规地面道具：分布在角色两侧或背景，不挡镜头主轴
    const side = floorSlotIdx % 2 === 0 ? -1 : 1
    const row = Math.floor(floorSlotIdx / 2)
    floorSlotIdx += 1
    objects.push({
      id: propId,
      name: item.name,
      category: arch.category,
      position: {
        x: Number((side * (1.25 + row * 0.65)).toFixed(2)),
        y: 0,
        z: Number((-0.45 - row * 0.6).toFixed(2))
      },
      rotationY: side * -0.25,
      parts: arch.parts
    })
  }

  // 3. 地点建筑环境白模（如「办公室格子间」在镜头中提供了成排纵深空间）
  for (const locName of locationNames) {
    const key = filmNameKey(locName)
    if (!key || seenKeys.has(key)) continue
    if (
      /格子间|办公|审讯|走廊|长廊|房间|大厅|cubicle|office|corridor|hall/.test(
        locName.toLowerCase()
      )
    ) {
      seenKeys.add(key)
      const locArch = inferCompoundWhiteModelArchetype(locName)
      if (locArch.category === 'architecture') {
        objects.push({
          id: `sb-prop:loc-${key}`,
          name: locName,
          category: 'architecture',
          position: { x: 0, y: 0, z: 0 },
          rotationY: 0,
          parts: locArch.parts
        })
      }
    }
  }

  return {
    actors,
    objects,
    usedLlm: false
  }
}

const LLM_STAGE_LAYOUT_SYSTEM_PROMPT = `You are a 3D Film Previsualization (Previz) Technical Director and White-Box Set Designer.
Given a storyboard's shots, characters, locations, and props, generate a physically accurate 3D stage layout and multi-part geometric white-models (素模) in JSON format.

### 3D Coordinate System & Physical Scale Rules (CRITICAL)
- Units: Meters (m).
- Floor plane: Y = 0.0 (all heights are relative to the floor, so floor objects have position.y = 0).
- X axis: Left (-) to Right (+). Center is X = 0.
- Z axis: Background depth (-) to Foreground camera (+). Main cameras usually look from +Z toward 0 / -Z.
- Standard humanoid character is 1.75m tall (standing).
- Standard desk/table height is 0.74m; standard chair seat height is 0.45m.
- SUPPORT & GRAVITY RULE:
  - If a character is sitting at a desk/workstation ("坐在工位", "瘫坐", "桌前"), set their posture to "sitting" or "slumped_sitting" at (x: 0, y: 0, z: -0.18, rotationYDeg: 0), and ALWAYS include both the supporting chair (e.g. "工位椅" at x: 0, y: 0, z: -0.22) and the desk (e.g. "办公桌" at x: 0, y: 0, z: 0.34, height 0.74m).
  - Tabletop props (e.g. "电脑显示器", "文件堆", "咖啡杯", "手机", "辞职信", "台灯") MUST be placed ON TOP OF the desk: their object \`position.y\` MUST equal the desk top height (\`0.74\`), and their \`(x, z)\` must be within the desk surface (\`x\` in \`[-0.55, 0.55]\`, \`z\` around \`0.28..0.46\`), NEVER on the floor (y=0) or overlapping each other!
  - A computer monitor ("电脑显示器") on the desk in front of a character at z = -0.18 should be at (x: 0, y: 0.74, z: 0.30) with \`rotationYDeg: 180\` so the screen faces the character.
  - Architectural/location set pieces (e.g. "办公室格子间") should frame the left/right sides (|x| >= 1.6) and background depth (z <= -0.8) so they NEVER block the front camera corridor (x in [-1.2, 1.2], z > 0.6).
- MULTI-CHARACTER BLOCKING & OTS DEPTH LAYER RULE:
  - NEVER line up 3 or more characters in a flat horizontal chorus row at the same Z!
  - In Over-The-Shoulder (OTS, e.g. "过肩（A肩前拍B）") or confrontation / triangle standoff ("对峙", "逼近", "压迫三角") shots:
    - Place the primary focal target character B in the midground center: (x: 0, y: 0, z: -0.25, rotationYDeg: -18).
    - Place the foreground OTS shoulder / confronting character A in the foreground left: (x: -0.68, y: 0, z: 0.62, rotationYDeg: 140) facing character B.
    - Place secondary / background characters in the background right depth layer: e.g. (x: 0.52, y: 0, z: -0.95) and (x: 0.94, y: 0, z: -1.03, rotationYDeg: -26) facing character B.

### Allowed Primitives for \`parts\`
Each object in \`objects\` is a compound white-model composed of 1 to 6 \`parts\`.
Allowed \`primitive\` values:
"box", "cylinder", "sphere", "capsule", "cone", "pyramid", "hemisphere", "torus", "arch", "pointedArch", "cross", "tube", "prism", "wedge", "disc", "ring", "quad"
- Note: Each primitive is centered at its local \`offset: {x, y, z}\` relative to the object's base \`position\`. So a part of height \`H\` resting on the object's base plane has \`offset.y = H / 2\`.

### Output JSON Schema (Return ONLY valid JSON, no markdown prose)
{
  "actors": [
    {
      "name": "Character Name",
      "mannequinPreset": "humanoid",
      "posture": "standing | sitting | slumped_sitting | walking | running | fighting | kneeling | crouching | lying_down | jumping | bowing | cheering | dancing | thinking | phone | drinking | falling",
      "position": { "x": 0, "y": 0, "z": -0.18 },
      "rotationYDeg": 0
    }
  ],
  "objects": [
    {
      "name": "Object Name",
      "category": "surface | seat | tabletop | floor | architecture",
      "position": { "x": 0, "y": 0.74, "z": 0.30 },
      "rotationYDeg": 180,
      "surfaceHeight": 0.74,
      "parts": [
        {
          "label": "Part Name",
          "primitive": "box",
          "offset": { "x": 0, "y": 0.17, "z": 0 },
          "rotationDeg": { "x": 0, "y": 0, "z": 0 },
          "size": { "x": 0.55, "y": 0.34, "z": 0.04 },
          "color": "#334155"
        }
      ]
    }
  ]
}`

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const text = raw.trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1].trim() : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

function clampNum(val: unknown, fallback: number, min: number, max: number): number {
  const n = Number(val)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function sanitizeHexColor(raw: unknown, fallback = '#94a3b8'): string {
  if (typeof raw !== 'string') return fallback
  const trimmed = raw.trim()
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed) ? trimmed : fallback
}

const LAYOUT_PLAN_CACHE_STORAGE_KEY = 'director.storyboardLayoutPlanCache.v4'
const LAYOUT_PLAN_CACHE_MAX_ENTRIES = 32
const layoutPlanMemoryCache = new Map<string, StoryboardSceneLayoutPlan>()
const layoutPlanInFlight = new Map<string, Promise<StoryboardSceneLayoutPlan>>()

function computeStoryboardLayoutCacheKey(options: {
  targetShots: readonly FilmShot[]
  characterNames: readonly string[]
  propNames: readonly string[]
  locationNames: readonly string[]
  isZh: boolean
}): string {
  const payload = {
    lang: options.isZh ? 'zh' : 'en',
    characters: options.characterNames,
    locations: options.locationNames,
    props: options.propNames,
    shots: options.targetShots.slice(0, 8).map((s) => ({
      id: s.id,
      location: s.location ?? '',
      characters: s.characters ?? [],
      props: s.props ?? [],
      action: s.action ?? ''
    }))
  }
  return JSON.stringify(payload)
}

function readPersistedLayoutPlan(cacheKey: string): StoryboardSceneLayoutPlan | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    const raw = window.localStorage.getItem(LAYOUT_PLAN_CACHE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, StoryboardSceneLayoutPlan>
    const hit = parsed?.[cacheKey]
    if (hit && Array.isArray(hit.actors) && Array.isArray(hit.objects)) {
      return hit
    }
  } catch {
    /* ignore storage errors */
  }
  return null
}

function writePersistedLayoutPlan(cacheKey: string, plan: StoryboardSceneLayoutPlan): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    const raw = window.localStorage.getItem(LAYOUT_PLAN_CACHE_STORAGE_KEY)
    const store: Record<string, StoryboardSceneLayoutPlan> = raw ? JSON.parse(raw) : {}
    delete store[cacheKey]
    store[cacheKey] = plan
    const keys = Object.keys(store)
    while (keys.length > LAYOUT_PLAN_CACHE_MAX_ENTRIES) {
      const oldest = keys.shift()
      if (oldest) delete store[oldest]
    }
    window.localStorage.setItem(LAYOUT_PLAN_CACHE_STORAGE_KEY, JSON.stringify(store))
  } catch {
    /* ignore storage quota errors */
  }
}

export function clearStoryboardLayoutPlanCache(): void {
  layoutPlanMemoryCache.clear()
  layoutPlanInFlight.clear()
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(LAYOUT_PLAN_CACHE_STORAGE_KEY)
    }
  } catch {
    /* ignore */
  }
}

/**
 * 调用大语言模型（LLM）规划 3D 分镜白模与空间陈设；
 * 内置内存 + localStorage 双层缓存与并发去重，相同分镜场景二次打开直接 0ms 命中缓存；
 * 若未配置文本模型或请求异常，自动无缝回退到内置启发式空间求解器。
 */
export async function planStoryboard3dLayoutWithLlm(options: {
  storyboard: FilmStoryboard
  targetShots: readonly FilmShot[]
  characterNames: readonly string[]
  propNames: readonly string[]
  locationNames: readonly string[]
  locale?: string
  generateText?: (input: {
    prompt: string
    system?: string
    model?: string
    providerInstanceId?: string
  }) => Promise<{ text: string }>
  model?: string
  providerInstanceId?: string
  disableCache?: boolean
}): Promise<StoryboardSceneLayoutPlan> {
  const isZh = options.locale ? options.locale.toLowerCase().startsWith('zh') : true
  const fallbackPlan = buildHeuristicStoryboardLayout(
    options.storyboard,
    options.targetShots,
    options.characterNames,
    options.propNames,
    options.locationNames,
    isZh
  )

  const genText =
    options.generateText ??
    (typeof window !== 'undefined' && window.studio?.generateText
      ? (input) => window.studio.generateText(input)
      : undefined)
  if (!genText) return fallbackPlan

  const cacheKey = computeStoryboardLayoutCacheKey({
    targetShots: options.targetShots,
    characterNames: options.characterNames,
    propNames: options.propNames,
    locationNames: options.locationNames,
    isZh
  })

  if (!options.disableCache) {
    const memHit = layoutPlanMemoryCache.get(cacheKey)
    if (memHit) return memHit
    const persistedHit = readPersistedLayoutPlan(cacheKey)
    if (persistedHit) {
      layoutPlanMemoryCache.set(cacheKey, persistedHit)
      return persistedHit
    }
    const inflight = layoutPlanInFlight.get(cacheKey)
    if (inflight) return inflight
  }

  const shotSummaries = options.targetShots.slice(0, 8).map((s) => ({
    id: s.id,
    shotSize: s.shotSize,
    angle: s.angle,
    cameraMove: s.cameraMove,
    location: s.location,
    characters: s.characters,
    props: s.props,
    action: s.action,
    imagePrompt: s.imagePrompt
  }))

  const userPrompt = JSON.stringify(
    {
      locale: options.locale ?? 'zh-CN',
      characters: options.characterNames,
      locations: options.locationNames,
      props: options.propNames,
      shots: shotSummaries
    },
    null,
    2
  )

  const runTask = (async (): Promise<StoryboardSceneLayoutPlan> => {
    try {
      const llmPromise = genText({
        system: LLM_STAGE_LAYOUT_SYSTEM_PROMPT,
        prompt: `Design the 3D white-model stage layout for the following storyboard shots:\n${userPrompt}`,
        ...(options.model ? { model: options.model } : {}),
        ...(options.providerInstanceId ? { providerInstanceId: options.providerInstanceId } : {})
      })
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 18000))
      const response = await Promise.race([llmPromise, timeoutPromise])
      if (!response || typeof response.text !== 'string') return fallbackPlan

      const parsed = extractJsonObject(response.text)
      if (!parsed) return fallbackPlan

      // 合并并校验角色站位与姿态
      const rawActors = Array.isArray(parsed.actors) ? parsed.actors : []
      const mergedActors: StoryboardActorPlacementSpec[] = fallbackPlan.actors.map(
        (fbActor, idx) => {
          const key = filmNameKey(fbActor.name)
          const matched = rawActors.find(
            (item): item is Record<string, unknown> =>
              !!item &&
              typeof item === 'object' &&
              typeof (item as Record<string, unknown>).name === 'string' &&
              filmNameKey(String((item as Record<string, unknown>).name)) === key
          )
          if (!matched) return fbActor

          const rawPosture = String(
            matched.posture ?? fbActor.posture
          ).trim() as StoryboardActorPosture
          const validPostures: ReadonlySet<string> = new Set([
            'standing',
            'sitting',
            'slumped_sitting',
            'walking',
            'running',
            'fighting',
            'kneeling',
            'crouching',
            'lying_down',
            'jumping',
            'bowing',
            'cheering',
            'dancing',
            'thinking',
            'phone',
            'drinking',
            'falling'
          ])
          const posture = validPostures.has(rawPosture) ? rawPosture : fbActor.posture
          const { yOffset, bonePose } = resolveActorPosturePose(
            posture,
            idx,
            fallbackPlan.actors.length
          )
          const rawPos = (matched.position ?? {}) as Record<string, unknown>
          const rotYDeg = clampNum(
            matched.rotationYDeg ?? matched.rotationY,
            (fbActor.rotationY * 180) / Math.PI,
            -360,
            360
          )

          return {
            name: fbActor.name,
            // 防止 LLM 误将人类角色设为 quadruped
            mannequinPreset: fbActor.mannequinPreset,
            posture,
            position: {
              x: clampNum(rawPos.x, fbActor.position.x, -8, 8),
              y: yOffset,
              z: clampNum(rawPos.z, fbActor.position.z, -8, 8)
            },
            rotationY: rotYDeg * DEG,
            bonePose
          }
        }
      )

      if (fallbackPlan.actors.length >= 3) {
        const fbZs = fallbackPlan.actors.map((a) => a.position.z)
        const llmZs = mergedActors.map((a) => a.position.z)
        const fbDepthSpan = Math.max(...fbZs) - Math.min(...fbZs)
        const llmDepthSpan = Math.max(...llmZs) - Math.min(...llmZs)
        if (fbDepthSpan >= 1.1 && llmDepthSpan < 0.55) {
          for (let i = 0; i < mergedActors.length; i++) {
            mergedActors[i] = {
              ...mergedActors[i],
              position: { ...fallbackPlan.actors[i].position },
              rotationY: fallbackPlan.actors[i].rotationY
            }
          }
        }
      }

      // 解析并增强 LLM 输出的 3D 组合素模
      const rawObjects = Array.isArray(parsed.objects) ? parsed.objects : []
      if (rawObjects.length === 0) {
        const plan: StoryboardSceneLayoutPlan = {
          ...fallbackPlan,
          actors: mergedActors,
          usedLlm: true
        }
        if (!options.disableCache) {
          layoutPlanMemoryCache.set(cacheKey, plan)
          writePersistedLayoutPlan(cacheKey, plan)
        }
        return plan
      }

      const parsedObjects: StoryboardWhiteModelObjectSpec[] = []
      const seenObjKeys = new Set<string>()
      let detectedSurfaceY =
        fallbackPlan.objects.find((o) => o.category === 'surface')?.surfaceHeight ?? 0

      for (let i = 0; i < rawObjects.length; i++) {
        const item = rawObjects[i]
        if (!item || typeof item !== 'object') continue
        const rec = item as Record<string, unknown>
        const name = String(rec.name ?? '').trim()
        if (!name) continue
        const key = filmNameKey(name)
        if (!key || seenObjKeys.has(key)) continue
        seenObjKeys.add(key)

        const arch = inferCompoundWhiteModelArchetype(name)
        const rawCat = String(rec.category ?? arch.category).trim() as StoryboardObjectCategory
        const category: StoryboardObjectCategory =
          rawCat === 'surface' ||
          rawCat === 'seat' ||
          rawCat === 'tabletop' ||
          rawCat === 'floor' ||
          rawCat === 'architecture'
            ? rawCat
            : arch.category

        const rawPos = (rec.position ?? {}) as Record<string, unknown>
        const rotYDeg = clampNum(rec.rotationYDeg ?? rec.rotationY, 0, -360, 360)

        // 解析 LLM 给出的自定义几何部件（兼容 size/scale 与 label/name）
        const rawParts = Array.isArray(rec.parts) ? rec.parts : []
        const llmParts: StoryboardWhiteModelPartSpec[] = []
        for (let pIdx = 0; pIdx < Math.min(8, rawParts.length); pIdx++) {
          const pr = rawParts[pIdx]
          if (!pr || typeof pr !== 'object') continue
          const pRec = pr as Record<string, unknown>
          const primRaw = String(pRec.primitive ?? 'box').trim()
          const primitive: StagePrimitive = VALID_PRIMITIVES.has(primRaw)
            ? (primRaw as StagePrimitive)
            : 'box'
          const off = (pRec.offset ?? {}) as Record<string, unknown>
          const sz = (pRec.size ?? pRec.scale ?? {}) as Record<string, unknown>
          const rot = (pRec.rotationDeg ?? pRec.rotation ?? {}) as Record<string, unknown>
          const sx = clampNum(sz.x, 0.3, 0.01, 8)
          const sy = clampNum(sz.y, 0.3, 0.01, 6)
          const szVal = clampNum(sz.z, 0.3, 0.01, 8)
          const partLabel =
            String(pRec.label ?? pRec.name ?? `部件 ${pIdx + 1}`).trim() || `部件 ${pIdx + 1}`
          llmParts.push({
            label: partLabel,
            primitive,
            offset: {
              x: clampNum(off.x, 0, -4, 4),
              y: clampNum(off.y, sy / 2, -2, 5),
              z: clampNum(off.z, 0, -4, 4)
            },
            rotation: {
              x: clampNum(rot.x, 0, -180, 180) * DEG,
              y: clampNum(rot.y, 0, -180, 180) * DEG,
              z: clampNum(rot.z, 0, -180, 180) * DEG
            },
            size: { x: sx, y: sy, z: szVal },
            color: sanitizeHexColor(pRec.color, '#94a3b8')
          })
        }

        // 若 LLM 规划了 >= 2 个组合部件，直接使用 LLM 设计；若只给了 1 个粗糙盒子且内置原型有多部件，则采用内置精细多部件
        const finalParts =
          llmParts.length >= 2
            ? llmParts
            : arch.parts.length > 1
              ? arch.parts
              : llmParts.length > 0
                ? llmParts
                : arch.parts

        const surfaceHeight =
          category === 'surface'
            ? clampNum(rec.surfaceHeight, arch.surfaceHeight ?? 0.74, 0.3, 1.5)
            : undefined
        if (surfaceHeight && surfaceHeight > detectedSurfaceY) {
          detectedSurfaceY = surfaceHeight
        }

        let posY = clampNum(rawPos.y, 0, 0, 3)
        if (category === 'tabletop' && posY < 0.35) {
          posY = detectedSurfaceY > 0 ? detectedSurfaceY : 0.74
        } else if (category !== 'tabletop' && posY > 0.25) {
          posY = 0
        }

        parsedObjects.push({
          id: category === 'architecture' ? `sb-prop:loc-${key}` : `sb-prop:${key}`,
          name,
          category,
          position: {
            x: clampNum(rawPos.x, 0, -6, 6),
            y: posY,
            z: clampNum(rawPos.z, 0, -6, 6)
          },
          rotationY: rotYDeg * DEG,
          ...(surfaceHeight ? { surfaceHeight } : {}),
          parts: finalParts
        })
      }

      // 补充 fallbackPlan 中必须存在但被 LLM 遗漏的道具或支撑桌椅
      for (const fbObj of fallbackPlan.objects) {
        const k = filmNameKey(fbObj.name)
        if (!seenObjKeys.has(k)) {
          seenObjKeys.add(k)
          parsedObjects.push(fbObj)
        }
      }

      const finalPlan: StoryboardSceneLayoutPlan = {
        actors: mergedActors,
        objects: parsedObjects,
        usedLlm: true
      }
      if (!options.disableCache) {
        layoutPlanMemoryCache.set(cacheKey, finalPlan)
        writePersistedLayoutPlan(cacheKey, finalPlan)
      }
      return finalPlan
    } catch (err) {
      console.warn('[director-previz] LLM layout planning failed, using heuristic layout:', err)
      return fallbackPlan
    } finally {
      layoutPlanInFlight.delete(cacheKey)
    }
  })()

  if (!options.disableCache) {
    layoutPlanInFlight.set(cacheKey, runTask)
  }
  return runTask
}
