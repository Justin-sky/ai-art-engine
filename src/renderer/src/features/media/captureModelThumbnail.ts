import * as THREE from 'three'
import { THUMB_MAX_EDGE } from '@shared/media/thumbnailPath'
import { loadModelScene } from '../director/loadModelScene'

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.SkinnedMesh)) return
    child.geometry?.dispose()
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      material?.dispose()
    }
  })
}

function fitCamera(camera: THREE.PerspectiveCamera, object: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) {
    camera.position.set(2.4, 1.6, 2.8)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
    return
  }
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z, 0.001)
  const distance = maxDim * 2.2
  camera.near = Math.max(distance / 100, 0.01)
  camera.far = Math.max(distance * 20, 100)
  camera.position.set(
    center.x + distance * 0.7,
    center.y + distance * 0.45,
    center.z + distance * 0.9
  )
  camera.lookAt(center)
  camera.updateProjectionMatrix()
}

/**
 * 离屏加载 3D 模型并拍一张 PNG（data URL）。
 * 与 Inspector ModelPreview 同一套 loader / 机位，给资产卡和 @ 选择器用。
 */
export async function captureModelThumbnailDataUrl(relativePath: string): Promise<string> {
  const url = await window.studio.getAssetFileUrl(relativePath)
  if (!url) return ''
  const loaded = await loadModelScene(url, relativePath)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x16191d)
  scene.add(new THREE.AmbientLight(0xffffff, 0.7))
  const key = new THREE.DirectionalLight(0xffffff, 1.1)
  key.position.set(3, 5, 2)
  const fill = new THREE.DirectionalLight(0xffffff, 0.35)
  fill.position.set(-2, 1, -2)
  scene.add(key, fill)
  scene.add(loaded.scene)

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200)
  fitCamera(camera, loaded.scene)

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
    powerPreference: 'low-power'
  })
  renderer.setPixelRatio(1)
  renderer.setSize(THUMB_MAX_EDGE, THUMB_MAX_EDGE, false)
  renderer.setClearColor(0x16191d, 1)
  renderer.render(scene, camera)
  const dataUrl = renderer.domElement.toDataURL('image/png')

  disposeObject(loaded.scene)
  renderer.dispose()
  renderer.forceContextLoss()
  return dataUrl.startsWith('data:image/') ? dataUrl : ''
}
