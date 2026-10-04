import { describe, expect, it } from 'vitest'
import {
  PORTRAIT_LANDMARK_COUNT,
  buildBodyWarpControls,
  buildFaceWarpControls,
  canonicalFaceTemplate,
  manual5ToCanonical68,
  portraitFaceBoxFromLandmarks,
  portraitFaceMetrics,
  portraitRegionFeather,
  portraitRegionPolygon,
  templateAnchors,
  type PortraitFaceRegion,
  type PortraitPoseKeypoint
} from '../src/shared/graph/portraitFace'

/**
 * 人脸几何（src/shared/graph/portraitFace.ts）。
 *
 * 这里错了，五官变形会推错点、妆容会涂到鼻子外面，而且**看起来只是「有点怪」**，
 * 极难排查。所以锁：模板对称性、手动 5 点拟合精度、区域多边形合法性、
 * 变形控制点的方向与「零参数不产生任何控制点」。
 */

const LANDMARKS = canonicalFaceTemplate()

const REGIONS: PortraitFaceRegion[] = [
  'faceOval',
  'faceSkin',
  'forehead',
  'leftEye',
  'rightEye',
  'leftBrow',
  'rightBrow',
  'nose',
  'outerLip',
  'innerLip',
  'teeth',
  'leftCheek',
  'rightCheek',
  'jaw'
]

/** 合成一个 COCO-17 姿态：正立、双臂下垂、双腿竖直 */
function syntheticPose(): PortraitPoseKeypoint[] {
  return [
    [0.5, 0.1],
    [0.48, 0.09],
    [0.52, 0.09],
    [0.46, 0.1],
    [0.54, 0.1],
    [0.42, 0.22],
    [0.58, 0.22],
    [0.38, 0.38],
    [0.62, 0.38],
    [0.35, 0.52],
    [0.65, 0.52],
    [0.45, 0.55],
    [0.55, 0.55],
    [0.45, 0.75],
    [0.55, 0.75],
    [0.45, 0.95],
    [0.55, 0.95]
  ]
}

describe('portraitFace 模板与拟合', () => {
  it('模板是 68 点且左右对称', () => {
    expect(LANDMARKS).toHaveLength(PORTRAIT_LANDMARK_COUNT)
    const mirrorPairs: Array<[number, number]> = [
      [0, 16],
      [4, 12],
      [8, 8],
      [17, 26],
      [19, 24],
      [21, 22],
      [36, 45],
      [39, 42],
      [48, 54],
      [55, 59],
      [56, 58],
      [60, 63],
      [61, 62],
      [64, 66]
    ]
    for (const [a, b] of mirrorPairs) {
      expect(LANDMARKS[a][0] + LANDMARKS[b][0]).toBeCloseTo(1, 3)
      expect(LANDMARKS[a][1]).toBeCloseTo(LANDMARKS[b][1], 3)
    }
  })

  it('下巴是轮廓最低点，鼻尖在双眼之间', () => {
    const jaw = LANDMARKS.slice(0, 17)
    const chin = LANDMARKS[8]
    expect(Math.max(...jaw.map((p) => p[1]))).toBeCloseTo(chin[1], 5)
    const anchors = templateAnchors(LANDMARKS)
    expect(anchors.noseTip[0]).toBeGreaterThan(anchors.leftEye[0])
    expect(anchors.noseTip[0]).toBeLessThan(anchors.rightEye[0])
    expect(anchors.noseTip[1]).toBeGreaterThan(anchors.leftEye[1])
  })

  it('用模板自身的 5 点拟合可还原模板', () => {
    const anchors = templateAnchors(LANDMARKS)
    const fitted = manual5ToCanonical68(anchors)
    expect(fitted).not.toBeNull()
    for (let i = 0; i < PORTRAIT_LANDMARK_COUNT; i++) {
      expect(fitted![i][0]).toBeCloseTo(LANDMARKS[i][0], 2)
      expect(fitted![i][1]).toBeCloseTo(LANDMARKS[i][1], 2)
    }
  })

  it('缩放平移后的 5 点拟合回原锚点位置', () => {
    const anchors = templateAnchors(LANDMARKS)
    const transform = ([x, y]: [number, number]): [number, number] => [0.3 + x * 0.5, 0.2 + y * 0.4]
    const manual = {
      leftEye: transform(anchors.leftEye),
      rightEye: transform(anchors.rightEye),
      noseTip: transform(anchors.noseTip),
      leftMouth: transform(anchors.leftMouth),
      rightMouth: transform(anchors.rightMouth)
    }
    const fitted = manual5ToCanonical68(manual)
    expect(fitted).not.toBeNull()
    const metrics = portraitFaceMetrics(fitted!)
    expect(metrics.leftEye[0]).toBeCloseTo(manual.leftEye[0], 2)
    expect(metrics.leftEye[1]).toBeCloseTo(manual.leftEye[1], 2)
    expect(metrics.rightEye[0]).toBeCloseTo(manual.rightEye[0], 2)
    expect(metrics.noseTip[1]).toBeGreaterThan(metrics.leftEye[1])
    expect(metrics.chin[1]).toBeGreaterThan(metrics.noseTip[1])
  })

  it('退化输入（五点重合）返回 null 而不是算出 NaN', () => {
    const degenerate = {
      leftEye: [0.5, 0.5] as [number, number],
      rightEye: [0.5, 0.5] as [number, number],
      noseTip: [0.5, 0.5] as [number, number],
      leftMouth: [0.5, 0.5] as [number, number],
      rightMouth: [0.5, 0.5] as [number, number]
    }
    expect(manual5ToCanonical68(degenerate)).toBeNull()
  })

  it('人脸框包住眼睛与下巴', () => {
    const box = portraitFaceBoxFromLandmarks(LANDMARKS)
    const metrics = portraitFaceMetrics(LANDMARKS)
    expect(box.x).toBeLessThan(metrics.leftEye[0])
    expect(box.x + box.w).toBeGreaterThan(metrics.rightEye[0])
    expect(box.y).toBeLessThan(metrics.leftEye[1])
    expect(box.y + box.h).toBeGreaterThan(metrics.chin[1])
    expect(box.w).toBeGreaterThan(0)
    expect(box.h).toBeGreaterThan(0)
  })

  it('每个区域都能给出合法多边形与羽化比例', () => {
    for (const region of REGIONS) {
      const polygon = portraitRegionPolygon(region, LANDMARKS)
      expect(polygon.length).toBeGreaterThanOrEqual(3)
      for (const [x, y] of polygon) {
        expect(Number.isFinite(x)).toBe(true)
        expect(Number.isFinite(y)).toBe(true)
        expect(x).toBeGreaterThan(-1)
        expect(x).toBeLessThan(2)
        expect(y).toBeGreaterThan(-1)
        expect(y).toBeLessThan(2)
      }
      const feather = portraitRegionFeather(region)
      expect(feather).toBeGreaterThan(0)
      expect(feather).toBeLessThan(1)
    }
  })
})

describe('portraitFace 变形控制点', () => {
  const zero = new Proxy({}, { get: () => 0 }) as Record<string, number>

  it('零参数不产生任何控制点（默认状态绝不该悄悄变形）', () => {
    expect(buildFaceWarpControls(zero, LANDMARKS)).toHaveLength(0)
    expect(buildBodyWarpControls(zero, syntheticPose())).toHaveLength(0)
  })

  it('瘦脸把左右轮廓向中轴推', () => {
    const controls = buildFaceWarpControls({ ...zero, faceSlim: 60 }, LANDMARKS)
    expect(controls.length).toBeGreaterThan(0)
    const center = portraitFaceMetrics(LANDMARKS).center[0]
    for (const c of controls) {
      if (c.x < center - 0.01) expect(c.dx).toBeGreaterThan(0)
      if (c.x > center + 0.01) expect(c.dx).toBeLessThan(0)
    }
  })

  it('下巴加长向下、鼻尖上提向上', () => {
    const chin = buildFaceWarpControls({ ...zero, chinLength: 50 }, LANDMARKS)
    expect(chin.some((c) => c.dy > 0)).toBe(true)
    const nose = buildFaceWarpControls({ ...zero, noseTip: -50 }, LANDMARKS)
    expect(nose.some((c) => c.dy < 0)).toBe(true)
  })

  it('大眼把眼睑推离眼心（上下方向）', () => {
    const controls = buildFaceWarpControls({ ...zero, eyeSize: 80 }, LANDMARKS)
    expect(controls.length).toBeGreaterThan(0)
    const eyeCenterY = LANDMARKS.slice(36, 42).reduce((s, p) => s + p[1], 0) / 6
    const upper = controls.filter((c) => Math.abs(c.x - 0.36) < 0.06 && c.y < eyeCenterY)
    expect(upper.some((c) => c.dy < 0)).toBe(true)
  })

  it('身形参数按姿态关键点产生位移，腿部拉长向下', () => {
    const pose = syntheticPose()
    const slim = buildBodyWarpControls({ ...zero, bodySlim: 60 }, pose)
    expect(slim.length).toBeGreaterThan(0)
    const leg = buildBodyWarpControls({ ...zero, legLengthen: 60 }, pose)
    expect(leg.some((c) => c.dy > 0)).toBe(true)
    // 关键点不足时安全退出
    expect(buildBodyWarpControls({ ...zero, bodySlim: 60 }, pose.slice(0, 3))).toHaveLength(0)
  })
})
