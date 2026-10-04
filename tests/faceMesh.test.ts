import { describe, expect, it } from 'vitest'
import {
  BLAZEFACE_ANCHOR_COUNT,
  FACEMESH_TO_68,
  boxFromLandmarks68,
  boxIoU,
  computeFaceCrop,
  decodeBlazeFaceDetections,
  generateBlazeFaceAnchors,
  landmarksTo68,
  mapPointFromCrop,
  mapPointToCrop,
  weightedNonMaxSuppression,
  type FaceDetection,
  type FaceKeypoint
} from '@shared/faceMesh'

/**
 * FaceMesh 纯数学层（src/shared/faceMesh.ts）。
 *
 * 这里错了外部表现只是「脸有点歪」或「妆容涂偏半个眼」，几乎无法定位，
 * 所以锁：锚点几何与总数、解码口径、加权 NMS 的合并/分离、裁剪投影可逆、68 点映射表。
 */

/** 造一个检测：给定中心/尺寸/分数，关键点默认放在框中心附近 */
function makeDetection(
  xCenter: number,
  yCenter: number,
  w: number,
  h: number,
  score: number
): FaceDetection {
  return {
    box: { xCenter, yCenter, w, h, score },
    keypoints: [
      { x: xCenter - w * 0.2, y: yCenter },
      { x: xCenter + w * 0.2, y: yCenter }
    ]
  }
}

describe('generateBlazeFaceAnchors', () => {
  const anchors = generateBlazeFaceAnchors()

  it('anchors total exactly 896', () => {
    expect(anchors).toHaveLength(BLAZEFACE_ANCHOR_COUNT)
    expect(BLAZEFACE_ANCHOR_COUNT).toBe(896)
  })

  it('first cell carries two anchors at the same center with different sizes', () => {
    const cellX = 0.5 / 16
    const cellY = 0.5 / 16
    expect(anchors[0].xCenter).toBeCloseTo(cellX, 12)
    expect(anchors[0].yCenter).toBeCloseTo(cellY, 12)
    expect(anchors[1].xCenter).toBeCloseTo(cellX, 12)
    expect(anchors[1].yCenter).toBeCloseTo(cellY, 12)

    // ⚠️ 顺序是「插值锚在前、固定锚在后」：MediaPipe SsdAnchorsCalculator 的实际产出顺序。
    // 顺序反了不会报错，只会让解码把每个回归行配上另一套边长 —— 6 张人脸照里只剩 1 张能命中。
    const scaleNext = 0.1484375 + ((0.75 - 0.1484375) * 1) / 3
    expect(anchors[0].w).toBeCloseTo(Math.sqrt(0.1484375 * scaleNext), 12)
    expect(anchors[0].h).toBeCloseTo(Math.sqrt(0.1484375 * scaleNext), 12)
    // 固定锚：归一化宽高恒为 1（不是 scale）。填 scale 等于把 scale 乘两遍，框缩到 1/4。
    expect(anchors[1].w).toBe(1)
    expect(anchors[1].h).toBe(1)
    expect(anchors[0].w).toBeLessThan(anchors[1].w)
  })

  it('last anchor size is the fixed anchor of the last layer (w = h = 1)', () => {
    const last = anchors[anchors.length - 1]
    expect(last.w).toBe(1)
    expect(last.h).toBe(1)
    // 倒数第二个是最后一层的插值锚 sqrt(maxScale * 1.0)
    const prev = anchors[anchors.length - 2]
    expect(prev.w).toBeCloseTo(Math.sqrt(0.75 * 1.0), 12)
    expect(prev.h).toBeCloseTo(Math.sqrt(0.75 * 1.0), 12)
  })

  it('all anchors are normalized and square', () => {
    for (const anchor of anchors) {
      expect(anchor.xCenter).toBeGreaterThan(0)
      expect(anchor.xCenter).toBeLessThan(1)
      expect(anchor.yCenter).toBeGreaterThan(0)
      expect(anchor.yCenter).toBeLessThan(1)
      expect(anchor.w).toBeCloseTo(anchor.h, 12)
      expect(anchor.w).toBeGreaterThan(0)
    }
  })

  it('lays out 16x16 + 8x8 + 8x8 + 8x8 cells with two anchors per cell', () => {
    // 锚点按层连续排列：layer0 stride8 是 16x16，其余三层 stride16 是 8x8
    const layers = [16, 8, 8, 8]
    const cellCounts = layers.map((grid) => grid * grid)
    expect(cellCounts.reduce((sum, n) => sum + n, 0)).toBe(448)
    expect(cellCounts.reduce((sum, n) => sum + n * 2, 0)).toBe(BLAZEFACE_ANCHOR_COUNT)

    let cursor = 0
    for (let layer = 0; layer < layers.length; layer++) {
      const grid = layers[layer]
      const chunk = anchors.slice(cursor, cursor + grid * grid * 2)
      expect(chunk).toHaveLength(grid * grid * 2)
      cursor += chunk.length

      // 每层固定 scale = calculateScale(min, max, layer, 4)，插值尺寸 = sqrt(scale*scaleNext)
      const scale = 0.1484375 + ((0.75 - 0.1484375) * layer) / 3
      const scaleNext =
        layer === layers.length - 1 ? 1.0 : 0.1484375 + ((0.75 - 0.1484375) * (layer + 1)) / 3
      // 每格的第一个锚点是插值尺寸、第二个是固定锚 w=1；同一层内各只有一个
      const fixedSizes = new Set(chunk.filter((_, i) => i % 2 === 0).map((a) => a.w))
      const interpSizes = new Set(chunk.filter((_, i) => i % 2 === 1).map((a) => a.w))
      expect(fixedSizes.size).toBe(1)
      expect(interpSizes.size).toBe(1)
      expect(chunk[0].w).toBeCloseTo(Math.sqrt(scale * scaleNext), 12)
      expect(chunk[1].w).toBe(1)
      // 一层内中心是 grid x grid 的规整网格
      const centers = new Set(chunk.map((a) => `${a.xCenter},${a.yCenter}`))
      expect(centers.size).toBe(grid * grid)
    }
    expect(cursor).toBe(anchors.length)

    // 三层 stride16 的中心完全重合 → 全局唯一中心数 = 256 + 64
    const allCenters = new Set(anchors.map((a) => `${a.xCenter},${a.yCenter}`))
    expect(allCenters.size).toBe(16 * 16 + 8 * 8)
  })
})

describe('decodeBlazeFaceDetections', () => {
  const anchors = generateBlazeFaceAnchors()

  it('zero regressors + one high score yields that anchor geometry', () => {
    const regressors = new Array<number>(BLAZEFACE_ANCHOR_COUNT * 16).fill(0)
    const classificators = new Array<number>(BLAZEFACE_ANCHOR_COUNT).fill(-10)
    const hit = 42
    classificators[hit] = 10

    const detections = decodeBlazeFaceDetections({ regressors, classificators })
    expect(detections).toHaveLength(1)

    const anchor = anchors[hit]
    const box = detections[0].box
    // raw 全为 0 → 中心等于锚点中心，宽高 = (raw/128)*anchor.wh = 0，被下限夹住
    expect(box.xCenter).toBe(anchor.xCenter)
    expect(box.yCenter).toBe(anchor.yCenter)
    expect(box.w).toBeGreaterThan(0)
    expect(box.w).toBeLessThan(1e-5)
    expect(box.h).toBeGreaterThan(0)
    expect(box.h).toBeLessThan(1e-5)
    expect(box.score).toBeGreaterThan(0.99)

    // 6 个关键点（右眼、左眼、鼻尖、嘴中心、右耳屏、左耳屏）raw 也是 0 → 落在锚点中心
    expect(detections[0].keypoints).toHaveLength(6)
    for (const keypoint of detections[0].keypoints) {
      expect(keypoint.x).toBe(anchor.xCenter)
      expect(keypoint.y).toBe(anchor.yCenter)
    }
  })

  it('applies sigmoid so raw 0 gives 0.5 and raw +5 gives >0.99', () => {
    const regressors = new Array<number>(BLAZEFACE_ANCHOR_COUNT * 16).fill(0)
    // sigmoid(0) 正好等于 0.5，判定是 `score >= minScoreThreshold`，所以默认阈值下全部通过
    const zeros = new Array<number>(BLAZEFACE_ANCHOR_COUNT).fill(0)
    const atHalf = decodeBlazeFaceDetections({ regressors, classificators: zeros })
    expect(atHalf).toHaveLength(BLAZEFACE_ANCHOR_COUNT)
    expect(atHalf[0].box.score).toBeCloseTo(0.5, 12)

    // 阈值略高于 0.5 时，raw=0 的全部被过滤
    const aboveHalf = decodeBlazeFaceDetections({
      regressors,
      classificators: zeros,
      minScoreThreshold: 0.5 + 1e-9
    })
    expect(aboveHalf).toHaveLength(0)

    // raw=-ln(3) → 0.25，低于默认阈值 → 全部被过滤
    const low = decodeBlazeFaceDetections({
      regressors,
      classificators: new Array<number>(BLAZEFACE_ANCHOR_COUNT).fill(-Math.log(3))
    })
    expect(low).toHaveLength(0)

    // raw=ln(3) → 0.75，通过默认阈值
    const high = decodeBlazeFaceDetections({
      regressors,
      classificators: new Array<number>(BLAZEFACE_ANCHOR_COUNT).fill(Math.log(3))
    })
    expect(high).toHaveLength(BLAZEFACE_ANCHOR_COUNT)
    expect(high[0].box.score).toBeCloseTo(0.75, 12)

    const strong = new Array<number>(BLAZEFACE_ANCHOR_COUNT).fill(5)
    const strongOut = decodeBlazeFaceDetections({ regressors, classificators: strong })
    expect(strongOut).toHaveLength(BLAZEFACE_ANCHOR_COUNT)
    expect(strongOut[0].box.score).toBeGreaterThan(0.99)
  })

  it('decodes box and keypoint offsets by anchor size', () => {
    const regressors = new Array<number>(BLAZEFACE_ANCHOR_COUNT * 16).fill(0)
    const classificators = new Array<number>(BLAZEFACE_ANCHOR_COUNT).fill(-10)
    const hit = 0
    classificators[hit] = 8
    const anchor = anchors[hit]
    // raw 全部按 128 反归一化后再乘 anchor 的 w/h
    regressors[hit * 16] = 128
    regressors[hit * 16 + 1] = -128
    regressors[hit * 16 + 2] = 64
    regressors[hit * 16 + 3] = 32
    regressors[hit * 16 + 4] = 16
    regressors[hit * 16 + 5] = 16

    const [detection] = decodeBlazeFaceDetections({
      regressors,
      classificators,
      minScoreThreshold: 0.3
    })
    expect(detection.box.xCenter).toBeCloseTo(anchor.xCenter + anchor.w, 12)
    expect(detection.box.yCenter).toBeCloseTo(anchor.yCenter - anchor.h, 12)
    expect(detection.box.w).toBeCloseTo(anchor.w * 0.5, 12)
    expect(detection.box.h).toBeCloseTo(anchor.h * 0.25, 12)
    expect(detection.keypoints[0].x).toBeCloseTo(anchor.xCenter + anchor.w * 0.125, 12)
    expect(detection.keypoints[0].y).toBeCloseTo(anchor.yCenter + anchor.h * 0.125, 12)
  })
})

describe('weightedNonMaxSuppression', () => {
  it('merges three heavily overlapping detections into one with a weighted-averaged center', () => {
    const merged = weightedNonMaxSuppression([
      makeDetection(0.4, 0.4, 0.5, 0.5, 0.9),
      makeDetection(0.45, 0.4, 0.5, 0.5, 0.8),
      makeDetection(0.5, 0.4, 0.5, 0.5, 0.7)
    ])
    expect(merged).toHaveLength(1)
    const total = 0.9 + 0.8 + 0.7
    expect(merged[0].box.xCenter).toBeCloseTo((0.4 * 0.9 + 0.45 * 0.8 + 0.5 * 0.7) / total, 12)
    expect(merged[0].box.yCenter).toBeCloseTo(0.4, 12)
    expect(merged[0].box.w).toBeCloseTo(0.5, 12)
    expect(merged[0].box.h).toBeCloseTo(0.5, 12)
    expect(merged[0].box.score).toBeCloseTo(0.9, 12)
    expect(merged[0].keypoints).toHaveLength(2)
    // 关键点同样按 score 加权（三个检测的 0 号点是 0.3/0.35/0.4）
    expect(merged[0].keypoints[0].x).toBeCloseTo((0.3 * 0.9 + 0.35 * 0.8 + 0.4 * 0.7) / total, 12)
  })

  it('keeps a non-overlapping detection as a separate result', () => {
    const out = weightedNonMaxSuppression([
      makeDetection(0.4, 0.4, 0.5, 0.5, 0.9),
      makeDetection(0.45, 0.4, 0.5, 0.5, 0.8),
      makeDetection(0.5, 0.4, 0.5, 0.5, 0.7),
      makeDetection(1.0, 0.4, 0.5, 0.5, 0.6)
    ])
    expect(out).toHaveLength(2)
    // 第一组是三个高分框的加权平均，第二组是不重叠那个（原样保留）
    expect(out[0].box.xCenter).toBeCloseTo((0.4 * 0.9 + 0.45 * 0.8 + 0.5 * 0.7) / 2.4, 12)
    expect(out[1].box.xCenter).toBeCloseTo(1.0, 12)
    expect(out[1].box.score).toBeCloseTo(0.6, 12)
  })

  it('keeps detections apart when IoU is below the suppression threshold', () => {
    const a = makeDetection(0.3, 0.5, 0.2, 0.2, 0.9)
    const b = makeDetection(0.6, 0.5, 0.2, 0.2, 0.8)
    expect(boxIoU(a.box, b.box)).toBe(0)
    expect(weightedNonMaxSuppression([a, b])).toHaveLength(2)
  })

  it('outputs groups in descending score order and does not mutate the input', () => {
    const input = [
      makeDetection(0.2, 0.2, 0.2, 0.2, 0.6),
      makeDetection(0.8, 0.8, 0.2, 0.2, 0.95),
      makeDetection(0.5, 0.5, 0.2, 0.2, 0.8)
    ]
    const snapshot = JSON.stringify(input)
    const out = weightedNonMaxSuppression(input)
    expect(out.map((d) => d.box.score)).toEqual([0.95, 0.8, 0.6])
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})

describe('computeFaceCrop and crop projection', () => {
  /** 两眼水平、框 0.4 见方的正面脸 */
  function frontalDetection(): FaceDetection {
    return {
      box: { xCenter: 0.5, yCenter: 0.5, w: 0.4, h: 0.5, score: 0.9 },
      keypoints: [
        { x: 0.4, y: 0.45 },
        { x: 0.6, y: 0.45 },
        { x: 0.5, y: 0.55 },
        { x: 0.5, y: 0.62 },
        { x: 0.36, y: 0.45 },
        { x: 0.64, y: 0.45 }
      ]
    }
  }

  it('builds a square rotated crop from the detection center and eye line', () => {
    const crop = computeFaceCrop(frontalDetection())
    expect(crop.centerX).toBeCloseTo(0.5, 12)
    expect(crop.centerY).toBeCloseTo(0.5, 12)
    expect(crop.size).toBeCloseTo(0.5 * 1.5, 12)
    expect(crop.rotationRad).toBeCloseTo(0, 12)
    expect(crop.targetSize).toBe(192)

    const tilted = frontalDetection()
    tilted.keypoints[0] = { x: 0.6, y: 0.4 }
    tilted.keypoints[1] = { x: 0.4, y: 0.5 }
    // atan2(leftEye.y - rightEye.y, leftEye.x - rightEye.x)
    expect(computeFaceCrop(tilted).rotationRad).toBeCloseTo(Math.atan2(0.1, -0.2), 12)
    expect(computeFaceCrop(tilted, { ignoreRotation: true }).rotationRad).toBe(0)
    expect(computeFaceCrop(frontalDetection(), { targetSize: 256, scale: 2 }).size).toBeCloseTo(
      1,
      12
    )
    expect(computeFaceCrop(frontalDetection(), { targetSize: 128 }).targetSize).toBe(128)
  })

  it('maps the crop center to (0.5, 0.5) and keeps normalized output', () => {
    const crop = computeFaceCrop(frontalDetection())
    const center = mapPointToCrop({ x: crop.centerX, y: crop.centerY }, crop)
    expect(center.x).toBeCloseTo(0.5, 12)
    expect(center.y).toBeCloseTo(0.5, 12)

    for (const point of [
      { x: 0.4, y: 0.4 },
      { x: 0.6, y: 0.6 },
      { x: 0.5, y: 0.5 }
    ]) {
      const mapped = mapPointToCrop(point, crop)
      expect(mapped.x).toBeGreaterThanOrEqual(0)
      expect(mapped.x).toBeLessThanOrEqual(1)
      expect(mapped.y).toBeGreaterThanOrEqual(0)
      expect(mapped.y).toBeLessThanOrEqual(1)
    }
  })

  it('round-trips points with and without rotation', () => {
    const cases: FaceKeypoint[] = [
      { x: 0.42, y: 0.37 },
      { x: 0.58, y: 0.63 },
      { x: 0.5, y: 0.5 },
      { x: 0.1, y: 0.9 }
    ]
    const crops = [
      computeFaceCrop(frontalDetection()),
      {
        centerX: 0.5,
        centerY: 0.5,
        size: 0.6,
        rotationRad: 0.3,
        targetSize: 192
      },
      {
        centerX: 0.31,
        centerY: 0.72,
        size: 0.42,
        rotationRad: -1.1,
        targetSize: 192
      }
    ]

    for (const crop of crops) {
      for (const point of cases) {
        const roundTrip = mapPointFromCrop(mapPointToCrop(point, crop), crop)
        expect(Math.abs(roundTrip.x - point.x)).toBeLessThan(1e-9)
        expect(Math.abs(roundTrip.y - point.y)).toBeLessThan(1e-9)
      }
    }
  })

  it('rotates a tilted face back to a level eye line', () => {
    const detection = frontalDetection()
    detection.keypoints[0] = { x: 0.62, y: 0.44 }
    detection.keypoints[1] = { x: 0.38, y: 0.56 }
    const crop = computeFaceCrop(detection)
    const rightEye = mapPointToCrop(detection.keypoints[0], crop)
    const leftEye = mapPointToCrop(detection.keypoints[1], crop)
    // 裁剪坐标里两眼应当等高（差值只剩浮点误差）
    expect(Math.abs(leftEye.y - rightEye.y)).toBeLessThan(1e-12)
    expect(leftEye.x).toBeGreaterThan(rightEye.x)
  })
})

describe('landmarksTo68 and boxFromLandmarks68', () => {
  const landmarks468: FaceKeypoint[] = Array.from({ length: 468 }, (_, i) => ({
    x: (i % 20) / 20,
    y: (i % 20) / 20
  }))

  it('FACEMESH_TO_68 is a 68-entry table of valid distinct indices', () => {
    expect(FACEMESH_TO_68).toHaveLength(68)
    for (const index of FACEMESH_TO_68) {
      expect(Number.isInteger(index)).toBe(true)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(468)
    }
    // 脸轮廓 0..16 共 17 个点（前 17 项）
    const contour = FACEMESH_TO_68.slice(0, 17)
    expect(contour).toHaveLength(17)
    expect(new Set(contour).size).toBe(17)
    expect(new Set(FACEMESH_TO_68).size).toBe(68)
  })

  it('picks landmarks strictly following the table order', () => {
    const out = landmarksTo68(landmarks468)
    expect(out).toHaveLength(68)
    for (let i = 0; i < FACEMESH_TO_68.length; i++) {
      const source = landmarks468[FACEMESH_TO_68[i]]
      expect(out[i].x).toBe(source.x)
      expect(out[i].y).toBe(source.y)
    }
  })

  it('boxFromLandmarks68 bounds every point with positive width and height', () => {
    const out = landmarksTo68(landmarks468)
    const box = boxFromLandmarks68(out)
    expect(box.w).toBeGreaterThan(0)
    expect(box.h).toBeGreaterThan(0)
    for (const point of out) {
      expect(point.x).toBeGreaterThanOrEqual(box.x)
      expect(point.x).toBeLessThanOrEqual(box.x + box.w)
      expect(point.y).toBeGreaterThanOrEqual(box.y)
      expect(point.y).toBeLessThanOrEqual(box.y + box.h)
    }
    const xs = landmarks468.map((p) => p.x)
    const ys = landmarks468.map((p) => p.y)
    expect(box.x).toBe(Math.min(...xs))
    expect(box.y).toBe(Math.min(...ys))
    expect(box.w).toBeCloseTo(Math.max(...xs) - Math.min(...xs), 12)
    expect(box.h).toBeCloseTo(Math.max(...ys) - Math.min(...ys), 12)
  })

  it('boxFromLandmarks68 stays finite for an empty input', () => {
    expect(boxFromLandmarks68([])).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })
})
