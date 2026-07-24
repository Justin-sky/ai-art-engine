import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export type LoadedModelScene = {
  scene: THREE.Object3D
  animations: THREE.AnimationClip[]
}

/** Path/URL extension including the leading dot, lowercased. */
export function modelFileExt(pathOrUrl: string): string {
  const clean = (pathOrUrl.split(/[?#]/)[0] ?? pathOrUrl).replace(/\\/g, '/')
  const base = clean.slice(clean.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(dot).toLowerCase() : ''
}

/**
 * Load a local model asset URL into a Three.js scene graph.
 * Supports glTF/GLB and FBX. Prefer passing the asset relativePath as
 * `filePathHint` when `url` is a protocol URL without a clear extension.
 */
export async function loadModelScene(
  url: string,
  filePathHint?: string | null
): Promise<LoadedModelScene> {
  const ext = modelFileExt(filePathHint || url)
  if (ext === '.fbx') {
    const root = await new FBXLoader().loadAsync(url)
    return {
      scene: root,
      animations: root.animations?.slice() ?? []
    }
  }
  if (ext === '.glb' || ext === '.gltf' || !ext) {
    const gltf = await new GLTFLoader().loadAsync(url)
    return {
      scene: gltf.scene,
      animations: gltf.animations?.slice() ?? []
    }
  }
  throw new Error(`Unsupported model format: ${ext}`)
}
