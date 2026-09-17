import * as THREE from 'three'
import { collectPoseEditBones, findNearestPoseBoneParent } from '../../director/skeletonRetarget'
import { loadModelScene } from '../../director/loadModelScene'
import { useProjectStore } from '../../../stores/project'

function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    mesh.geometry?.dispose?.()
    const material = mesh.material
    if (Array.isArray(material)) {
      for (const item of material) item.dispose()
    } else {
      material?.dispose?.()
    }
  })
}

/**
 * 从图节点输入的 3D 模型读取可编辑骨骼（蒙皮主链）。
 * Cook `model.pose` 时由执行器注入调用。
 */
export async function inspectModelSkeleton(input: {
  relativePath?: string
  assetId?: string
}): Promise<Array<{ name: string; parent: string | null }>> {
  let relativePath = input.relativePath?.trim() || ''
  if (!relativePath && input.assetId?.trim()) {
    const asset = useProjectStore().assets.find((item) => item.id === input.assetId)
    relativePath = asset?.relativePath?.trim() || ''
  }
  if (!relativePath) return []
  const url = await window.studio.getAssetFileUrl(relativePath)
  if (!url) return []
  const loaded = await loadModelScene(url, relativePath)
  try {
    const bones = collectPoseEditBones(loaded.scene)
    const boneSet = new Set(bones)
    const out: Array<{ name: string; parent: string | null }> = []
    for (const bone of bones) {
      const name = bone.name?.trim()
      if (!name) continue
      const parent = findNearestPoseBoneParent(bone, boneSet)
      out.push({ name, parent: parent?.name?.trim() || null })
    }
    return out
  } finally {
    disposeObject(loaded.scene)
  }
}
