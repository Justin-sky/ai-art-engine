<template>
  <div class="model-preview">
    <div ref="viewportEl" class="viewport" />
    <div v-if="status === 'loading'" class="overlay">
      {{ t('asset.inspector.modelPreviewLoading') }}
    </div>
    <div v-else-if="status === 'empty'" class="overlay">
      {{ t('asset.inspector.unlinked') }}
    </div>
    <div v-else-if="status === 'error'" class="overlay error">
      {{ errorMessage }}
    </div>
    <div v-if="showSaveToLibrary && canSave(relativePath)" class="save-slot">
      <PreviewSaveToLibraryButton
        :can-save="true"
        :saved="isSaved(relativePath)"
        :saving="isSaving(relativePath)"
        @save="openSave(savePath)"
      />
    </div>
    <SaveAssetDialog
      v-if="showSaveToLibrary"
      ref="dialogRef"
      :open="dialogOpen"
      :default-name="defaultName"
      :default-folder-id="defaultFolderId"
      :title="t('studio.chat.saveToLibraryTitle')"
      :subtitle="t('studio.chat.saveToLibrarySubtitle')"
      @confirm="confirmSave"
      @cancel="closeDialog"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { normalizeOutputPathKey } from '@shared/outputScan'
import { useSaveCacheAsset } from '../composables/useSaveCacheAsset'
import PreviewSaveToLibraryButton from './PreviewSaveToLibraryButton.vue'
import SaveAssetDialog from './SaveAssetDialog.vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { loadModelScene } from '../features/director/loadModelScene'
import { skeletonClipLabel } from '../features/director/skeletonAnim'
import { collectSkinningBones, isSkinningBone } from '../features/director/skeletonRetarget'
import { useStudioI18n } from '../composables/useStudioI18n'
import { themePreference } from '../editor/preferences'
import { detectModelPreviewMeta, type ModelPreviewMeta } from '@shared/domain'
import type { StageVec3 } from '@shared/domain'
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
    /**
     * 预设骨架拓扑（armature 空间 head/tail 坐标）。模型文件里没有 THREE.Bone
     * 时（rigSkin 预设路径只写 rigMeta 元数据、不烘焙模型），用它合成骨架预览。
     */
    presetBones?: readonly PresetBoneSpec[] | null
    /**
     * 骨名 → 局部欧拉弧度（与 GraphNodeParams.bonePose 同口径）。modelPose 节点
     * 用它给 SkinnedMesh 套姿势：bind 局部 quaternion 乘上 Euler 偏移四元数，
     * 子骨自然跟随父骨 FK，skinned mesh 按原始 vertex 权重 / blend 变形。
     */
    bonePose?: Readonly<Record<string, StageVec3>> | null
    /** Inspector 预览：把 Cache 产物保存到资产库。对话卡已有独立按钮，不要开。 */
    showSaveToLibrary?: boolean
  }>(),
  {
    relativePath: null,
    transform: null,
    previewClip: null,
    previewPlaying: false,
    previewSpeed: 1,
    showSkeleton: false,
    selectedBone: null,
    presetBones: null,
    showSaveToLibrary: false,
    bonePose: null
  }
)

const {
  dialogOpen,
  defaultName,
  defaultFolderId,
  dialogRef,
  canSave,
  isSaved,
  isSaving,
  openSave,
  closeDialog,
  confirmSave
} = useSaveCacheAsset()
const savePath = computed(() => normalizeOutputPathKey(props.relativePath ?? ''))

/** 骨架来源：模型自带 / 预设拓扑合成 / 都没有 */
type SkeletonSource = 'baked' | 'preset' | 'none'

type PresetBoneSpec = {
  name: string
  parent?: string
  head: [number, number, number]
  tail: [number, number, number]
}

const emit = defineEmits<{
  clips: [names: string[]]
  bones: [names: string[]]
  meta: [meta: ModelPreviewMeta]
  'select-bone': [name: string | null]
  'scene-defaults': [defaults: ModelSceneDefaults]
  'skeleton-source': [source: SkeletonSource]
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
  /** 模型自带骨骼；预设合成骨架时为 null（用 rest 静态位置） */
  bone: THREE.Bone | null
  joint: THREE.Mesh
  /** 预设合成骨架的关节静态世界坐标；模型自带骨骼时为 null */
  rest: THREE.Vector3 | null
}

type BoneLink = {
  from: THREE.Bone | null
  to: THREE.Bone | null
  fromName: string
  toName: string
  mesh: THREE.Mesh
  /** 预设合成骨段的静态端点（armature 空间换算到模型包围盒后）；自带骨骼时为 null */
  restFrom: THREE.Vector3 | null
  restTo: THREE.Vector3 | null
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
/** 模型自带骨骼的 bind 局部 quaternion（GLTF 读进来时的 rest pose） */
const boneRotationSnapshot = new Map<string, { bone: THREE.Bone; bind: THREE.Quaternion }>()
const poseEuler = new THREE.Euler()
const poseOffsetQuat = new THREE.Quaternion()
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
  for (const bone of collectSkinningBones(root)) {
    const label = boneLabel(bone)
    if (seen.has(label)) continue
    seen.add(label)
    names.push(label)
  }
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
    0,
    0,
    0, // 0 parent tip
    w,
    mid,
    0, // 1
    0,
    mid,
    w, // 2
    -w,
    mid,
    0, // 3
    0,
    mid,
    -w, // 4
    0,
    1,
    0 // 5 child tip
  ])
  const indices = [
    0,
    1,
    2,
    0,
    2,
    3,
    0,
    3,
    4,
    0,
    4,
    1, // parent cone
    5,
    2,
    1,
    5,
    3,
    2,
    5,
    4,
    3,
    5,
    1,
    4 // child cone
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
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.95
    })
  }
  if (!boneMatSelected) {
    boneMatSelected = new THREE.MeshBasicMaterial({
      color: BONE_SELECTED_COLOR,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 1
    })
  }
  if (!boneMatLink) {
    boneMatLink = new THREE.MeshBasicMaterial({
      color: BONE_LINE_COLOR,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide
    })
  }
  if (!boneMatLinkSelected) {
    boneMatLinkSelected = new THREE.MeshBasicMaterial({
      color: BONE_SELECTED_COLOR,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide
    })
  }
}

function syncModelMeshVisibility(hideMesh: boolean): void {
  if (!rootObject) return
  rootObject.traverse((child) => {
    if (isSkinningBone(child)) return
    if (
      child instanceof THREE.Mesh ||
      child instanceof THREE.Line ||
      child instanceof THREE.Points
    ) {
      child.visible = !hideMesh
    }
  })
}

function syncSkeletonOverlay(): void {
  clearBoneOverlay()
  if (!scene || !rootObject || !props.showSkeleton) {
    syncModelMeshVisibility(false)
    return
  }

  ensureBoneMaterials()
  boneOverlay = new THREE.Group()
  boneOverlay.name = 'bone-overlay'

  const bones = collectSkinningBones(rootObject)
  const seen = new Set<string>()
  const unique: THREE.Bone[] = []
  for (const bone of bones) {
    const name = boneLabel(bone)
    if (seen.has(name)) continue
    seen.add(name)
    unique.push(bone)
  }

  if (unique.length) {
    syncModelMeshVisibility(true)
    for (const bone of unique) {
      const name = boneLabel(bone)
      const joint = new THREE.Mesh(jointGeom!, boneMatNormal!)
      joint.name = `bone-joint:${name}`
      joint.renderOrder = 12
      joint.userData.boneName = name
      joint.frustumCulled = false
      boneOverlay.add(joint)
      boneEntries.push({ name, bone, joint, rest: null })
    }

    const boneSet = new Set(unique)
    for (const bone of unique) {
      for (const child of bone.children) {
        if (!isSkinningBone(child) || !boneSet.has(child)) continue
        const mesh = new THREE.Mesh(segmentGeom!, boneMatLink!)
        mesh.name = `bone-link:${boneLabel(bone)}>${boneLabel(child)}`
        mesh.renderOrder = 11
        mesh.userData.boneName = boneLabel(child)
        mesh.userData.parentBoneName = boneLabel(bone)
        mesh.frustumCulled = false
        boneOverlay.add(mesh)
        boneLinks.push({
          from: bone,
          to: child,
          fromName: boneLabel(bone),
          toName: boneLabel(child),
          mesh,
          restFrom: null,
          restTo: null
        })
      }
    }

    scene.add(boneOverlay)
    updateBoneMarkers()
    fitCameraToBones(rootObject)
    emit('skeleton-source', 'baked')
    return
  }

  // 模型文件里没有可绘制骨骼——有预设拓扑时按 armature 空间坐标合成骨架预览。
  if (buildPresetSkeletonOverlay()) {
    syncModelMeshVisibility(true)
    scene.add(boneOverlay)
    updateBoneMarkers()
    fitCameraToBoneOverlay()
    emit('skeleton-source', 'preset')
    return
  }

  syncModelMeshVisibility(false)
  clearBoneOverlay()
  emit('skeleton-source', 'none')
}

/** 按预设拓扑合成骨架（armature 空间 head/tail → 模型包围盒内缩放对齐） */
function buildPresetSkeletonOverlay(): boolean {
  const specs = props.presetBones
  if (!boneOverlay || !rootObject || !specs?.length) return false

  // 模型包围盒（mesh 被 showSkeleton 隐藏后 setFromObject 仍读几何）
  const modelBox = new THREE.Box3().setFromObject(rootObject)
  if (modelBox.isEmpty()) return false
  const modelSize = modelBox.getSize(new THREE.Vector3())
  const modelCenter = modelBox.getCenter(new THREE.Vector3())

  const skelBox = new THREE.Box3()
  for (const spec of specs) {
    skelBox.expandByPoint(new THREE.Vector3(...spec.head))
    skelBox.expandByPoint(new THREE.Vector3(...spec.tail))
  }
  const skelSize = skelBox.getSize(new THREE.Vector3())
  const skelCenter = skelBox.getCenter(new THREE.Vector3())
  // 用三轴最大边对齐：Blender Z-up 拓扑的「身高」在 Z，不能只除 skelSize.y（会把骨架放大到视野外）
  const modelExtent = Math.max(modelSize.x, modelSize.y, modelSize.z, 1e-3)
  const skelExtent = Math.max(skelSize.x, skelSize.y, skelSize.z, 1e-3)
  const scale = modelExtent / skelExtent
  const toWorld = (p: readonly [number, number, number]): THREE.Vector3 =>
    new THREE.Vector3(p[0], p[1], p[2]).sub(skelCenter).multiplyScalar(scale).add(modelCenter)
  boneRadius = Math.max(0.01, modelExtent * 0.015)

  for (const spec of specs) {
    const name = spec.name?.trim() || spec.name
    const pos = toWorld(spec.head)
    const joint = new THREE.Mesh(jointGeom!, boneMatNormal!)
    joint.name = `bone-joint:${name}`
    joint.position.copy(pos)
    joint.scale.setScalar(boneRadius * 0.35)
    joint.renderOrder = 12
    joint.userData.boneName = name
    joint.frustumCulled = false
    boneOverlay!.add(joint)
    boneEntries.push({ name, bone: null, joint, rest: pos.clone() })
  }

  for (const spec of specs) {
    const name = spec.name?.trim() || spec.name
    const from = toWorld(spec.head)
    const to = toWorld(spec.tail)
    const mesh = new THREE.Mesh(segmentGeom!, boneMatLink!)
    mesh.name = `bone-link:${name}`
    mesh.renderOrder = 11
    mesh.userData.boneName = name
    mesh.frustumCulled = false
    const dir = new THREE.Vector3().subVectors(to, from)
    const len = dir.length()
    if (len < 1e-6) {
      mesh.visible = false
    } else {
      dir.multiplyScalar(1 / len)
      mesh.position.copy(from)
      mesh.quaternion.copy(boneQuat.setFromUnitVectors(yAxis, dir))
      const thickness = Math.max(boneRadius * 0.5, len * 0.07)
      mesh.scale.set(thickness, len, thickness)
    }
    boneOverlay!.add(mesh)
    boneLinks.push({
      from: null,
      to: null,
      fromName: name,
      toName: name,
      mesh,
      restFrom: from,
      restTo: to
    })
  }

  emit(
    'bones',
    boneEntries.map((entry) => entry.name)
  )
  return true
}

function updateBoneMarkers(): void {
  if (!props.showSkeleton || !boneEntries.length) return

  for (const entry of boneEntries) {
    if (entry.bone) {
      entry.bone.updateWorldMatrix(true, false)
      entry.bone.getWorldPosition(worldPos)
      entry.joint.position.copy(worldPos)
    } else if (entry.rest) {
      worldPos.copy(entry.rest)
      entry.joint.position.copy(entry.rest)
    } else {
      continue
    }
    const selected = props.selectedBone != null && props.selectedBone === entry.name
    entry.joint.material = selected ? boneMatSelected! : boneMatNormal!
    // 关节球：能看清 / 可点选，但不盖住骨架结构
    entry.joint.scale.setScalar(selected ? boneRadius * 0.45 : boneRadius * 0.32)

    if (selected) {
      if (!selectedAxes) {
        selectedAxes = new THREE.AxesHelper(boneRadius * 4)
        selectedAxes.renderOrder = 13
        scene?.add(selectedAxes)
      }
      selectedAxes.position.copy(worldPos)
      selectedAxes.visible = true
    }
  }

  for (const link of boneLinks) {
    if (link.from && link.to) {
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
      const thickness = Math.max(boneRadius * 0.5, len * 0.07)
      link.mesh.scale.set(thickness, len, thickness)
    } else if (!(link.restFrom && link.restTo)) {
      continue
    }
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
  boneRotationSnapshot.clear()
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

/**
 * 模型加载完成后抓取每根 THREE.Bone 的 bind 局部 quaternion（rest-pose 旋转）；
 * 之后套姿势都用 bind 作为基准，避免在已偏移基础上叠加导致累计漂移。
 */
function captureBoneRotationSnapshot(root: THREE.Object3D): void {
  boneRotationSnapshot.clear()
  for (const bone of collectSkinningBones(root)) {
    const name = boneLabel(bone)
    if (!name || boneRotationSnapshot.has(name)) continue
    boneRotationSnapshot.set(name, { bone, bind: bone.quaternion.clone() })
  }
}

/**
 * 把姿态字典（骨名 → 局部欧拉弧度，与 GraphNodeParams.bonePose 同口径）套到当前
 * 模型上。空字典 / null 时恢复到 bind。骨名匹配使用原始 GLTF 骨骼名（不做归一化
 * ——Inspector 拿到的就是 Blender readback 的原始名）。
 */
function applyBonePoseToRoot(
  root: THREE.Object3D,
  pose: Readonly<Record<string, StageVec3>> | null | undefined
): void {
  if (!boneRotationSnapshot.size) captureBoneRotationSnapshot(root)
  for (const snap of boneRotationSnapshot.values()) {
    snap.bone.quaternion.copy(snap.bind)
  }
  if (!pose) return
  for (const [name, rot] of Object.entries(pose)) {
    const key = name?.trim()
    if (!key || !rot) continue
    if (rot.x === 0 && rot.y === 0 && rot.z === 0) continue
    const snap = boneRotationSnapshot.get(key)
    if (!snap) continue
    poseEuler.set(rot.x, rot.y, rot.z, 'XYZ')
    poseOffsetQuat.setFromEuler(poseEuler)
    snap.bone.quaternion.multiply(poseOffsetQuat)
  }
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
  return collectSkinningBones(object).length > 0
}

function fitCameraToBones(object: THREE.Object3D): boolean {
  if (!camera || !controls) return false
  const box = new THREE.Box3()
  const point = new THREE.Vector3()
  let any = false
  object.updateMatrixWorld(true)
  for (const bone of collectSkinningBones(object)) {
    bone.getWorldPosition(point)
    box.expandByPoint(point)
    any = true
  }
  if (!any || box.isEmpty()) return false
  fitCameraToBox(box)
  return true
}

/** 预设合成骨架：按 overlay 关节包围盒取景 */
function fitCameraToBoneOverlay(): boolean {
  if (!camera || !controls || !boneEntries.length) return false
  const box = new THREE.Box3()
  for (const entry of boneEntries) {
    if (entry.rest) box.expandByPoint(entry.rest)
    else if (entry.joint) box.expandByPoint(entry.joint.position)
  }
  if (box.isEmpty()) return false
  fitCameraToBox(box)
  return true
}

function fitCameraToBox(box: THREE.Box3): void {
  if (!camera || !controls) return
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z, 0.25)
  boneRadius = Math.max(0.012, maxDim * 0.025)
  const distance = maxDim * 2.6
  camera.near = Math.max(distance / 100, 0.01)
  camera.far = Math.max(distance * 20, 100)
  camera.position.set(
    center.x + distance * 0.7,
    center.y + distance * 0.45,
    center.z + distance * 0.9
  )
  camera.lookAt(center)
  camera.updateProjectionMatrix()
  controls.target.copy(center)
  controls.update()
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
  camera.position.set(
    center.x + distance * 0.7,
    center.y + distance * 0.45,
    center.z + distance * 0.9
  )
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
  const pickables = [...boneEntries.map((e) => e.joint), ...boneLinks.map((l) => l.mesh)]
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
    captureBoneRotationSnapshot(rootObject)
    applyBonePoseToRoot(rootObject, props.bonePose)
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
    // 父级 flex 曾把视口挤成 0 高时，切 Tab 后补一次尺寸
    requestAnimationFrame(() => resize())
  }
)

watch(
  () => props.presetBones,
  () => {
    if (props.showSkeleton) syncSkeletonOverlay()
  },
  { deep: true }
)

watch(
  () => props.bonePose,
  (pose) => {
    if (rootObject) applyBonePoseToRoot(rootObject, pose ?? null)
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
  min-height: 160px;
  flex-shrink: 0;
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

.save-slot {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 3;
}
</style>
