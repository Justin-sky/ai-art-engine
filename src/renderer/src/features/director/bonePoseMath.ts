import * as THREE from 'three'

/** 从「当前局部旋转」相对「基准局部旋转」求出偏移：offset = base⁻¹ * current */
export function boneOffsetFromBase(
  base: THREE.Quaternion,
  current: THREE.Quaternion,
  out = new THREE.Quaternion()
): THREE.Quaternion {
  return out.copy(base).invert().multiply(current)
}

/** 套用偏移：result = base * offset */
export function applyBoneOffset(
  base: THREE.Quaternion,
  offset: THREE.Quaternion,
  out = new THREE.Quaternion()
): THREE.Quaternion {
  return out.copy(base).multiply(offset)
}

export function isNearIdentityQuat(q: THREE.Quaternion, eps = 1e-5): boolean {
  return (
    Math.abs(q.x) < eps &&
    Math.abs(q.y) < eps &&
    Math.abs(q.z) < eps &&
    Math.abs(Math.abs(q.w) - 1) < eps
  )
}

/** 欧拉（弧度 XYZ）→ 四元数偏移 */
export function offsetFromEulerXYZ(x: number, y: number, z: number, out = new THREE.Quaternion()): THREE.Quaternion {
  return out.setFromEuler(new THREE.Euler(x, y, z, 'XYZ'))
}
