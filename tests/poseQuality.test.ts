import { describe, expect, it } from 'vitest'
import type { YoloBox, YoloModelInfo, YoloSkeletonPoint } from '../src/shared/yolo'
import {
  POSE_KEYPOINT_MIN_CONF,
  bestPoseModel,
  followUpSelectedIndex,
  poseModelRank,
  poseSubjectScore,
  skeletonBounds,
  skeletonCentroid,
  skeletonKeypointCount,
  sortPosePeople
} from '@renderer/features/director/poseQuality'

function kp(x: number, y: number, confidence = 1): YoloSkeletonPoint {
  return { x, y, confidence }
}

/** 直立人形（17 点 COCO），centerX 控制横向位置、scale 控制整体大小 */
function person(centerX: number, scale: number): YoloSkeletonPoint[] {
  return [
    kp(centerX, 20 * scale), // nose
    kp(centerX - 4 * scale, 22 * scale),
    kp(centerX + 4 * scale, 22 * scale),
    kp(centerX - 8 * scale, 23 * scale),
    kp(centerX + 8 * scale, 23 * scale),
    kp(centerX - 15 * scale, 40 * scale), // l_shoulder
    kp(centerX + 15 * scale, 40 * scale), // r_shoulder
    kp(centerX - 22 * scale, 70 * scale), // l_elbow
    kp(centerX + 22 * scale, 70 * scale), // r_elbow
    kp(centerX - 24 * scale, 100 * scale), // l_wrist
    kp(centerX + 24 * scale, 100 * scale), // r_wrist
    kp(centerX - 12 * scale, 110 * scale), // l_hip
    kp(centerX + 12 * scale, 110 * scale), // r_hip
    kp(centerX - 13 * scale, 160 * scale), // l_knee
    kp(centerX + 13 * scale, 160 * scale), // r_knee
    kp(centerX - 14 * scale, 200 * scale), // l_ankle
    kp(centerX + 14 * scale, 200 * scale) // r_ankle
  ]
}

function box(centerX: number, scale: number, confidence = 1): YoloBox {
  return {
    label: 'person',
    confidence,
    x: centerX - 20 * scale,
    y: 10 * scale,
    width: 40 * scale,
    height: 200 * scale
  }
}

describe('poseQuality：模型档位与默认选择', () => {
  it('poseModelRank 按 scale 排序（n<s<m<l<x），无法识别为 0', () => {
    expect(poseModelRank('yolo11n-pose')).toBe(1)
    expect(poseModelRank('yolo11s-pose')).toBe(2)
    expect(poseModelRank('yolo11m-pose')).toBe(3)
    expect(poseModelRank('yolo11l-pose')).toBe(4)
    expect(poseModelRank('yolo11x-pose')).toBe(5)
    expect(poseModelRank('yolov8x-pose')).toBe(0)
  })

  it('bestPoseModel 挑档位最高的可用模型，同档位取大文件', () => {
    const models: YoloModelInfo[] = [
      { id: 'yolo11n-pose', kind: 'pose', path: '/a', sizeMb: 6 },
      { id: 'yolo11m-pose', kind: 'pose', path: '/b', sizeMb: 80 },
      { id: 'yolo11x-pose', kind: 'pose', path: '/c', sizeMb: 225 }
    ]
    expect(bestPoseModel(models)?.id).toBe('yolo11x-pose')
    const sameRank = [
      { id: 'custom', kind: 'pose', path: '/x', sizeMb: 10 },
      { id: 'custom2', kind: 'pose', path: '/y', sizeMb: 40 }
    ]
    expect(bestPoseModel(sameRank)?.id).toBe('custom2')
    expect(bestPoseModel([])).toBeNull()
  })
})

describe('poseQuality：骨架统计与主体排序', () => {
  it('骨架统计忽略低置信度点；可见点不足时不给出包围盒/中心', () => {
    const skel = person(0, 1)
    skel[0] = kp(100, 100, 0.01) // nose 置信度极低
    expect(POSE_KEYPOINT_MIN_CONF).toBe(0.2)
    expect(skeletonKeypointCount(skel)).toBe(16)
    const b = skeletonBounds(skel)!
    expect(b.minX).toBeLessThan(b.maxX)
    const center = skeletonCentroid(skel)!
    expect(Math.abs(center.x)).toBeLessThan(30)

    const sparse = [kp(1, 1, 1)]
    expect(skeletonBounds(sparse)).toBeNull()
    expect(skeletonCentroid(sparse)).toBeNull()
  })

  it('poseSubjectScore 越大者分越高（人物框与骨架均可）', () => {
    const big = person(0, 2)
    const small = person(100, 1)
    expect(poseSubjectScore(big, box(0, 2))).toBeGreaterThan(poseSubjectScore(small, box(100, 1)))
    // 无框时退化到骨架散度
    expect(poseSubjectScore(big)).toBeGreaterThan(poseSubjectScore(small))
  })

  it('sortPosePeople 把画面中最大的人排到最前，且 boxes 与新骨架保持一一对应', () => {
    const small = person(0, 1)
    const big = person(120, 2)
    const skeletons = [small, big]
    const boxes = [box(0, 1, 0.8), box(120, 2, 0.9)]
    const sorted = sortPosePeople(skeletons, boxes)
    expect(sorted.skeletons).toHaveLength(2)
    expect(sorted.skeletons[0]).toBe(big)
    expect(sorted.skeletons[1]).toBe(small)
    expect(sorted.boxes[0]).toBe(boxes[1])
    expect(sorted.boxes[1]).toBe(boxes[0])
  })

  it('并列主体按横向位置稳定排序（左者在前）', () => {
    const a = person(0, 1)
    const b = person(60, 1)
    const boxes = [box(0, 1), box(60, 1)]
    const sorted = sortPosePeople([a, b], boxes)
    expect(sorted.skeletons[0]).toBe(a)
    expect(sorted.skeletons[1]).toBe(b)
  })
})

describe('poseQuality：重新检测时跟随原选中人物', () => {
  it('同帧重检（顺序翻转）仍能找到原选中的人', () => {
    const prevPerson = person(120, 2) // 用户原先选的大个子
    const small = person(0, 1)
    const reordered = [small, prevPerson]
    const idx = followUpSelectedIndex(prevPerson, reordered)
    expect(idx).toBe(1)
  })

  it('人物消失 / 差异过大时返回 null（由调用方回落主体 index 0）', () => {
    const prevPerson = person(120, 2)
    const farPerson = person(5000, 2)
    expect(followUpSelectedIndex(prevPerson, [farPerson])).toBeNull()
    expect(followUpSelectedIndex(undefined, [person(0, 1)])).toBeNull()
    expect(followUpSelectedIndex(prevPerson, [])).toBeNull()
  })
})
