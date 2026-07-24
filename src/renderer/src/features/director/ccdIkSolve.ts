import * as THREE from 'three'

const _targetPos = new THREE.Vector3()
const _effectorPos = new THREE.Vector3()
const _linkPos = new THREE.Vector3()
const _linkScale = new THREE.Vector3()
const _invLinkQ = new THREE.Quaternion()
const _effectorVec = new THREE.Vector3()
const _targetVec = new THREE.Vector3()
const _axis = new THREE.Vector3()
const _quat = new THREE.Quaternion()

export type CcdIkSolveOptions = {
  /** 末端效应器（手/脚），只用来量位置，默认不旋 */
  effector: THREE.Bone
  /** 从近末端到近根的可旋转骨 */
  links: THREE.Bone[]
  /** 世界空间目标点 */
  targetWorld: THREE.Vector3
  /** 迭代次数，默认 10 */
  iteration?: number
  /** 单步最大转角（弧度），默认 1.0 */
  maxAngle?: number
  /** 更新世界矩阵的根（角色根），默认 effector 向上找 */
  root?: THREE.Object3D | null
}

/**
 * 简易 CCD IK：直接改 links 的 local quaternion，target 为世界坐标（无需骨架内 target bone）。
 * 算法对齐 three.js CCDIKSolver，但不依赖 skeleton.bones 下标。
 */
export function solveCcdIk(opts: CcdIkSolveOptions): void {
  const { effector, links, targetWorld } = opts
  if (!links.length) return
  const iteration = opts.iteration ?? 10
  const maxAngle = opts.maxAngle ?? 1.0
  const root = opts.root ?? null

  _targetPos.copy(targetWorld)

  for (let i = 0; i < iteration; i++) {
    for (const link of links) {
      if (root) root.updateMatrixWorld(true)
      else link.updateWorldMatrix(true, true)

      link.matrixWorld.decompose(_linkPos, _invLinkQ, _linkScale)
      _invLinkQ.invert()
      _effectorPos.setFromMatrixPosition(effector.matrixWorld)

      _effectorVec.subVectors(_effectorPos, _linkPos).applyQuaternion(_invLinkQ).normalize()
      _targetVec.subVectors(_targetPos, _linkPos).applyQuaternion(_invLinkQ).normalize()

      let angle = _targetVec.dot(_effectorVec)
      angle = Math.acos(Math.min(1, Math.max(-1, angle)))
      if (angle < 1e-5) continue
      if (angle > maxAngle) angle = maxAngle

      _axis.crossVectors(_effectorVec, _targetVec)
      if (_axis.lengthSq() < 1e-10) continue
      _axis.normalize()
      _quat.setFromAxisAngle(_axis, angle)
      link.quaternion.multiply(_quat)
      link.updateMatrix()
    }
  }

  if (root) root.updateMatrixWorld(true)
  else effector.updateWorldMatrix(true, true)
}
