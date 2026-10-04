import { describe, expect, it } from 'vitest'
import {
  PORTRAIT_LANDMARK_COUNT,
  canonicalFaceTemplate,
  portraitFaceBoxFromLandmarks,
  portraitFaceMetrics
} from '../src/shared/graph/portraitFace'

/**
 * 人脸几何（src/shared/graph/portraitFace.ts）。
 *
 * 这里错了，依赖人脸的组会整组不进提示词、局部回贴的脸蒙版会歪，而且**看起来只是「有点怪」**，
 * 极难排查。所以锁：模板对称性、几何度量与由关键点反推的人脸框。
 */

const LANDMARKS = canonicalFaceTemplate()

describe('portraitFace 模板与几何度量', () => {
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
    const metrics = portraitFaceMetrics(LANDMARKS)
    expect(metrics.noseTip[0]).toBeGreaterThan(metrics.leftEye[0])
    expect(metrics.noseTip[0]).toBeLessThan(metrics.rightEye[0])
    expect(metrics.noseTip[1]).toBeGreaterThan(metrics.leftEye[1])
    expect(metrics.chin[1]).toBeGreaterThan(metrics.noseTip[1])
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
})
