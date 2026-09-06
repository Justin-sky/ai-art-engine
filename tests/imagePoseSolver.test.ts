import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { solveImagePoseToBonePose } from '@renderer/features/director/imagePoseSolver'
import type { ImagePoseBindBone, KeypointMap } from '@renderer/features/director/imagePoseSolver'

/**
 * 构造「直立、双手自然下垂」风格的角色骨骼（类 Mixamo 层级命名），
 * bind 即静止姿势：四肢沿 -Y，脊柱沿 +Y。
 */
function buildBindBones(): ImagePoseBindBone[] {
  const n = (name: string, parentName: string | null, x: number, y: number, z = 0): ImagePoseBindBone => ({
    name,
    parentName,
    position: { x, y, z },
    quaternion: { x: 0, y: 0, z: 0, w: 1 }
  })
  return [
    n('Hips', null, 0, 0, 0),
    n('Spine', 'Hips', 0, 0.4, 0),
    n('Spine1', 'Spine', 0, 0.3, 0),
    n('Spine2', 'Spine1', 0, 0.25, 0),
    n('Neck', 'Spine2', 0, 0.15, 0),
    n('Head', 'Neck', 0, 0.15, 0),
    // 腿：thigh 骨在髋，小腿骨在原位（膝）
    n('LeftUpLeg', 'Hips', 0.06, 0, 0),
    n('LeftLeg', 'LeftUpLeg', 0, -1.6, 0),
    n('LeftFoot', 'LeftLeg', 0, -1.5, 0),
    n('RightUpLeg', 'Hips', -0.06, 0, 0),
    n('RightLeg', 'RightUpLeg', 0, -1.6, 0),
    n('RightFoot', 'RightLeg', 0, -1.5, 0),
    // 臂：上臂骨在肩，前臂骨在肘
    n('LeftArm', 'Spine2', 0.15, 0.05, 0),
    n('LeftForeArm', 'LeftArm', 0, -1.1, 0),
    n('LeftHand', 'LeftForeArm', 0, -0.7, 0),
    n('RightArm', 'Spine2', -0.15, 0.05, 0),
    n('RightForeArm', 'RightArm', 0, -1.1, 0),
    n('RightHand', 'RightForeArm', 0, -0.7, 0)
  ]
}

/** 把 bindBones + offsets 放到真实 THREE.Bone 层级上，取各骨当前世界关节位置 */
function buildThreeHierarchy(
  bones: ImagePoseBindBone[],
  offsets: Record<string, { x: number; y: number; z: number }>
): Map<string, THREE.Bone> {
  const map = new Map<string, THREE.Bone>()
  for (const b of bones) {
    const bone = new THREE.Bone()
    bone.name = b.name
    bone.position.set(b.position.x, b.position.y, b.position.z)
    bone.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w)
    map.set(b.name, bone)
  }
  for (const b of bones) {
    if (!b.parentName) continue
    const parent = map.get(b.parentName)
    if (!parent) continue
    parent.add(map.get(b.name)!)
  }
  // 施加 solver 输出的局部欧拉偏移：bonePose 语义 = bind 局部四元数 * 偏移
  for (const [name, eul] of Object.entries(offsets)) {
    const bone = map.get(name)
    if (!bone) continue
    const offsetQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(eul.x, eul.y, eul.z, 'XYZ'))
    const bindQ = new THREE.Quaternion(
      bones.find((b) => b.name === name)?.quaternion.x ?? 0,
      bones.find((b) => b.name === name)?.quaternion.y ?? 0,
      bones.find((b) => b.name === name)?.quaternion.z ?? 0,
      bones.find((b) => b.name === name)?.quaternion.w ?? 1
    )
    bone.quaternion.copy(bindQ).multiply(offsetQ)
  }
  // 全局更新世界矩阵
  const root = [...map.values()].find((b) => !b.parent)
  root?.updateMatrixWorld(true)
  return map
}

function kp(x: number, y: number, confidence = 1): { x: number; y: number; confidence: number } {
  return { x, y, confidence }
}

/** 图像 keypoints（y 向下）。图 x → 骨骼 +X，图 y(下) → -Y。 */
function standingKeypoints(armSide: 'l' | 'r' | 'both', elbowBent = false): KeypointMap {
  // 躯干中心在 x=20；肩高 y=10、髋 y=60、膝 y=110、踝 y=170
  const k: KeypointMap = {
    left_shoulder: kp(13, 10),
    right_shoulder: kp(27, 10),
    left_hip: kp(13, 60),
    right_hip: kp(27, 60),
    left_knee: kp(13, 110),
    right_knee: kp(27, 110),
    left_ankle: kp(13, 170),
    right_ankle: kp(27, 170),
    left_elbow: kp(13, 60), // 待覆盖
    right_elbow: kp(27, 60),
    left_wrist: kp(13, 110),
    right_wrist: kp(27, 110)
  }
  if (armSide === 'l' || armSide === 'both') {
    // 左臂水平外展：肩→肘 +X，肘→腕 +X（若 bent，肘→腕 -Y）
    k.left_elbow = kp(23, 10)
    k.left_wrist = elbowBent ? kp(23, 40) : kp(33, 10)
  }
  if (armSide === 'r' || armSide === 'both') {
    k.right_elbow = kp(17, 10)
    k.right_wrist = elbowBent ? kp(17, 40) : kp(7, 10)
  }
  return k
}

function dirBetween(map: Map<string, THREE.Bone>, from: string, to: string): THREE.Vector3 {
  const a = map.get(from)!.getWorldPosition(new THREE.Vector3())
  const b = map.get(to)!.getWorldPosition(new THREE.Vector3())
  return b.sub(a).normalize()
}

describe('imagePoseSolver COCO17 → bonePose', () => {
  it('站立、双臂水平外展：各段世界方向与图像一致', () => {
    const bones = buildBindBones()
    const keypoints = standingKeypoints('both')
    const solved = solveImagePoseToBonePose({ bones, keypoints })
    // 8 段肢体 + 躯干全部解析成功；水平双臂主要靠上臂旋转（直臂前臂继承，offset≈0）
    expect(solved.segments.filter((s) => s.status === 'ok').length).toBeGreaterThanOrEqual(8)
    expect(solved.drivenBones).toContain('LeftArm')
    // 左臂水平 +X
    const map = buildThreeHierarchy(bones, solved.bonePose)
    expect(dirBetween(map, 'LeftArm', 'LeftForeArm').x).toBeCloseTo(1, 3)
    expect(dirBetween(map, 'LeftForeArm', 'LeftHand').x).toBeCloseTo(1, 3)
    // 右臂水平 -X
    expect(dirBetween(map, 'RightArm', 'RightForeArm').x).toBeCloseTo(-1, 3)
    // 双腿垂直向下
    expect(dirBetween(map, 'LeftUpLeg', 'LeftLeg').y).toBeCloseTo(-1, 3)
    expect(dirBetween(map, 'LeftLeg', 'LeftFoot').y).toBeCloseTo(-1, 3)
    expect(dirBetween(map, 'RightUpLeg', 'RightLeg').y).toBeCloseTo(-1, 3)
    // 脊柱仍竖直（躯干直立）
    expect(dirBetween(map, 'Hips', 'Spine').y).toBeCloseTo(1, 3)
  })

  it('左臂肘部弯曲：前臂方向垂直向下', () => {
    const bones = buildBindBones()
    const keypoints = standingKeypoints('l', true)
    const solved = solveImagePoseToBonePose({ bones, keypoints })
    const map = buildThreeHierarchy(bones, solved.bonePose)
    // 上臂 +X（肩→肘），前臂 -Y（肘→腕）
    expect(dirBetween(map, 'LeftArm', 'LeftForeArm').x).toBeCloseTo(1, 3)
    const fore = dirBetween(map, 'LeftForeArm', 'LeftHand')
    expect(fore.y).toBeCloseTo(-1, 3)
    // 未涉及的右臂保持 bind（竖直）
    const rightArm = dirBetween(map, 'RightArm', 'RightForeArm')
    expect(rightArm.y).toBeCloseTo(-1, 3)
  })

  it('躯干侧倾（肩整体右移）→ 脊柱基底偏移', () => {
    const bones = buildBindBones()
    const k: KeypointMap = {
      ...standingKeypoints('both'),
      left_shoulder: kp(23, 10),
      right_shoulder: kp(37, 10),
      left_elbow: kp(23, 60),
      right_elbow: kp(37, 60)
    }
    const solved = solveImagePoseToBonePose({ bones, keypoints: k })
    const map = buildThreeHierarchy(bones, solved.bonePose)
    // 肩中心(30,10) - 髋中心(20,60) => char (10, 50)，归一化后应有 x≈0.196,y≈0.98
    // 脊柱基底(Spine)自身段方向应与目标一致（Hips→Spine1 是混叠测量，不作断言）
    const spine = dirBetween(map, 'Spine', 'Spine1')
    expect(spine.x).toBeGreaterThan(0.18)
    expect(spine.x).toBeLessThan(0.21)
    expect(spine.y).toBeCloseTo(0.98, 1)
  })

  it('骨架无对应语义骨骼时安全跳过并返回原因', () => {
    const bones = buildBindBones().filter((b) => !/Arm|Hand|ForeArm/i.test(b.name))
    const keypoints = standingKeypoints('both')
    const solved = solveImagePoseToBonePose({ bones, keypoints })
    // 四肢无臂，但腿/躯干仍应解析
    expect(solved.segments.filter((s) => s.status === 'no-bone').length).toBeGreaterThan(0)
    expect(solved.segments.find((s) => s.side === 'l' && s.role === 'l_thigh')?.status).toBe('ok')
    expect(solved.segments.find((s) => s.side === 'l' && s.role === 'l_upperarm')?.status).toBe(
      'no-bone'
    )
  })

  it('置信度不足的关键点段被跳过', () => {
    const bones = buildBindBones()
    const keypoints: KeypointMap = {
      left_shoulder: kp(13, 10, 0.01),
      left_elbow: kp(23, 10, 0.01),
      left_hip: kp(13, 60),
      right_hip: kp(27, 60),
      left_knee: kp(13, 110),
      right_knee: kp(27, 110),
      left_ankle: kp(13, 170),
      right_ankle: kp(27, 170),
      right_shoulder: kp(27, 10),
      right_elbow: kp(17, 10),
      right_wrist: kp(7, 10)
    }
    const solved = solveImagePoseToBonePose({
      bones,
      keypoints,
      minConfidence: 0.05
    })
    const row = solved.segments.find(
      (s) => s.side === 'l' && s.role === 'l_upperarm'
    )
    expect(row?.status).toBe('no-keypoints')
  })

  it('支持 L/R 侧别后缀/前缀的自定义骨骼命名（如 Arm_L / L_UpperArm）', () => {
    const n = (name: string, parentName: string | null, x: number, y: number, z = 0): ImagePoseBindBone => ({
      name,
      parentName,
      position: { x, y, z },
      quaternion: { x: 0, y: 0, z: 0, w: 1 }
    })
    const bones: ImagePoseBindBone[] = [
      n('Root', null, 0, 0, 0),
      n('Pelvis', 'Root', 0, 0, 0),
      n('Spine', 'Pelvis', 0, 0.4, 0),
      n('Spine1', 'Spine', 0, 0.3, 0),
      n('Shoulder_L', 'Spine1', 0.15, 0.05, 0),
      n('Arm_L', 'Shoulder_L', 0, -0.05, 0),
      n('ForeArm_L', 'Arm_L', 0, -1.1, 0),
      n('Hand_L', 'ForeArm_L', 0, -0.7, 0),
      n('Shoulder_R', 'Spine1', -0.15, 0.05, 0),
      n('Arm_R', 'Shoulder_R', 0, -0.05, 0),
      n('ForeArm_R', 'Arm_R', 0, -1.1, 0),
      n('Hand_R', 'ForeArm_R', 0, -0.7, 0),
      n('UpLeg_L', 'Pelvis', 0.06, 0, 0),
      n('Leg_L', 'UpLeg_L', 0, -1.6, 0),
      n('Foot_L', 'Leg_L', 0, -1.5, 0),
      n('UpLeg_R', 'Pelvis', -0.06, 0, 0),
      n('Leg_R', 'UpLeg_R', 0, -1.6, 0),
      n('Foot_R', 'Leg_R', 0, -1.5, 0)
    ]
    const keypoints = standingKeypoints('both')
    const solved = solveImagePoseToBonePose({ bones, keypoints })
    expect(solved.drivenBones).toContain('Arm_L')
    expect(solved.drivenBones).toContain('Arm_R')
    expect(solved.segments.filter((s) => s.status === 'ok').length).toBeGreaterThanOrEqual(8)

    const map = buildThreeHierarchy(bones, solved.bonePose)
    expect(dirBetween(map, 'Arm_L', 'ForeArm_L').x).toBeCloseTo(1, 3)
    expect(dirBetween(map, 'Arm_R', 'ForeArm_R').x).toBeCloseTo(-1, 3)
    expect(dirBetween(map, 'UpLeg_L', 'Leg_L').y).toBeCloseTo(-1, 3)
    expect(dirBetween(map, 'UpLeg_R', 'Leg_R').y).toBeCloseTo(-1, 3)
  })
})
