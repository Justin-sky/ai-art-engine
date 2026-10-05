import * as THREE from 'three'
import { THUMB_MAX_EDGE } from '@shared/media/thumbnailPath'
import { loadModelScene } from '../director/loadModelScene'
import {
  disposeSparkLayer,
  ensureSparkLayer,
  isGaussianSplatObject,
  primeSparkLayer,
  splatObjectBounds
} from '../director/splatMesh'

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
  // 泼溅求不到普通包围盒（几何体由 Spark 在渲染前构造），回退到它自己的包围盒
  const effective = box.isEmpty() ? splatObjectBounds(object) : box
  if (effective.isEmpty()) {
    camera.position.set(2.4, 1.6, 2.8)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
    return
  }
  const size = effective.getSize(new THREE.Vector3())
  const center = effective.getCenter(new THREE.Vector3())
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
 *
 * 泼溅（.ply / .spz）额外需要 Spark 渲染层，且它的第一帧只是准备数据
 *（排序 / 几何体构造在渲染过程中完成），所以多渲几帧再取帧，
 * 否则缩略图会是一张空的背景色。
 */
export async function captureModelThumbnailDataUrl(relativePath: string): Promise<string> {
  const url = await window.studio.getAssetFileUrl(relativePath)
  if (!url) return ''
  const loaded = await loadModelScene(url, relativePath)
  const isSplat = isGaussianSplatObject(loaded.scene)

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

  try {
    if (isSplat) {
      await ensureSparkLayer({ scene, renderer })
      // 先喂一次累加器再取帧：否则 activeSplats 恒为 0，缩略图是空背景
      await primeSparkLayer({ scene, camera })
      const frames = 3
      for (let i = 0; i < frames; i++) renderer.render(scene, camera)
    } else {
      renderer.render(scene, camera)
    }
    const dataUrl = renderer.domElement.toDataURL('image/png')
    return dataUrl.startsWith('data:image/') ? dataUrl : ''
  } finally {
    // 泼溅网格不是材质网格（没有 geometry / 普通材质），disposeObject 对它只做空遍历，
    // 真正的释放交给 Spark 自己的 dispose；渲染层是模块级单例，必须显式摘掉
    disposeObject(loaded.scene)
    if (isSplat) {
      ;(loaded.scene as unknown as { dispose?: () => void }).dispose?.()
      disposeSparkLayer()
    }
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
