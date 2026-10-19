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
  'standing' | 'sitting' | 'slumped_sitting' | 'walking' | 'running' | 'fighting' | 'kneeling'

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
  if (/坐在|坐着|端坐|工位上|办公桌前|审讯椅|sit|seated/.test(text)) return 'sitting'
  if (/跪|半跪|kneel/.test(text)) return 'kneeling'
  if (/奔跑|狂奔|追逐|冲刺|逃离|run|sprint|chase/.test(text)) return 'running'
  if (/行走|走近|迈步|漫步|穿行|walk|step/.test(text)) return 'walking'
  if (/格斗|战斗|攻击|挥拳|拔剑|fight|combat|attack/.test(text)) return 'fighting'
  void actorName
  return 'standing'
}

/**
 * 启发式空间布局求解器（0 延迟确定性生成 + LLM 兜底）：
 * - 自动识别工位/桌面场景，补全支撑家具（办公桌 + 工位椅）；
 * - 将桌面道具（显示器、文件堆、咖啡杯、手机等）放置在桌面高度 `y = 0.74m` 上并合理排布；
 * - 将场景建筑结构（如成排办公室格子间）沿纵深排布在背景与通道两侧。
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

  // 1. 角色排布与姿态
  const actors: StoryboardActorPlacementSpec[] = []
  const totalActors = characterNames.length
  for (let i = 0; i < totalActors; i++) {
    const name = characterNames[i]
    const entityDesc =
      (storyboard.entities ?? []).find(
        (e) => e.kind === 'character' && filmNameKey(e.name) === filmNameKey(name)
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
      "posture": "standing | sitting | slumped_sitting | walking | running | fighting | kneeling",
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

/**
 * 调用大语言模型（LLM）规划 3D 分镜白模与空间陈设；
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
    const mergedActors: StoryboardActorPlacementSpec[] = fallbackPlan.actors.map((fbActor, idx) => {
      const key = filmNameKey(fbActor.name)
      const matched = rawActors.find(
        (item): item is Record<string, unknown> =>
          !!item &&
          typeof item === 'object' &&
          typeof (item as Record<string, unknown>).name === 'string' &&
          filmNameKey(String((item as Record<string, unknown>).name)) === key
      )
      if (!matched) return fbActor

      const rawPosture = String(matched.posture ?? fbActor.posture).trim() as StoryboardActorPosture
      const validPostures: ReadonlySet<string> = new Set([
        'standing',
        'sitting',
        'slumped_sitting',
        'walking',
        'running',
        'fighting',
        'kneeling'
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
    })

    // 解析并增强 LLM 输出的 3D 组合素模
    const rawObjects = Array.isArray(parsed.objects) ? parsed.objects : []
    if (rawObjects.length === 0) {
      return { ...fallbackPlan, actors: mergedActors, usedLlm: true }
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

    return {
      actors: mergedActors,
      objects: parsedObjects,
      usedLlm: true
    }
  } catch (err) {
    console.warn('[director-previz] LLM layout planning failed, using heuristic layout:', err)
    return fallbackPlan
  }
}
