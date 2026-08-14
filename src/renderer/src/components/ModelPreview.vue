<template>
  <div class="model-preview">
    <div
      ref="viewportEl"
      class="viewport"
    />
    <div
      v-if="status === 'loading'"
      class="overlay"
    >
      {{ t('asset.inspector.modelPreviewLoading') }}
    </div>
    <div
      v-else-if="status === 'empty'"
      class="overlay"
    >
      {{ t('asset.inspector.unlinked') }}
    </div>
    <div
      v-else-if="status === 'error'"
      class="overlay error"
    >
      {{ errorMessage }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { loadModelScene } from '../features/director/loadModelScene'
import { skeletonClipLabel } from '../features/director/skeletonAnim'
import { useStudioI18n } from '../composables/useStudioI18n'
import { themePreference } from '../editor/preferences'
import { detectModelPreviewMeta, type ModelPreviewMeta } from '@shared/domain'
import {
  extractModelSceneDefaults,
  type ModelSceneDefaults
} from '../features/director/modelSceneDefaults'

function themePreviewHex(): string {
  if (typeof document === 'undefined') return '#16191d'
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--graph-preview-bg')
    .trim()
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw) ? raw : '#16191d'
}

function applyPreviewBackground(): void {
  const hex = themePreviewHex()
  if (scene) scene.background = new THREE.Color(hex)
  renderer?.setClearColor(hex, 1)
}

const props = withDefaults(
  defineProps<{
    relativePath?: string | null
    transform?: {
      position: { x: number; y: number; z: number }
      rotation: { x: number; y: number; z: number }
      scale: { x: number; y: number; z: number }
    } | null
    /** 预览播放的 clip 显示名；空则不播 */
    previewClip?: string | null
    previewPlaying?: boolean
    previewSpeed?: number
    showSkeleton?: boolean
    /** 列表选中的骨骼显示名 */
    selectedBone?: string | null
  }>(),
  {
    relativePath: null,
    transform: null,
    previewClip: null,
    previewPlaying: false,
    previewSpeed: 1,
    showSkeleton: false,
    selectedBone: null
  }
)

const emit = defineEmits<{
  clips: [names: string[]]
  bones: [names: string[]]
  meta: [meta: ModelPreviewMeta]
  'select-bone': [name: string | null]
  'scene-defaults': [defaults: ModelSceneDefaults]
}>()

const { t } = useStudioI18n()
const viewportEl = ref<HTMLDivElement | null>(null)
const status = ref<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle')
const errorMessage = ref('')

const BONE_COLOR = 0xff9f1c
const BONE_SELECTED_COLOR = 0x2ee6ff
const BONE_LINE_COLOR = 0xe8a54b

type BoneEntry = {
  name: string
  bone: THREE.Bone
  joint: THREE.Mesh
}

type BoneLink = {
  from: THREE.Bone
  to: THREE.Bone
  fromName: string
  toName: string
  mesh: THREE.Mesh
}

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let controls: OrbitControls | null = null
let rootObject: THREE.Object3D | null = null
let mixer: THREE.AnimationMixer | null = null
let clips: THREE.AnimationClip[] = []
let activeAction: THREE.AnimationAction | null = null
let boneOverlay: THREE.Group | null = null
let boneEntries: BoneEntry[] = []
let boneLinks: BoneLink[] = []
let boneRadius = 0.02
let jointGeom: THREE.SphereGeometry | null = null
let segmentGeom: THREE.BufferGeometry | null = null
let boneMatNormal: THREE.MeshBasicMaterial | null = null
let boneMatSelected: THREE.MeshBasicMaterial | null = null
let boneMatLink: THREE.MeshBasicMaterial | null = null
let boneMatLinkSelected: THREE.MeshBasicMaterial | null = null
let selectedAxes: THREE.AxesHelper | null = null
let timer: THREE.Timer | null = null
let resizeObserver: ResizeObserver | null = null
let rafId = 0
let loadToken = 0
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const worldPos = new THREE.Vector3()
const worldPosChild = new THREE.Vector3()
const boneDir = new THREE.Vector3()
const yAxis = new THREE.Vector3(0, 1, 0)
const boneQuat = new THREE.Quaternion()

function applyTransformProp(): void {
  if (!rootObject) return
  const transform = props.transform
  if (!transform) {
    rootObject.position.set(0, 0, 0)
    rootObject.rotation.set(0, 0, 0)
    rootObject.scale.set(1, 1, 1)
    return
  }
  rootObject.position.set(transform.position.x, transform.position.y, transform.position.z)
  rootObject.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z)
  rootObject.scale.set(transform.scale.x, transform.scale.y, transform.scale.z)
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.isMesh) {
      mesh.geometry?.dispose()
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) {
        material?.dispose?.()
      }
    }
  })
}

function boneLabel(bone: THREE.Bone): string {
  return bone.name?.trim() || bone.uuid.slice(0, 8)
}

function collectBoneNames(root: THREE.Object3D): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  root.traverse((child) => {
    if (!(child instanceof THREE.Bone)) return
    const label = boneLabel(child)
    if (seen.has(label)) return
    seen.add(label)
    names.push(label)
  })
  return names
}

function clearSelectedAxes(): void {
  if (!selectedAxes) return
  selectedAxes.removeFromParent()
  selectedAxes.geometry.dispose()
  const mat = selectedAxes.material
  if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
  else mat.dispose()
  selectedAxes = null
}

function clearBoneOverlay(): void {
  clearSelectedAxes()
  if (boneOverlay && scene) {
    scene.remove(boneOverlay)
  }
  boneOverlay = null
  boneEntries = []
  boneLinks = []
  jointGeom?.dispose()
  jointGeom = null
  segmentGeom?.dispose()
  segmentGeom = null
  boneMatNormal?.dispose()
  boneMatNormal = null
  boneMatSelected?.dispose()
  boneMatSelected = null
  boneMatLink?.dispose()
  boneMatLink = null
  boneMatLinkSelected?.dispose()
  boneMatLinkSelected = null
}

/** Maya / Blender 风格：沿 +Y 的双锥骨段（父关节→子关节） */
function createBoneSegmentGeometry(): THREE.BufferGeometry {
  const w = 0.22
  const mid = 0.2
  const positions = new Float32Array([
    0, 0, 0, // 0 parent tip
    w, mid, 0, // 1
    0, mid, w, // 2
    -w, mid, 0, // 3
    0, mid, -w, // 4
    0, 1, 0 // 5 child tip
  ])
  const indices = [
    0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1, // parent cone
    5, 2, 1, 5, 3, 2, 5, 4, 3, 5, 1, 4 // child cone
  ]
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geom.setIndex(indices)
  geom.computeVertexNormals()
  return geom
}

function ensureBoneMaterials(): void {
  if (!jointGeom) jointGeom = new THREE.SphereGeometry(1, 12, 12)
  if (!segmentGeom) segmentGeom = createBoneSegmentGeometry()
  if (!boneMatNormal) {
    boneMatNormal = new THREE.MeshBasicMaterial({
      color: BONE_COLOR,
      depthTest: true,
      transparent: true,
      opacity: 0.95
    })
  }
  if (!boneMatSelected) {
    boneMatSelected = new THREE.MeshBasicMaterial({
      color: BONE_SELECTED_COLOR,
      depthTest: true,
      transparent: true,
      opacity: 1
    })
  }
  if (!boneMatLink) {
    boneMatLink = new THREE.MeshBasicMaterial({
      color: BONE_LINE_COLOR,
      depthTest: true,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide
    })
  }
  if (!boneMatLinkSelected) {
    boneMatLinkSelected = new THREE.MeshBasicMaterial({
      color: BONE_SELECTED_COLOR,
      depthTest: true,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide
    })
  }
}

function syncModelMeshVisibility(): void {
  if (!rootObject) return
  const skeletonOnly = props.showSkeleton === true
  rootObject.traverse((child) => {
    if (child instanceof THREE.Bone) return
    if (
      child instanceof THREE.Mesh ||
      child instanceof THREE.Line ||
      child instanceof THREE.Points
    ) {
      child.visible = !skeletonOnly
    }
  })
}

function syncSkeletonOverlay(): void {
  clearBoneOverlay()
  syncModelMeshVisibility()
  if (!scene || !rootObject || !props.showSkeleton) return

  ensureBoneMaterials()
  boneOverlay = new THREE.Group()
  boneOverlay.name = 'bone-overlay'

  const bones: THREE.Bone[] = []
  const seen = new Set<string>()
  rootObject.traverse((child) => {
    if (!(child instanceof THREE.Bone)) return
    const name = boneLabel(child)
    if (seen.has(name)) return
    seen.add(name)
    bones.push(child)
    const joint = new THREE.Mesh(jointGeom!, boneMatNormal!)
    joint.name = `bone-joint:${name}`
    joint.renderOrder = 12
    joint.userData.boneName = name
    joint.frustumCulled = false
    boneOverlay!.add(joint)
    boneEntries.push({ name, bone: child, joint })
  })

  for (const bone of bones) {
    for (const child of bone.children) {
      if (!(child instanceof THREE.Bone)) continue
      const mesh = new THREE.Mesh(segmentGeom!, boneMatLink!)
      mesh.name = `bone-link:${boneLabel(bone)}>${boneLabel(child)}`
      mesh.renderOrder = 11
      mesh.userData.boneName = boneLabel(child)
      mesh.userData.parentBoneName = boneLabel(bone)
      mesh.frustumCulled = false
      boneOverlay!.add(mesh)
      boneLinks.push({
        from: bone,
        to: child,
        fromName: boneLabel(bone),
        toName: boneLabel(child),
        mesh
      })
    }
  }

  scene.add(boneOverlay)
  updateBoneMarkers()
}

function updateBoneMarkers(): void {
  if (!props.showSkeleton || !boneEntries.length) return

  for (const entry of boneEntries) {
    entry.bone.updateWorldMatrix(true, false)
    entry.bone.getWorldPosition(worldPos)
    entry.joint.position.copy(worldPos)
    const selected = props.selectedBone != null && props.selectedBone === entry.name
    entry.joint.material = selected ? boneMatSelected! : boneMatNormal!
    entry.joint.scale.setScalar(selected ? boneRadius * 0.55 : boneRadius * 0.32)

    if (selected) {
      if (!selectedAxes) {
        selectedAxes = new THREE.AxesHelper(boneRadius * 6)
        selectedAxes.renderOrder = 13
        scene?.add(selectedAxes)
      }
      selectedAxes.position.copy(worldPos)
      selectedAxes.visible = true
    }
  }

  for (const link of boneLinks) {
    link.from.getWorldPosition(worldPos)
    link.to.getWorldPosition(worldPosChild)
    boneDir.subVectors(worldPosChild, worldPos)
    const len = boneDir.length()
    if (len < 1e-6) {
      link.mesh.visible = false
      continue
    }
    link.mesh.visible = true
    boneDir.multiplyScalar(1 / len)
    boneQuat.setFromUnitVectors(yAxis, boneDir)
    link.mesh.position.copy(worldPos)
    link.mesh.quaternion.copy(boneQuat)
    const thickness = Math.max(boneRadius * 2.4, len * 0.14)
    link.mesh.scale.set(thickness, len, thickness)
    const selected =
      props.selectedBone != null &&
      (props.selectedBone === link.fromName || props.selectedBone === link.toName)
    link.mesh.material = selected ? boneMatLinkSelected! : boneMatLink!
  }

  if (selectedAxes && !props.selectedBone) {
    selectedAxes.visible = false
  }
}

function findClip(clipName: string | null | undefined): THREE.AnimationClip | null {
  if (!clipName?.trim() || !clips.length) return null
  const wanted = clipName.trim()
  return (
    clips.find((clip) => clip.name === wanted) ??
    clips.find((clip, index) => skeletonClipLabel(clip.name, index) === wanted) ??
    null
  )
}

function stopPreviewAction(): void {
  if (activeAction) {
    activeAction.stop()
    activeAction = null
  }
  mixer?.stopAllAction()
  if (rootObject) {
    rootObject.traverse((child) => {
      if (child instanceof THREE.SkinnedMesh && child.skeleton) {
        child.skeleton.pose()
      }
    })
  }
}

function syncPreviewAction(): void {
  if (!mixer || !rootObject) return
  const clip = findClip(props.previewClip)
  if (!clip || !props.previewPlaying) {
    stopPreviewAction()
    return
  }
  if (activeAction && activeAction.getClip() === clip) {
    activeAction.paused = false
    activeAction.setEffectiveTimeScale(Math.max(0.05, props.previewSpeed || 1))
    if (!activeAction.isRunning()) activeAction.play()
    return
  }
  mixer.stopAllAction()
  activeAction = mixer.clipAction(clip)
  activeAction.reset()
  activeAction.setEffectiveTimeScale(Math.max(0.05, props.previewSpeed || 1))
  activeAction.setLoop(THREE.LoopRepeat, Infinity)
  activeAction.play()
}

function clearRoot(): void {
  stopPreviewAction()
  clearBoneOverlay()
  mixer = null
  clips = []
  activeAction = null
  emit('clips', [])
  emit('bones', [])
  emit('meta', detectModelPreviewMeta(false, false, 0))
  if (!scene || !rootObject) return
  scene.remove(rootObject)
  disposeObject(rootObject)
  rootObject = null
}

function sceneHasRenderableMesh(object: THREE.Object3D): boolean {
  let found = false
  object.traverse((child) => {
    if (found) return
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.SkinnedMesh)) return
    const geom = child.geometry
    const count = geom?.getAttribute('position')?.count ?? 0
    if (count > 0) found = true
  })
  return found
}

function sceneHasBones(object: THREE.Object3D): boolean {
  let found = false
  object.traverse((child) => {
    if (found) return
    if (child instanceof THREE.Bone) found = true
  })
  return found
}

function fitCameraToBones(object: THREE.Object3D): boolean {
  if (!camera || !controls) return false
  const box = new THREE.Box3()
  const point = new THREE.Vector3()
  let any = false
  object.updateMatrixWorld(true)
  object.traverse((child) => {
    if (!(child instanceof THREE.Bone)) return
    child.getWorldPosition(point)
    box.expandByPoint(point)
    any = true
  })
  if (!any || box.isEmpty()) return false
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z, 0.25)
  boneRadius = Math.max(0.012, maxDim * 0.035)
  const distance = maxDim * 2.6
  camera.near = Math.max(distance / 100, 0.01)
  camera.far = Math.max(distance * 20, 100)
  camera.position.set(center.x + distance * 0.7, center.y + distance * 0.45, center.z + distance * 0.9)
  camera.lookAt(center)
  camera.updateProjectionMatrix()
  controls.target.copy(center)
  controls.update()
  return true
}

function fitCameraToObject(object: THREE.Object3D, preferBones = false): void {
  if (preferBones && fitCameraToBones(object)) return
  if (!camera || !controls) return
  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z, 0.001)
  boneRadius = Math.max(0.012, maxDim * 0.022)
  const distance = maxDim * 2.2
  camera.near = Math.max(distance / 100, 0.01)
  camera.far = Math.max(distance * 20, 100)
  camera.position.set(center.x + distance * 0.7, center.y + distance * 0.45, center.z + distance * 0.9)
  camera.lookAt(center)
  camera.updateProjectionMatrix()
  controls.target.copy(center)
  controls.update()
}

function resize(): void {
  const el = viewportEl.value
  if (!el || !renderer || !camera) return
  const width = Math.max(el.clientWidth, 1)
  const height = Math.max(el.clientHeight, 1)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height, false)
}

function animate(timestamp?: number): void {
  rafId = requestAnimationFrame(animate)
  timer?.update(timestamp)
  if (props.previewPlaying) mixer?.update(timer?.getDelta() ?? 0)
  if (props.showSkeleton) updateBoneMarkers()
  controls?.update()
  if (renderer && scene && camera) renderer.render(scene, camera)
}

function onPointerDown(event: PointerEvent): void {
  if (!props.showSkeleton || !renderer || !camera || !boneEntries.length) return
  if (event.button !== 0) return
  const rect = renderer.domElement.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  const pickables = [
    ...boneEntries.map((e) => e.joint),
    ...boneLinks.map((l) => l.mesh)
  ]
  const hits = raycaster.intersectObjects(pickables, false)
  if (!hits.length) return
  const name = hits[0]?.object.userData.boneName
  if (typeof name === 'string') {
    emit('select-bone', name)
    if (controls) {
      controls.enabled = false
      const reenable = (): void => {
        if (controls) controls.enabled = true
        window.removeEventListener('pointerup', reenable)
      }
      window.addEventListener('pointerup', reenable)
    }
    event.preventDefault()
    event.stopPropagation()
  }
}

function initThree(): void {
  const el = viewportEl.value
  if (!el || renderer) return

  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200)
  camera.position.set(2.4, 1.6, 2.8)

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  applyPreviewBackground()
  el.appendChild(renderer.domElement)
  renderer.domElement.addEventListener('pointerdown', onPointerDown)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.enablePan = false

  const ambient = new THREE.AmbientLight(0xffffff, 0.7)
  const key = new THREE.DirectionalLight(0xffffff, 1.1)
  key.position.set(3, 5, 2)
  const fill = new THREE.DirectionalLight(0xffffff, 0.35)
  fill.position.set(-2, 1, -2)
  scene.add(ambient, key, fill)

  const grid = new THREE.GridHelper(4, 8, 0x3a4149, 0x2a3036)
  grid.position.y = 0
  scene.add(grid)

  timer?.dispose()
  timer = new THREE.Timer()
  timer.connect(document)
  resize()
  resizeObserver = new ResizeObserver(() => resize())
  resizeObserver.observe(el)
  animate()
}

async function loadModel(relativePath: string | null | undefined): Promise<void> {
  const token = ++loadToken
  clearRoot()

  if (!relativePath?.trim()) {
    status.value = 'empty'
    errorMessage.value = ''
    return
  }

  status.value = 'loading'
  errorMessage.value = ''

  try {
    const url = await window.studio.getAssetFileUrl(relativePath)
    if (token !== loadToken) return
    const loaded = await loadModelScene(url, relativePath)
    if (token !== loadToken || !scene) return
    rootObject = loaded.scene
    clips = loaded.animations.slice()
    mixer = clips.length ? new THREE.AnimationMixer(rootObject) : null
    scene.add(rootObject)
    const sceneDefaults = extractModelSceneDefaults(rootObject)
    emit('scene-defaults', sceneDefaults)
    applyTransformProp()
    const hasMesh = sceneHasRenderableMesh(rootObject)
    const hasBones = sceneHasBones(rootObject)
    const meta = detectModelPreviewMeta(hasMesh, hasBones, clips.length)
    fitCameraToObject(rootObject, meta.animationOnly)
    emit(
      'clips',
      clips.map((clip, index) => skeletonClipLabel(clip.name, index))
    )
    emit('bones', collectBoneNames(rootObject))
    emit('meta', meta)
    syncSkeletonOverlay()
    syncPreviewAction()
    status.value = 'ready'
  } catch (error) {
    if (token !== loadToken) return
    status.value = 'error'
    errorMessage.value =
      error instanceof Error ? error.message : t('asset.inspector.modelPreviewError')
  }
}

function disposeThree(): void {
  cancelAnimationFrame(rafId)
  rafId = 0
  loadToken += 1
  resizeObserver?.disconnect()
  resizeObserver = null
  timer?.dispose()
  timer = null
  renderer?.domElement.removeEventListener('pointerdown', onPointerDown)
  clearRoot()
  controls?.dispose()
  controls = null
  if (renderer) {
    renderer.dispose()
    renderer.domElement.remove()
    renderer = null
  }
  scene = null
  camera = null
}

onMounted(() => {
  initThree()
  void loadModel(props.relativePath)
})

watch(
  () => props.relativePath,
  (path) => {
    void loadModel(path)
  }
)

watch(
  () => props.transform,
  () => {
    applyTransformProp()
  },
  { deep: true }
)

watch(
  () => [props.previewClip, props.previewPlaying, props.previewSpeed] as const,
  () => {
    syncPreviewAction()
  }
)

watch(
  () => props.showSkeleton,
  () => {
    syncSkeletonOverlay()
  }
)

watch(
  () => props.selectedBone,
  () => {
    updateBoneMarkers()
  }
)

watch(themePreference, () => {
  applyPreviewBackground()
})

onBeforeUnmount(() => {
  disposeThree()
})
</script>

<style scoped>
.model-preview {
  position: relative;
  width: 100%;
  height: 200px;
  border-radius: 8px;
  overflow: hidden;
  background: var(--graph-preview-bg);
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
}

.viewport {
  width: 100%;
  height: 100%;
}

.viewport :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
}

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
  background: color-mix(in srgb, var(--graph-preview-bg) 72%, transparent);
  pointer-events: none;
}

.overlay.error {
  color: var(--danger);
}
</style>
