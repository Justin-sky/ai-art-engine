import * as THREE from 'three'
import type { StageMannequinPreset } from '@shared/domain'

export interface BuiltinMannequinResult {
  root: THREE.Group
  bones: THREE.Bone[]
  clips: THREE.AnimationClip[]
}

interface BoneSpec {
  name: string
  parent?: string
  pos: [number, number, number]
  limb?: {
    kind: 'box' | 'sphere' | 'capsule'
    size: [number, number, number]
    offset: [number, number, number]
    isJoint?: boolean
  }
}

function getMannequinBoneSpecs(preset: StageMannequinPreset): BoneSpec[] {
  if (preset === 'chibi') {
    return [
      {
        name: 'Hips',
        pos: [0, 0.62, 0],
        limb: { kind: 'box', size: [0.28, 0.15, 0.18], offset: [0, 0.02, 0] }
      },
      {
        name: 'Spine',
        parent: 'Hips',
        pos: [0, 0.12, 0],
        limb: { kind: 'box', size: [0.26, 0.16, 0.17], offset: [0, 0.09, 0] }
      },
      {
        name: 'Chest',
        parent: 'Spine',
        pos: [0, 0.2, 0],
        limb: { kind: 'box', size: [0.3, 0.2, 0.19], offset: [0, 0.11, 0] }
      },
      {
        name: 'Neck',
        parent: 'Chest',
        pos: [0, 0.22, 0],
        limb: { kind: 'sphere', size: [0.075, 0.075, 0.075], offset: [0, 0.03, 0], isJoint: true }
      },
      {
        name: 'Head',
        parent: 'Neck',
        pos: [0, 0.06, 0],
        limb: { kind: 'sphere', size: [0.28, 0.28, 0.28], offset: [0, 0.24, 0] }
      },
      {
        name: 'LeftShoulder',
        parent: 'Chest',
        pos: [-0.185, 0.16, 0],
        limb: { kind: 'sphere', size: [0.06, 0.06, 0.06], offset: [0, 0, 0], isJoint: true }
      },
      {
        name: 'LeftUpperArm',
        parent: 'LeftShoulder',
        pos: [-0.045, 0, 0],
        limb: { kind: 'capsule', size: [0.056, 0.15, 0.056], offset: [0, -0.1, 0] }
      },
      {
        name: 'LeftForeArm',
        parent: 'LeftUpperArm',
        pos: [0, -0.2, 0],
        limb: { kind: 'capsule', size: [0.052, 0.14, 0.052], offset: [0, -0.09, 0] }
      },
      {
        name: 'LeftHand',
        parent: 'LeftForeArm',
        pos: [0, -0.18, 0],
        limb: { kind: 'sphere', size: [0.07, 0.07, 0.07], offset: [0, -0.04, 0] }
      },
      { name: 'LeftIndex', parent: 'LeftHand', pos: [-0.02, -0.07, 0.02] },
      { name: 'LeftThumb', parent: 'LeftHand', pos: [0.03, -0.05, 0.03] },
      {
        name: 'RightShoulder',
        parent: 'Chest',
        pos: [0.185, 0.16, 0],
        limb: { kind: 'sphere', size: [0.06, 0.06, 0.06], offset: [0, 0, 0], isJoint: true }
      },
      {
        name: 'RightUpperArm',
        parent: 'RightShoulder',
        pos: [0.045, 0, 0],
        limb: { kind: 'capsule', size: [0.056, 0.15, 0.056], offset: [0, -0.1, 0] }
      },
      {
        name: 'RightForeArm',
        parent: 'RightUpperArm',
        pos: [0, -0.2, 0],
        limb: { kind: 'capsule', size: [0.052, 0.14, 0.052], offset: [0, -0.09, 0] }
      },
      {
        name: 'RightHand',
        parent: 'RightForeArm',
        pos: [0, -0.18, 0],
        limb: { kind: 'sphere', size: [0.07, 0.07, 0.07], offset: [0, -0.04, 0] }
      },
      { name: 'RightIndex', parent: 'RightHand', pos: [0.02, -0.07, 0.02] },
      { name: 'RightThumb', parent: 'RightHand', pos: [-0.03, -0.05, 0.03] },
      {
        name: 'LeftUpLeg',
        parent: 'Hips',
        pos: [-0.105, -0.06, 0],
        limb: { kind: 'capsule', size: [0.068, 0.16, 0.068], offset: [0, -0.12, 0] }
      },
      {
        name: 'LeftLeg',
        parent: 'LeftUpLeg',
        pos: [0, -0.24, 0],
        limb: { kind: 'capsule', size: [0.062, 0.16, 0.062], offset: [0, -0.12, 0] }
      },
      {
        name: 'LeftFoot',
        parent: 'LeftLeg',
        pos: [0, -0.24, 0],
        limb: { kind: 'box', size: [0.11, 0.075, 0.19], offset: [0, -0.04, 0.04] }
      },
      {
        name: 'RightUpLeg',
        parent: 'Hips',
        pos: [0.105, -0.06, 0],
        limb: { kind: 'capsule', size: [0.068, 0.16, 0.068], offset: [0, -0.12, 0] }
      },
      {
        name: 'RightLeg',
        parent: 'RightUpLeg',
        pos: [0, -0.24, 0],
        limb: { kind: 'capsule', size: [0.062, 0.16, 0.062], offset: [0, -0.12, 0] }
      },
      {
        name: 'RightFoot',
        parent: 'RightLeg',
        pos: [0, -0.24, 0],
        limb: { kind: 'box', size: [0.11, 0.075, 0.19], offset: [0, -0.04, 0.04] }
      }
    ]
  }

  if (preset === 'quadruped') {
    return [
      {
        name: 'Hips',
        pos: [0, 0.78, -0.35],
        limb: { kind: 'box', size: [0.34, 0.3, 0.42], offset: [0, 0, 0] }
      },
      {
        name: 'Spine',
        parent: 'Hips',
        pos: [0, 0.02, 0.35],
        limb: { kind: 'box', size: [0.32, 0.28, 0.42], offset: [0, 0, 0.18] }
      },
      {
        name: 'Chest',
        parent: 'Spine',
        pos: [0, 0.04, 0.38],
        limb: { kind: 'box', size: [0.36, 0.34, 0.38], offset: [0, 0, 0.12] }
      },
      {
        name: 'Neck',
        parent: 'Chest',
        pos: [0, 0.18, 0.24],
        limb: { kind: 'capsule', size: [0.09, 0.22, 0.09], offset: [0, 0.12, 0.08] }
      },
      {
        name: 'Head',
        parent: 'Neck',
        pos: [0, 0.22, 0.14],
        limb: { kind: 'box', size: [0.24, 0.22, 0.32], offset: [0, 0.04, 0.12] }
      },
      {
        name: 'LeftShoulder',
        parent: 'Chest',
        pos: [-0.16, -0.08, 0.14],
        limb: { kind: 'sphere', size: [0.07, 0.07, 0.07], offset: [0, 0, 0], isJoint: true }
      },
      {
        name: 'LeftUpperArm',
        parent: 'LeftShoulder',
        pos: [0, -0.04, 0],
        limb: { kind: 'capsule', size: [0.065, 0.26, 0.065], offset: [0, -0.16, 0] }
      },
      {
        name: 'LeftForeArm',
        parent: 'LeftUpperArm',
        pos: [0, -0.32, 0],
        limb: { kind: 'capsule', size: [0.055, 0.24, 0.055], offset: [0, -0.15, 0] }
      },
      {
        name: 'LeftHand',
        parent: 'LeftForeArm',
        pos: [0, -0.3, 0],
        limb: { kind: 'box', size: [0.1, 0.06, 0.14], offset: [0, -0.03, 0.03] }
      },
      { name: 'LeftIndex', parent: 'LeftHand', pos: [0, -0.03, 0.08] },
      { name: 'LeftThumb', parent: 'LeftHand', pos: [0.04, -0.03, 0.05] },
      {
        name: 'RightShoulder',
        parent: 'Chest',
        pos: [0.16, -0.08, 0.14],
        limb: { kind: 'sphere', size: [0.07, 0.07, 0.07], offset: [0, 0, 0], isJoint: true }
      },
      {
        name: 'RightUpperArm',
        parent: 'RightShoulder',
        pos: [0, -0.04, 0],
        limb: { kind: 'capsule', size: [0.065, 0.26, 0.065], offset: [0, -0.16, 0] }
      },
      {
        name: 'RightForeArm',
        parent: 'RightUpperArm',
        pos: [0, -0.32, 0],
        limb: { kind: 'capsule', size: [0.055, 0.24, 0.055], offset: [0, -0.15, 0] }
      },
      {
        name: 'RightHand',
        parent: 'RightForeArm',
        pos: [0, -0.3, 0],
        limb: { kind: 'box', size: [0.1, 0.06, 0.14], offset: [0, -0.03, 0.03] }
      },
      { name: 'RightIndex', parent: 'RightHand', pos: [0, -0.03, 0.08] },
      { name: 'RightThumb', parent: 'RightHand', pos: [-0.04, -0.03, 0.05] },
      {
        name: 'LeftUpLeg',
        parent: 'Hips',
        pos: [-0.15, -0.08, -0.08],
        limb: { kind: 'capsule', size: [0.07, 0.26, 0.07], offset: [0, -0.16, 0] }
      },
      {
        name: 'LeftLeg',
        parent: 'LeftUpLeg',
        pos: [0, -0.32, 0],
        limb: { kind: 'capsule', size: [0.06, 0.24, 0.06], offset: [0, -0.15, 0] }
      },
      {
        name: 'LeftFoot',
        parent: 'LeftLeg',
        pos: [0, -0.3, 0],
        limb: { kind: 'box', size: [0.1, 0.06, 0.14], offset: [0, -0.03, 0.03] }
      },
      {
        name: 'RightUpLeg',
        parent: 'Hips',
        pos: [0.15, -0.08, -0.08],
        limb: { kind: 'capsule', size: [0.07, 0.26, 0.07], offset: [0, -0.16, 0] }
      },
      {
        name: 'RightLeg',
        parent: 'RightUpLeg',
        pos: [0, -0.32, 0],
        limb: { kind: 'capsule', size: [0.06, 0.24, 0.06], offset: [0, -0.15, 0] }
      },
      {
        name: 'RightFoot',
        parent: 'RightLeg',
        pos: [0, -0.3, 0],
        limb: { kind: 'box', size: [0.1, 0.06, 0.14], offset: [0, -0.03, 0.03] }
      }
    ]
  }

  // Default: 'humanoid' standard 1.75m proportion with articulated joint clearance
  return [
    {
      name: 'Hips',
      pos: [0, 0.94, 0],
      limb: { kind: 'box', size: [0.26, 0.14, 0.16], offset: [0, 0.02, 0] }
    },
    {
      name: 'Spine',
      parent: 'Hips',
      pos: [0, 0.12, 0],
      limb: { kind: 'box', size: [0.24, 0.18, 0.15], offset: [0, 0.1, 0] }
    },
    {
      name: 'Chest',
      parent: 'Spine',
      pos: [0, 0.22, 0],
      limb: { kind: 'box', size: [0.28, 0.24, 0.18], offset: [0, 0.13, 0] }
    },
    {
      name: 'Neck',
      parent: 'Chest',
      pos: [0, 0.28, 0],
      limb: { kind: 'capsule', size: [0.05, 0.06, 0.05], offset: [0, 0.04, 0], isJoint: true }
    },
    {
      name: 'Head',
      parent: 'Neck',
      pos: [0, 0.08, 0],
      limb: { kind: 'sphere', size: [0.13, 0.15, 0.14], offset: [0, 0.13, 0] }
    },
    {
      name: 'LeftShoulder',
      parent: 'Chest',
      pos: [-0.175, 0.21, 0],
      limb: { kind: 'sphere', size: [0.055, 0.055, 0.055], offset: [0, 0, 0], isJoint: true }
    },
    {
      name: 'LeftUpperArm',
      parent: 'LeftShoulder',
      pos: [-0.045, 0, 0],
      limb: { kind: 'capsule', size: [0.052, 0.2, 0.052], offset: [0, -0.14, 0] }
    },
    {
      name: 'LeftForeArm',
      parent: 'LeftUpperArm',
      pos: [0, -0.28, 0],
      limb: { kind: 'capsule', size: [0.046, 0.19, 0.046], offset: [0, -0.13, 0] }
    },
    {
      name: 'LeftHand',
      parent: 'LeftForeArm',
      pos: [0, -0.26, 0],
      limb: { kind: 'box', size: [0.075, 0.1, 0.038], offset: [0, -0.05, 0] }
    },
    {
      name: 'LeftIndex',
      parent: 'LeftHand',
      pos: [-0.015, -0.1, 0.01],
      limb: { kind: 'box', size: [0.025, 0.06, 0.025], offset: [0, -0.03, 0] }
    },
    {
      name: 'LeftThumb',
      parent: 'LeftHand',
      pos: [0.035, -0.05, 0.02],
      limb: { kind: 'box', size: [0.025, 0.05, 0.025], offset: [0, -0.02, 0] }
    },
    {
      name: 'RightShoulder',
      parent: 'Chest',
      pos: [0.175, 0.21, 0],
      limb: { kind: 'sphere', size: [0.055, 0.055, 0.055], offset: [0, 0, 0], isJoint: true }
    },
    {
      name: 'RightUpperArm',
      parent: 'RightShoulder',
      pos: [0.045, 0, 0],
      limb: { kind: 'capsule', size: [0.052, 0.2, 0.052], offset: [0, -0.14, 0] }
    },
    {
      name: 'RightForeArm',
      parent: 'RightUpperArm',
      pos: [0, -0.28, 0],
      limb: { kind: 'capsule', size: [0.046, 0.19, 0.046], offset: [0, -0.13, 0] }
    },
    {
      name: 'RightHand',
      parent: 'RightForeArm',
      pos: [0, -0.26, 0],
      limb: { kind: 'box', size: [0.075, 0.1, 0.038], offset: [0, -0.05, 0] }
    },
    {
      name: 'RightIndex',
      parent: 'RightHand',
      pos: [0.015, -0.1, 0.01],
      limb: { kind: 'box', size: [0.025, 0.06, 0.025], offset: [0, -0.03, 0] }
    },
    {
      name: 'RightThumb',
      parent: 'RightHand',
      pos: [-0.035, -0.05, 0.02],
      limb: { kind: 'box', size: [0.025, 0.05, 0.025], offset: [0, -0.02, 0] }
    },
    {
      name: 'LeftUpLeg',
      parent: 'Hips',
      pos: [-0.105, -0.06, 0],
      limb: { kind: 'capsule', size: [0.068, 0.3, 0.068], offset: [0, -0.21, 0] }
    },
    {
      name: 'LeftLeg',
      parent: 'LeftUpLeg',
      pos: [0, -0.42, 0],
      limb: { kind: 'capsule', size: [0.058, 0.32, 0.058], offset: [0, -0.21, 0] }
    },
    {
      name: 'LeftFoot',
      parent: 'LeftLeg',
      pos: [0, -0.42, 0],
      limb: { kind: 'box', size: [0.095, 0.065, 0.21], offset: [0, -0.03, 0.05] }
    },
    {
      name: 'RightUpLeg',
      parent: 'Hips',
      pos: [0.105, -0.06, 0],
      limb: { kind: 'capsule', size: [0.068, 0.3, 0.068], offset: [0, -0.21, 0] }
    },
    {
      name: 'RightLeg',
      parent: 'RightUpLeg',
      pos: [0, -0.42, 0],
      limb: { kind: 'capsule', size: [0.058, 0.32, 0.058], offset: [0, -0.21, 0] }
    },
    {
      name: 'RightFoot',
      parent: 'RightLeg',
      pos: [0, -0.42, 0],
      limb: { kind: 'box', size: [0.095, 0.065, 0.21], offset: [0, -0.03, 0.05] }
    }
  ]
}

function buildLimbGeometry(limb: NonNullable<BoneSpec['limb']>): THREE.BufferGeometry {
  const [sx, sy, sz] = limb.size
  let geo: THREE.BufferGeometry
  if (limb.kind === 'sphere') {
    geo = new THREE.SphereGeometry(1, 18, 14)
    geo.scale(sx, sy, sz)
  } else if (limb.kind === 'capsule') {
    geo = new THREE.CapsuleGeometry(sx, Math.max(0.02, sy), 8, 14)
  } else {
    geo = new THREE.BoxGeometry(sx, sy, sz)
  }
  geo.translate(limb.offset[0], limb.offset[1], limb.offset[2])
  return geo
}

function quatTrackFromEulerKeyframes(
  boneName: string,
  times: number[],
  eulers: Array<[number, number, number]>
): THREE.QuaternionKeyframeTrack {
  const values: number[] = []
  const euler = new THREE.Euler()
  const quat = new THREE.Quaternion()
  for (const [rx, ry, rz] of eulers) {
    euler.set(rx, ry, rz, 'XYZ')
    quat.setFromEuler(euler)
    values.push(quat.x, quat.y, quat.z, quat.w)
  }
  return new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, values)
}

function vecTrackFromKeyframes(
  boneName: string,
  times: number[],
  positions: Array<[number, number, number]>
): THREE.VectorKeyframeTrack {
  const values: number[] = []
  for (const [px, py, pz] of positions) {
    values.push(px, py, pz)
  }
  return new THREE.VectorKeyframeTrack(`${boneName}.position`, times, values)
}

/**
 * 生成内置程序化骨骼动画片段（涵盖日常与戏剧常用 24 种动作），无需外部资产即可直接挂上时间轴播放。
 * 注意：手臂/腿部沿 -Y 轴下垂，右手定则下绕 +Z 旋转会将 -Y 摆向 +X：
 * - 左臂（位于 -X 侧）外展（远离躯干）需要 rz < 0；
 * - 右臂（位于 +X 侧）外展（远离躯干）需要 rz > 0。
 */
export function buildBuiltinMannequinClips(): THREE.AnimationClip[] {
  // 1. Idle (待机呼吸 2.4s)
  const idleTimes = [0, 1.2, 2.4]
  const idleClip = new THREE.AnimationClip('Idle', 2.4, [
    quatTrackFromEulerKeyframes('Spine', idleTimes, [
      [0.02, 0, 0],
      [0.05, 0.02, 0],
      [0.02, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('Chest', idleTimes, [
      [0, 0, 0],
      [0.03, -0.02, 0],
      [0, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('Head', idleTimes, [
      [0, 0, 0],
      [-0.04, 0.05, 0],
      [0, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpperArm', idleTimes, [
      [0.04, 0, -0.12],
      [0.08, 0, -0.15],
      [0.04, 0, -0.12]
    ]),
    quatTrackFromEulerKeyframes('RightUpperArm', idleTimes, [
      [0.04, 0, 0.12],
      [0.08, 0, 0.15],
      [0.04, 0, 0.12]
    ]),
    quatTrackFromEulerKeyframes('LeftForeArm', idleTimes, [
      [-0.12, 0, 0],
      [-0.16, 0, 0],
      [-0.12, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightForeArm', idleTimes, [
      [-0.12, 0, 0],
      [-0.16, 0, 0],
      [-0.12, 0, 0]
    ])
  ])

  // 2. Walk (日常行走 1.2s)
  const walkTimes = [0, 0.3, 0.6, 0.9, 1.2]
  const walkClip = new THREE.AnimationClip('Walk', 1.2, [
    vecTrackFromKeyframes('Hips', walkTimes, [
      [0, 0.92, 0],
      [0, 0.96, 0],
      [0, 0.92, 0],
      [0, 0.96, 0],
      [0, 0.92, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpLeg', walkTimes, [
      [-0.45, 0, 0],
      [0, 0, 0],
      [0.42, 0, 0],
      [0, 0, 0],
      [-0.45, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftLeg', walkTimes, [
      [0.15, 0, 0],
      [0.55, 0, 0],
      [0.1, 0, 0],
      [0.05, 0, 0],
      [0.15, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightUpLeg', walkTimes, [
      [0.42, 0, 0],
      [0, 0, 0],
      [-0.45, 0, 0],
      [0, 0, 0],
      [0.42, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightLeg', walkTimes, [
      [0.1, 0, 0],
      [0.05, 0, 0],
      [0.15, 0, 0],
      [0.55, 0, 0],
      [0.1, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpperArm', walkTimes, [
      [0.35, 0, -0.12],
      [0, 0, -0.12],
      [-0.35, 0, -0.12],
      [0, 0, -0.12],
      [0.35, 0, -0.12]
    ]),
    quatTrackFromEulerKeyframes('RightUpperArm', walkTimes, [
      [-0.35, 0, 0.12],
      [0, 0, 0.12],
      [0.35, 0, 0.12],
      [0, 0, 0.12],
      [-0.35, 0, 0.12]
    ]),
    quatTrackFromEulerKeyframes('LeftForeArm', walkTimes, [
      [-0.25, 0, 0],
      [-0.35, 0, 0],
      [-0.45, 0, 0],
      [-0.35, 0, 0],
      [-0.25, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightForeArm', walkTimes, [
      [-0.45, 0, 0],
      [-0.35, 0, 0],
      [-0.25, 0, 0],
      [-0.35, 0, 0],
      [-0.45, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('Spine', walkTimes, [
      [0.05, -0.06, 0],
      [0.06, 0, 0],
      [0.05, 0.06, 0],
      [0.06, 0, 0],
      [0.05, -0.06, 0]
    ])
  ])

  // 3. Run (慢跑/奔跑 0.8s)
  const runTimes = [0, 0.2, 0.4, 0.6, 0.8]
  const runClip = new THREE.AnimationClip('Run', 0.8, [
    vecTrackFromKeyframes('Hips', runTimes, [
      [0, 0.89, 0],
      [0, 0.99, 0],
      [0, 0.89, 0],
      [0, 0.99, 0],
      [0, 0.89, 0]
    ]),
    quatTrackFromEulerKeyframes('Spine', runTimes, [
      [0.18, -0.08, 0],
      [0.2, 0, 0],
      [0.18, 0.08, 0],
      [0.2, 0, 0],
      [0.18, -0.08, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpLeg', runTimes, [
      [-0.78, 0, 0],
      [0.1, 0, 0],
      [0.68, 0, 0],
      [-0.1, 0, 0],
      [-0.78, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftLeg', runTimes, [
      [0.25, 0, 0],
      [1.05, 0, 0],
      [0.2, 0, 0],
      [0.1, 0, 0],
      [0.25, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightUpLeg', runTimes, [
      [0.68, 0, 0],
      [-0.1, 0, 0],
      [-0.78, 0, 0],
      [0.1, 0, 0],
      [0.68, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightLeg', runTimes, [
      [0.2, 0, 0],
      [0.1, 0, 0],
      [0.25, 0, 0],
      [1.05, 0, 0],
      [0.2, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpperArm', runTimes, [
      [0.65, 0, -0.16],
      [0, 0, -0.16],
      [-0.65, 0, -0.16],
      [0, 0, -0.16],
      [0.65, 0, -0.16]
    ]),
    quatTrackFromEulerKeyframes('RightUpperArm', runTimes, [
      [-0.65, 0, 0.16],
      [0, 0, 0.16],
      [0.65, 0, 0.16],
      [0, 0, 0.16],
      [-0.65, 0, 0.16]
    ]),
    quatTrackFromEulerKeyframes('LeftForeArm', runTimes, [
      [-0.85, 0, 0],
      [-0.95, 0, 0],
      [-1.05, 0, 0],
      [-0.95, 0, 0],
      [-0.85, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightForeArm', runTimes, [
      [-1.05, 0, 0],
      [-0.95, 0, 0],
      [-0.85, 0, 0],
      [-0.95, 0, 0],
      [-1.05, 0, 0]
    ])
  ])

  // 4. Sprint (全速冲刺 0.6s)
  const sprintTimes = [0, 0.15, 0.3, 0.45, 0.6]
  const sprintClip = new THREE.AnimationClip('Sprint', 0.6, [
    vecTrackFromKeyframes('Hips', sprintTimes, [
      [0, 0.86, 0],
      [0, 1.02, 0],
      [0, 0.86, 0],
      [0, 1.02, 0],
      [0, 0.86, 0]
    ]),
    quatTrackFromEulerKeyframes('Spine', sprintTimes, [
      [0.32, -0.12, 0],
      [0.35, 0, 0],
      [0.32, 0.12, 0],
      [0.35, 0, 0],
      [0.32, -0.12, 0]
    ]),
    quatTrackFromEulerKeyframes('Chest', sprintTimes, [
      [0.12, -0.06, 0],
      [0.14, 0, 0],
      [0.12, 0.06, 0],
      [0.14, 0, 0],
      [0.12, -0.06, 0]
    ]),
    quatTrackFromEulerKeyframes('Head', sprintTimes, [
      [-0.22, 0, 0],
      [-0.25, 0, 0],
      [-0.22, 0, 0],
      [-0.25, 0, 0],
      [-0.22, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpLeg', sprintTimes, [
      [-1.05, 0, 0],
      [0.15, 0, 0],
      [0.85, 0, 0],
      [-0.2, 0, 0],
      [-1.05, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftLeg', sprintTimes, [
      [0.35, 0, 0],
      [1.35, 0, 0],
      [0.25, 0, 0],
      [0.15, 0, 0],
      [0.35, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightUpLeg', sprintTimes, [
      [0.85, 0, 0],
      [-0.2, 0, 0],
      [-1.05, 0, 0],
      [0.15, 0, 0],
      [0.85, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightLeg', sprintTimes, [
      [0.25, 0, 0],
      [0.15, 0, 0],
      [0.35, 0, 0],
      [1.35, 0, 0],
      [0.25, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpperArm', sprintTimes, [
      [0.85, 0, -0.18],
      [0, 0, -0.18],
      [-0.88, 0, -0.18],
      [0, 0, -0.18],
      [0.85, 0, -0.18]
    ]),
    quatTrackFromEulerKeyframes('RightUpperArm', sprintTimes, [
      [-0.88, 0, 0.18],
      [0, 0, 0.18],
      [0.85, 0, 0.18],
      [0, 0, 0.18],
      [-0.88, 0, 0.18]
    ]),
    quatTrackFromEulerKeyframes('LeftForeArm', sprintTimes, [
      [-1.1, 0, 0],
      [-1.2, 0, 0],
      [-1.3, 0, 0],
      [-1.2, 0, 0],
      [-1.1, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightForeArm', sprintTimes, [
      [-1.3, 0, 0],
      [-1.2, 0, 0],
      [-1.1, 0, 0],
      [-1.2, 0, 0],
      [-1.3, 0, 0]
    ])
  ])

  // 5. Jump (蓄力跳跃与缓冲落地 1.4s)
  const jumpTimes = [0, 0.35, 0.7, 1.05, 1.4]
  const jumpClip = new THREE.AnimationClip('Jump', 1.4, [
    vecTrackFromKeyframes('Hips', jumpTimes, [
      [0, 0.94, 0],
      [0, 0.68, 0],
      [0, 1.42, 0],
      [0, 0.72, 0],
      [0, 0.94, 0]
    ]),
    quatTrackFromEulerKeyframes('Spine', jumpTimes, [
      [0.04, 0, 0],
      [0.32, 0, 0],
      [-0.12, 0, 0],
      [0.26, 0, 0],
      [0.04, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('Head', jumpTimes, [
      [0, 0, 0],
      [-0.18, 0, 0],
      [-0.15, 0, 0],
      [-0.12, 0, 0],
      [0, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpLeg', jumpTimes, [
      [0, 0, 0],
      [-0.82, 0, -0.06],
      [-0.48, 0, -0.08],
      [-0.75, 0, -0.06],
      [0, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightUpLeg', jumpTimes, [
      [0, 0, 0],
      [-0.82, 0, 0.06],
      [-0.48, 0, 0.08],
      [-0.75, 0, 0.06],
      [0, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftLeg', jumpTimes, [
      [0.06, 0, 0],
      [1.25, 0, 0],
      [0.65, 0, 0],
      [1.15, 0, 0],
      [0.06, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightLeg', jumpTimes, [
      [0.06, 0, 0],
      [1.25, 0, 0],
      [0.65, 0, 0],
      [1.15, 0, 0],
      [0.06, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpperArm', jumpTimes, [
      [0.05, 0, -0.14],
      [0.55, 0, -0.22],
      [-0.85, 0, -1.35],
      [-0.25, 0, -0.35],
      [0.05, 0, -0.14]
    ]),
    quatTrackFromEulerKeyframes('RightUpperArm', jumpTimes, [
      [0.05, 0, 0.14],
      [0.55, 0, 0.22],
      [-0.85, 0, 1.35],
      [-0.25, 0, 0.35],
      [0.05, 0, 0.14]
    ]),
    quatTrackFromEulerKeyframes('LeftForeArm', jumpTimes, [
      [-0.15, 0, 0],
      [-0.45, 0, 0],
      [-0.35, 0, 0],
      [-0.55, 0, 0],
      [-0.15, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightForeArm', jumpTimes, [
      [-0.15, 0, 0],
      [-0.45, 0, 0],
      [-0.35, 0, 0],
      [-0.55, 0, 0],
      [-0.15, 0, 0]
    ])
  ])

  // 6. Sit (日常端坐椅上呼吸 2.4s)
  const sitTimes = [0, 1.2, 2.4]
  const sitClip = new THREE.AnimationClip('Sit', 2.4, [
    vecTrackFromKeyframes('Hips', sitTimes, [
      [0, 0.52, -0.08],
      [0, 0.53, -0.08],
      [0, 0.52, -0.08]
    ]),
    quatTrackFromEulerKeyframes('Spine', sitTimes, [
      [0.04, 0, 0],
      [0.07, 0.02, 0],
      [0.04, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('Head', sitTimes, [
      [0.02, 0, 0],
      [-0.03, 0.05, 0],
      [0.02, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpLeg', sitTimes, [
      [-1.48, 0.06, -0.06],
      [-1.48, 0.06, -0.06],
      [-1.48, 0.06, -0.06]
    ]),
    quatTrackFromEulerKeyframes('RightUpLeg', sitTimes, [
      [-1.48, -0.06, 0.06],
      [-1.48, -0.06, 0.06],
      [-1.48, -0.06, 0.06]
    ]),
    quatTrackFromEulerKeyframes('LeftLeg', sitTimes, [
      [1.48, 0, 0],
      [1.45, 0, 0],
      [1.48, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightLeg', sitTimes, [
      [1.48, 0, 0],
      [1.45, 0, 0],
      [1.48, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpperArm', sitTimes, [
      [-0.22, 0, -0.14],
      [-0.25, 0, -0.16],
      [-0.22, 0, -0.14]
    ]),
    quatTrackFromEulerKeyframes('RightUpperArm', sitTimes, [
      [-0.22, 0, 0.14],
      [-0.25, 0, 0.16],
      [-0.22, 0, 0.14]
    ]),
    quatTrackFromEulerKeyframes('LeftForeArm', sitTimes, [
      [-0.65, 0, 0],
      [-0.68, 0, 0],
      [-0.65, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightForeArm', sitTimes, [
      [-0.65, 0, 0],
      [-0.68, 0, 0],
      [-0.65, 0, 0]
    ])
  ])

  // 7. SitFloor (席地盘坐/冥想 2.6s)
  const sitFloorTimes = [0, 1.3, 2.6]
  const sitFloorClip = new THREE.AnimationClip('SitFloor', 2.6, [
    vecTrackFromKeyframes('Hips', sitFloorTimes, [
      [0, 0.18, 0],
      [0, 0.19, 0],
      [0, 0.18, 0]
    ]),
    quatTrackFromEulerKeyframes('Spine', sitFloorTimes, [
      [0.06, 0, 0],
      [0.03, 0, 0],
      [0.06, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('Head', sitFloorTimes, [
      [0.05, 0, 0],
      [0.01, 0, 0],
      [0.05, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpLeg', sitFloorTimes, [
      [-1.35, -0.55, -0.65],
      [-1.35, -0.55, -0.65],
      [-1.35, -0.55, -0.65]
    ]),
    quatTrackFromEulerKeyframes('RightUpLeg', sitFloorTimes, [
      [-1.35, 0.55, 0.65],
      [-1.35, 0.55, 0.65],
      [-1.35, 0.55, 0.65]
    ]),
    quatTrackFromEulerKeyframes('LeftLeg', sitFloorTimes, [
      [1.75, 0, 0],
      [1.75, 0, 0],
      [1.75, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightLeg', sitFloorTimes, [
      [1.75, 0, 0],
      [1.75, 0, 0],
      [1.75, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpperArm', sitFloorTimes, [
      [-0.18, 0, -0.22],
      [-0.2, 0, -0.24],
      [-0.18, 0, -0.22]
    ]),
    quatTrackFromEulerKeyframes('RightUpperArm', sitFloorTimes, [
      [-0.18, 0, 0.22],
      [-0.2, 0, 0.24],
      [-0.18, 0, 0.22]
    ]),
    quatTrackFromEulerKeyframes('LeftForeArm', sitFloorTimes, [
      [-0.55, 0, 0],
      [-0.58, 0, 0],
      [-0.55, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightForeArm', sitFloorTimes, [
      [-0.55, 0, 0],
      [-0.58, 0, 0],
      [-0.55, 0, 0]
    ])
  ])

  // 8. Crouch (潜行下蹲 2.0s)
  const crouchTimes = [0, 1.0, 2.0]
  const crouchClip = new THREE.AnimationClip('Crouch', 2.0, [
    vecTrackFromKeyframes('Hips', crouchTimes, [
      [0, 0.48, 0],
      [0, 0.44, 0],
      [0, 0.48, 0]
    ]),
    quatTrackFromEulerKeyframes('Spine', crouchTimes, [
      [0.36, 0, 0],
      [0.42, 0, 0],
      [0.36, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('Head', crouchTimes, [
      [-0.28, -0.1, 0],
      [-0.32, 0.1, 0],
      [-0.28, -0.1, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpLeg', crouchTimes, [
      [-1.32, 0, -0.12],
      [-1.38, 0, -0.12],
      [-1.32, 0, -0.12]
    ]),
    quatTrackFromEulerKeyframes('RightUpLeg', crouchTimes, [
      [-1.32, 0, 0.12],
      [-1.38, 0, 0.12],
      [-1.32, 0, 0.12]
    ]),
    quatTrackFromEulerKeyframes('LeftLeg', crouchTimes, [
      [1.82, 0, 0],
      [1.9, 0, 0],
      [1.82, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightLeg', crouchTimes, [
      [1.82, 0, 0],
      [1.9, 0, 0],
      [1.82, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpperArm', crouchTimes, [
      [-0.45, 0, -0.22],
      [-0.52, 0, -0.24],
      [-0.45, 0, -0.22]
    ]),
    quatTrackFromEulerKeyframes('RightUpperArm', crouchTimes, [
      [-0.45, 0, 0.22],
      [-0.52, 0, 0.24],
      [-0.45, 0, 0.22]
    ]),
    quatTrackFromEulerKeyframes('LeftForeArm', crouchTimes, [
      [-0.65, 0, 0],
      [-0.72, 0, 0],
      [-0.65, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightForeArm', crouchTimes, [
      [-0.65, 0, 0],
      [-0.72, 0, 0],
      [-0.65, 0, 0]
    ])
  ])

  // 9. Kneel (单膝跪地 2.2s)
  const kneelTimes = [0, 1.1, 2.2]
  const kneelClip = new THREE.AnimationClip('Kneel', 2.2, [
    vecTrackFromKeyframes('Hips', kneelTimes, [
      [0, 0.54, 0],
      [0, 0.52, 0],
      [0, 0.54, 0]
    ]),
    quatTrackFromEulerKeyframes('Spine', kneelTimes, [
      [0.14, 0, 0],
      [0.18, 0, 0],
      [0.14, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('Head', kneelTimes, [
      [0.12, 0, 0],
      [0.06, 0, 0],
      [0.12, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpLeg', kneelTimes, [
      [-1.42, 0, -0.06],
      [-1.45, 0, -0.06],
      [-1.42, 0, -0.06]
    ]),
    quatTrackFromEulerKeyframes('LeftLeg', kneelTimes, [
      [1.45, 0, 0],
      [1.48, 0, 0],
      [1.45, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightUpLeg', kneelTimes, [
      [0.18, 0, 0.04],
      [0.2, 0, 0.04],
      [0.18, 0, 0.04]
    ]),
    quatTrackFromEulerKeyframes('RightLeg', kneelTimes, [
      [1.62, 0, 0],
      [1.65, 0, 0],
      [1.62, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpperArm', kneelTimes, [
      [-0.45, 0, -0.18],
      [-0.48, 0, -0.2],
      [-0.45, 0, -0.18]
    ]),
    quatTrackFromEulerKeyframes('RightUpperArm', kneelTimes, [
      [0.15, 0, 0.2],
      [0.18, 0, 0.22],
      [0.15, 0, 0.2]
    ]),
    quatTrackFromEulerKeyframes('LeftForeArm', kneelTimes, [
      [-0.65, 0, 0],
      [-0.68, 0, 0],
      [-0.65, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightForeArm', kneelTimes, [
      [-0.35, 0, 0],
      [-0.38, 0, 0],
      [-0.35, 0, 0]
    ])
  ])

  // 10. LieDown (仰卧平躺呼吸 2.8s)
  const lieTimes = [0, 1.4, 2.8]
  const lieDownClip = new THREE.AnimationClip('LieDown', 2.8, [
    vecTrackFromKeyframes('Hips', lieTimes, [
      [0, 0.14, 0],
      [0, 0.15, 0],
      [0, 0.14, 0]
    ]),
    quatTrackFromEulerKeyframes('Hips', lieTimes, [
      [-1.52, 0, 0],
      [-1.52, 0, 0],
      [-1.52, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('Spine', lieTimes, [
      [0.04, 0, 0],
      [0.08, 0, 0],
      [0.04, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('Head', lieTimes, [
      [0.12, 0.06, 0],
      [0.14, -0.04, 0],
      [0.12, 0.06, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpLeg', lieTimes, [
      [0.04, 0, -0.08],
      [0.04, 0, -0.08],
      [0.04, 0, -0.08]
    ]),
    quatTrackFromEulerKeyframes('RightUpLeg', lieTimes, [
      [0.04, 0, 0.08],
      [0.04, 0, 0.08],
      [0.04, 0, 0.08]
    ]),
    quatTrackFromEulerKeyframes('LeftUpperArm', lieTimes, [
      [0.05, 0, -0.24],
      [0.06, 0, -0.26],
      [0.05, 0, -0.24]
    ]),
    quatTrackFromEulerKeyframes('RightUpperArm', lieTimes, [
      [0.05, 0, 0.24],
      [0.06, 0, 0.26],
      [0.05, 0, 0.24]
    ]),
    quatTrackFromEulerKeyframes('LeftForeArm', lieTimes, [
      [-0.18, 0, 0],
      [-0.22, 0, 0],
      [-0.18, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightForeArm', lieTimes, [
      [-0.18, 0, 0],
      [-0.22, 0, 0],
      [-0.18, 0, 0]
    ])
  ])

  // 11. Wave (挥手致意 1.6s)
  const waveTimes = [0, 0.4, 0.8, 1.2, 1.6]
  const waveClip = new THREE.AnimationClip('Wave', 1.6, [
    quatTrackFromEulerKeyframes('LeftUpperArm', waveTimes, [
      [0.04, 0, -0.12],
      [0.06, 0, -0.14],
      [0.04, 0, -0.12],
      [0.06, 0, -0.14],
      [0.04, 0, -0.12]
    ]),
    quatTrackFromEulerKeyframes('LeftForeArm', waveTimes, [
      [-0.14, 0, 0],
      [-0.16, 0, 0],
      [-0.14, 0, 0],
      [-0.16, 0, 0],
      [-0.14, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightUpperArm', waveTimes, [
      [0.15, 0, 2.05],
      [0.15, 0, 2.18],
      [0.15, 0, 2.05],
      [0.15, 0, 2.18],
      [0.15, 0, 2.05]
    ]),
    quatTrackFromEulerKeyframes('RightForeArm', waveTimes, [
      [-0.15, 0, 0.55],
      [-0.15, 0, 1.02],
      [-0.15, 0, 0.55],
      [-0.15, 0, 1.02],
      [-0.15, 0, 0.55]
    ]),
    quatTrackFromEulerKeyframes('Head', waveTimes, [
      [-0.05, -0.1, 0.06],
      [-0.05, -0.1, -0.04],
      [-0.05, -0.1, 0.06],
      [-0.05, -0.1, -0.04],
      [-0.05, -0.1, 0.06]
    ])
  ])

  // 12. Bow (鞠躬行礼 2.0s)
  const bowTimes = [0, 0.7, 1.3, 2.0]
  const bowClip = new THREE.AnimationClip('Bow', 2.0, [
    quatTrackFromEulerKeyframes('Spine', bowTimes, [
      [0.02, 0, 0],
      [0.52, 0, 0],
      [0.52, 0, 0],
      [0.02, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('Chest', bowTimes, [
      [0, 0, 0],
      [0.24, 0, 0],
      [0.24, 0, 0],
      [0, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('Head', bowTimes, [
      [0, 0, 0],
      [0.18, 0, 0],
      [0.18, 0, 0],
      [0, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpperArm', bowTimes, [
      [0.04, 0, -0.14],
      [-0.15, 0, -0.16],
      [-0.15, 0, -0.16],
      [0.04, 0, -0.14]
    ]),
    quatTrackFromEulerKeyframes('RightUpperArm', bowTimes, [
      [0.04, 0, 0.14],
      [-0.15, 0, 0.16],
      [-0.15, 0, 0.16],
      [0.04, 0, 0.14]
    ]),
    quatTrackFromEulerKeyframes('LeftForeArm', bowTimes, [
      [-0.15, 0, 0],
      [-0.28, 0, 0],
      [-0.28, 0, 0],
      [-0.15, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightForeArm', bowTimes, [
      [-0.15, 0, 0],
      [-0.28, 0, 0],
      [-0.28, 0, 0],
      [-0.15, 0, 0]
    ])
  ])

  // 13. Clap (鼓掌喝彩 1.2s)
  const clapTimes = [0, 0.3, 0.6, 0.9, 1.2]
  const clapClip = new THREE.AnimationClip('Clap', 1.2, [
    quatTrackFromEulerKeyframes('Spine', clapTimes, [
      [0.03, 0, 0],
      [0.06, 0, 0],
      [0.03, 0, 0],
      [0.06, 0, 0],
      [0.03, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('Head', clapTimes, [
      [-0.04, 0, 0.03],
      [-0.08, 0, -0.03],
      [-0.04, 0, 0.03],
      [-0.08, 0, -0.03],
      [-0.04, 0, 0.03]
    ]),
    quatTrackFromEulerKeyframes('LeftUpperArm', clapTimes, [
      [-0.65, 0, -0.22],
      [-0.65, 0, -0.14],
      [-0.65, 0, -0.22],
      [-0.65, 0, -0.14],
      [-0.65, 0, -0.22]
    ]),
    quatTrackFromEulerKeyframes('RightUpperArm', clapTimes, [
      [-0.65, 0, 0.22],
      [-0.65, 0, 0.14],
      [-0.65, 0, 0.22],
      [-0.65, 0, 0.14],
      [-0.65, 0, 0.22]
    ]),
    quatTrackFromEulerKeyframes('LeftForeArm', clapTimes, [
      [-1.15, 0, 0.15],
      [-1.15, 0, 0.42],
      [-1.15, 0, 0.15],
      [-1.15, 0, 0.42],
      [-1.15, 0, 0.15]
    ]),
    quatTrackFromEulerKeyframes('RightForeArm', clapTimes, [
      [-1.15, 0, -0.15],
      [-1.15, 0, -0.42],
      [-1.15, 0, -0.15],
      [-1.15, 0, -0.42],
      [-1.15, 0, -0.15]
    ])
  ])

  // 14. Cheer (双臂高举欢呼 1.4s)
  const cheerTimes = [0, 0.35, 0.7, 1.05, 1.4]
  const cheerClip = new THREE.AnimationClip('Cheer', 1.4, [
    vecTrackFromKeyframes('Hips', cheerTimes, [
      [0, 0.94, 0],
      [0, 1.04, 0],
      [0, 0.92, 0],
      [0, 1.04, 0],
      [0, 0.94, 0]
    ]),
    quatTrackFromEulerKeyframes('Spine', cheerTimes, [
      [-0.08, 0, 0],
      [-0.14, 0, 0],
      [-0.08, 0, 0],
      [-0.14, 0, 0],
      [-0.08, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('Head', cheerTimes, [
      [-0.15, 0, 0.04],
      [-0.22, 0, -0.04],
      [-0.15, 0, 0.04],
      [-0.22, 0, -0.04],
      [-0.15, 0, 0.04]
    ]),
    quatTrackFromEulerKeyframes('LeftUpperArm', cheerTimes, [
      [-0.2, 0, -2.15],
      [-0.2, 0, -2.35],
      [-0.2, 0, -2.15],
      [-0.2, 0, -2.35],
      [-0.2, 0, -2.15]
    ]),
    quatTrackFromEulerKeyframes('RightUpperArm', cheerTimes, [
      [-0.2, 0, 2.15],
      [-0.2, 0, 2.35],
      [-0.2, 0, 2.15],
      [-0.2, 0, 2.35],
      [-0.2, 0, 2.15]
    ]),
    quatTrackFromEulerKeyframes('LeftForeArm', cheerTimes, [
      [-0.25, 0, -0.2],
      [-0.45, 0, -0.35],
      [-0.25, 0, -0.2],
      [-0.45, 0, -0.35],
      [-0.25, 0, -0.2]
    ]),
    quatTrackFromEulerKeyframes('RightForeArm', cheerTimes, [
      [-0.25, 0, 0.2],
      [-0.45, 0, 0.35],
      [-0.25, 0, 0.2],
      [-0.45, 0, 0.35],
      [-0.25, 0, 0.2]
    ]),
    quatTrackFromEulerKeyframes('LeftUpLeg', cheerTimes, [
      [0, 0, -0.08],
      [-0.18, 0, -0.1],
      [0, 0, -0.08],
      [-0.18, 0, -0.1],
      [0, 0, -0.08]
    ]),
    quatTrackFromEulerKeyframes('RightUpLeg', cheerTimes, [
      [0, 0, 0.08],
      [-0.18, 0, 0.1],
      [0, 0, 0.08],
      [-0.18, 0, 0.1],
      [0, 0, 0.08]
    ])
  ])

  // 15. Dance (律动舞蹈 1.6s)
  const danceTimes = [0, 0.4, 0.8, 1.2, 1.6]
  const danceClip = new THREE.AnimationClip('Dance', 1.6, [
    vecTrackFromKeyframes('Hips', danceTimes, [
      [-0.06, 0.91, 0],
      [0, 0.96, 0],
      [0.06, 0.91, 0],
      [0, 0.96, 0],
      [-0.06, 0.91, 0]
    ]),
    quatTrackFromEulerKeyframes('Spine', danceTimes, [
      [0.06, -0.18, 0.08],
      [0.04, 0, 0],
      [0.06, 0.18, -0.08],
      [0.04, 0, 0],
      [0.06, -0.18, 0.08]
    ]),
    quatTrackFromEulerKeyframes('Head', danceTimes, [
      [-0.05, 0.12, -0.08],
      [0.04, 0, 0],
      [-0.05, -0.12, 0.08],
      [0.04, 0, 0],
      [-0.05, 0.12, -0.08]
    ]),
    quatTrackFromEulerKeyframes('LeftUpperArm', danceTimes, [
      [-0.55, 0, -1.65],
      [-0.45, 0, -0.45],
      [-0.55, 0, -0.35],
      [-0.45, 0, -0.95],
      [-0.55, 0, -1.65]
    ]),
    quatTrackFromEulerKeyframes('RightUpperArm', danceTimes, [
      [-0.55, 0, 0.35],
      [-0.45, 0, 0.95],
      [-0.55, 0, 1.65],
      [-0.45, 0, 0.45],
      [-0.55, 0, 0.35]
    ]),
    quatTrackFromEulerKeyframes('LeftForeArm', danceTimes, [
      [-0.65, 0, 0],
      [-0.95, 0, 0],
      [-0.85, 0, 0],
      [-0.75, 0, 0],
      [-0.65, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightForeArm', danceTimes, [
      [-0.85, 0, 0],
      [-0.75, 0, 0],
      [-0.65, 0, 0],
      [-0.95, 0, 0],
      [-0.85, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpLeg', danceTimes, [
      [-0.25, 0, -0.12],
      [0, 0, -0.06],
      [-0.1, 0, -0.06],
      [0, 0, -0.06],
      [-0.25, 0, -0.12]
    ]),
    quatTrackFromEulerKeyframes('RightUpLeg', danceTimes, [
      [-0.1, 0, 0.06],
      [0, 0, 0.06],
      [-0.25, 0, 0.12],
      [0, 0, 0.06],
      [-0.1, 0, 0.06]
    ]),
    quatTrackFromEulerKeyframes('LeftLeg', danceTimes, [
      [0.45, 0, 0],
      [0.12, 0, 0],
      [0.2, 0, 0],
      [0.12, 0, 0],
      [0.45, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightLeg', danceTimes, [
      [0.2, 0, 0],
      [0.12, 0, 0],
      [0.45, 0, 0],
      [0.12, 0, 0],
      [0.2, 0, 0]
    ])
  ])

  // 16. Talk (自然交谈手势 2.0s)
  const talkTimes = [0, 0.5, 1.0, 1.5, 2.0]
  const talkClip = new THREE.AnimationClip('Talk', 2.0, [
    quatTrackFromEulerKeyframes('Spine', talkTimes, [
      [0.03, -0.05, 0],
      [0.05, 0.04, 0],
      [0.04, -0.03, 0],
      [0.05, 0.05, 0],
      [0.03, -0.05, 0]
    ]),
    quatTrackFromEulerKeyframes('Head', talkTimes, [
      [-0.04, 0.08, 0.03],
      [0.05, -0.06, -0.02],
      [-0.06, 0.04, 0.04],
      [0.04, -0.08, 0],
      [-0.04, 0.08, 0.03]
    ]),
    quatTrackFromEulerKeyframes('LeftUpperArm', talkTimes, [
      [-0.35, 0, -0.22],
      [-0.48, 0, -0.32],
      [-0.38, 0, -0.24],
      [-0.52, 0, -0.28],
      [-0.35, 0, -0.22]
    ]),
    quatTrackFromEulerKeyframes('RightUpperArm', talkTimes, [
      [-0.48, 0, 0.28],
      [-0.35, 0, 0.2],
      [-0.55, 0, 0.34],
      [-0.4, 0, 0.22],
      [-0.48, 0, 0.28]
    ]),
    quatTrackFromEulerKeyframes('LeftForeArm', talkTimes, [
      [-0.85, 0, 0],
      [-1.05, 0, 0],
      [-0.78, 0, 0],
      [-0.98, 0, 0],
      [-0.85, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightForeArm', talkTimes, [
      [-1.02, 0, 0],
      [-0.82, 0, 0],
      [-1.12, 0, 0],
      [-0.88, 0, 0],
      [-1.02, 0, 0]
    ])
  ])

  // 17. Think (托腮沉思 2.4s)
  const thinkTimes = [0, 1.2, 2.4]
  const thinkClip = new THREE.AnimationClip('Think', 2.4, [
    quatTrackFromEulerKeyframes('Spine', thinkTimes, [
      [0.06, 0.05, 0],
      [0.08, 0.03, 0],
      [0.06, 0.05, 0]
    ]),
    quatTrackFromEulerKeyframes('Head', thinkTimes, [
      [0.14, -0.08, 0.08],
      [0.18, -0.04, 0.1],
      [0.14, -0.08, 0.08]
    ]),
    quatTrackFromEulerKeyframes('LeftUpperArm', thinkTimes, [
      [-0.35, 0, -0.18],
      [-0.38, 0, -0.2],
      [-0.35, 0, -0.18]
    ]),
    quatTrackFromEulerKeyframes('LeftForeArm', thinkTimes, [
      [-0.75, 0, 0],
      [-0.78, 0, 0],
      [-0.75, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightUpperArm', thinkTimes, [
      [-0.82, 0, 0.22],
      [-0.86, 0, 0.22],
      [-0.82, 0, 0.22]
    ]),
    quatTrackFromEulerKeyframes('RightForeArm', thinkTimes, [
      [-1.42, 0, -0.25],
      [-1.46, 0, -0.25],
      [-1.42, 0, -0.25]
    ])
  ])

  // 18. PhoneLook (低头看手机/阅读 2.4s)
  const phoneTimes = [0, 1.2, 2.4]
  const phoneLookClip = new THREE.AnimationClip('PhoneLook', 2.4, [
    quatTrackFromEulerKeyframes('Spine', phoneTimes, [
      [0.08, 0, 0],
      [0.1, 0, 0],
      [0.08, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('Neck', phoneTimes, [
      [0.18, 0, 0],
      [0.2, 0, 0],
      [0.18, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('Head', phoneTimes, [
      [0.32, 0, 0],
      [0.35, 0.03, 0],
      [0.32, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpperArm', phoneTimes, [
      [0.04, 0, -0.14],
      [0.06, 0, -0.16],
      [0.04, 0, -0.14]
    ]),
    quatTrackFromEulerKeyframes('LeftForeArm', phoneTimes, [
      [-0.2, 0, 0],
      [-0.22, 0, 0],
      [-0.2, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightUpperArm', phoneTimes, [
      [-0.65, 0, 0.18],
      [-0.68, 0, 0.18],
      [-0.65, 0, 0.18]
    ]),
    quatTrackFromEulerKeyframes('RightForeArm', phoneTimes, [
      [-1.18, 0, -0.22],
      [-1.22, 0, -0.22],
      [-1.18, 0, -0.22]
    ])
  ])

  // 19. Stretch (伸懒腰舒展 2.6s)
  const stretchTimes = [0, 1.1, 1.7, 2.6]
  const stretchClip = new THREE.AnimationClip('Stretch', 2.6, [
    quatTrackFromEulerKeyframes('Spine', stretchTimes, [
      [0.02, 0, 0],
      [-0.18, 0, 0],
      [-0.22, 0, 0],
      [0.02, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('Chest', stretchTimes, [
      [0, 0, 0],
      [-0.14, 0, 0],
      [-0.16, 0, 0],
      [0, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('Head', stretchTimes, [
      [0, 0, 0],
      [-0.22, 0, 0],
      [-0.25, 0.06, 0],
      [0, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpperArm', stretchTimes, [
      [0.04, 0, -0.14],
      [-0.25, 0, -2.15],
      [-0.3, 0, -2.28],
      [0.04, 0, -0.14]
    ]),
    quatTrackFromEulerKeyframes('RightUpperArm', stretchTimes, [
      [0.04, 0, 0.14],
      [-0.25, 0, 2.15],
      [-0.3, 0, 2.28],
      [0.04, 0, 0.14]
    ]),
    quatTrackFromEulerKeyframes('LeftForeArm', stretchTimes, [
      [-0.15, 0, 0],
      [-0.35, 0, 0],
      [-0.2, 0, 0],
      [-0.15, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightForeArm', stretchTimes, [
      [-0.15, 0, 0],
      [-0.35, 0, 0],
      [-0.2, 0, 0],
      [-0.15, 0, 0]
    ])
  ])

  // 20. LookAround (左右张望寻找 2.6s)
  const lookTimes = [0, 0.65, 1.3, 1.95, 2.6]
  const lookAroundClip = new THREE.AnimationClip('LookAround', 2.6, [
    quatTrackFromEulerKeyframes('Spine', lookTimes, [
      [0.04, 0, 0],
      [0.05, 0.25, 0],
      [0.04, 0, 0],
      [0.05, -0.25, 0],
      [0.04, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('Head', lookTimes, [
      [0, 0, 0],
      [-0.06, 0.45, 0],
      [0, 0, 0],
      [-0.06, -0.45, 0],
      [0, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpperArm', lookTimes, [
      [-0.15, 0, -0.18],
      [-0.22, 0, -0.24],
      [-0.15, 0, -0.18],
      [-0.22, 0, -0.24],
      [-0.15, 0, -0.18]
    ]),
    quatTrackFromEulerKeyframes('RightUpperArm', lookTimes, [
      [-0.15, 0, 0.18],
      [-0.75, 0, 0.32],
      [-0.15, 0, 0.18],
      [-0.22, 0, 0.24],
      [-0.15, 0, 0.18]
    ]),
    quatTrackFromEulerKeyframes('LeftForeArm', lookTimes, [
      [-0.3, 0, 0],
      [-0.45, 0, 0],
      [-0.3, 0, 0],
      [-0.45, 0, 0],
      [-0.3, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightForeArm', lookTimes, [
      [-0.3, 0, 0],
      [-1.25, 0, 0],
      [-0.3, 0, 0],
      [-0.45, 0, 0],
      [-0.3, 0, 0]
    ])
  ])

  // 21. Drink (举杯畅饮 2.2s)
  const drinkTimes = [0, 0.7, 1.5, 2.2]
  const drinkClip = new THREE.AnimationClip('Drink', 2.2, [
    quatTrackFromEulerKeyframes('Spine', drinkTimes, [
      [0.02, 0, 0],
      [-0.06, 0, 0],
      [-0.08, 0, 0],
      [0.02, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('Head', drinkTimes, [
      [0, 0, 0],
      [-0.24, 0, 0],
      [-0.28, 0, 0],
      [0, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpperArm', drinkTimes, [
      [0.04, 0, -0.14],
      [0.06, 0, -0.16],
      [0.06, 0, -0.16],
      [0.04, 0, -0.14]
    ]),
    quatTrackFromEulerKeyframes('LeftForeArm', drinkTimes, [
      [-0.18, 0, 0],
      [-0.22, 0, 0],
      [-0.22, 0, 0],
      [-0.18, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightUpperArm', drinkTimes, [
      [-0.35, 0, 0.18],
      [-0.95, 0, 0.25],
      [-1.02, 0, 0.25],
      [-0.35, 0, 0.18]
    ]),
    quatTrackFromEulerKeyframes('RightForeArm', drinkTimes, [
      [-0.75, 0, 0],
      [-1.42, 0, -0.2],
      [-1.45, 0, -0.2],
      [-0.75, 0, 0]
    ])
  ])

  // 22. PushUp (俯卧撑锻炼 1.6s)
  const pushUpTimes = [0, 0.8, 1.6]
  const pushUpClip = new THREE.AnimationClip('PushUp', 1.6, [
    vecTrackFromKeyframes('Hips', pushUpTimes, [
      [0, 0.38, 0],
      [0, 0.22, 0],
      [0, 0.38, 0]
    ]),
    quatTrackFromEulerKeyframes('Hips', pushUpTimes, [
      [1.32, 0, 0],
      [1.42, 0, 0],
      [1.32, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('Head', pushUpTimes, [
      [-0.85, 0, 0],
      [-0.92, 0, 0],
      [-0.85, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpperArm', pushUpTimes, [
      [-1.25, 0, -0.25],
      [-0.65, 0, -0.55],
      [-1.25, 0, -0.25]
    ]),
    quatTrackFromEulerKeyframes('RightUpperArm', pushUpTimes, [
      [-1.25, 0, 0.25],
      [-0.65, 0, 0.55],
      [-1.25, 0, 0.25]
    ]),
    quatTrackFromEulerKeyframes('LeftForeArm', pushUpTimes, [
      [-0.15, 0, 0],
      [-1.05, 0, 0],
      [-0.15, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightForeArm', pushUpTimes, [
      [-0.15, 0, 0],
      [-1.05, 0, 0],
      [-0.15, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpLeg', pushUpTimes, [
      [0.05, 0, -0.06],
      [0.05, 0, -0.06],
      [0.05, 0, -0.06]
    ]),
    quatTrackFromEulerKeyframes('RightUpLeg', pushUpTimes, [
      [0.05, 0, 0.06],
      [0.05, 0, 0.06],
      [0.05, 0, 0.06]
    ])
  ])

  // 23. Fall (受击失衡跌倒 1.8s)
  const fallTimes = [0, 0.45, 0.95, 1.8]
  const fallClip = new THREE.AnimationClip('Fall', 1.8, [
    vecTrackFromKeyframes('Hips', fallTimes, [
      [0, 0.94, 0],
      [0, 0.68, -0.15],
      [0, 0.18, -0.35],
      [0, 0.16, -0.38]
    ]),
    quatTrackFromEulerKeyframes('Hips', fallTimes, [
      [0, 0, 0],
      [-0.55, 0, 0],
      [-1.48, 0, 0],
      [-1.52, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('Spine', fallTimes, [
      [0.04, 0, 0],
      [-0.25, 0, 0],
      [0.12, 0, 0],
      [0.06, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('Head', fallTimes, [
      [0, 0, 0],
      [-0.35, 0, 0],
      [0.22, 0, 0],
      [0.15, 0.1, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpperArm', fallTimes, [
      [0.05, 0, -0.15],
      [-0.75, 0, -0.85],
      [-0.25, 0, -0.65],
      [0.05, 0, -0.45]
    ]),
    quatTrackFromEulerKeyframes('RightUpperArm', fallTimes, [
      [0.05, 0, 0.15],
      [-0.75, 0, 0.85],
      [-0.25, 0, 0.65],
      [0.05, 0, 0.45]
    ]),
    quatTrackFromEulerKeyframes('LeftForeArm', fallTimes, [
      [-0.18, 0, 0],
      [-0.55, 0, 0],
      [-0.35, 0, 0],
      [-0.2, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightForeArm', fallTimes, [
      [-0.18, 0, 0],
      [-0.55, 0, 0],
      [-0.35, 0, 0],
      [-0.2, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpLeg', fallTimes, [
      [0, 0, 0],
      [-0.65, 0, -0.12],
      [-0.25, 0, -0.15],
      [0.05, 0, -0.12]
    ]),
    quatTrackFromEulerKeyframes('RightUpLeg', fallTimes, [
      [0, 0, 0],
      [-0.45, 0, 0.12],
      [-0.2, 0, 0.15],
      [0.05, 0, 0.12]
    ]),
    quatTrackFromEulerKeyframes('LeftLeg', fallTimes, [
      [0.05, 0, 0],
      [0.85, 0, 0],
      [0.35, 0, 0],
      [0.1, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightLeg', fallTimes, [
      [0.05, 0, 0],
      [0.65, 0, 0],
      [0.3, 0, 0],
      [0.1, 0, 0]
    ])
  ])

  // 24. Action / Combat Ready (战斗格斗戒备 1.8s)
  const actionTimes = [0, 0.9, 1.8]
  const actionClip = new THREE.AnimationClip('Action', 1.8, [
    quatTrackFromEulerKeyframes('Spine', actionTimes, [
      [0.18, -0.2, 0],
      [0.22, -0.15, 0],
      [0.18, -0.2, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpLeg', actionTimes, [
      [-0.42, 0.12, -0.08],
      [-0.5, 0.12, -0.08],
      [-0.42, 0.12, -0.08]
    ]),
    quatTrackFromEulerKeyframes('LeftLeg', actionTimes, [
      [0.48, 0, 0],
      [0.58, 0, 0],
      [0.48, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightUpLeg', actionTimes, [
      [0.32, -0.12, 0.08],
      [0.38, -0.12, 0.08],
      [0.32, -0.12, 0.08]
    ]),
    quatTrackFromEulerKeyframes('RightLeg', actionTimes, [
      [0.35, 0, 0],
      [0.45, 0, 0],
      [0.35, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('LeftUpperArm', actionTimes, [
      [-0.75, 0.15, -0.22],
      [-0.85, 0.15, -0.22],
      [-0.75, 0.15, -0.22]
    ]),
    quatTrackFromEulerKeyframes('LeftForeArm', actionTimes, [
      [-1.05, 0, 0],
      [-1.15, 0, 0],
      [-1.05, 0, 0]
    ]),
    quatTrackFromEulerKeyframes('RightUpperArm', actionTimes, [
      [-0.55, -0.15, 0.25],
      [-0.65, -0.15, 0.25],
      [-0.55, -0.15, 0.25]
    ]),
    quatTrackFromEulerKeyframes('RightForeArm', actionTimes, [
      [-1.1, 0, 0],
      [-1.2, 0, 0],
      [-1.1, 0, 0]
    ])
  ])

  return [
    idleClip,
    walkClip,
    runClip,
    sprintClip,
    jumpClip,
    sitClip,
    sitFloorClip,
    crouchClip,
    kneelClip,
    lieDownClip,
    waveClip,
    bowClip,
    clapClip,
    cheerClip,
    danceClip,
    talkClip,
    thinkClip,
    phoneLookClip,
    stretchClip,
    lookAroundClip,
    drinkClip,
    pushUpClip,
    fallClip,
    actionClip
  ]
}

/**
 * 构建内置可摆姿 3D 素体人偶（支持 FK 旋转 / CCDIK / YOLO 媒体提姿 / 常用手势眼神预设 / 骨骼动画轨道）。
 */
export function createBuiltinMannequin(
  preset: StageMannequinPreset = 'humanoid',
  colorHex = '#56b8ff'
): BuiltinMannequinResult {
  const root = new THREE.Group()
  root.name = `Mannequin_${preset}`

  const specs = getMannequinBoneSpecs(preset)
  const boneMap = new Map<string, THREE.Bone>()
  const bones: THREE.Bone[] = []

  const mainMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colorHex),
    roughness: 0.42,
    metalness: 0.12
  })
  mainMat.name = 'MannequinBody'

  const jointMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colorHex).multiplyScalar(0.72),
    roughness: 0.3,
    metalness: 0.28
  })
  jointMat.name = 'MannequinJoints'

  for (const spec of specs) {
    const bone = new THREE.Bone()
    bone.name = spec.name
    bone.position.set(spec.pos[0], spec.pos[1], spec.pos[2])
    boneMap.set(spec.name, bone)
    bones.push(bone)
    if (spec.parent) {
      const parentBone = boneMap.get(spec.parent)
      if (parentBone) {
        parentBone.add(bone)
      } else {
        root.add(bone)
      }
    } else {
      root.add(bone)
    }

    if (spec.limb) {
      const geo = buildLimbGeometry(spec.limb)
      const mat = spec.limb.isJoint ? jointMat : mainMat
      const limbMesh = new THREE.Mesh(geo, mat)
      limbMesh.name = `${spec.name}_Mesh`
      limbMesh.castShadow = true
      limbMesh.receiveShadow = true
      limbMesh.userData.isMaterialTarget = !spec.limb.isJoint
      limbMesh.userData.baseColor = mat.color.getHex()
      bone.add(limbMesh)
    }
  }

  // Head visor / face direction indicator so gaze direction is visually unmistakable
  const headBone = boneMap.get('Head')
  if (headBone) {
    const visorGeo =
      preset === 'chibi'
        ? new THREE.BoxGeometry(0.32, 0.08, 0.08)
        : preset === 'quadruped'
          ? new THREE.BoxGeometry(0.18, 0.06, 0.08)
          : new THREE.BoxGeometry(0.19, 0.055, 0.06)
    const visorPos: [number, number, number] =
      preset === 'chibi'
        ? [0, 0.23, 0.25]
        : preset === 'quadruped'
          ? [0, 0.08, 0.26]
          : [0, 0.14, 0.12]
    visorGeo.translate(visorPos[0], visorPos[1], visorPos[2])
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.2,
      metalness: 0.6,
      emissive: new THREE.Color(colorHex),
      emissiveIntensity: 0.25
    })
    visorMat.name = 'MannequinVisor'
    const visorMesh = new THREE.Mesh(visorGeo, visorMat)
    visorMesh.name = 'Head_Visor'
    visorMesh.castShadow = true
    headBone.add(visorMesh)
  }

  // Create a SkinnedMesh carrier bound to the full bone list so `collectSkinningBones(root)`
  // and `resetSkeletonBindPose(root)` treat this mannequin identically to a rigged GLB model.
  const carrierGeo = new THREE.BoxGeometry(0.02, 0.02, 0.02)
  const posAttr = carrierGeo.attributes.position
  const vertexCount = posAttr.count
  const skinIndices = new Uint16Array(vertexCount * 4)
  const skinWeights = new Float32Array(vertexCount * 4)
  for (let i = 0; i < vertexCount; i++) {
    skinIndices[i * 4] = 0
    skinWeights[i * 4] = 1
  }
  carrierGeo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndices, 4))
  carrierGeo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeights, 4))
  const carrierMesh = new THREE.SkinnedMesh(carrierGeo, mainMat)
  carrierMesh.name = 'Mannequin_SkinnedCarrier'
  carrierMesh.frustumCulled = false
  root.add(carrierMesh)
  root.updateMatrixWorld(true)
  const skeleton = new THREE.Skeleton(bones)
  carrierMesh.bind(skeleton, carrierMesh.matrixWorld)

  const clips = buildBuiltinMannequinClips()
  return { root, bones, clips }
}
