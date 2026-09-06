import { describe, expect, it } from 'vitest'
import {
  COCO17_SKELETON_EDGES,
  keypointMapFromSkeleton,
  solvePoseFromSkeleton,
  summarizeSolveResult,
  visibleKeypointIndices
} from '@renderer/features/director/poseFromMedia'
import type { ImagePoseBindBone } from '@renderer/features/director/imagePoseSolver'
import type { YoloSkeletonPoint } from '@shared/yolo'

const I = (q: { x?: number; y?: number; z?: number; w?: number } = {}) => ({
  x: q.x ?? 0,
  y: q.y ?? 0,
  z: q.z ?? 0,
  w: q.w ?? 1
})

/** 站立骨架：角色 +Y 为上；臂展 -X/+X，腿下垂 -Y */
function standingBindBones(): ImagePoseBindBone[] {
  const P = (x: number, y: number, z = 0) => ({ x, y, z })
  return [
    { name: 'mixamorig:Hips', parentName: null, position: P(0, 0, 0), quaternion: I() },
    { name: 'mixamorig:Spine1', parentName: 'mixamorig:Hips', position: P(0, 0.18, 0), quaternion: I() },
    { name: 'mixamorig:Neck', parentName: 'mixamorig:Spine1', position: P(0, 0.12, 0), quaternion: I() },
    { name: 'mixamorig:Head', parentName: 'mixamorig:Neck', position: P(0, 0.08, 0), quaternion: I() },
    { name: 'mixamorig:LeftUpLeg', parentName: 'mixamorig:Hips', position: P(-0.12, 0, 0), quaternion: I() },
    { name: 'mixamorig:LeftLeg', parentName: 'mixamorig:LeftUpLeg', position: P(0, -0.45, 0), quaternion: I() },
    { name: 'mixamorig:LeftFoot', parentName: 'mixamorig:LeftLeg', position: P(0, -0.45, 0), quaternion: I() },
    { name: 'mixamorig:RightUpLeg', parentName: 'mixamorig:Hips', position: P(0.12, 0, 0), quaternion: I() },
    { name: 'mixamorig:RightLeg', parentName: 'mixamorig:RightUpLeg', position: P(0, -0.45, 0), quaternion: I() },
    { name: 'mixamorig:RightFoot', parentName: 'mixamorig:RightLeg', position: P(0, -0.45, 0), quaternion: I() },
    { name: 'mixamorig:LeftArm', parentName: 'mixamorig:Spine1', position: P(-0.02, 0.03, 0), quaternion: I() },
    { name: 'mixamorig:LeftForeArm', parentName: 'mixamorig:LeftArm', position: P(-0.32, 0, 0), quaternion: I() },
    { name: 'mixamorig:LeftHand', parentName: 'mixamorig:LeftForeArm', position: P(-0.28, 0, 0), quaternion: I() },
    { name: 'mixamorig:RightArm', parentName: 'mixamorig:Spine1', position: P(0.02, 0.03, 0), quaternion: I() },
    { name: 'mixamorig:RightForeArm', parentName: 'mixamorig:RightArm', position: P(0.32, 0, 0), quaternion: I() },
    { name: 'mixamorig:RightHand', parentName: 'mixamorig:RightForeArm', position: P(0.28, 0, 0), quaternion: I() }
  ]
}

/** 站立正面照：肩外展略垂、腿近直立、双手略下垂外展 */
function standingSkeleton(): YoloSkeletonPoint[] {
  const K = (x: number, y: number, c = 0.9): YoloSkeletonPoint => ({ x, y, confidence: c })
  return [
    K(500, 80), // nose
    K(478, 70), K(522, 70), // eyes
    K(465, 76), K(535, 76), // ears
    K(300, 220), // left_shoulder（图左）
    K(700, 220), // right_shoulder
    K(230, 420), K(770, 420), // elbows
    K(205, 640), K(795, 640), // wrists
    K(455, 560), K(545, 560), // hips
    K(440, 760), K(560, 760), // knees
    K(445, 950), K(555, 950) // ankles
  ]
}

describe('poseFromMedia — keypoint 换算', () => {
  it('COCO17 连线索引保持在合法范围内', () => {
    for (const [a, b] of COCO17_SKELETON_EDGES) {
      expect(a).toBeGreaterThanOrEqual(0)
      expect(b).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThan(17)
      expect(b).toBeLessThan(17)
    }
  })

  it('过滤坐标非法 / 低置信度点', () => {
    const skel: YoloSkeletonPoint[] = [
      { x: 1, y: 2, confidence: 0.9 },
      { x: NaN, y: 2, confidence: 0.9 },
      { x: 3, y: 4, confidence: 0.01 },
      { x: 5, y: 6, confidence: 0.5 }
    ]
    const visible = visibleKeypointIndices(skel, 0.05)
    expect(visible).toEqual([0, 3])
    const map = keypointMapFromSkeleton(skel, 0.05)
    expect(map['nose']).toEqual({ x: 1, y: 2, confidence: 0.9 })
    expect(map['left_eye']).toBeUndefined()
    expect(map['right_eye']).toBeUndefined()
    expect(map['left_ear']).toEqual({ x: 5, y: 6, confidence: 0.5 })
  })

  it('空骨架得到空 map 且求解结果为空', () => {
    const map = keypointMapFromSkeleton([])
    expect(Object.keys(map)).toHaveLength(0)
    const res = solvePoseFromSkeleton({ bones: [], skeleton: [] })
    expect(res.drivenBones).toHaveLength(0)
    expect(Object.keys(res.bonePose)).toHaveLength(0)
  })
})

describe('poseFromMedia — 骨架求解接线', () => {
  it('站立照片可驱动到四肢与脊柱，且汇总统计一致', () => {
    const bones = standingBindBones()
    const res = solvePoseFromSkeleton({ bones, skeleton: standingSkeleton() })
    expect(res.segments.length).toBeGreaterThan(0)
    expect(res.drivenBones.length).toBeGreaterThan(0)
    // 直立对称姿态下四肢应都能解析（ok 段由 drivenBones 对齐）
    const stat = summarizeSolveResult(res)
    expect(stat.ok).toBeGreaterThanOrEqual(4)
    expect(stat.ok + stat.noBone + stat.noKeypoints + stat.degenerate).toBe(stat.total)
    for (const name of res.drivenBones) {
      expect(res.bonePose[name]).toBeDefined()
    }
  })

  it('骨骼缺失的角色返回 no-bone 而非抛错', () => {
    const res = solvePoseFromSkeleton({
      bones: standingBindBones().filter((b) => !/arm|hand/i.test(b.name)),
      skeleton: standingSkeleton()
    })
    const stat = summarizeSolveResult(res)
    expect(stat.noBone).toBeGreaterThan(0)
  })

  it('全部关键点缺失返回 no-keypoints', () => {
    const res = solvePoseFromSkeleton({
      bones: standingBindBones(),
      skeleton: Array.from({ length: 17 }, (_, i) => ({
        x: i,
        y: i,
        confidence: 0
      }))
    })
    const stat = summarizeSolveResult(res)
    expect(stat.ok).toBe(0)
    expect(stat.noKeypoints).toBeGreaterThan(0)
  })
})
