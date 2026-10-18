import * as THREE from 'three'
import type { DirectorCapturePass, DirectorStageState, DirectorViewerState } from '@shared/domain'

/** 创建地面接触阴影捕手平面（Shadow Catcher） */
export function createShadowCatcherPlane(): THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial> {
  const geo = new THREE.PlaneGeometry(240, 240)
  geo.rotateX(-Math.PI / 2)
  const mat = new THREE.ShadowMaterial({
    opacity: 0.35,
    transparent: true,
    depthWrite: false
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = '__director_shadow_catcher__'
  mesh.receiveShadow = true
  mesh.renderOrder = -1
  return mesh
}

/** 同步地面接触阴影捕手位置、开关与不透明度 */
export function syncShadowCatcherPlane(
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial> | null,
  stage: DirectorStageState,
  gridOffsetY: number
): void {
  if (!mesh) return
  const enabled = stage.shadowCatcherEnabled !== false
  const opacity =
    typeof stage.shadowCatcherOpacity === 'number' && Number.isFinite(stage.shadowCatcherOpacity)
      ? Math.min(1, Math.max(0, stage.shadowCatcherOpacity))
      : 0.35
  mesh.visible = enabled && opacity > 0.005
  mesh.position.y = gridOffsetY - 0.002
  mesh.material.opacity = opacity
}

/** 同步大气体积指数雾（FogExp2） */
export function syncStageAtmosphericFog(
  scene: THREE.Scene,
  stage: DirectorStageState,
  fallbackSkyHex: string
): void {
  if (stage.fogEnabled !== true) {
    if (scene.fog) scene.fog = null
    return
  }
  const density =
    typeof stage.fogDensity === 'number' && Number.isFinite(stage.fogDensity)
      ? Math.min(0.25, Math.max(0.001, stage.fogDensity))
      : 0.018
  const colorHex =
    typeof stage.fogColor === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(stage.fogColor)
      ? stage.fogColor
      : fallbackSkyHex
  if (scene.fog instanceof THREE.FogExp2) {
    scene.fog.color.set(colorHex)
    scene.fog.density = density
  } else {
    scene.fog = new THREE.FogExp2(colorHex, density)
  }
}

/** 从全景贴图生成 PMREM 环境光反射贴图（IBL），让 PBR 模型表面自然反射全景色彩 */
export function applyPanoramaEnvironmentMap(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  equirectTexture: THREE.Texture | null,
  prevEnvTarget: THREE.WebGLRenderTarget | null
): THREE.WebGLRenderTarget | null {
  if (prevEnvTarget) {
    prevEnvTarget.dispose()
  }
  if (!equirectTexture) {
    scene.environment = null
    return null
  }
  try {
    const pmrem = new THREE.PMREMGenerator(renderer)
    pmrem.compileEquirectangularShader()
    const envTarget = pmrem.fromEquirectangular(equirectTexture)
    scene.environment = envTarget.texture
    pmrem.dispose()
    return envTarget
  } catch {
    scene.environment = null
    return null
  }
}

/** OpenPose 风格骨骼连线配色表 */
const OPENPOSE_BONE_COLORS: Record<string, number> = {
  Spine: 0x0099ff,
  Chest: 0x0066ff,
  Neck: 0x0033ff,
  Head: 0x9900ff,
  LeftShoulder: 0xff3300,
  LeftUpperArm: 0xff6600,
  LeftForeArm: 0xff9900,
  LeftHand: 0xffcc00,
  RightShoulder: 0x66ff00,
  RightUpperArm: 0x33ff00,
  RightForeArm: 0x00ff33,
  RightHand: 0x00ff66,
  LeftUpLeg: 0x00ffcc,
  LeftLeg: 0x00ffff,
  LeftFoot: 0x00ccff,
  RightUpLeg: 0x3300ff,
  RightLeg: 0x6600ff,
  RightFoot: 0xcc00ff
}

function buildOpenPoseOverlayGroup(objectGroup: THREE.Group): THREE.Group {
  const poseGroup = new THREE.Group()
  poseGroup.name = '__director_openpose_pass__'

  const wpChild = new THREE.Vector3()
  const wpParent = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const mid = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  const quat = new THREE.Quaternion()

  objectGroup.updateMatrixWorld(true)

  objectGroup.traverse((node) => {
    if (!(node as THREE.Bone).isBone) return
    const bone = node as THREE.Bone
    bone.getWorldPosition(wpChild)

    const jointColor = OPENPOSE_BONE_COLORS[bone.name] ?? 0xffffff
    const jointGeo = new THREE.SphereGeometry(0.032, 10, 10)
    const jointMat = new THREE.MeshBasicMaterial({
      color: jointColor,
      depthTest: false,
      toneMapped: false
    })
    const jointMesh = new THREE.Mesh(jointGeo, jointMat)
    jointMesh.position.copy(wpChild)
    jointMesh.renderOrder = 999
    poseGroup.add(jointMesh)

    const parentBone =
      bone.parent && (bone.parent as THREE.Bone).isBone ? (bone.parent as THREE.Bone) : null
    if (!parentBone) return
    parentBone.getWorldPosition(wpParent)
    const dist = wpChild.distanceTo(wpParent)
    if (dist < 0.015 || dist > 2.5) return

    dir.subVectors(wpChild, wpParent).normalize()
    mid.addVectors(wpParent, wpChild).multiplyScalar(0.5)
    quat.setFromUnitVectors(up, dir)

    const limbColor = OPENPOSE_BONE_COLORS[bone.name] ?? 0x00ffcc
    const cylGeo = new THREE.CylinderGeometry(0.018, 0.018, dist, 8, 1)
    const cylMat = new THREE.MeshBasicMaterial({
      color: limbColor,
      depthTest: false,
      toneMapped: false
    })
    const cylMesh = new THREE.Mesh(cylGeo, cylMat)
    cylMesh.position.copy(mid)
    cylMesh.quaternion.copy(quat)
    cylMesh.renderOrder = 998
    poseGroup.add(cylMesh)
  })

  return poseGroup
}

export interface SavedCapturePassContext {
  pass: DirectorCapturePass
  prevOverrideMaterial: THREE.Material | null
  prevBackground: THREE.Color | THREE.Texture | null
  prevFog: THREE.FogBase | null
  prevPanoramaVisible: boolean
  prevShadowCatcherVisible: boolean
  prevCameraNear: number
  prevCameraFar: number
  hiddenMeshes: THREE.Object3D[]
  poseOverlayGroup: THREE.Group | null
}

/**
 * 切换到指定渲染通道（rgb / depth / normal / pose）以供截屏或视频帧导出。
 */
export function applyCapturePassState(params: {
  pass: DirectorCapturePass
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  objectGroup: THREE.Group
  panoramaMesh: THREE.Object3D | null
  shadowCatcher: THREE.Object3D | null
}): SavedCapturePassContext {
  const { pass, scene, camera, objectGroup, panoramaMesh, shadowCatcher } = params
  const ctx: SavedCapturePassContext = {
    pass,
    prevOverrideMaterial: scene.overrideMaterial,
    prevBackground: scene.background,
    prevFog: scene.fog,
    prevPanoramaVisible: panoramaMesh ? panoramaMesh.visible : false,
    prevShadowCatcherVisible: shadowCatcher ? shadowCatcher.visible : false,
    prevCameraNear: camera.near,
    prevCameraFar: camera.far,
    hiddenMeshes: [],
    poseOverlayGroup: null
  }

  if (pass === 'rgb') {
    return ctx
  }

  if (panoramaMesh) panoramaMesh.visible = false
  if (shadowCatcher) shadowCatcher.visible = false
  scene.fog = null

  if (pass === 'depth') {
    scene.background = new THREE.Color(0x000000)
    // Tighten camera near/far around scene objects so depth map has rich grayscale dynamic range
    const box = new THREE.Box3().setFromObject(objectGroup)
    if (!box.isEmpty()) {
      const camPos = new THREE.Vector3()
      camera.getWorldPosition(camPos)
      const sphere = new THREE.Sphere()
      box.getBoundingSphere(sphere)
      const distToCenter = camPos.distanceTo(sphere.center)
      const radius = Math.max(1.5, sphere.radius)
      camera.near = Math.max(0.2, distToCenter - radius * 1.4)
      camera.far = Math.max(camera.near + 2, distToCenter + radius * 1.6)
      camera.updateProjectionMatrix()
    }
    scene.overrideMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.BasicDepthPacking
    })
    return ctx
  }

  if (pass === 'normal') {
    scene.background = new THREE.Color(0x000000)
    scene.overrideMaterial = new THREE.MeshNormalMaterial()
    return ctx
  }

  if (pass === 'pose') {
    scene.background = new THREE.Color(0x000000)
    objectGroup.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && child.visible) {
        child.visible = false
        ctx.hiddenMeshes.push(child)
      }
    })
    const poseOverlay = buildOpenPoseOverlayGroup(objectGroup)
    scene.add(poseOverlay)
    ctx.poseOverlayGroup = poseOverlay
    return ctx
  }

  return ctx
}

/** 恢复渲染通道切换前的场景状态并释放临时几何/材质 */
export function restoreCapturePassState(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  panoramaMesh: THREE.Object3D | null,
  shadowCatcher: THREE.Object3D | null,
  ctx: SavedCapturePassContext
): void {
  if (ctx.pass === 'rgb') return

  if (ctx.prevOverrideMaterial !== scene.overrideMaterial && scene.overrideMaterial) {
    scene.overrideMaterial.dispose()
  }
  scene.overrideMaterial = ctx.prevOverrideMaterial
  scene.background = ctx.prevBackground
  scene.fog = ctx.prevFog

  if (panoramaMesh) panoramaMesh.visible = ctx.prevPanoramaVisible
  if (shadowCatcher) shadowCatcher.visible = ctx.prevShadowCatcherVisible

  if (camera.near !== ctx.prevCameraNear || camera.far !== ctx.prevCameraFar) {
    camera.near = ctx.prevCameraNear
    camera.far = ctx.prevCameraFar
    camera.updateProjectionMatrix()
  }

  for (const m of ctx.hiddenMeshes) {
    m.visible = true
  }

  if (ctx.poseOverlayGroup) {
    scene.remove(ctx.poseOverlayGroup)
    ctx.poseOverlayGroup.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (mesh.isMesh) {
        mesh.geometry?.dispose()
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((mat) => mat.dispose())
        } else {
          mesh.material?.dispose()
        }
      }
    })
  }
}

/**
 * 若机位开启了大光圈景深（aperture ≤ 8），在截屏 Canvas 上合成边缘散景虚化（Bokeh Depth-of-Field）。
 */
export function applyCanvasDofBlurIfEnabled(
  sourceCanvas: HTMLCanvasElement,
  viewer: DirectorViewerState
): HTMLCanvasElement {
  const aperture = viewer.aperture
  if (typeof aperture !== 'number' || !Number.isFinite(aperture) || aperture > 8) {
    return sourceCanvas
  }
  const blurPx = Math.min(10, Math.max(0, (8 - aperture) * 1.25))
  if (blurPx < 0.5) return sourceCanvas

  const w = sourceCanvas.width
  const h = sourceCanvas.height
  if (w <= 0 || h <= 0) return sourceCanvas

  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')
  if (!ctx) return sourceCanvas

  // 1. Draw blurred background layer
  ctx.save()
  ctx.filter = `blur(${blurPx.toFixed(1)}px)`
  ctx.drawImage(sourceCanvas, 0, 0)
  ctx.restore()

  // 2. Mask sharp center focal region onto blurred background
  const sharpLayer = document.createElement('canvas')
  sharpLayer.width = w
  sharpLayer.height = h
  const sctx = sharpLayer.getContext('2d')
  if (!sctx) return sourceCanvas

  sctx.drawImage(sourceCanvas, 0, 0)
  sctx.globalCompositeOperation = 'destination-in'
  const cx = w * 0.5
  const cy = h * 0.5
  const rInner = Math.min(w, h) * 0.24
  const rOuter = Math.max(w, h) * 0.62
  const grad = sctx.createRadialGradient(cx, cy, rInner, cx, cy, rOuter)
  grad.addColorStop(0, 'rgba(0,0,0,1)')
  grad.addColorStop(0.65, 'rgba(0,0,0,0.85)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  sctx.fillStyle = grad
  sctx.fillRect(0, 0, w, h)

  ctx.drawImage(sharpLayer, 0, 0)
  return out
}
