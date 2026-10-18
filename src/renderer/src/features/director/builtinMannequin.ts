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

/**
 * 生成内置程序化骨骼动画片段（Idle / Walk / Run / Wave / Action），无需外部资产即可直接挂上时间轴播放。
 * 注意：手臂/腿部沿 -Y 轴下垂，右手定则下绕 +Z 旋转会将 -Y 摆向 +X：
 * - 左臂（位于 -X 侧）外展（远离躯干）需要 rz < 0；
 * - 右臂（位于 +X 侧）外展（远离躯干）需要 rz > 0。
 */
export function buildBuiltinMannequinClips(): THREE.AnimationClip[] {
  // 1. Idle (2.4s loop)
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

  // 2. Walk (1.2s loop)
  const walkTimes = [0, 0.3, 0.6, 0.9, 1.2]
  const walkClip = new THREE.AnimationClip('Walk', 1.2, [
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

  // 3. Run (0.8s loop)
  const runTimes = [0, 0.2, 0.4, 0.6, 0.8]
  const runClip = new THREE.AnimationClip('Run', 0.8, [
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

  // 4. Wave (1.6s loop)
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

  // 5. Action / Combat Ready (1.8s loop)
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

  return [idleClip, walkClip, runClip, waveClip, actionClip]
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
