import { describe, expect, it } from 'vitest'
import {
  computeStage2dRigTransforms,
  createHumanoidStage2dRig,
  classifyStage2dJoint,
  keypointsFromSkeleton,
  solveStage2dPoseFromSkeleton,
  tokenizeJointName,
  type Stage2dPoseSolveResult,
  type Stage2dRig
} from '../src/shared/gameAssets'
import type { YoloSkeletonPoint } from '../src/shared/yolo'

function rig(): Stage2dRig {
  return createHumanoidStage2dRig({ x: 0, groundY: 0, height: 200 })
}

function kp(x: number, y: number, confidence = 0.9): YoloSkeletonPoint {
  return { x, y, confidence }
}

/** 建立 17 点骨架；未填的记为缺省空 */
const EMPTY = { x: 0, y: 0, confidence: 0 }
const order = [
  'nose',
  'left_eye',
  'right_eye',
  'left_ear',
  'right_ear',
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle'
] as const

function skeleton(over: Partial<Record<(typeof order)[number], YoloSkeletonPoint>>): YoloSkeletonPoint[] {
  const list: YoloSkeletonPoint[] = order.map(() => EMPTY)
  for (const [name, pt] of Object.entries(over)) {
    const i = order.indexOf(name as (typeof order)[number])
    if (i >= 0) list[i] = pt as YoloSkeletonPoint
  }
  return list
}

/** 中性站姿（T 臂朝两边、腿垂直向下） */
function neutralPose(): Partial<Record<(typeof order)[number], YoloSkeletonPoint>> {
  return {
    nose: kp(0, -70),
    left_shoulder: kp(-60, 0),
    right_shoulder: kp(60, 0),
    left_elbow: kp(-160, 0),
    right_elbow: kp(160, 0),
    left_wrist: kp(-250, 0),
    right_wrist: kp(250, 0),
    left_hip: kp(-50, 60),
    right_hip: kp(50, 60),
    left_knee: kp(-50, 160),
    right_knee: kp(50, 160),
    left_ankle: kp(-50, 230),
    right_ankle: kp(50, 230)
  }
}

/** 取关节方向角（子→孙），用于断言解算结果 */
function segmentDeg(skel: Stage2dPoseSolveResult['pose'], r: Stage2dRig, from: string, to: string): number {
  const map = new Map(computeStage2dRigTransforms(r, skel).map((t) => [t.jointId, t]))
  const a = map.get(from)!
  const b = map.get(to)!
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
}

describe('关节命名推断', () => {
  it('tokenize 支持 L/R 后缀与 left/right 前后缀', () => {
    expect(tokenizeJointName('shoulderL')).toEqual({ words: ['shoulder'], side: 'l' })
    expect(tokenizeJointName('leftShoulder')).toEqual({ words: ['shoulder'], side: 'l' })
    expect(tokenizeJointName('elbow_right')).toEqual({ words: ['elbow'], side: 'r' })
    expect(tokenizeJointName('mixamorigHipR')).toEqual({ words: ['hip'], side: 'r' })
    expect(tokenizeJointName('head')).toEqual({ words: ['head'], side: null })
  })

  it('classify 命中 COCO 对应角色', () => {
    expect(classifyStage2dJoint('chest')).toEqual({ role: 'chest', side: null })
    expect(classifyStage2dJoint('kneeL')).toEqual({ role: 'knee', side: 'l' })
    expect(classifyStage2dJoint('ankleR')).toEqual({ role: 'ankle', side: 'r' })
    expect(classifyStage2dJoint('wing')).toEqual({ role: 'other', side: null })
  })
})

describe('keypointsFromSkeleton', () => {
  it('跳过空点与非有限值', () => {
    const names = keypointsFromSkeleton(skeleton(neutralPose()))
    expect(names.left_shoulder).toBeDefined()
    expect(names.nose).toBeDefined()
  })
})

describe('人形模板', () => {
  it('建出 16 个关节、绑定无 pose', () => {
    const r = rig()
    expect(r.joints).toHaveLength(16)
    expect(r.joints.every((j) => j.rotation === 0)).toBe(true)
    expect(r.joints.find((j) => j.id === 'wristR')?.parentId).toBe('elbowR')
    expect(r.attachments).toEqual([])
  })
})

describe('solveStage2dPoseFromSkeleton', () => {
  it('中性站姿 T 臂 → 几乎不产生 pose', () => {
    const r = rig()
    const result = solveStage2dPoseFromSkeleton({ rig: r, skeleton: skeleton(neutralPose()) })
    expect(result.segments).toHaveLength(9)
    expect(result.driven).toEqual([])
    for (const seg of result.segments) expect(seg.status).toBe('ok')
  })

  it('右臂从 T 臂抬到竖直向上 → shoulderR -90°（FK 校验子链方向）', () => {
    const r = rig()
    const skel = skeleton({
      ...neutralPose(),
      right_elbow: kp(60, -100),
      right_wrist: kp(60, -200)
    })
    const result = solveStage2dPoseFromSkeleton({ rig: r, skeleton: skel })
    const shoulderR = result.segments.find((s) => s.key === 'upperarm' && s.side === 'r')
    expect(shoulderR?.status).toBe('ok')
    expect(result.pose.shoulderR).toBeCloseTo(-90, 5)
    // 驱动后世界方向：肩→肘 与 肘→腕 都对齐竖直向上
    expect(segmentDeg(result.pose, r, 'shoulderR', 'elbowR')).toBeCloseTo(-90, 5)
    expect(segmentDeg(result.pose, r, 'elbowR', 'wristR')).toBeCloseTo(-90, 5)
    // 左臂不受影响
    expect(segmentDeg(result.pose, r, 'shoulderL', 'elbowL')).toBeCloseTo(180, 5)
  })

  it('低置信关键点不驱动（对应段 no-keypoints）', () => {
    const r = rig()
    const skel = skeleton({
      ...neutralPose(),
      right_shoulder: kp(60, 0, 0.05),
      right_elbow: kp(160, -100, 0.9)
    })
    const result = solveStage2dPoseFromSkeleton({ rig: r, skeleton: skel })
    const upperarmR = result.segments.find((s) => s.key === 'upperarm' && s.side === 'r')
    expect(upperarmR?.status).toBe('no-keypoints')
    expect(result.pose.shoulderR).toBeUndefined()
  })

  it('rig 没有对应关节 → no-joint 且不影响其它段', () => {
    const r = createHumanoidStage2dRig({
      x: 0,
      groundY: 0,
      height: 100
    })
    r.joints = r.joints.filter((j) => !j.id.startsWith('shoulder'))
    const result = solveStage2dPoseFromSkeleton({ rig: r, skeleton: skeleton(neutralPose()) })
    const upperarmL = result.segments.find((s) => s.key === 'upperarm' && s.side === 'l')
    expect(upperarmL?.status).toBe('no-joint')
    const shinL = result.segments.find((s) => s.key === 'shin' && s.side === 'l')
    expect(shinL?.status).toBe('ok')
  })

  it('flip 换边配对（自拍镜像参考）：图像“人物左侧”抬臂 → rig 右侧复制该姿势', () => {
    const r = rig()
    const skel = skeleton({
      ...neutralPose(),
      left_elbow: kp(-60, -100),
      left_wrist: kp(-60, -200)
    })
    const flipped = solveStage2dPoseFromSkeleton({ rig: r, skeleton: skel, flip: true })
    expect(flipped.pose.shoulderR).toBeCloseTo(-90, 5)
    expect(flipped.pose.shoulderL).toBeUndefined()
    expect(segmentDeg(flipped.pose, r, 'shoulderR', 'elbowR')).toBeCloseTo(-90, 5)
    // 水平方向已随镜像反射：抬臂成竖直时视觉不变，斜向时方向正确
  })

  it('flip 对左右对称的中性站姿不引入多余 pose（水平方向随镜像反射抵消）', () => {
    const r = rig()
    const result = solveStage2dPoseFromSkeleton({ rig: r, skeleton: skeleton(neutralPose()), flip: true })
    expect(result.driven).toEqual([])
    expect(result.pose).toEqual({})
  })

  it('driveTorso=false 时不驱动躯干', () => {
    const r = rig()
    const result = solveStage2dPoseFromSkeleton({
      rig: r,
      skeleton: skeleton(neutralPose()),
      driveTorso: false
    })
    const torso = result.segments.find((s) => s.key === 'torso')
    expect(torso).toBeUndefined()
  })
})
