import { describe, expect, it } from 'vitest'
import {
  analyzeStage2dSpriteSilhouette,
  computeStage2dRigTransforms,
  createHumanoidStage2dRig,
  fitHumanoidStage2dRigToSkeleton,
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

function skeleton(
  over: Partial<Record<(typeof order)[number], YoloSkeletonPoint>>
): YoloSkeletonPoint[] {
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
function segmentDeg(
  skel: Stage2dPoseSolveResult['pose'],
  r: Stage2dRig,
  from: string,
  to: string
): number {
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
    const result = solveStage2dPoseFromSkeleton({
      rig: r,
      skeleton: skeleton(neutralPose()),
      flip: true
    })
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

describe('fitHumanoidStage2dRigToSkeleton', () => {
  it('正面立绘 COCO17 关键点（left_shoulder 在画面右侧）自动翻转配对并对齐 16 个关节世界坐标', () => {
    const skel = skeleton({
      nose: kp(512, 160),
      left_shoulder: kp(560, 260),
      right_shoulder: kp(464, 260),
      left_elbow: kp(600, 360),
      right_elbow: kp(424, 360),
      left_wrist: kp(620, 450),
      right_wrist: kp(404, 450),
      left_hip: kp(544, 480),
      right_hip: kp(480, 480),
      left_knee: kp(550, 650),
      right_knee: kp(474, 650),
      left_ankle: kp(556, 820),
      right_ankle: kp(468, 820)
    })
    const fitted = fitHumanoidStage2dRigToSkeleton({
      skeleton: skel,
      bounds: { x: 380, y: 110, width: 264, height: 740 }
    })
    expect(fitted.matchedKeypoints).toBe(13)
    expect(fitted.usedKeypoints).toBe(true)
    expect(fitted.rig.joints).toHaveLength(16)

    const world = new Map(
      computeStage2dRigTransforms(fitted.rig).map((item) => [item.jointId, item])
    )
    // 屏幕左侧 *L 对应画面左半边（COCO right_*），屏幕右侧 *R 对应画面右半边（COCO left_*）
    expect(world.get('shoulderL')!.x).toBeCloseTo(464, 1)
    expect(world.get('shoulderR')!.x).toBeCloseTo(560, 1)
    expect(world.get('wristL')!.x).toBeCloseTo(404, 1)
    expect(world.get('wristR')!.x).toBeCloseTo(620, 1)
    expect(world.get('ankleL')!.y).toBeCloseTo(820, 1)
    expect(world.get('ankleR')!.y).toBeCloseTo(820, 1)
    expect(world.get('pelvis')!.x).toBeCloseTo(512, 1)
  })

  it('无关键点时退化为按透明包围盒生成完整 16 关节人形骨骼', () => {
    const fitted = fitHumanoidStage2dRigToSkeleton({
      skeleton: null,
      bounds: { x: 300, y: 100, width: 400, height: 800 }
    })
    expect(fitted.matchedKeypoints).toBe(0)
    expect(fitted.rig.joints).toHaveLength(16)
    const world = new Map(
      computeStage2dRigTransforms(fitted.rig).map((item) => [item.jointId, item])
    )
    expect(world.get('pelvis')!.x).toBeCloseTo(500, 1)
    expect(world.get('ankleL')!.x).toBeLessThan(500)
    expect(world.get('ankleR')!.x).toBeGreaterThan(500)
  })

  it('二次元/Q版 Alpha 轮廓形态学分析 + YOLO 异常飞点过滤（透明区飞点与倒置髋部自动剔除）', () => {
    const w = 100
    const h = 200
    const alpha = new Uint8Array(w * h)
    const fillRect = (x0: number, x1: number, y0: number, y1: number): void => {
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          if (x >= 0 && x < w && y >= 0 && y < h) alpha[y * w + x] = 255
        }
      }
    }
    // 构造约 3 头身二次元/Q版透明立绘掩码：
    // 大头 (y: 4..60, x: 25..75) -> 颈部收窄 (y: 61..68, x: 43..57)
    // -> 躯干 (y: 69..124, x: 34..66) + 左右独立手臂 (x: 16..28, x: 72..84, y: 72..130)
    // -> 左右独立双腿 (x: 35..46, x: 54..65, y: 125..195)
    fillRect(25, 75, 4, 60)
    fillRect(43, 57, 61, 68)
    fillRect(34, 66, 69, 124)
    fillRect(16, 28, 72, 130)
    fillRect(72, 84, 72, 130)
    fillRect(35, 46, 125, 195)
    fillRect(54, 65, 125, 195)

    const bounds = { x: 200, y: 100, width: 200, height: 400 }
    const sil = analyzeStage2dSpriteSilhouette({ data: alpha, width: w, height: h }, bounds)
    expect(sil).not.toBeNull()
    expect(sil!.hasLegSplit).toBe(true)
    // 颈部收窄应识别在 y ≈ 64/200 = 0.32 附近（Q版大头比例）
    expect(sil!.neckV).toBeGreaterThan(0.26)
    expect(sil!.neckV).toBeLessThan(0.38)

    // 传入带二次元典型误检的 YOLO 关键点：
    // - right_wrist 飞到画面最左侧透明空白区 (x=202, y=200)
    // - left_hip / right_hip 被误检到比肩膀还高的位置 (y=180 < shoulder.y=245)
    const noisySkel = skeleton({
      nose: kp(300, 170, 0.8),
      left_shoulder: kp(330, 245, 0.75),
      right_shoulder: kp(270, 245, 0.75),
      right_wrist: kp(202, 200, 0.85), // 透明空白区飞点
      left_hip: kp(320, 180, 0.8), // 解剖学倒置异常点（高于肩部）
      right_hip: kp(280, 180, 0.8)
    })

    const fitted = fitHumanoidStage2dRigToSkeleton({
      skeleton: noisySkel,
      bounds,
      silhouette: { data: alpha, width: w, height: h }
    })
    expect(fitted.usedSilhouette).toBe(true)
    const world = new Map(
      computeStage2dRigTransforms(fitted.rig).map((item) => [item.jointId, item])
    )
    // 倒置的髋部被剔除，pelvis 保持在轮廓形态学骨盆位置（低于肩部）
    expect(world.get('pelvis')!.y).toBeGreaterThan(world.get('shoulderL')!.y + 60)
    // 飞出透明区的 wristL 被过滤，回退到左侧手臂非透明连通段中心 (x ≈ 200 + 0.22 * 200 = 244)
    expect(world.get('wristL')!.x).toBeGreaterThan(230)
    expect(world.get('wristL')!.x).toBeLessThan(260)
    // 左右脚踝精准落在左右腿连通段内部
    expect(world.get('ankleL')!.x).toBeCloseTo(200 + 0.41 * 200, -1)
    expect(world.get('ankleR')!.x).toBeCloseTo(200 + 0.6 * 200, -1)
  })
})
