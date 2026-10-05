import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { createSplatMesh, isSplatPath } from './splatMesh'

export type LoadedModelScene = {
  scene: THREE.Object3D
  animations: THREE.AnimationClip[]
}

/** 泼溅（`.ply` / `.spz`）没有骨骼 / 动画 / glTF 默认变换，按扩展名判定即可 */
export function isSplatModelPath(pathOrUrl: string): boolean {
  return isSplatPath(pathOrUrl)
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
 * Supports glTF/GLB, FBX and gaussian splats (.ply / .spz, rendered by Spark).
 * Prefer passing the asset relativePath as `filePathHint` when `url` is a
 * protocol URL without a clear extension.
 *
 * Splat products return a `SplatMesh` (a plain Object3D) and no animations;
 * the caller hosting a render loop must also mount the Spark renderer layer —
 * see `ensureSparkLayer` in `./splatMesh`.
 */
export async function loadModelScene(
  url: string,
  filePathHint?: string | null
): Promise<LoadedModelScene> {
  const ext = modelFileExt(filePathHint || url)
  if (isSplatPath(filePathHint || url)) {
    // 带上文件名：直链可能没有后缀，Spark 认得 .ply / .spz 才能定格式
    return { scene: await createSplatMesh({ url, name: `splat${ext}` }), animations: [] }
  }
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
