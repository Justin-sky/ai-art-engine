import * as THREE from 'three'
import type { ModelAssetTransform } from '@shared/domain'

export type ModelSceneDefaults = {
  transform: ModelAssetTransform
  color: string
}

function colorToCssHex(color: THREE.Color): string {
  return `#${color.getHexString()}`
}

/** 从导入的 GLTF 场景根读取默认 transform，并从首个带颜色的材质读取颜色。 */
export function extractModelSceneDefaults(root: THREE.Object3D): ModelSceneDefaults {
  const transform: ModelAssetTransform = {
    position: {
      x: root.position.x,
      y: root.position.y,
      z: root.position.z
    },
    rotation: {
      x: root.rotation.x,
      y: root.rotation.y,
      z: root.rotation.z
    },
    scale: {
      x: Number.isFinite(root.scale.x) && root.scale.x !== 0 ? root.scale.x : 1,
      y: Number.isFinite(root.scale.y) && root.scale.y !== 0 ? root.scale.y : 1,
      z: Number.isFinite(root.scale.z) && root.scale.z !== 0 ? root.scale.z : 1
    }
  }

  let color: string | null = null
  root.traverse((child) => {
    if (color || !(child instanceof THREE.Mesh)) return
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      if (!material || !('color' in material)) continue
      const materialColor = (material as THREE.Material & { color?: THREE.Color }).color
      if (materialColor instanceof THREE.Color) {
        color = colorToCssHex(materialColor)
        return
      }
    }
  })

  return {
    transform,
    color: color ?? '#ffffff'
  }
}
