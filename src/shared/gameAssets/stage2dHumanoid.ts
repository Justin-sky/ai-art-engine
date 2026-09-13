/**
 * 2D 人体骨骼模板（5.5「2D 导演台」骨骼摆姿装配子项）。
 *
 * 按 COCO17 拓扑一次性建出“正面平视”的标准人形 rig：
 * 关节名/侧别使用 stage2dPoseSolve 约定的可识别写法（chest/shoulder/elbow/
 * wrist/hip/knee/ankle + L/R 后缀），故建好后可直接用「从图片反解姿势」驱动。
 *
 * 仅绑定几何、无 pose（= 中立站立 + T 臂）。返回的 rig 坐标在画布 px 上，
 * 可整体按 { x, groundY, height } 摆放；比例可按需二次微调。
 */
import { normalizeStage2dRig, type Stage2dJoint, type Stage2dRig } from './stage2dRig'

export interface HumanoidStage2dRigOptions {
  /** 角色中轴线 x（画布 px），默认 0 */
  x?: number
  /** 脚底 y（画布 px），默认 height */
  groundY?: number
  /** 特征身高（头顶到脚底 px），默认 100 */
  height?: number
}

/** 人形模板关节构造描述 */
interface TemplateJointSpec {
  id: string
  name: string
  parentId: string | null
  /** 相对父关节的偏移（单位：height 的倍数；y 向下为正） */
  dx: number
  dy: number
}

/** 模板（比例相对身高，便于整体缩放摆位） */
const TEMPLATE: Array<Omit<TemplateJointSpec, 'dx' | 'dy'> & { offset: [number, number] }> = [
  { id: 'pelvis', name: 'pelvis', parentId: null, offset: [0, -0.5] },
  { id: 'chest', name: 'chest', parentId: 'pelvis', offset: [0, -0.18] },
  { id: 'neck', name: 'neck', parentId: 'chest', offset: [0, -0.12] },
  { id: 'head', name: 'head', parentId: 'neck', offset: [0, -0.1] },
  { id: 'shoulderL', name: 'shoulderL', parentId: 'chest', offset: [-0.1, -0.05] },
  { id: 'elbowL', name: 'elbowL', parentId: 'shoulderL', offset: [-0.22, 0] },
  { id: 'wristL', name: 'wristL', parentId: 'elbowL', offset: [-0.15, 0] },
  { id: 'shoulderR', name: 'shoulderR', parentId: 'chest', offset: [0.1, -0.05] },
  { id: 'elbowR', name: 'elbowR', parentId: 'shoulderR', offset: [0.22, 0] },
  { id: 'wristR', name: 'wristR', parentId: 'elbowR', offset: [0.15, 0] },
  { id: 'hipL', name: 'hipL', parentId: 'pelvis', offset: [-0.085, 0] },
  { id: 'kneeL', name: 'kneeL', parentId: 'hipL', offset: [0, 0.25] },
  { id: 'ankleL', name: 'ankleL', parentId: 'kneeL', offset: [0, 0.25] },
  { id: 'hipR', name: 'hipR', parentId: 'pelvis', offset: [0.085, 0] },
  { id: 'kneeR', name: 'kneeR', parentId: 'hipR', offset: [0, 0.25] },
  { id: 'ankleR', name: 'ankleR', parentId: 'kneeR', offset: [0, 0.25] }
]

/**
 * 生成标准人形骨骼。
 *
 * @param options.x       角色中轴线（默认 0）
 * @param options.groundY 脚底 y（默认 = height，即 x 轴处落地）
 * @param options.height  特征身高 px（默认 100）
 */
export function createHumanoidStage2dRig(options: HumanoidStage2dRigOptions = {}): Stage2dRig {
  const h = Math.max(1, options.height ?? 100)
  const x = options.x ?? 0
  const groundY = options.groundY ?? h
  // 根点 = 脚底中轴（子代逐级向上/向下铺开）
  const joints: Stage2dJoint[] = TEMPLATE.map((spec) => ({
    id: spec.id,
    name: spec.name,
    parentId: spec.parentId,
    x: Math.round(spec.offset[0] * h * 1000) / 1000,
    y: Math.round(spec.offset[1] * h * 1000) / 1000,
    rotation: 0
  }))
  return normalizeStage2dRig({
    root: { x: Math.round(x), y: Math.round(groundY) },
    joints,
    attachments: []
  })
}
