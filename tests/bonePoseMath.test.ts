import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  applyBoneOffset,
  boneOffsetFromBase,
  isNearIdentityQuat,
  offsetFromEulerXYZ
} from '../src/renderer/src/features/director/bonePoseMath'

describe('bonePoseMath', () => {
  it('offset round-trips with apply', () => {
    const bind = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, -0.2, 0.3, 'XYZ'))
    const current = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, 0.1, -0.4, 'XYZ'))
    const offset = boneOffsetFromBase(bind, current)
    const restored = applyBoneOffset(bind, offset)
    expect(restored.angleTo(current)).toBeLessThan(1e-6)
  })

  it('parent then child offsets compose as independent local offsets', () => {
    // 模拟：父骨 bind→posed，子骨仍用自己的 bind 局部旋转（FK：子世界位姿跟着父走）
    const parentBind = new THREE.Quaternion()
    const childBind = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0, 0, 'XYZ'))
    const parentOffset = offsetFromEulerXYZ(0, Math.PI / 2, 0)
    const parentLocal = applyBoneOffset(parentBind, parentOffset)
    // 子骨无偏移时局部仍是 bind；世界旋转 = parentLocal * childBind
    const childWorld = parentLocal.clone().multiply(childBind)
    const expected = parentOffset.clone().multiply(childBind)
    expect(childWorld.angleTo(expected)).toBeLessThan(1e-6)
  })

  it('re-applying same offsets is idempotent when resetting to bind first', () => {
    const bind = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.15, 0.05, -0.1, 'XYZ'))
    const offset = offsetFromEulerXYZ(0.3, -0.4, 0.2)
    const a = applyBoneOffset(bind, offset)
    const b = applyBoneOffset(bind, offset)
    expect(a.angleTo(b)).toBeLessThan(1e-6)
    // 若错误地在已偏移结果上再 multiply，会偏离
    const wrong = a.clone().multiply(offset)
    expect(wrong.angleTo(a)).toBeGreaterThan(0.1)
  })

  it('isNearIdentityQuat', () => {
    expect(isNearIdentityQuat(new THREE.Quaternion())).toBe(true)
    expect(isNearIdentityQuat(offsetFromEulerXYZ(0.2, 0, 0))).toBe(false)
  })
})
