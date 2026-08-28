import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { loadModelScene } from './loadModelScene'
import { collectStageMaterialSlots } from './stageMaterialSlots'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import {
  clampDirectorPanoramaRadius,
  clampDirectorSceneScalePercent,
  clampGridDensity,
  clampGridOpacity,
  createDefaultDirectorAnimation,
  createDefaultDirectorStage,
  createDefaultDirectorCamera,
  createDefaultDirectorViewer,
  DEFAULT_DIRECTOR_CAMERA_FOV,
  DEFAULT_DIRECTOR_PANORAMA_RADIUS,
  DEFAULT_DIRECTOR_SKY_COLOR,
  isDirectorSkyFollowTheme,
  DEFAULT_GRID_DENSITY,
  DEFAULT_GRID_OFFSET_Y,
  DEFAULT_GRID_OPACITY,
  DIRECTOR_PANORAMA_HIERARCHY_ID,
  directorAspectRatioValue,
  directorViewerForwardFromRotation,
  directorViewerRotationFromLook,
  gridDensityToCellSize,
  isAnimationModelAsset,
  isNonPlaceableModelAsset,
  isPoseModelAsset,
  buildPoseAssetGenParams,
  readPoseAssetData,
  getActiveDirectorCamera,
  normalizeDirectorAspectRatio,
  normalizeDirectorSkyColor,
  readDirectorAnimation,
  readDirectorSceneWorld,
  readModelAssetTransform,
  readModelAssetColor,
  resolveDirectorCameras,
  type DirectorAnimKeyframe,
  type DirectorAnimPath,
  type DirectorAnimPathHandle,
  type DirectorAnimPathKind,
  type DirectorSkeletonClipSegment,
  type DirectorAnimTrack,
  type DirectorCameraCutSegment,
  type DirectorAnimationState,
  type DirectorPathForwardAxis,
  directorAnimTrackHasContent,
  directorTrackSkeletonClips,
  DEFAULT_PATH_FORWARD_AXIS,
  type DirectorAspectRatio,
  type DirectorCameraGroup,
  type DirectorCameraState,
  type DirectorCameraShot,
  type DirectorCameraVideo,
  buildGeneratedMediaFileKey,
  type DirectorSceneWorld,
  type DirectorStageState,
  type DirectorViewMode,
  type DirectorViewerState,
  type StageObjectState,
  type StageMaterialTextureOverrides,
  type StagePrimitive,
  STAGE_TEXTURE_SLOTS,
  type StageTextureSlot,
  type StageVec3,
  type TransformMode,
  type DirectorPosePreset,
  type DirectorIkChainSpec,
  type DirectorIkChainSlotId,
  type AssetInfo
} from '@shared/domain'
import {
  findDirectorComboCameraPreset,
  findDirectorShotCameraPreset,
  type DirectorComboCameraDef
} from '@shared/directorCameraPresets'
import {
  bakeKeyframesFromPath,
  buildCirclePath,
  buildRectPath,
  derivePathHandles,
  finalizeDrawnPath,
  flattenPathPositions,
  flattenStagePositions,
  pathHasEditableHandles,
  requiredDrawClicks,
  sampleAnimKeyframes,
  sampleAnimPath,
  rotationFromPathTangent,
  type AnimKeyframeSample
} from './animationPath'
import {
  clampSkeletonSegmentRange,
  findActiveSkeletonSegment,
  placeSkeletonSegmentRange,
  skeletonClipLabel,
  skeletonClipOption,
  skeletonSegmentLocalTime,
  type SkeletonClipOption
} from './skeletonAnim'
import {
  retargetClipToCharacter,
  collectPoseEditBoneNames,
  collectPoseEditBones,
  collectSkinningBones,
  findNearestPoseBoneParent
} from './skeletonRetarget'
import {
  detectDefaultIkChains,
  mergeIkChains,
  IK_CHAIN_SLOTS,
  type IkChain,
  type IkChainSlot
} from './ikChains'
import { solveCcdIk } from './ccdIkSolve'
import {
  applyBoneOffset,
  boneOffsetFromBase,
  isNearIdentityQuat,
  offsetFromEulerXYZ
} from './bonePoseMath'
import {
  encodeBonePoseNormalized,
  mapNormalizedPoseToTargetBones
} from './poseAsset'
import {
  createPoseSkeletonOverlay,
  objectHasSkeleton,
  type PoseSkeletonOverlay
} from './poseSkeletonOverlay'
import {
  findDirectorProcessingNode,
  patchGenParamsWithNodeStage,
  readStagesByNodeId,
  resolveDirectorStageForNode,
  shouldResetDirectorStage
} from './directorStageBinding'
import {
  flattenAssetValues,
  flattenImagesValues,
  isDirectorProcessingNode,
  type GraphValue
} from '@shared/graph'
import { resolveAssetFileUrl } from '../media/assetUrlCache'
import { extractModelSceneDefaults } from './modelSceneDefaults'
import { persistAssetRecord, useAssetRecord } from '../../composables/useAssetRecord'
import { useEditorDocumentSession } from '../../composables/useEditorDocumentSession'
import { useStudioI18n } from '../../composables/useStudioI18n'
import { useEditorKernel } from '../../editor/kernel'
import { themePreference } from '../../editor/preferences'
import { useProjectStore } from '../../stores/project'
import { graphEditorHosts } from '../graph/model/graphEditorHosts'
import unityCameraIconUrl from '../../assets/unity-camera-icon.png'

export type DirectorSelectionKind = 'object' | 'camera' | 'scene' | 'panorama' | null

/** ????????????? / ???? */
export type DirectorStageEditMode = 'scene' | 'animation'

export type DirectorMediaGalleryTab = 'shots' | 'actions'

/** 相机 far 平面 = 全景半径倍数（需覆盖最大拉远距离，避免远景被裁掉） */
const DIRECTOR_CAMERA_FAR_RADIUS_MULTIPLIER = 10
/** 无全景背景时允许的最大拉远距离 = 全景半径倍数（模型可在屏幕上显示得更小） */
const DIRECTOR_MAX_ZOOMOUT_RADIUS_MULTIPLIER = 6

export interface UseDirectorStageSceneOptions {
  directorAssetId: string
  /** ?????????????????????????*/
  processingNodeId?: string | null
  viewportEl: Ref<HTMLDivElement | null>
  onPreview?: (url: string) => void
}

export function useDirectorStageScene(options: UseDirectorStageSceneOptions) {
  const project = useProjectStore()
  const editor = useEditorKernel()
  const { t } = useStudioI18n()
  const { asset } = useAssetRecord(options.directorAssetId)
  const graphHostId = computed(() => `asset:${options.directorAssetId}`)

  const error = ref('')
  const linkedPanoramaId = ref<string | null>(null)
  const transformMode = ref<TransformMode>('translate')
  const selectedObjectId = ref<string | null>(null)
  const selectedCameraId = ref<string | null>(null)
  const selectionKind = ref<DirectorSelectionKind>('scene')
  const viewMode = ref<DirectorViewMode>('director')
  /** 浮动相机预览窗：开启后按层级多选相机实时渲染各自视角 */
  const cameraPreviewOpen = ref(false)
  const cameraPreviewIds = ref<string[]>([])
  /** 预览已弹出到独立 OS 窗口：主窗口隐藏面板但继续渲染供 captureStream 取帧 */
  const cameraPreviewDetached = ref(false)
  const cameraPreviewCanvases = new Map<string, HTMLCanvasElement>()
  /** 层级多选（含相机）同步，供右键/快捷键复制使用 */
  const multiSelectedIds = ref<string[]>([])
  /** 复制剪贴板：对象 / 相机深拷贝 */
  const stageClipboard = ref<
    Array<{ kind: 'camera'; data: DirectorCameraState } | { kind: 'object'; data: StageObjectState }>
  >([])
  const isPanning = ref(false)
  const isOrbiting = ref(false)
  /** ?????? UE ?????? + WASD/QE? */
  let flyNavigateActive = false
  const flyKeys = {
    forward: false,
    back: false,
    left: false,
    right: false,
    up: false,
    down: false,
    boost: false
  }
  let flyLastClientX = 0
  let flyLastClientY = 0
  const flyEuler = new THREE.Euler(0, 0, 0, 'YXZ')
  const flyForward = new THREE.Vector3()
  const flyRight = new THREE.Vector3()
  const flyMove = new THREE.Vector3()
  const flyWorldUp = new THREE.Vector3(0, 1, 0)
  const FLY_LOOK_SPEED = 0.0022
  const FLY_MOVE_SPEED = 5
  const FLY_BOOST_MULT = 2.5
  const FLY_ORBIT_TARGET_DIST = 3
  const stage = ref<DirectorStageState>(createDefaultDirectorStage())
  const previewRevision = ref(0)
  const aspectRatio = computed({
    get: (): DirectorAspectRatio => normalizeDirectorAspectRatio(stage.value.aspectRatio),
    set: (value: DirectorAspectRatio) => {
      stage.value.aspectRatio = value
    }
  })

  function currentPanoramaRadius(): number {
    return clampDirectorPanoramaRadius(
      stage.value.panoramaRadius ?? DEFAULT_DIRECTOR_PANORAMA_RADIUS
    )
  }

  let renderer: THREE.WebGLRenderer | null = null
  let labelRenderer: CSS2DRenderer | null = null
  let scene: THREE.Scene | null = null
  /** ?? / ?? / ?? / ?????????????????? */
  let contentRoot: THREE.Group | null = null
  let camera: THREE.PerspectiveCamera | null = null
  let orbit: OrbitControls | null = null
  let transform: TransformControls | null = null
  let transformHelper: THREE.Object3D | null = null
  let poseBoneTransform: TransformControls | null = null
  let poseBoneTransformHelper: THREE.Object3D | null = null
  let poseBoneDragging = false
  /**
   * FK ???TransformControls ??local ??????????quaternion??   * IK ????????????CCD ?? links????????bonePose??   */
  const poseBoneEditEuler = new THREE.Euler()
  const dragBindLocalQuat = new THREE.Quaternion()
  const poseTmpQuat = new THREE.Quaternion()
  const poseTmpVec3 = new THREE.Vector3()
  /** 'fk' ????'ik' ????????*/
  const poseEditMode = ref<'fk' | 'ik' | 'ai'>('fk')
  const selectedIkChainId = ref<IkChainSlot | null>(null)
  let ikTarget: THREE.Object3D | null = null
  let ikTargetGeom: THREE.SphereGeometry | null = null
  let ikTargetMat: THREE.MeshBasicMaterial | null = null
  /** objectId ??????????*/
  const ikChainsByObject = new Map<string, IkChain[]>()
  /** ???????????? gizmo ????quat?euler?quat ???????? */
  const bonePoseOffsetCache = new Map<string, Map<string, THREE.Quaternion>>()
  /** bind ?????objectId ??boneName ??bind ???????????= bind ? offset ?? SET????*/
  type BindPoseRecord = {
    position: THREE.Vector3
    quaternion: THREE.Quaternion
    scale: THREE.Vector3
  }
  const bindPoseSnapshots = new Map<string, Map<string, BindPoseRecord>>()
  let panoramaSphere: THREE.Mesh | null = null
  let panoramaTexture: THREE.Texture | null = null
  let grid: THREE.GridHelper | null = null
  let resizeObserver: ResizeObserver | null = null
  let rafId = 0
  let lastFrameAt = 0
  let lastRenderAt = 0
  /** ????????????????????????? 15fps ????????*/
  let forceRenderUntil = 0
  let suppressTransformEvent = false
  let skipAssetWatch = false
  let savedBeforeUnmount = false
  let appliedStageFingerprint: string | null = null
  let selectionHelper: THREE.BoxHelper | null = null
  const SELECTION_BOUNDS_STORAGE_KEY = 'director.stage.selectionBoundsVisible'
  const selectionBoundsVisible = ref(readSelectionBoundsVisiblePref())
  /** Unity 式 Gizmos 全局开关与尺寸 */
  const gizmoSize = ref(1)
  const sceneLabelsVisible = ref(true)
  const cameraGizmosVisible = ref(true)
  const gridGizmoVisible = ref(true)
  /** 截屏 / 视频导出是否把场景文字标签画进输出画面 */
  const captureLabelsVisible = ref(false)
  /** 截屏 / 视频导出是否把相机名称标签画进输出画面（独立开关） */
  const captureCameraLabelsVisible = ref(false)
  /** ???????? + ?????????????????*/
  type ShotViz = {
    root: THREE.Group
    camera: THREE.PerspectiveCamera
    helper: THREE.CameraHelper
    body: THREE.Group
  }
  const shotVisuals = new Map<string, ShotViz>()
  const cameraLabels = new Map<string, CSS2DObject>()
  const SHOT_VIZ_NEAR = 0.2
  const SHOT_VIZ_FAR = 10
  /** ???????? rebuildObjects ????????? mesh ????????????*/
  let rebuildGeneration = 0
  const objectMeshes = new Map<string, THREE.Object3D>()
  const objectLabels = new Map<string, CSS2DObject>()
  let poseSkeletonOverlay: PoseSkeletonOverlay | null = null
  const selectedPoseBone = ref<string | null>(null)
  const bonePoseOffsetQuat = new THREE.Quaternion()
  type SkeletonRuntime = {
    mixer: THREE.AnimationMixer
    /** ???? GLB ???? */
    embeddedClips: THREE.AnimationClip[]
  }
  const skeletonRuntimes = new Map<string, SkeletonRuntime>()
  /** ????????clip + ??????????*/
  type AnimationAssetCacheEntry = {
    clips: THREE.AnimationClip[]
    scene: THREE.Object3D
  }
  const animationAssetCache = new Map<string, AnimationAssetCacheEntry>()
  /** `${assetId}|${objectId}|${clipName}` ????????????clip */
  const retargetedClipCache = new Map<string, THREE.AnimationClip>()
  /** ??????????clip ?? */
  const skeletonClipsRevision = ref(0)
  const animSelectedSkeletonClipId = ref<string | null>(null)
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const previewCanvas = document.createElement('canvas')
  let shotRenderTarget: THREE.WebGLRenderTarget | null = null
  /** ??/?????????????? WebGL ?????????????????*/
  let offscreenCaptureLock = 0

  const animPlaying = ref(false)
  const animTime = ref(0)
  /** ?????????????????????? */
  const animPlaybackRate = ref(1)
  const animExporting = ref(false)
  const animSelectedTrackId = ref<string | null>(null)
  const animSelectedKeyframeId = ref<string | null>(null)
  const animSelectedCameraCutSegmentId = ref<string | null>(null)
  const pathDrawMode = ref<{ trackId: string; kind: DirectorAnimPathKind } | null>(null)
  const stageEditMode = ref<DirectorStageEditMode>('scene')
  const pathDrawDraft = ref<StageVec3[]>([])
  let pathDrawPlaneY = 0
  let pathDrawPencilActive = false
  const pathVisuals = new Map<string, Line2>()
  let pathDraftLine: Line2 | null = null
  const pathLineMaterials = new Set<LineMaterial>()
  const pathDrawPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const pathHitPoint = new THREE.Vector3()
  const PATH_LINE_COLOR = 0x5b9cf5
  const PATH_LINE_SELECTED_COLOR = 0xffc857
  const PATH_DRAFT_COLOR = 0x7dd3a0
  const PATH_LINE_WIDTH = 4
  const PATH_LINE_SELECTED_WIDTH = 5.5
  const PATH_DRAFT_LINE_WIDTH = 4.5
  const PATH_GUIDE_COLOR = 0xffd166
  const PATH_POINT_COLOR = 0x5eead4
  const PATH_ANCHOR_COLOR = 0xffc857
  const PATH_HANDLE_COLOR = 0xa78bfa
  const PATH_ROD_COLOR = 0x94a3b8
  const PATH_LINE2_PICK_THRESHOLD = 0.35
  const GRID_DIVISIONS = 40
  let pathDrawGuide: THREE.Object3D | null = null
  const pathDrawPointMarkers: THREE.Mesh[] = []

  type PathEditKind = 'anchor' | 'handleIn' | 'handleOut'
  type PathEditSelection = { trackId: string; kind: PathEditKind; index: number } | null
  let pathEditSelection: PathEditSelection = null
  let pathEditBreakHandles = false
  let pathEditDragging = false
  const pathEditAnchorMeshes: THREE.Mesh[] = []
  const pathEditHandleInMeshes: THREE.Mesh[] = []
  const pathEditHandleOutMeshes: THREE.Mesh[] = []
  const pathEditRodLines: THREE.Line[] = []
  const pathEditPickables: THREE.Object3D[] = []

  function ensureShotRenderTarget(width: number, height: number): THREE.WebGLRenderTarget {
    // ?? LinearSRGB?RGBA8??? SRGB8_ALPHA8?????? Windows/ANGLE ????
    // readPixels ?????? 0???????????????
    if (!shotRenderTarget) {
      shotRenderTarget = new THREE.WebGLRenderTarget(width, height, {
        type: THREE.UnsignedByteType,
        format: THREE.RGBAFormat,
        colorSpace: THREE.LinearSRGBColorSpace,
        depthBuffer: true,
        stencilBuffer: false,
        samples: 0
      })
      // Three ????RT ???? toneMapping???XR ??????????????????
      ;(shotRenderTarget as THREE.WebGLRenderTarget & { isXRRenderTarget?: boolean }).isXRRenderTarget =
        true
      return shotRenderTarget
    }
    if (shotRenderTarget.width !== width || shotRenderTarget.height !== height) {
      shotRenderTarget.setSize(width, height)
    }
    return shotRenderTarget
  }

  function linearByteToSrgbByte(value: number): number {
    const v = value / 255
    const s = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
    return Math.min(255, Math.max(0, Math.round(s * 255)))
  }

  const LINEAR_TO_SRGB_LUT = new Uint8Array(256)
  for (let i = 0; i < 256; i++) LINEAR_TO_SRGB_LUT[i] = linearByteToSrgbByte(i)

  /** ?? Y??????????sRGB????2D canvas / JPEG ??????*/
  function flipAndEncodeSrgb(source: Uint8Array, width: number, height: number): Uint8ClampedArray {
    const out = new Uint8ClampedArray(source.length)
    const row = width * 4
    for (let y = 0; y < height; y++) {
      const srcRow = (height - 1 - y) * row
      const dstRow = y * row
      for (let i = 0; i < row; i += 4) {
        const s = srcRow + i
        const d = dstRow + i
        out[d] = LINEAR_TO_SRGB_LUT[source[s]!]!
        out[d + 1] = LINEAR_TO_SRGB_LUT[source[s + 1]!]!
        out[d + 2] = LINEAR_TO_SRGB_LUT[source[s + 2]!]!
        out[d + 3] = source[s + 3]!
      }
    }
    return out
  }

  function bufferLooksEmpty(buffer: Uint8Array): boolean {
    // ???????/?????????????????????
    const step = Math.max(4, Math.floor(buffer.length / 256) & ~3)
    for (let i = 0; i < buffer.length; i += step) {
      if (buffer[i] || buffer[i + 1] || buffer[i + 2] || buffer[i + 3]) return false
    }
    return true
  }

  /** ????RT ???????? WebGL ???preserveDrawingBuffer=false ?????????*/
  function renderCameraToCanvas2D(
    cam: THREE.PerspectiveCamera,
    width: number,
    height: number,
    targetCanvas: HTMLCanvasElement = previewCanvas,
    includeLabels = false
  ): boolean {
    if (!renderer || !scene || width <= 0 || height <= 0) return false
    const rt = ensureShotRenderTarget(width, height)
    const prevTarget = renderer.getRenderTarget()
    const prevActiveCubeFace = renderer.getActiveCubeFace()
    const prevActiveMipmapLevel = renderer.getActiveMipmapLevel()
    const prevClear = new THREE.Color()
    const prevAlpha = renderer.getClearAlpha()
    renderer.getClearColor(prevClear)
    const prevViewport = new THREE.Vector4()
    const prevScissor = new THREE.Vector4()
    renderer.getViewport(prevViewport)
    renderer.getScissor(prevScissor)
    const prevScissorTest = renderer.getScissorTest()
    offscreenCaptureLock += 1
    try {
      runWithoutStageGizmos(() => {
        renderer!.setRenderTarget(rt)
        renderer!.setViewport(0, 0, width, height)
        renderer!.setScissor(0, 0, width, height)
        renderer!.setScissorTest(false)
        if (scene!.background instanceof THREE.Color) {
          renderer!.setClearColor(scene!.background, 1)
        } else {
          renderer!.setClearColor(0x000000, 1)
        }
        renderer!.clear()
        renderer!.render(scene!, cam)
      })
      // ?????? RT ????finish ????????????????readPixels??
      renderer.setRenderTarget(rt)
      const gl = renderer.getContext()
      gl.finish()
      const buffer = new Uint8Array(width * height * 4)
      renderer.readRenderTargetPixels(rt, 0, 0, width, height, buffer)
      if (bufferLooksEmpty(buffer)) {
        // ???????? RT ??????
        shotRenderTarget?.dispose()
        shotRenderTarget = null
        const retryRt = ensureShotRenderTarget(width, height)
        runWithoutStageGizmos(() => {
          renderer!.setRenderTarget(retryRt)
          renderer!.setViewport(0, 0, width, height)
          renderer!.setScissorTest(false)
          if (scene!.background instanceof THREE.Color) {
            renderer!.setClearColor(scene!.background, 1)
          } else {
            renderer!.setClearColor(0x000000, 1)
          }
          renderer!.clear()
          renderer!.render(scene!, cam)
        })
        renderer.setRenderTarget(retryRt)
        gl.finish()
        renderer.readRenderTargetPixels(retryRt, 0, 0, width, height, buffer)
        if (bufferLooksEmpty(buffer)) return false
      }
      if (targetCanvas.width !== width) targetCanvas.width = width
      if (targetCanvas.height !== height) targetCanvas.height = height
      const ctx = targetCanvas.getContext('2d')
      if (!ctx) return false
      const pixels = flipAndEncodeSrgb(buffer, width, height)
      const imageData = new ImageData(width, height)
      imageData.data.set(pixels)
      ctx.putImageData(imageData, 0, 0)
      if (includeLabels) {
        drawCapturedLabels(ctx, cam, width, height)
      }
      return true
    } finally {
      renderer.setRenderTarget(prevTarget, prevActiveCubeFace, prevActiveMipmapLevel)
      renderer.setViewport(prevViewport)
      renderer.setScissor(prevScissor)
      renderer.setScissorTest(prevScissorTest)
      renderer.setClearColor(prevClear, prevAlpha)
      offscreenCaptureLock -= 1
      // ???????????? preserveDrawingBuffer=false ????residual ????
      if (offscreenCaptureLock === 0 && scene && camera) {
        renderer.setRenderTarget(null)
        renderer.render(scene, camera)
        labelRenderer?.render(scene, camera)
      }
      requestRender(120)
    }
  }

  /** 截屏/导出：按相机投影把可见物体/相机名称标签画进输出画面（各自由独立开关控制） */
  function drawCapturedLabels(
    ctx: CanvasRenderingContext2D,
    cam: THREE.PerspectiveCamera,
    width: number,
    height: number
  ): void {
    if (!scene) return
    scene.updateMatrixWorld(true)
    const world = new THREE.Vector3()
    const ndc = new THREE.Vector3()
    const draw = (label: CSS2DObject): void => {
      if (!label.visible || !label.element.textContent) return
      label.getWorldPosition(world)
      ndc.copy(world).project(cam)
      if (ndc.z > 1 || ndc.z < -1) return
      const x = ((ndc.x + 1) / 2) * width
      const y = ((1 - ndc.y) / 2) * height
      if (x < -60 || x > width + 60 || y < -60 || y > height + 60) return
      ctx.save()
      ctx.font = '600 13px system-ui, "Segoe UI", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(0,0,0,0.75)'
      ctx.strokeText(label.element.textContent, x, y - 4)
      ctx.fillStyle = '#ffffff'
      ctx.fillText(label.element.textContent, x, y - 4)
      ctx.restore()
    }
    if (captureLabelsVisible.value) {
      for (const label of objectLabels.values()) {
        draw(label)
      }
    }
    if (captureCameraLabelsVisible.value) {
      for (const label of cameraLabels.values()) {
        draw(label)
      }
    }
  }

  function buildShotCamera(aspect: number): THREE.PerspectiveCamera {
    const viewer = activeCameraState().viewer
    const shotCam = new THREE.PerspectiveCamera(
      viewer.fov ?? DEFAULT_DIRECTOR_CAMERA_FOV,
      aspect,
      0.1,
      currentPanoramaRadius() * DIRECTOR_CAMERA_FAR_RADIUS_MULTIPLIER
    )
    shotCam.position.set(viewer.position.x, viewer.position.y, viewer.position.z)
    const rotation =
      viewer.rotation ?? directorViewerRotationFromLook(viewer.position, viewer.target)
    shotCam.rotation.set(rotation.x, rotation.y, rotation.z, 'XYZ')
    const scale = viewer.scale ?? { x: 1, y: 1, z: 1 }
    shotCam.scale.set(scale.x, scale.y, scale.z)
    shotCam.updateProjectionMatrix()
    shotCam.updateMatrixWorld(true)
    return shotCam
  }

  function directorProcessingNode() {
    const preferred = options.processingNodeId
    if (preferred) {
      return (
        graphEditorHosts.findNode(
          graphHostId.value,
          (node) => node.id === preferred && isDirectorProcessingNode(node)
        ) ?? null
      )
    }
    return graphEditorHosts.findNode(graphHostId.value, isDirectorProcessingNode)
  }

  function boundProcessingNodeId(): string | null {
    return options.processingNodeId ?? directorProcessingNode()?.id ?? null
  }

  /** ???????????????????????????*/
  const inputPanoramaAssets = computed(() =>
    project.assets
      .filter((item) => item.type === 'image')
      .map((item) => ({ id: item.id, name: item.name }))
  )

  function listCameras(): DirectorCameraState[] {
    const resolved = resolveDirectorCameras(stage.value)
    if (!Array.isArray(stage.value.cameras) || stage.value.cameras.length === 0) {
      stage.value.cameras = resolved.cameras
    }
    if (!stage.value.activeCameraId || !stage.value.cameras.some((camera) => camera.id === stage.value.activeCameraId)) {
      stage.value.activeCameraId = resolved.activeCameraId
    }
    return stage.value.cameras
  }

  function getCameraState(id: string): DirectorCameraState | null {
    return listCameras().find((camera) => camera.id === id) ?? null
  }

  function activeCameraState(): DirectorCameraState {
    return getActiveDirectorCamera(stage.value)
  }

  function isStageCameraId(id: string): boolean {
    return !!getCameraState(id)
  }

  function isCameraGroupId(id: string): boolean {
    return !!stage.value.cameraGroups?.some((group) => group.id === id)
  }

  /** ??????????????????empty ?????????*/
  function isObjectNameVisible(obj: Pick<StageObjectState, 'kind' | 'nameVisible'>): boolean {
    if (obj.nameVisible === false) return false
    if (obj.nameVisible === true) return true
    return obj.kind !== 'empty'
  }

  const hierarchyItems = computed(() => {
    const items: {
      id: string
      name: string
      kind: 'camera' | 'model' | 'object'
    }[] = listCameras().map((camera) => ({ id: camera.id, name: camera.name, kind: 'camera' }))
    for (const obj of stage.value.objects) {
      items.push({
        id: obj.id,
        name: obj.name,
        kind: obj.kind === 'model' ? 'model' : 'object'
      })
    }
    return items
  })

  /** Unity Hierarchy ???????????? */
  const hierarchyRows = computed(() => {
    type Row = {
      id: string
      name: string
      kind: StageObjectState['kind'] | 'camera' | 'cameraGroup' | 'panorama'
      depth: number
      visible: boolean
      locked: boolean
      nameVisible: boolean
      hasChildren: boolean
      parentId: string | null
    }
    const cameras = listCameras()
    const groups = stage.value.cameraGroups ?? []
    const groupById = new Map(groups.map((g) => [g.id, g]))

    const cameraParentOf = (camera: DirectorCameraState): string | null => {
      const p = camera.parentId
      if (!p) return null
      if (groupById.has(p)) return p
      if (stage.value.objects.some((o) => o.id === p)) return p
      return null
    }
    const cameraByParent = new Map<string | null, DirectorCameraState[]>()
    for (const camera of cameras) {
      const parent = cameraParentOf(camera)
      const list = cameraByParent.get(parent) ?? []
      list.push(camera)
      cameraByParent.set(parent, list)
    }
    const groupByObjectParent = new Map<string | null, DirectorCameraGroup[]>()
    for (const group of groups) {
      const parent =
        group.parentId && stage.value.objects.some((o) => o.id === group.parentId)
          ? group.parentId
          : null
      const list = groupByObjectParent.get(parent) ?? []
      list.push(group)
      groupByObjectParent.set(parent, list)
    }
    const cameraRow = (
      camera: DirectorCameraState,
      depth: number,
      parentId: string | null
    ): Row => ({
      id: camera.id,
      name: camera.name,
      kind: 'camera',
      depth,
      visible: camera.visible !== false,
      locked: camera.locked === true,
      nameVisible: false,
      hasChildren: false,
      parentId
    })
    const rows: Row[] = [
      {
        id: DIRECTOR_PANORAMA_HIERARCHY_ID,
        name: t('director.stage.panoramaBackground'),
        kind: 'panorama',
        depth: 0,
        visible: true,
        locked: false,
        nameVisible: false,
        hasChildren: false,
        parentId: null
      },
      ...(cameraByParent.get(null) ?? []).map((camera) => cameraRow(camera, 0, null))
    ]
    const objects = stage.value.objects
    const byParent = new Map<string | null, StageObjectState[]>()
    for (const obj of objects) {
      const parent =
        obj.parentId && objects.some((item) => item.id === obj.parentId) ? obj.parentId : null
      const list = byParent.get(parent) ?? []
      list.push(obj)
      byParent.set(parent, list)
    }
    const visit = (parentId: string | null, depth: number): void => {
      for (const obj of byParent.get(parentId) ?? []) {
        const kids = byParent.get(obj.id) ?? []
        const cameraKids = cameraByParent.get(obj.id) ?? []
        const groupKids = groupByObjectParent.get(obj.id) ?? []
        rows.push({
          id: obj.id,
          name: obj.name,
          kind: obj.kind,
          depth,
          visible: obj.visible !== false,
          locked: obj.locked === true,
          nameVisible: isObjectNameVisible(obj),
          hasChildren: kids.length > 0 || cameraKids.length > 0 || groupKids.length > 0,
          parentId
        })
        for (const group of groupKids) {
          const groupCameras = cameraByParent.get(group.id) ?? []
          rows.push({
            id: group.id,
            name: group.name,
            kind: 'cameraGroup' as const,
            depth: depth + 1,
            visible: true,
            locked: false,
            nameVisible: false,
            hasChildren: groupCameras.length > 0,
            parentId: obj.id
          })
          for (const camera of groupCameras) {
            rows.push(cameraRow(camera, depth + 2, group.id))
          }
        }
        for (const camera of cameraKids) {
          rows.push(cameraRow(camera, depth + 1, obj.id))
        }
        visit(obj.id, depth + 1)
      }
    }
    visit(null, 0)
    return rows
  })

  const selectedObject = computed(() => {
    if (selectionKind.value !== 'object' || !selectedObjectId.value) return null
    return stage.value.objects.find((o) => o.id === selectedObjectId.value) ?? null
  })

  function isObjectLocked(id: string): boolean {
    if (isStageCameraId(id)) return getCameraState(id)?.locked === true
    return stage.value.objects.find((o) => o.id === id)?.locked === true
  }

  function isCameraLocked(id = selectedCameraId.value): boolean {
    return !!id && getCameraState(id)?.locked === true
  }

  function collectDescendantIds(rootId: string): Set<string> {
    const ids = new Set<string>()
    const walk = (id: string): void => {
      for (const obj of stage.value.objects) {
        if (obj.parentId !== id || ids.has(obj.id)) continue
        ids.add(obj.id)
        walk(obj.id)
      }
    }
    walk(rootId)
    return ids
  }

  function wouldCreateCycle(childId: string, parentId: string | null): boolean {
    if (!parentId) return false
    if (parentId === childId) return true
    return collectDescendantIds(childId).has(parentId)
  }

  function updateDirectorProcessingNode(
    params: Partial<{
      viewer: DirectorViewerState
      cameraShots: DirectorCameraShot[]
      cameraVideos: DirectorCameraVideo[]
      previewDataUrl: string
    }>
  ): void {
    const node = directorProcessingNode()
    if (!node) return
    graphEditorHosts.updateNode(graphHostId.value, node.id, params)
  }

  const mediaGallerySignal = ref<{ seq: number; tab: DirectorMediaGalleryTab }>({
    seq: 0,
    tab: 'shots'
  })

  function openMediaGallery(tab: DirectorMediaGalleryTab = 'shots'): void {
    mediaGallerySignal.value = {
      seq: mediaGallerySignal.value.seq + 1,
      tab
    }
  }

  function syncCameraNodeFromStage(previewOverride?: string | null): void {
    const node = directorProcessingNode()
    if (!node) return
    const shots = [...(stage.value.cameraShots ?? [])]
    const videos = [...(stage.value.cameraVideos ?? [])]
    const preview =
      previewOverride ||
      shots[0]?.dataUrl ||
      node.params.previewDataUrl ||
      undefined
    updateDirectorProcessingNode({
      viewer: activeCameraState().viewer,
      cameraShots: shots,
      cameraVideos: videos,
      ...(preview ? { previewDataUrl: preview } : {})
    })
  }

  function setViewerFromInspector(viewer: DirectorViewerState): void {
    const selected = selectedCameraId.value ? getCameraState(selectedCameraId.value) : null
    if (!selected || isCameraLocked(selected.id)) return
    const rotation =
      viewer.rotation ?? directorViewerRotationFromLook(viewer.position, viewer.target)
    const next: DirectorViewerState = {
      position: { ...viewer.position },
      rotation: { ...rotation },
      scale: viewer.scale
        ? {
            x: Math.max(0.001, viewer.scale.x),
            y: Math.max(0.001, viewer.scale.y),
            z: Math.max(0.001, viewer.scale.z)
          }
        : { x: 1, y: 1, z: 1 },
      target: { ...viewer.target },
      fov: viewer.fov
    }
    if (isEditingAnimKeyframeFor('camera', selected.id)) {
      writeTransformToSelectedKeyframe('camera', selected.id, {
        position: next.position,
        rotation: next.rotation,
        scale: next.scale
      })
      const viz = shotVisuals.get(selected.id)
      if (viz) {
        viz.root.position.set(next.position.x, next.position.y, next.position.z)
        viz.root.rotation.set(rotation.x, rotation.y, rotation.z, 'XYZ')
        viz.root.scale.set(next.scale!.x, next.scale!.y, next.scale!.z)
        viz.helper.update()
      }
      previewRevision.value += 1
      requestRender()
      return
    }
    updateCamera(selected.id, { viewer: next })
    if (viewMode.value === 'camera') applyCameraView()
    syncShotVisuals()
    previewRevision.value += 1
    requestRender()
    schedulePersist()
  }

  /** 选中物体下的模型子物体（世界包围盒中心/身高），供组合机位使用 */
  function modelSubjectsUnder(objectId: string): {
    id: string
    pos: StageVec3
    height: number
  }[] {
    const subjects: { id: string; pos: StageVec3; height: number }[] = []
    for (const obj of stage.value.objects) {
      if (obj.parentId !== objectId || obj.kind !== 'model') continue
      const mesh = objectMeshes.get(obj.id)
      let pos: StageVec3 = { x: obj.position.x, y: 0.9, z: obj.position.z }
      let height = 1.8
      if (mesh) {
        const box = new THREE.Box3().setFromObject(mesh)
        if (!box.isEmpty()) {
          const c = box.getCenter(new THREE.Vector3())
          pos = { x: c.x, y: c.y, z: c.z }
          height = Math.max(0.3, box.max.y - box.min.y)
        }
      }
      subjects.push({ id: obj.id, pos, height })
    }
    return subjects
  }

  function canApplyComboPresets(): boolean {
    if (selectionKind.value !== 'object' || !selectedObjectId.value) return false
    return modelSubjectsUnder(selectedObjectId.value).length >= 2
  }

  function canApplyComboPreset(presetId: string): boolean {
    const preset = findDirectorComboCameraPreset(presetId)
    if (!preset) return false
    if (selectionKind.value !== 'object' || !selectedObjectId.value) return false
    return modelSubjectsUnder(selectedObjectId.value).length >= preset.minSubjects
  }

  /** 组合机位：按专业对话机位规则在选中物体下批量创建相机（同一侧保持 180° 轴线） */
  function applyComboCameraPreset(presetId: string): void {
    const preset = findDirectorComboCameraPreset(presetId)
    if (!preset) return
    if (selectionKind.value !== 'object' || !selectedObjectId.value) return
    const objectId = selectedObjectId.value
    const subjects = modelSubjectsUnder(objectId)
    if (subjects.length < preset.minSubjects) return
    const a = subjects[0]!
    const b = subjects.length > 1 ? subjects[1]! : a
    const c = subjects.length > 2 ? subjects[2]! : b

    // 创建机位组容器，相机统一挂在组下
    const groupId = `camera-group:${crypto.randomUUID()}`
    const group: DirectorCameraGroup = {
      id: groupId,
      name: resolveUniqueCameraName(t(preset.labelKey)),
      parentId: objectId
    }
    stage.value.cameraGroups = [...(stage.value.cameraGroups ?? []), group]

    const created: string[] = []
    for (const def of preset.cameras) {
      const viewer = buildComboCameraViewer(a, b, c, def)
      const id = `camera:${crypto.randomUUID()}`
      const camera = createDefaultDirectorCamera(id, resolveUniqueCameraName(t(def.nameKey)))
      camera.parentId = groupId
      camera.viewer = viewer
      stage.value.cameras = [...listCameras(), camera]
      ensureShotCameraVisual(camera)
      created.push(id)
    }
    if (created.length) {
      selectCamera(created[created.length - 1]!)
      setViewMode('camera')
      previewRevision.value += 1
      requestRender()
      schedulePersist()
    }
  }

  function buildComboCameraViewer(
    a: { pos: StageVec3; height: number },
    b: { pos: StageVec3; height: number },
    c: { pos: StageVec3; height: number },
    def: DirectorComboCameraDef
  ): DirectorViewerState {
    const axisX = b.pos.x - a.pos.x
    const axisZ = b.pos.z - a.pos.z
    const axisLen = Math.hypot(axisX, axisZ) || 1
    const ux = axisX / axisLen
    const uz = axisZ / axisLen
    const sx = -uz
    const sz = ux
    const midX = (a.pos.x + b.pos.x) / 2
    const midY = (a.pos.y + b.pos.y) / 2
    const midZ = (a.pos.z + b.pos.z) / 2
    const abcX = (a.pos.x + b.pos.x + c.pos.x) / 3
    const abcY = (a.pos.y + b.pos.y + c.pos.y) / 3
    const abcZ = (a.pos.z + b.pos.z + c.pos.z) / 3
    const anchorPos =
      def.anchor === 'A'
        ? a.pos
        : def.anchor === 'B'
          ? b.pos
          : def.anchor === 'C'
            ? c.pos
            : def.anchor === 'abc'
              ? { x: abcX, y: abcY, z: abcZ }
              : { x: midX, y: midY, z: midZ }
    const targetPos =
      def.target === 'A'
        ? a.pos
        : def.target === 'B'
          ? b.pos
          : def.target === 'C'
            ? c.pos
            : def.target === 'abc'
              ? { x: abcX, y: abcY, z: abcZ }
              : { x: midX, y: midY, z: midZ }
    const anchorHeight =
      def.anchor === 'A'
        ? a.height
        : def.anchor === 'B'
          ? b.height
          : def.anchor === 'C'
            ? c.height
            : def.anchor === 'abc'
              ? (a.height + b.height + c.height) / 3
              : (a.height + b.height) / 2
    const targetHeight =
      def.target === 'A'
        ? a.height
        : def.target === 'B'
          ? b.height
          : def.target === 'C'
            ? c.height
            : def.target === 'abc'
              ? (a.height + b.height + c.height) / 3
              : (a.height + b.height) / 2
    const aimY = targetPos.y + (def.targetBias - 0.5) * targetHeight
    let position: StageVec3
    if (def.orbitAngleDeg != null) {
      const radius = Math.max(0.5, anchorHeight * (def.orbitDistanceFactor ?? 2))
      const ang = (def.orbitAngleDeg * Math.PI) / 180
      position = {
        x: anchorPos.x + Math.sin(ang) * radius,
        y: aimY + def.heightFactor * anchorHeight,
        z: anchorPos.z + Math.cos(ang) * radius
      }
    } else {
      position = {
        x:
          anchorPos.x +
          ux * ((def.alongFactor ?? 0) * anchorHeight) +
          sx * ((def.sideFactor ?? 0) * anchorHeight),
        y: aimY + def.heightFactor * anchorHeight,
        z:
          anchorPos.z +
          uz * ((def.alongFactor ?? 0) * anchorHeight) +
          sz * ((def.sideFactor ?? 0) * anchorHeight)
      }
    }
    const target: StageVec3 = { x: targetPos.x, y: aimY, z: targetPos.z }
    let rotation = directorViewerRotationFromLook(position, target)
    if (def.rollDeg) {
      rotation = {
        ...rotation,
        z: rotation.z + (def.rollDeg * Math.PI) / 180
      }
    }
    return {
      position,
      rotation,
      scale: { x: 1, y: 1, z: 1 },
      target,
      fov: DEFAULT_DIRECTOR_CAMERA_FOV
    }
  }

  /** 专业机位预设：以选中物体（或舞台中心）为主体，套用景别/角度到当前或活动相机 */
  function applyCameraPreset(presetId: string): void {
    if (findDirectorComboCameraPreset(presetId)) {
      applyComboCameraPreset(presetId)
      return
    }
    const preset = findDirectorShotCameraPreset(presetId)
    if (!preset) return
    // 仅选中物体时可用：在选中物体下新建相机
    if (selectionKind.value !== 'object' || !selectedObjectId.value) return
    const objectId = selectedObjectId.value
    const object = stage.value.objects.find((o) => o.id === objectId)
    if (!object) return

    // 主体信息：选中物体世界包围盒与朝向；缺省舞台中心 + 平均身高
    let centerX = 0
    let centerY = 1.0
    let centerZ = 0
    let subjectHeight = 1.8
    let facingYaw = 0
    const mesh = objectMeshes.get(objectId)
    if (mesh) {
      const box = new THREE.Box3().setFromObject(mesh)
      if (!box.isEmpty()) {
        const c = box.getCenter(new THREE.Vector3())
        centerX = c.x
        centerY = c.y
        centerZ = c.z
        subjectHeight = Math.max(0.3, box.max.y - box.min.y)
        const q = new THREE.Quaternion()
        mesh.getWorldQuaternion(q)
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q)
        facingYaw = Math.atan2(fwd.x, fwd.z)
      }
    }

    const fov = preset.fov ?? DEFAULT_DIRECTOR_CAMERA_FOV
    const frameBias = preset.frameBias ?? 0.5
    const aimY = centerY + (frameBias - 0.5) * subjectHeight
    const target: StageVec3 = { x: centerX, y: aimY, z: centerZ }
    const frameHeight = Math.max(0.1, subjectHeight * preset.frameFactor)
    const distance = Math.max(
      0.3,
      frameHeight / 2 / Math.tan((fov / 2) * Math.PI / 180)
    )

    // 相机方向：相对主体朝向旋转 azimuth；azimuth 0 = 正面
    const az = (preset.azimuthDeg * Math.PI) / 180
    const frontX = Math.sin(facingYaw)
    const frontZ = Math.cos(facingYaw)
    const rx = frontX * Math.cos(az) + frontZ * Math.sin(az)
    const rz = -frontX * Math.sin(az) + frontZ * Math.cos(az)
    const camHeight = (preset.cameraHeightBias ?? 0) * subjectHeight
    const position: StageVec3 = {
      x: target.x - rx * distance,
      y: target.y + camHeight,
      z: target.z - rz * distance
    }
    let rotation = directorViewerRotationFromLook(position, target)
    if (preset.rollDeg) {
      rotation = {
        ...rotation,
        z: rotation.z + (preset.rollDeg * Math.PI) / 180
      }
    }
    const viewer: DirectorViewerState = {
      position,
      rotation,
      scale: { x: 1, y: 1, z: 1 },
      target,
      fov
    }

    const id = `camera:${crypto.randomUUID()}`
    const camera = createDefaultDirectorCamera(id, resolveUniqueCameraName(t(preset.labelKey)))
    camera.parentId = objectId
    camera.viewer = viewer
    stage.value.cameras = [...listCameras(), camera]
    ensureShotCameraVisual(camera)
    selectCamera(id)
    setViewMode('camera')
    previewRevision.value += 1
    requestRender()
    schedulePersist()
  }

  function applyCameraView(): void {
    if (!camera || !orbit) return
    const viewer = activeCameraState().viewer
    camera.position.set(viewer.position.x, viewer.position.y, viewer.position.z)
    const rotation =
      viewer.rotation ?? directorViewerRotationFromLook(viewer.position, viewer.target)
    camera.rotation.set(rotation.x, rotation.y, rotation.z, 'XYZ')
    const scale = viewer.scale ?? { x: 1, y: 1, z: 1 }
    camera.scale.set(scale.x, scale.y, scale.z)
    if (viewer.fov != null) {
      camera.fov = viewer.fov
      camera.updateProjectionMatrix()
    }
    orbit.target.set(viewer.target.x, viewer.target.y, viewer.target.z)
    camera.updateMatrixWorld()
  }

  /** ????????????????????????*/
  function frameShotCameraInDirectorView(): void {
    if (!camera || !orbit) return
    const viewer = activeCameraState().viewer
    const rotation =
      viewer.rotation ?? directorViewerRotationFromLook(viewer.position, viewer.target)
    const forward = directorViewerForwardFromRotation(rotation)
    const back = 5
    const lift = 1.8
    camera.position.set(
      viewer.position.x - forward.x * back,
      viewer.position.y - forward.y * back + lift,
      viewer.position.z - forward.z * back
    )
    orbit.target.set(viewer.position.x, viewer.position.y, viewer.position.z)
    orbit.update()
  }

  function setViewMode(mode: DirectorViewMode): void {
    const prev = viewMode.value
    viewMode.value = mode
    if (!orbit) return
    if (mode === 'camera') {
      orbit.enabled = false
      applyCameraView()
    } else {
      orbit.enabled = true
      if (prev === 'camera') frameShotCameraInDirectorView()
    }
    syncShotVisuals()
    applySelectionToScene()
    requestRender()
  }

  /** Unity ?? Camera Gizmo??? PNG + ????????????Sprite ?????*/
  function createShotCameraBody(id: string): THREE.Group {
    const root = new THREE.Group()
    const map = new THREE.TextureLoader().load(
      unityCameraIconUrl,
      () => {
        map.needsUpdate = true
        requestRender(500)
      },
      undefined,
      () => {
        console.warn('[stage] failed to load unity camera icon', unityCameraIconUrl)
      }
    )
    map.colorSpace = THREE.SRGBColorSpace
    map.magFilter = THREE.LinearFilter
    map.minFilter = THREE.LinearFilter
    map.generateMipmaps = false
    const mat = new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      alphaTest: 0.08,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide
    })
    const icon = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), mat)
    icon.renderOrder = 20
    icon.frustumCulled = false
    icon.userData.stageCameraId = id
    icon.onBeforeRender = (_renderer, _scene, cam) => {
      icon.quaternion.copy(cam.quaternion)
    }
    root.add(icon)

    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 12, 10),
      new THREE.MeshBasicMaterial({ visible: false })
    )
    hit.userData.stageCameraId = id
    root.add(hit)

    root.userData.stageCameraId = id
    return root
  }

  function ensureShotCameraVisual(cameraState: DirectorCameraState): ShotViz | null {
    const rootHost = getStageRoot()
    if (!rootHost) return null
    const existing = shotVisuals.get(cameraState.id)
    if (existing) return existing
    const root = new THREE.Group()
    root.name = `StageCameraViz:${cameraState.id}`
    root.userData.stageCameraId = cameraState.id
    const shotCamera = new THREE.PerspectiveCamera(
      DEFAULT_DIRECTOR_CAMERA_FOV,
      1,
      SHOT_VIZ_NEAR,
      SHOT_VIZ_FAR
    )
    root.add(shotCamera)
    rootHost.add(root)
    const body = createShotCameraBody(cameraState.id)
    rootHost.add(body)
    const helper = new THREE.CameraHelper(shotCamera)
    helper.setColors(
      new THREE.Color(0xf0c674),
      new THREE.Color(0xf0c674),
      new THREE.Color(0x7fd99a),
      new THREE.Color(0x5b9cf5),
      new THREE.Color(0x8899aa)
    )
    helper.userData.stageCameraId = cameraState.id
    rootHost.add(helper)
    const viz = { root, camera: shotCamera, helper, body }
    shotVisuals.set(cameraState.id, viz)
    // 相机名称标签（跟随相机 gizmo）
    const label = createNameLabel(cameraState.name)
    label.position.set(0, 0.2, 0)
    root.add(label)
    cameraLabels.set(cameraState.id, label)
    return viz
  }

  function disposeShotCameraVisual(id: string): void {
    const viz = shotVisuals.get(id)
    const label = cameraLabels.get(id)
    if (label) {
      label.parent?.remove(label)
      disposeLabel(label)
      cameraLabels.delete(id)
    }
    if (!viz) return
    const rootHost = getStageRoot()
    rootHost?.remove(viz.helper, viz.root, viz.body)
    viz.helper.dispose()
    viz.body.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return
        child.geometry.dispose()
        const material = child.material
        const materials = Array.isArray(material) ? material : [material]
        materials.forEach((item) => {
          const texture = (item as THREE.Material & { map?: THREE.Texture }).map
          texture?.dispose()
          item.dispose()
        })
    })
    shotVisuals.delete(id)
  }

  function syncShotVisuals(): void {
    if (!camera) return
    const cameraIds = new Set(listCameras().map((item) => item.id))
    for (const id of shotVisuals.keys()) {
      if (!cameraIds.has(id)) disposeShotCameraVisual(id)
    }
    for (const cameraState of listCameras()) {
      const viz = ensureShotCameraVisual(cameraState)
      if (!viz) continue
      const visible =
        cameraState.visible !== false &&
        viewMode.value === 'director' &&
        cameraGizmosVisible.value
      const selected = selectionKind.value === 'camera' && selectedCameraId.value === cameraState.id
      viz.root.visible = visible
      viz.helper.visible = visible && selected
      viz.body.visible = visible
      viz.root.scale.set(gizmoSize.value, gizmoSize.value, gizmoSize.value)
      viz.body.scale.set(gizmoSize.value, gizmoSize.value, gizmoSize.value)
      const nameLabel = cameraLabels.get(cameraState.id)
      if (nameLabel) {
        nameLabel.visible = visible && sceneLabelsVisible.value
        nameLabel.element.textContent = cameraState.name
      }
      const draggingCamera =
        !!transform?.dragging && selectionKind.value === 'camera' && selectedCameraId.value === cameraState.id
      if (!draggingCamera) {
        const viewer = cameraState.viewer
      const rotation =
        viewer.rotation ?? directorViewerRotationFromLook(viewer.position, viewer.target)
        viz.root.position.set(viewer.position.x, viewer.position.y, viewer.position.z)
        viz.root.rotation.set(rotation.x, rotation.y, rotation.z, 'XYZ')
        viz.camera.fov = viewer.fov ?? DEFAULT_DIRECTOR_CAMERA_FOV
      }
      viz.body.position.copy(viz.root.position)
      viz.camera.aspect = directorAspectRatioValue(
        aspectRatio.value,
        options.viewportEl.value?.clientWidth ?? 1,
        options.viewportEl.value?.clientHeight ?? 1
      )
      viz.camera.updateProjectionMatrix()
      viz.camera.near = SHOT_VIZ_NEAR
      viz.camera.far = SHOT_VIZ_FAR
      viz.camera.updateProjectionMatrix()
      viz.root.updateMatrixWorld(true)
      if (viz.helper.visible) viz.helper.update()
    }
  }

  function capturePreviewFrame(): string | null {
    if (!renderer || !camera) return null
    try {
      const source = renderer.domElement
      if (source.width <= 0 || source.height <= 0) return null
      const width = 320
      const height = Math.max(1, Math.round((source.height / source.width) * width))
      const aspect = source.width / Math.max(1, source.height)
      const shotCam = camera.clone() as THREE.PerspectiveCamera
      shotCam.aspect = aspect
      shotCam.updateProjectionMatrix()
      if (!renderCameraToCanvas2D(shotCam, width, height)) return null
      return previewCanvas.toDataURL('image/jpeg', 0.65)
    } catch {
      return null
    }
  }

  /** ??/???????????????????????????????? */
  function flushPreview(): string | null {
    const url = stage.value.cameraShots?.[0]?.dataUrl ?? capturePreviewFrame()
    if (url) {
      options.onPreview?.(url)
      syncCameraNodeFromStage(url)
    }
    return url
  }

  function takeCameraShot(): DirectorCameraShot | null {
    if (!renderer || !scene) return null
    try {
      const el = options.viewportEl.value
      const ratio = directorAspectRatioValue(
        aspectRatio.value,
        el?.clientWidth ?? 16,
        el?.clientHeight ?? 9
      )
      // ?????????????? data URL ?? DOM ???????????
      const width = 720
      const height = Math.max(1, Math.round(width / ratio))
      const shotCam = buildShotCamera(ratio)
      if (
        !renderCameraToCanvas2D(
          shotCam,
          width,
          height,
          previewCanvas,
          captureLabelsVisible.value || captureCameraLabelsVisible.value
        )
      ) {
        return null
      }

      const dataUrl = previewCanvas.toDataURL('image/jpeg', 0.72)
      const shot: DirectorCameraShot = {
        id: crypto.randomUUID(),
        dataUrl,
        createdAt: new Date().toISOString()
      }
      const list = [...(stage.value.cameraShots ?? []), shot].slice(-24)
      stage.value.cameraShots = list
      options.onPreview?.(dataUrl)
      syncCameraNodeFromStage(dataUrl)
      schedulePersist()
      requestRender()
      return shot
    } catch {
      return null
    }
  }

  /** ??????????????RT?????? WebGL ?????????????*/
  function renderCameraPreviewToCanvas(
    targetCanvas: HTMLCanvasElement,
    viewer: DirectorViewerState,
    aspect: number,
    /** 渲染后是否排程下一次刷新（浮动预览循环传 false，避免把帧率顶满） */
    schedule = true
  ): boolean {
    if (!renderer || !scene || offscreenCaptureLock > 0) return false
    const width = Math.max(1, Math.round(targetCanvas.clientWidth || targetCanvas.width || 320))
    const height = Math.max(1, Math.round(width / Math.max(0.01, aspect)))
    const previewCam = new THREE.PerspectiveCamera(
      viewer.fov ?? DEFAULT_DIRECTOR_CAMERA_FOV,
      aspect,
      0.1,
      currentPanoramaRadius() * DIRECTOR_CAMERA_FAR_RADIUS_MULTIPLIER
    )
    previewCam.position.set(viewer.position.x, viewer.position.y, viewer.position.z)
    const rotation =
      viewer.rotation ?? directorViewerRotationFromLook(viewer.position, viewer.target)
    previewCam.rotation.set(rotation.x, rotation.y, rotation.z, 'XYZ')
    const scale = viewer.scale ?? { x: 1, y: 1, z: 1 }
    previewCam.scale.set(scale.x, scale.y, scale.z)
    previewCam.updateProjectionMatrix()
    previewCam.updateMatrixWorld(true)
    const ok = renderCameraToCanvas2D(previewCam, width, height, targetCanvas)
    if (schedule) requestRender(120)
    return ok
  }

  /** 层级多选同步：仅保留相机，驱动浮动预览窗 */
  function setCameraPreviewSelection(ids: Iterable<string>): void {
    const seen = new Set<string>()
    const next: string[] = []
    for (const id of ids) {
      if (seen.has(id) || !isStageCameraId(id)) continue
      seen.add(id)
      next.push(id)
    }
    cameraPreviewIds.value = next
    if (cameraPreviewOpen.value) requestRender(120)
  }

  function toggleCameraPreview(): void {
    cameraPreviewOpen.value = !cameraPreviewOpen.value
    requestRender(120)
  }

  function setCameraPreviewOpen(open: boolean): void {
    if (cameraPreviewOpen.value === open) return
    cameraPreviewOpen.value = open
    requestRender(120)
  }

  function setCameraPreviewDetached(detached: boolean): void {
    cameraPreviewDetached.value = detached
    requestRender(120)
  }

  function registerCameraPreviewCanvas(cameraId: string, canvas: HTMLCanvasElement): void {
    cameraPreviewCanvases.set(cameraId, canvas)
    requestRender(120)
  }

  function unregisterCameraPreviewCanvas(cameraId: string, canvas: HTMLCanvasElement): void {
    if (cameraPreviewCanvases.get(cameraId) === canvas) {
      cameraPreviewCanvases.delete(cameraId)
    }
  }

  /** 跟随主渲染循环刷新浮动预览（开启时按循环节流刷新，不额外顶帧） */
  function refreshCameraPreviews(): void {
    if (
      (!cameraPreviewOpen.value && !cameraPreviewDetached.value) ||
      !renderer ||
      !scene ||
      offscreenCaptureLock > 0
    ) {
      return
    }
    for (const id of cameraPreviewIds.value) {
      const canvas = cameraPreviewCanvases.get(id)
      if (!canvas || !canvas.isConnected) {
        cameraPreviewCanvases.delete(id)
        continue
      }
      const state = getCameraState(id)
      if (!state) continue
      const cw = canvas.clientWidth || canvas.width || 320
      const ch = canvas.clientHeight || canvas.height || 180
      renderCameraPreviewToCanvas(canvas, state.viewer, Math.max(0.01, cw / Math.max(1, ch)), false)
    }
  }

  function removeCameraShot(id: string): void {
    stage.value.cameraShots = (stage.value.cameraShots ?? []).filter((s) => s.id !== id)
    syncCameraNodeFromStage()
    schedulePersist()
  }

  function removeCameraVideo(id: string): void {
    stage.value.cameraVideos = (stage.value.cameraVideos ?? []).filter((v) => v.id !== id)
    syncCameraNodeFromStage()
    schedulePersist()
  }

  async function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read video blob'))
      reader.readAsDataURL(blob)
    })
  }

  function themeDirectorSkyHex(): string {
    if (typeof document === 'undefined') return DEFAULT_DIRECTOR_SKY_COLOR
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--director-sky').trim()
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw)) return raw
    return DEFAULT_DIRECTOR_SKY_COLOR
  }

  /** 未自定义天空色时跟随应用主题；自定义色保持项目设置 */
  function skyColorHex(): string {
    if (isDirectorSkyFollowTheme(stage.value.skyColor)) {
      return themeDirectorSkyHex()
    }
    return normalizeDirectorSkyColor(stage.value.skyColor)
  }

  function applyBorderlessStyle(hasPanorama: boolean): void {
    if (!scene || !renderer) return
    if (hasPanorama) {
      scene.background = null
      renderer.setClearColor(0x000000, 1)
    } else {
      const hex = skyColorHex()
      scene.background = new THREE.Color(hex)
      renderer.setClearColor(hex, 1)
    }
  }

  function getStageRoot(): THREE.Object3D | null {
    return contentRoot ?? scene
  }

  function syncTransformGizmoScale(): void {
    if (!transform || !contentRoot) return
    const worldScale = contentRoot.getWorldScale(new THREE.Vector3())
    const avg = Math.max(0.001, (worldScale.x + worldScale.y + worldScale.z) / 3)
    transform.size = (1 / avg) * gizmoSize.value
  }

  function applySceneWorldTransform(): void {
    if (!contentRoot) return
    const world = readDirectorSceneWorld(stage.value.world)
    const scale = clampDirectorSceneScalePercent(world.scalePercent) / 100
    contentRoot.position.set(world.position.x, world.position.y, world.position.z)
    contentRoot.rotation.set(world.rotation.x, world.rotation.y, world.rotation.z, 'XYZ')
    contentRoot.scale.set(scale, scale, scale)
    contentRoot.updateMatrixWorld(true)
    syncTransformGizmoScale()
    syncAllPathVisuals()
  }

  function resolvePanoramaSphere(): THREE.Mesh | null {
    if (panoramaSphere?.parent || panoramaSphere) return panoramaSphere
    const root = contentRoot ?? scene
    if (!root) return null
    let found: THREE.Mesh | null = null
    root.traverse((obj) => {
      if (found || !(obj instanceof THREE.Mesh)) return
      if (obj.userData.stagePanorama) found = obj
    })
    if (found) panoramaSphere = found
    return found
  }

  function applyPanoramaMeshVisibility(mesh: THREE.Mesh, visible: boolean): void {
    const yaw = typeof stage.value.panoramaYaw === 'number' ? stage.value.panoramaYaw : 0
    mesh.rotation.set(0, THREE.MathUtils.degToRad(yaw), 0)
    mesh.visible = visible
    const material = mesh.material
    if (!Array.isArray(material) && material) material.visible = visible
  }

  function applyPanoramaVisuals(visibleOverride?: boolean): void {
    const visible = visibleOverride ?? stage.value.panoramaVisible !== false
    const sphere = resolvePanoramaSphere()
    const root = contentRoot ?? scene
    if (root) {
      root.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh) || !obj.userData.stagePanorama) return
        applyPanoramaMeshVisibility(obj, visible)
      })
    } else if (sphere) {
      applyPanoramaMeshVisibility(sphere, visible)
    }
    applyBorderlessStyle(visible && !!sphere)
    requestRender()
  }

  function syncCameraClipPlanes(): void {
    const far = currentPanoramaRadius() * DIRECTOR_CAMERA_FAR_RADIUS_MULTIPLIER
    if (camera) {
      camera.far = far
      camera.updateProjectionMatrix()
    }
    if (orbit) {
      // 有全景背景时保持相机在球体内（避免背景被裁掉）；无全景时放开拉远上限，模型可显示得更小
      orbit.maxDistance = panoramaSphere
        ? currentPanoramaRadius() * 0.9
        : currentPanoramaRadius() * DIRECTOR_MAX_ZOOMOUT_RADIUS_MULTIPLIER
    }
  }

  function applyGridVisuals(): void {
    if (!grid) return
    const opacity = clampGridOpacity(stage.value.gridOpacity ?? DEFAULT_GRID_OPACITY)
    grid.visible = stage.value.gridVisible !== false && gridGizmoVisible.value
    grid.position.y = stage.value.gridOffsetY ?? DEFAULT_GRID_OFFSET_Y
    const materials = Array.isArray(grid.material) ? grid.material : [grid.material]
    for (const mat of materials) {
      if (!mat || !('opacity' in mat)) continue
      mat.transparent = opacity < 1
      mat.opacity = opacity
      mat.depthWrite = opacity >= 1
      mat.needsUpdate = true
    }
  }

  function rebuildGrid(): void {
    if (!contentRoot) return
    const density = clampGridDensity(stage.value.gridDensity ?? DEFAULT_GRID_DENSITY)
    const cellSize = gridDensityToCellSize(density)
    const gridSize = cellSize * GRID_DIVISIONS
    if (grid) {
      contentRoot.remove(grid)
      disposeGridHelper(grid)
      grid = null
    }
    grid = new THREE.GridHelper(gridSize, GRID_DIVISIONS, 0x6b7f96, 0x4a5568)
    applyGridVisuals()
    contentRoot.add(grid)
  }

  function updateGround(patch: {
    visible?: boolean
    opacity?: number
    offsetY?: number
  }): void {
    if (patch.visible !== undefined) stage.value.gridVisible = patch.visible
    if (patch.opacity !== undefined) {
      stage.value.gridOpacity = clampGridOpacity(patch.opacity)
    }
    if (patch.offsetY !== undefined && Number.isFinite(patch.offsetY)) {
      stage.value.gridOffsetY = patch.offsetY
    }
    applyGridVisuals()
    previewRevision.value += 1
    requestRender()
    schedulePersist()
  }

  function updateSceneWorld(patch: Partial<DirectorSceneWorld>): void {
    const current = readDirectorSceneWorld(stage.value.world)
    stage.value.world = {
      scalePercent: clampDirectorSceneScalePercent(
        patch.scalePercent !== undefined ? patch.scalePercent : current.scalePercent
      ),
      position: patch.position ? { ...patch.position } : { ...current.position },
      rotation: patch.rotation ? { ...patch.rotation } : { ...current.rotation }
    }
    applySceneWorldTransform()
    previewRevision.value += 1
    requestRender()
    schedulePersist()
  }

  function updateSkyColor(color: string): void {
    const next = normalizeDirectorSkyColor(color)
    // 选中当前主题天空色 → 存跟随哨兵，避免浅色解析色被当成自定义
    stage.value.skyColor =
      next.toLowerCase() === themeDirectorSkyHex().toLowerCase() || isDirectorSkyFollowTheme(color)
        ? DEFAULT_DIRECTOR_SKY_COLOR
        : next
    applyPanoramaVisuals()
    previewRevision.value += 1
    requestRender()
    schedulePersist()
  }

  function updatePanoramaVisible(visible: boolean): void {
    stage.value = { ...stage.value, panoramaVisible: visible }
    applyPanoramaVisuals(visible)
    previewRevision.value += 1
    requestRender(800)
    schedulePersist()
  }

  function updatePanoramaYaw(degrees: number): void {
    stage.value.panoramaYaw = Number.isFinite(degrees) ? degrees : 0
    applyPanoramaVisuals()
    previewRevision.value += 1
    requestRender()
    schedulePersist()
  }

  function updatePanoramaRadius(radius: number): void {
    const next = clampDirectorPanoramaRadius(radius)
    if (next === currentPanoramaRadius() && stage.value.panoramaRadius === next) return
    stage.value.panoramaRadius = next
    syncCameraClipPlanes()
    if (linkedPanoramaId.value) void loadPanorama(linkedPanoramaId.value)
    else {
      previewRevision.value += 1
      requestRender()
    }
    schedulePersist()
  }

  function disposeGridHelper(helper: THREE.GridHelper): void {
    helper.geometry.dispose()
    const material = helper.material
    if (Array.isArray(material)) material.forEach((item) => item.dispose())
    else material.dispose()
  }

  function schedulePersist(): void {
    directorDocument.markDirty()
  }

  function ensureAnimation(): DirectorAnimationState {
    if (!stage.value.animation) {
      stage.value.animation = createDefaultDirectorAnimation()
    }
    const anim = stage.value.animation
    // 机位轨为内置轨道：默认存在、不可删除，保证时间线始终有它
    if (!anim.tracks.some((t) => t.cameraCut)) {
      const cameras = listCameras()
      const active = stage.value.activeCameraId ?? cameras[0]?.id ?? ''
      const track: DirectorAnimTrack = {
        id: `anim-cut:${crypto.randomUUID()}`,
        name: t('director.stage.anim.cameraCutTrack'),
        targetKind: 'camera',
        targetId: active,
        start: 0,
        end: anim.duration,
        path: null,
        keyframes: [],
        cameraCut: true,
        cameraSegments: []
      }
      anim.tracks = [track, ...anim.tracks]
    }
    return anim
  }

  function syncPathLineResolution(): void {
    if (!renderer) return
    const w = renderer.domElement.clientWidth
    const h = renderer.domElement.clientHeight
    if (w <= 0 || h <= 0) return
    for (const material of pathLineMaterials) {
      material.resolution.set(w, h)
    }
  }

  function disposePathLine(line: Line2 | null): void {
    if (!line) return
    line.parent?.remove(line)
    line.geometry.dispose()
    const material = line.material as LineMaterial
    pathLineMaterials.delete(material)
    material.dispose()
  }

  function clearPathDraftVisual(): void {
    disposePathLine(pathDraftLine)
    pathDraftLine = null
  }

  function clearAllPathVisuals(): void {
    for (const line of pathVisuals.values()) disposePathLine(line)
    pathVisuals.clear()
    clearPathDraftVisual()
    clearPathEditOverlays()
  }

  function makePathLine(
    positions: number[],
    color: number,
    linewidth: number,
    trackId?: string
  ): Line2 {
    const geometry = new LineGeometry()
    geometry.setPositions(positions)
    const material = new LineMaterial({
      color,
      linewidth,
      transparent: true,
      opacity: 0.95,
      depthTest: true,
      worldUnits: false
    })
    pathLineMaterials.add(material)
    syncPathLineResolution()
    const line = new Line2(geometry, material)
    line.computeLineDistances()
    line.frustumCulled = false
    line.renderOrder = 3
    if (trackId) line.userData.animTrackId = trackId
    getStageRoot()?.add(line)
    return line
  }

  function flattenWorldPathPositions(points: StageVec3[]): number[] {
    return flattenStagePositions(points.map((p) => worldToContentLocal(p)))
  }

  function pathLineStyle(trackId: string): { color: number; linewidth: number } {
    const selected = animSelectedTrackId.value === trackId
    return {
      color: selected ? PATH_LINE_SELECTED_COLOR : PATH_LINE_COLOR,
      linewidth: selected ? PATH_LINE_SELECTED_WIDTH : PATH_LINE_WIDTH
    }
  }

  function syncPathVisual(trackId: string, path: DirectorAnimPath | null, targetKind?: 'camera' | 'object'): void {
    void targetKind
    const prev = pathVisuals.get(trackId)
    if (prev) {
      disposePathLine(prev)
      pathVisuals.delete(trackId)
    }
    if (stageEditMode.value !== 'animation') return
    if (!path || path.points.length < 2 || !getStageRoot()) return
    const style = pathLineStyle(trackId)
    const line = makePathLine(flattenPathPositions(path), style.color, style.linewidth, trackId)
    pathVisuals.set(trackId, line)
  }

  function syncAllPathVisuals(): void {
    if (stageEditMode.value !== 'animation') {
      for (const id of [...pathVisuals.keys()]) {
        disposePathLine(pathVisuals.get(id) ?? null)
        pathVisuals.delete(id)
      }
      clearPathEditOverlays()
      return
    }
    const anim = stage.value.animation
    const keep = new Set(anim?.tracks.map((t) => t.id) ?? [])
    for (const id of [...pathVisuals.keys()]) {
      if (!keep.has(id)) {
        disposePathLine(pathVisuals.get(id) ?? null)
        pathVisuals.delete(id)
      }
    }
    for (const track of anim?.tracks ?? []) {
      syncPathVisual(track.id, track.path)
    }
    syncPathEditOverlays()
  }

  function updatePathDraftVisual(points: StageVec3[]): void {
    if (points.length < 2 || !getStageRoot()) {
      clearPathDraftVisual()
      return
    }
    const positions = flattenWorldPathPositions(points)
    // LineGeometry ????setPositions ????????????????
    if (pathDraftLine) {
      disposePathLine(pathDraftLine)
      pathDraftLine = null
    }
    pathDraftLine = makePathLine(positions, PATH_DRAFT_COLOR, PATH_DRAFT_LINE_WIDTH)
  }

  function createPathDrawMarker(color: number, scale = 0.12): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(scale, 14, 14),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.92,
        depthTest: true
      })
    )
    mesh.renderOrder = 4
    return mesh
  }

  function clearPathDrawMarkers(): void {
    for (const marker of pathDrawPointMarkers) {
      marker.parent?.remove(marker)
      marker.geometry.dispose()
      ;(marker.material as THREE.Material).dispose()
    }
    pathDrawPointMarkers.length = 0
  }

  function disposePathDrawGuide(): void {
    if (transform) {
      if (transform.object === pathDrawGuide) {
        suppressTransformEvent = true
        transform.detach()
        suppressTransformEvent = false
      }
      transform.enabled = true
      transform.showX = true
      transform.showY = true
      transform.showZ = true
    }
    if (!pathDrawGuide) return
    pathDrawGuide.parent?.remove(pathDrawGuide)
    pathDrawGuide.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
        ;(child.material as THREE.Material).dispose()
      }
    })
    pathDrawGuide = null
  }

  function guideWorldPosition(): StageVec3 | null {
    if (!pathDrawGuide) return null
    const wp = new THREE.Vector3()
    pathDrawGuide.getWorldPosition(wp)
    return { x: wp.x, y: wp.y, z: wp.z }
  }

  function setPathDrawGuidePosition(worldP: StageVec3): void {
    if (!pathDrawGuide) return
    const local = worldToContentLocal(worldP)
    pathDrawGuide.position.set(local.x, local.y, local.z)
  }

  function setupPathDrawGuide(worldOrigin: StageVec3): void {
    disposePathDrawGuide()
    const root = getStageRoot()
    if (!root) return
    const local = worldToContentLocal(worldOrigin)
    pathDrawGuide = new THREE.Group()
    pathDrawGuide.add(createPathDrawMarker(PATH_GUIDE_COLOR, 0.06))
    pathDrawGuide.position.set(local.x, local.y, local.z)
    root.add(pathDrawGuide)
    // ?????? TransformControls??????
    if (transform) {
      suppressTransformEvent = true
      transform.detach()
      transform.enabled = false
      suppressTransformEvent = false
    }
  }

  function syncPathDrawPointMarkers(points: StageVec3[]): void {
    clearPathDrawMarkers()
    const root = getStageRoot()
    if (!root) return
    for (const p of points) {
      const local = worldToContentLocal(p)
      const marker = createPathDrawMarker(PATH_POINT_COLOR, 0.1)
      marker.position.set(local.x, local.y, local.z)
      root.add(marker)
      pathDrawPointMarkers.push(marker)
    }
  }

  function buildPathDrawPreviewPoints(
    kind: DirectorAnimPathKind,
    placed: StageVec3[],
    cursor: StageVec3 | null
  ): StageVec3[] {
    if (!cursor) return placed
    if (placed.length === 0) return [cursor]
    switch (kind) {
      case 'circle':
        return buildCirclePath(placed[0], cursor)
      case 'line':
        return [placed[0], cursor]
      case 'rect': {
        const corners = buildRectPath(placed[0], cursor)
        return [...corners, corners[0]]
      }
      case 'pen':
      case 'pencil':
        return [...placed, cursor]
      default:
        return [...placed, cursor]
    }
  }

  function refreshPathDrawVisual(cursor?: StageVec3 | null): void {
    const mode = pathDrawMode.value
    if (!mode) return
    syncPathDrawPointMarkers(pathDrawDraft.value)
    if (mode.kind === 'pencil' && pathDrawPencilActive) {
      updatePathDraftVisual(pathDrawDraft.value)
      return
    }
    const cursorPos = cursor ?? guideWorldPosition()
    const preview = buildPathDrawPreviewPoints(mode.kind, pathDrawDraft.value, cursorPos)
    if (preview.length >= 2) updatePathDraftVisual(preview)
    else clearPathDraftVisual()
  }

  function resolvePathDrawHit(clientX: number, clientY: number): StageVec3 | null {
    return raycastPathPlane(clientX, clientY) ?? guideWorldPosition()
  }

  function worldToContentLocal(p: StageVec3): StageVec3 {
    if (!contentRoot) return { ...p }
    pathHitPoint.set(p.x, p.y, p.z)
    contentRoot.worldToLocal(pathHitPoint)
    return { x: pathHitPoint.x, y: pathHitPoint.y, z: pathHitPoint.z }
  }

  function contentLocalToWorld(p: StageVec3): StageVec3 {
    if (!contentRoot) return { ...p }
    pathHitPoint.set(p.x, p.y, p.z)
    contentRoot.localToWorld(pathHitPoint)
    return { x: pathHitPoint.x, y: pathHitPoint.y, z: pathHitPoint.z }
  }

  function targetWorldPosition(targetKind: 'camera' | 'object', targetId: string): StageVec3 {
    if (targetKind === 'camera') {
      const cam = getCameraState(targetId)
      return cam
        ? contentLocalToWorld(cam.viewer.position)
        : { x: 0, y: 1.5, z: 0 }
    }
    const obj = stage.value.objects.find((o) => o.id === targetId)
    return obj ? contentLocalToWorld(obj.position) : { x: 0, y: 0, z: 0 }
  }

  function raycastPathPlane(clientX: number, clientY: number): StageVec3 | null {
    if (!camera || !renderer) return null
    const rect = renderer.domElement.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    pathDrawPlane.set(new THREE.Vector3(0, 1, 0), -pathDrawPlaneY)
    if (!raycaster.ray.intersectPlane(pathDrawPlane, pathHitPoint)) return null
    return { x: pathHitPoint.x, y: pathDrawPlaneY, z: pathHitPoint.z }
  }

  function setTrackPath(trackId: string, path: DirectorAnimPath | null): void {
    const anim = ensureAnimation()
    const idx = anim.tracks.findIndex((t) => t.id === trackId)
    if (idx < 0) return
    const track = anim.tracks[idx]
    let nextPath = path
    if (path) {
      nextPath = {
        ...path,
        points: path.points.map((p) => worldToContentLocal(p)),
        ...(path.handles
          ? {
              handles: path.handles.map(
                (h): DirectorAnimPathHandle => ({
                  in: worldToContentLocal(h.in),
                  out: worldToContentLocal(h.out)
                })
              )
            }
          : {})
      }
    }
    const keyframes =
      nextPath && nextPath.points.length >= 2
        ? bakeKeyframesFromPath(nextPath, track.start, track.end, trackId)
        : []
    anim.tracks[idx] = { ...track, path: nextPath, keyframes }
    syncPathVisual(trackId, nextPath, track.targetKind)
    animSelectedKeyframeId.value = null
    syncPathEditOverlays()
    requestRender()
    schedulePersist()
  }

  function patchTrackPathLocal(
    trackId: string,
    path: DirectorAnimPath,
    opts?: { persist?: boolean; refreshOverlays?: boolean }
  ): void {
    const anim = ensureAnimation()
    const idx = anim.tracks.findIndex((t) => t.id === trackId)
    if (idx < 0) return
    const track = anim.tracks[idx]
    const nextPath: DirectorAnimPath = {
      ...path,
      points: path.points.map((p) => ({ ...p })),
      ...(path.handles
        ? {
            handles: path.handles.map((h) => ({
              in: { ...h.in },
              out: { ...h.out }
            }))
          }
        : {})
    }
    const keyframes =
      nextPath.points.length >= 2
        ? bakeKeyframesFromPath(nextPath, track.start, track.end, trackId)
        : []
    anim.tracks[idx] = { ...track, path: nextPath, keyframes }
    syncPathVisual(trackId, nextPath, track.targetKind)
    if (opts?.refreshOverlays !== false && !pathEditDragging) {
      syncPathEditOverlays()
    } else if (pathEditDragging) {
      refreshPathEditOverlayPositions(nextPath)
    }
    requestRender()
    if (opts?.persist) schedulePersist()
  }

  function getSelectedPenPathTrack(): DirectorAnimTrack | null {
    if (stageEditMode.value !== 'animation') return null
    const trackId = animSelectedTrackId.value
    if (!trackId) return null
    const track = stage.value.animation?.tracks.find((t) => t.id === trackId) ?? null
    if (!track?.path || track.path.kind !== 'pen') return null
    return track
  }

  function isPenPathEditActive(): boolean {
    return getSelectedPenPathTrack() != null
  }

  function ensurePenPathHandles(trackId: string): boolean {
    const anim = ensureAnimation()
    const idx = anim.tracks.findIndex((t) => t.id === trackId)
    if (idx < 0) return false
    const track = anim.tracks[idx]
    const path = track.path
    if (!path || path.kind !== 'pen' || path.points.length < 2) return false
    if (pathHasEditableHandles(path)) return true
    const handles = derivePathHandles(path.points)
    anim.tracks[idx] = {
      ...track,
      path: { ...path, handles },
      keyframes: bakeKeyframesFromPath({ ...path, handles }, track.start, track.end, trackId)
    }
    syncPathVisual(trackId, anim.tracks[idx].path, track.targetKind)
    schedulePersist()
    return true
  }

  function disposePathEditMesh(mesh: THREE.Mesh): void {
    mesh.parent?.remove(mesh)
    mesh.geometry.dispose()
    ;(mesh.material as THREE.Material).dispose()
  }

  function disposePathEditLine(line: THREE.Line): void {
    line.parent?.remove(line)
    line.geometry.dispose()
    ;(line.material as THREE.Material).dispose()
  }

  function clearPathEditOverlays(): void {
    if (transform && pathEditSelection) {
      const obj = transform.object
      if (
        obj &&
        (pathEditAnchorMeshes.includes(obj as THREE.Mesh) ||
          pathEditHandleInMeshes.includes(obj as THREE.Mesh) ||
          pathEditHandleOutMeshes.includes(obj as THREE.Mesh))
      ) {
        suppressTransformEvent = true
        transform.detach()
        suppressTransformEvent = false
      }
    }
    pathEditSelection = null
    for (const mesh of pathEditAnchorMeshes) disposePathEditMesh(mesh)
    for (const mesh of pathEditHandleInMeshes) disposePathEditMesh(mesh)
    for (const mesh of pathEditHandleOutMeshes) disposePathEditMesh(mesh)
    for (const line of pathEditRodLines) disposePathEditLine(line)
    pathEditAnchorMeshes.length = 0
    pathEditHandleInMeshes.length = 0
    pathEditHandleOutMeshes.length = 0
    pathEditRodLines.length = 0
    pathEditPickables.length = 0
  }

  function createPathEditRod(a: StageVec3, b: StageVec3): THREE.Line {
    const geom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(a.x, a.y, a.z),
      new THREE.Vector3(b.x, b.y, b.z)
    ])
    const mat = new THREE.LineBasicMaterial({
      color: PATH_ROD_COLOR,
      transparent: true,
      opacity: 0.75,
      depthTest: true
    })
    const line = new THREE.Line(geom, mat)
    line.frustumCulled = false
    line.renderOrder = 4
    return line
  }

  function refreshPathEditOverlayPositions(path: DirectorAnimPath): void {
    if (!path.handles || path.handles.length !== path.points.length) return
    for (let i = 0; i < path.points.length; i++) {
      const p = path.points[i]
      const h = path.handles[i]
      const anchor = pathEditAnchorMeshes[i]
      const hin = pathEditHandleInMeshes[i]
      const hout = pathEditHandleOutMeshes[i]
      if (anchor) anchor.position.set(p.x, p.y, p.z)
      if (hin) hin.position.set(h.in.x, h.in.y, h.in.z)
      if (hout) hout.position.set(h.out.x, h.out.y, h.out.z)
      const rodIn = pathEditRodLines[i * 2]
      const rodOut = pathEditRodLines[i * 2 + 1]
      if (rodIn) {
        const pos = rodIn.geometry.attributes.position as THREE.BufferAttribute
        pos.setXYZ(0, p.x, p.y, p.z)
        pos.setXYZ(1, h.in.x, h.in.y, h.in.z)
        pos.needsUpdate = true
        rodIn.geometry.computeBoundingSphere()
      }
      if (rodOut) {
        const pos = rodOut.geometry.attributes.position as THREE.BufferAttribute
        pos.setXYZ(0, p.x, p.y, p.z)
        pos.setXYZ(1, h.out.x, h.out.y, h.out.z)
        pos.needsUpdate = true
        rodOut.geometry.computeBoundingSphere()
      }
    }
  }

  function syncPathEditOverlays(): void {
    const prevSelection = pathEditSelection
    clearPathEditOverlays()
    if (pathDrawMode.value || stageEditMode.value !== 'animation') return
    const track = getSelectedPenPathTrack()
    if (!track?.path) return
    if (!ensurePenPathHandles(track.id)) return
    const path = stage.value.animation?.tracks.find((t) => t.id === track.id)?.path
    if (!path?.handles || path.handles.length !== path.points.length) return
    const root = getStageRoot()
    if (!root) return

    for (let i = 0; i < path.points.length; i++) {
      const p = path.points[i]
      const h = path.handles[i]
      const anchor = createPathDrawMarker(PATH_ANCHOR_COLOR, 0.11)
      anchor.position.set(p.x, p.y, p.z)
      anchor.userData.pathEdit = { trackId: track.id, kind: 'anchor' as const, index: i }
      root.add(anchor)
      pathEditAnchorMeshes.push(anchor)

      const hin = createPathDrawMarker(PATH_HANDLE_COLOR, 0.08)
      hin.position.set(h.in.x, h.in.y, h.in.z)
      hin.userData.pathEdit = { trackId: track.id, kind: 'handleIn' as const, index: i }
      root.add(hin)
      pathEditHandleInMeshes.push(hin)

      const hout = createPathDrawMarker(PATH_HANDLE_COLOR, 0.08)
      hout.position.set(h.out.x, h.out.y, h.out.z)
      hout.userData.pathEdit = { trackId: track.id, kind: 'handleOut' as const, index: i }
      root.add(hout)
      pathEditHandleOutMeshes.push(hout)

      const rodIn = createPathEditRod(p, h.in)
      const rodOut = createPathEditRod(p, h.out)
      root.add(rodIn, rodOut)
      pathEditRodLines.push(rodIn, rodOut)
    }

    // ??????? > ??
    pathEditPickables.push(...pathEditHandleInMeshes, ...pathEditHandleOutMeshes, ...pathEditAnchorMeshes)

    if (
      prevSelection &&
      prevSelection.trackId === track.id &&
      prevSelection.index >= 0 &&
      prevSelection.index < path.points.length
    ) {
      attachPathEditGizmo(prevSelection)
    }
  }

  function meshForPathEdit(sel: NonNullable<PathEditSelection>): THREE.Mesh | null {
    if (sel.kind === 'anchor') return pathEditAnchorMeshes[sel.index] ?? null
    if (sel.kind === 'handleIn') return pathEditHandleInMeshes[sel.index] ?? null
    return pathEditHandleOutMeshes[sel.index] ?? null
  }

  function attachPathEditGizmo(sel: NonNullable<PathEditSelection>): void {
    const mesh = meshForPathEdit(sel)
    if (!mesh || !transform) {
      pathEditSelection = null
      return
    }
    pathEditSelection = sel
    suppressTransformEvent = true
    transform.setMode('translate')
    transform.attach(mesh)
    suppressTransformEvent = false
    syncTransformGizmoScale()
  }

  function selectPathEditTarget(sel: NonNullable<PathEditSelection>): void {
    if (animSelectedTrackId.value !== sel.trackId) {
      animSelectedTrackId.value = sel.trackId
      syncSelectionFromAnimTrack(sel.trackId)
    }
    ensurePenPathHandles(sel.trackId)
    if (!pathEditAnchorMeshes.length) syncPathEditOverlays()
    attachPathEditGizmo(sel)
    // ??????
    const path = stage.value.animation?.tracks.find((t) => t.id === sel.trackId)?.path ?? null
    syncPathVisual(sel.trackId, path)
    requestRender()
  }

  function mirrorOppositeHandle(
    anchor: StageVec3,
    moved: StageVec3,
    keepLengthFrom: StageVec3
  ): StageVec3 {
    const mx = moved.x - anchor.x
    const my = moved.y - anchor.y
    const mz = moved.z - anchor.z
    const movedLen = Math.hypot(mx, my, mz)
    const keepLen = Math.hypot(
      keepLengthFrom.x - anchor.x,
      keepLengthFrom.y - anchor.y,
      keepLengthFrom.z - anchor.z
    )
    if (movedLen < 1e-8) {
      return { ...keepLengthFrom }
    }
    const scale = keepLen / movedLen
    return {
      x: anchor.x - mx * scale,
      y: anchor.y - my * scale,
      z: anchor.z - mz * scale
    }
  }

  function syncPathEditFromTransform(persist: boolean): void {
    if (!pathEditSelection || !transform?.object) return
    const sel = pathEditSelection
    const track = stage.value.animation?.tracks.find((t) => t.id === sel.trackId)
    const path = track?.path
    if (!path?.handles || path.handles.length !== path.points.length) return
    const mesh = transform.object
    const nextPoints = path.points.map((p) => ({ ...p }))
    const nextHandles = path.handles.map((h) => ({
      in: { ...h.in },
      out: { ...h.out }
    }))
    const local = { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }
    const i = sel.index
    if (sel.kind === 'anchor') {
      const prev = nextPoints[i]
      const dx = local.x - prev.x
      const dy = local.y - prev.y
      const dz = local.z - prev.z
      nextPoints[i] = { ...local }
      nextHandles[i] = {
        in: {
          x: nextHandles[i].in.x + dx,
          y: nextHandles[i].in.y + dy,
          z: nextHandles[i].in.z + dz
        },
        out: {
          x: nextHandles[i].out.x + dx,
          y: nextHandles[i].out.y + dy,
          z: nextHandles[i].out.z + dz
        }
      }
    } else if (sel.kind === 'handleIn') {
      nextHandles[i] = { ...nextHandles[i], in: { ...local } }
      if (!pathEditBreakHandles) {
        nextHandles[i].out = mirrorOppositeHandle(nextPoints[i], local, nextHandles[i].out)
      }
    } else {
      nextHandles[i] = { ...nextHandles[i], out: { ...local } }
      if (!pathEditBreakHandles) {
        nextHandles[i].in = mirrorOppositeHandle(nextPoints[i], local, nextHandles[i].in)
      }
    }
    patchTrackPathLocal(
      sel.trackId,
      { ...path, points: nextPoints, handles: nextHandles },
      { persist, refreshOverlays: false }
    )
    refreshPathEditOverlayPositions({ ...path, points: nextPoints, handles: nextHandles })
  }

  function findPathEditHit(hits: THREE.Intersection[]): PathEditSelection {
    for (const hit of hits) {
      let obj: THREE.Object3D | null = hit.object
      while (obj) {
        const pe = obj.userData.pathEdit as
          | { trackId: string; kind: PathEditKind; index: number }
          | undefined
        if (pe && typeof pe.trackId === 'string' && typeof pe.index === 'number') {
          return { trackId: pe.trackId, kind: pe.kind, index: pe.index }
        }
        obj = obj.parent
      }
    }
    return null
  }

  function findPathLineHit(hits: THREE.Intersection[]): string | null {
    for (const hit of hits) {
      let obj: THREE.Object3D | null = hit.object
      while (obj) {
        if (typeof obj.userData.animTrackId === 'string') return obj.userData.animTrackId
        obj = obj.parent
      }
    }
    return null
  }

  /** ????????????????????*/
  function restoreBasePoseFromStage(): void {
    stopAllSkeletonMixers()
    for (const obj of stage.value.objects) {
      const mesh = objectMeshes.get(obj.id)
      if (!mesh) continue
      applyTransform(mesh, obj)
      if (selectionHelper && selectedObjectId.value === obj.id) selectionHelper.update()
    }
    applyAllBonePoses()
    syncShotVisuals()
    if (viewMode.value === 'camera') applyCameraView()
    previewRevision.value += 1
  }

  function clearSkeletonRuntime(objectId: string): void {
    const runtime = skeletonRuntimes.get(objectId)
    if (!runtime) return
    runtime.mixer.stopAllAction()
    skeletonRuntimes.delete(objectId)
    for (const key of [...retargetedClipCache.keys()]) {
      if (key.includes(`|${objectId}|`)) retargetedClipCache.delete(key)
    }
    skeletonClipsRevision.value += 1
  }

  function clearAllSkeletonRuntimes(): void {
    if (!skeletonRuntimes.size && !retargetedClipCache.size) return
    for (const id of [...skeletonRuntimes.keys()]) {
      const runtime = skeletonRuntimes.get(id)
      runtime?.mixer.stopAllAction()
      skeletonRuntimes.delete(id)
    }
    retargetedClipCache.clear()
    skeletonClipsRevision.value += 1
  }

  function resetSkeletonBindPose(root: THREE.Object3D): void {
    root.traverse((child) => {
      if (child instanceof THREE.SkinnedMesh && child.skeleton) {
        child.skeleton.pose()
      }
    })
  }

  function stopAllSkeletonMixers(): void {
    for (const [objectId, runtime] of skeletonRuntimes) {
      runtime.mixer.stopAllAction()
      runtime.mixer.update(0)
      const mesh = objectMeshes.get(objectId)
      if (mesh) resetSkeletonBindPose(mesh)
    }
  }

  function registerSkeletonRuntime(
    objectId: string,
    root: THREE.Object3D,
    clips: THREE.AnimationClip[]
  ): void {
    clearSkeletonRuntime(objectId)
    skeletonRuntimes.set(objectId, {
      mixer: new THREE.AnimationMixer(root),
      embeddedClips: clips.slice()
    })
    skeletonClipsRevision.value += 1
  }

  function findSkeletonClip(
    clips: THREE.AnimationClip[],
    clipName: string
  ): THREE.AnimationClip | null {
    const wanted = clipName.trim()
    if (!wanted) return null
    const byName = clips.find((clip) => clip.name === wanted)
    if (byName) return byName
    const byLabel = clips.find((clip, index) => skeletonClipLabel(clip.name, index) === wanted)
    return byLabel ?? null
  }

  function retargetCacheKey(assetId: string, objectId: string, clipName: string): string {
    return `${assetId}|${objectId}|${clipName}`
  }

  async function loadAnimationAsset(assetId: string): Promise<AnimationAssetCacheEntry | null> {
    const cached = animationAssetCache.get(assetId)
    if (cached) return cached
    const asset = project.assets.find((item) => item.id === assetId && item.type === 'model')
    if (!asset?.relativePath) return null
    try {
      const url = await window.studio.getAssetFileUrl(asset.relativePath)
      const loaded = await loadModelScene(url, asset.relativePath)
      const entry: AnimationAssetCacheEntry = {
        clips: loaded.animations.slice(),
        scene: loaded.scene
      }
      animationAssetCache.set(assetId, entry)
      return entry
    } catch {
      return null
    }
  }

  async function loadAnimationClipsFromAsset(assetId: string): Promise<THREE.AnimationClip[]> {
    const entry = await loadAnimationAsset(assetId)
    return entry?.clips ?? []
  }

  function ensureRetargetedClip(
    objectId: string,
    assetId: string,
    sourceClip: THREE.AnimationClip
  ): THREE.AnimationClip {
    const clipName = sourceClip.name?.trim() || 'Clip'
    const key = retargetCacheKey(assetId, objectId, clipName)
    const cached = retargetedClipCache.get(key)
    if (cached) return cached

    const targetRoot = objectMeshes.get(objectId)
    const assetEntry = animationAssetCache.get(assetId)
    if (!targetRoot || !assetEntry) {
      retargetedClipCache.set(key, sourceClip)
      return sourceClip
    }

    const retargeted = retargetClipToCharacter(targetRoot, assetEntry.scene, sourceClip)
    retargetedClipCache.set(key, retargeted)
    return retargeted
  }

  async function hydrateRetargetedClipsForObject(objectId: string): Promise<void> {
    const tracks = stage.value.animation?.tracks ?? []
    for (const track of tracks) {
      if (track.targetKind !== 'object' || track.targetId !== objectId) continue
      for (const segment of directorTrackSkeletonClips(track)) {
        const assetId = segment.assetId?.trim()
        if (!assetId) continue
        const entry = await loadAnimationAsset(assetId)
        if (!entry) continue
        const source = findSkeletonClip(entry.clips, segment.clip) ?? entry.clips[0]
        if (source) ensureRetargetedClip(objectId, assetId, source)
      }
    }
  }

  function collectTrackSkeletonAssetIds(track: DirectorAnimTrack): string[] {
    const ids = new Set<string>()
    for (const segment of directorTrackSkeletonClips(track)) {
      const id = segment.assetId?.trim()
      if (id) ids.add(id)
    }
    return [...ids]
  }

  async function hydrateExternalSkeletonAssets(): Promise<void> {
    const tracks = stage.value.animation?.tracks ?? []
    const objectIds = new Set<string>()
    const assetIds = new Set<string>()
    for (const track of tracks) {
      if (track.targetKind !== 'object') continue
      objectIds.add(track.targetId)
      for (const id of collectTrackSkeletonAssetIds(track)) assetIds.add(id)
    }
    await Promise.all([...assetIds].map((id) => loadAnimationAsset(id)))
    await Promise.all([...objectIds].map((id) => hydrateRetargetedClipsForObject(id)))
    skeletonClipsRevision.value += 1
  }

  function clipsForSkeletonSegment(
    objectId: string,
    segment: DirectorSkeletonClipSegment
  ): THREE.AnimationClip[] {
    const assetId = segment.assetId?.trim()
    if (!assetId) return skeletonRuntimes.get(objectId)?.embeddedClips ?? []
    const entry = animationAssetCache.get(assetId)
    if (!entry) return []
    return entry.clips.map((clip) => {
      const name = clip.name?.trim() || 'Clip'
      return retargetedClipCache.get(retargetCacheKey(assetId, objectId, name)) ?? clip
    })
  }

  function applySkeletonAnimationsAtTime(time: number): void {
    if (poseBoneDragging) return
    const anim = stage.value.animation
    const trackByObject = new Map<string, DirectorAnimTrack>()
    if (anim) {
      for (const track of anim.tracks) {
        if (track.targetKind !== 'object') continue
        if (!directorTrackSkeletonClips(track).length) continue
        trackByObject.set(track.targetId, track)
      }
    }
    const animatedIds = new Set<string>()
    for (const [objectId, runtime] of skeletonRuntimes) {
      const track = trackByObject.get(objectId)
      const segment = track ? findActiveSkeletonSegment(track, time) : null
      if (!track || !segment) {
        runtime.mixer.stopAllAction()
        runtime.mixer.update(0)
        continue
      }
      const clip = findSkeletonClip(clipsForSkeletonSegment(objectId, segment), segment.clip)
      if (!clip) {
        runtime.mixer.stopAllAction()
        runtime.mixer.update(0)
        continue
      }
      const seek = skeletonSegmentLocalTime(time, segment, clip.duration)
      if (!seek.active) {
        runtime.mixer.stopAllAction()
        runtime.mixer.update(0)
        continue
      }
      runtime.mixer.stopAllAction()
      const action = runtime.mixer.clipAction(clip)
      action.enabled = true
      action.paused = true
      action.time = seek.time
      action.play()
      runtime.mixer.update(0)
      animatedIds.add(objectId)
    }
    // ???????????? SET?bind ?? ? ??????????????????
    applyAllBonePoses(animatedIds)
  }

  function clearBonePoseOffsetCache(objectId?: string): void {
    if (objectId) bonePoseOffsetCache.delete(objectId)
    else bonePoseOffsetCache.clear()
  }

  function setBonePoseOffsetCacheQuat(
    objectId: string,
    boneName: string,
    offset: THREE.Quaternion
  ): void {
    let map = bonePoseOffsetCache.get(objectId)
    if (!map) {
      map = new Map()
      bonePoseOffsetCache.set(objectId, map)
    }
    if (isNearIdentityQuat(offset)) map.delete(boneName)
    else map.set(boneName, offset.clone())
    if (!map.size) bonePoseOffsetCache.delete(objectId)
  }

  function syncBonePoseOffsetCacheFromEuler(
    objectId: string,
    poses: Record<string, StageVec3> | undefined
  ): void {
    bonePoseOffsetCache.delete(objectId)
    if (!poses) return
    const map = new Map<string, THREE.Quaternion>()
    for (const [name, rot] of Object.entries(poses)) {
      if (!rot) continue
      if (rot.x === 0 && rot.y === 0 && rot.z === 0) continue
      map.set(name, offsetFromEulerXYZ(rot.x, rot.y, rot.z))
    }
    if (map.size) bonePoseOffsetCache.set(objectId, map)
  }

  /** ???????????????????TRS????bind ??????? */
  function snapshotObjectBindPose(objectId: string, root: THREE.Object3D): void {
    const map = new Map<string, BindPoseRecord>()
    for (const bone of collectSkinningBones(root)) {
      const name = bone.name?.trim()
      if (!name) continue
      map.set(name, {
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone(),
        scale: bone.scale.clone()
      })
    }
    if (map.size) bindPoseSnapshots.set(objectId, map)
    else bindPoseSnapshots.delete(objectId)
  }

  function offsetForBone(objectId: string, name: string): THREE.Quaternion | null {
    const cached = bonePoseOffsetCache.get(objectId)?.get(name)
    if (cached) return cached
    const rot = stage.value.objects.find((item) => item.id === objectId)?.bonePose?.[name]
    if (!rot || (rot.x === 0 && rot.y === 0 && rot.z === 0)) return null
    return offsetFromEulerXYZ(rot.x, rot.y, rot.z, bonePoseOffsetQuat)
  }

  function skinningBonesByName(root: THREE.Object3D): Map<string, THREE.Bone> {
    const byName = new Map<string, THREE.Bone>()
    for (const bone of collectSkinningBones(root)) {
      const name = bone.name?.trim()
      if (name) byName.set(name, bone)
    }
    return byName
  }

  /**
   * ???????????? SET ??bind ??????/???????? SET bind?offset??   * ??????/ ?? / ?? / ?????gizmo ????????????   */
  function applyBonePoseForObject(objectId: string, onTopOfAnimation = false): void {
    const obj = stage.value.objects.find((item) => item.id === objectId)
    const poses = obj?.bonePose
    const root = objectMeshes.get(objectId)
    if (!root) return
    if (poses && !bonePoseOffsetCache.has(objectId)) {
      syncBonePoseOffsetCacheFromEuler(objectId, poses)
    }

    const snapshot = bindPoseSnapshots.get(objectId)
    if (!onTopOfAnimation && snapshot) {
      const byName = skinningBonesByName(root)
      for (const [name, rec] of snapshot) {
        const bone = byName.get(name)
        if (!bone) continue
        bone.position.copy(rec.position)
        bone.scale.copy(rec.scale)
        const offset = offsetForBone(objectId, name)
        if (offset) applyBoneOffset(rec.quaternion, offset, bone.quaternion)
        else bone.quaternion.copy(rec.quaternion)
      }
      return
    }

    // ??????????multiply ????????????
    if (!poses) return
    const byName = skinningBonesByName(root)
    for (const name of Object.keys(poses)) {
      const bone = byName.get(name)
      if (!bone) continue
      const offset = offsetForBone(objectId, name)
      if (offset) bone.quaternion.multiply(offset)
    }
  }

  /** animatedIds???? mixer ?????????? multiply ???????? SET */
  function applyAllBonePoses(animatedIds?: Set<string>): void {
    if (poseBoneDragging) return
    for (const obj of stage.value.objects) {
      const mesh = objectMeshes.get(obj.id)
      if (!mesh) continue
      const hasPose = !!obj.bonePose && Object.keys(obj.bonePose).length > 0
      if (animatedIds?.has(obj.id)) {
        if (hasPose) applyBonePoseForObject(obj.id, true)
        continue
      }
      const hasSnapshot = bindPoseSnapshots.has(obj.id)
      if (!hasPose && !hasSnapshot) continue
      if (!hasSnapshot) resetSkeletonBindPose(mesh)
      applyBonePoseForObject(obj.id)
    }
  }

  function refreshObjectSkeletonPose(objectId: string): void {
    // ??/??????????? mixer????????????
    if (
      stageEditMode.value === 'animation' &&
      skeletonRuntimes.has(objectId) &&
      stage.value.animation
    ) {
      applySkeletonAnimationsAtTime(animTime.value)
      return
    }
    const mesh = objectMeshes.get(objectId)
    if (!mesh) return
    if (!bindPoseSnapshots.has(objectId)) resetSkeletonBindPose(mesh)
    applyBonePoseForObject(objectId)
  }

  /** ??????bind ? offset????????????*/
  function applySingleBonePose(objectId: string, boneName: string): void {
    const rec = bindPoseSnapshots.get(objectId)?.get(boneName)
    const bone = poseSkeletonOverlay?.findBone(boneName)
    if (!rec || !bone) {
      refreshObjectSkeletonPose(objectId)
      return
    }
    bone.position.copy(rec.position)
    bone.scale.copy(rec.scale)
    const offset = offsetForBone(objectId, boneName)
    if (offset) applyBoneOffset(rec.quaternion, offset, bone.quaternion)
    else bone.quaternion.copy(rec.quaternion)
  }

  function listObjectBones(objectId: string): string[] {
    void previewRevision.value
    const mesh = objectMeshes.get(objectId)
    if (!mesh) return []
    return collectPoseEditBoneNames(mesh)
  }

  /** 可编辑骨骼层级（含父骨名与当前度数偏移），供 AI 姿势提示词使用 */
  function listObjectBoneHierarchy(objectId: string): {
    name: string
    parent: string | null
    rotationDeg: StageVec3
  }[] {
    void previewRevision.value
    const mesh = objectMeshes.get(objectId)
    if (!mesh) return []
    const bones = collectPoseEditBones(mesh)
    const boneSet = new Set(bones)
    return bones
      .map((bone) => {
        const name = bone.name?.trim()
        if (!name) return null
        const parent = findNearestPoseBoneParent(bone, boneSet)
        return {
          name,
          parent: parent?.name?.trim() || null,
          rotationDeg: getObjectBonePoseDeg(objectId, name)
        }
      })
      .filter((row): row is { name: string; parent: string | null; rotationDeg: StageVec3 } => !!row)
  }

  function getObjectBonePoseDeg(objectId: string, boneName: string): StageVec3 {
    const obj = stage.value.objects.find((item) => item.id === objectId)
    const pose = obj?.bonePose?.[boneName]
    if (!pose) return { x: 0, y: 0, z: 0 }
    return {
      x: Number(((pose.x * 180) / Math.PI).toFixed(1)),
      y: Number(((pose.y * 180) / Math.PI).toFixed(1)),
      z: Number(((pose.z * 180) / Math.PI).toFixed(1))
    }
  }

  function setObjectBonePoseDeg(
    objectId: string,
    boneName: string,
    axis: 'x' | 'y' | 'z',
    degrees: number
  ): void {
    const idx = stage.value.objects.findIndex((item) => item.id === objectId)
    if (idx < 0) return
    const obj = stage.value.objects[idx]
    if (obj.locked) return
    const name = boneName.trim()
    if (!name) return
    const rad = (Number.isFinite(degrees) ? degrees : 0) * (Math.PI / 180)
    const prev = obj.bonePose?.[name] ?? { x: 0, y: 0, z: 0 }
    const nextRot: StageVec3 = {
      x: axis === 'x' ? rad : prev.x,
      y: axis === 'y' ? rad : prev.y,
      z: axis === 'z' ? rad : prev.z
    }
    const nextPose = { ...(obj.bonePose ?? {}) }
    if (nextRot.x === 0 && nextRot.y === 0 && nextRot.z === 0) {
      delete nextPose[name]
    } else {
      nextPose[name] = nextRot
    }
    const bonePose = Object.keys(nextPose).length ? nextPose : undefined
    stage.value.objects = stage.value.objects.map((item, i) =>
      i === idx ? { ...item, bonePose } : item
    )
    selectedPoseBone.value = name
    poseSkeletonOverlay?.setSelectedBone(name)
    // ???????? setBonePoseOffsetCacheQuat ?????????
    setBonePoseOffsetCacheQuat(objectId, name, offsetFromEulerXYZ(nextRot.x, nextRot.y, nextRot.z))
    // ??????????????refresh??????????????
    applySingleBonePose(objectId, name)
    syncPoseBoneGizmo()
    requestRender()
    schedulePersist()
  }

  function setSelectedPoseBone(boneName: string | null): void {
    selectedPoseBone.value = boneName?.trim() || null
    poseSkeletonOverlay?.setSelectedBone(selectedPoseBone.value)
    if (poseEditMode.value === 'ik') {
      const objectId = poseSkeletonOverlay?.getTargetObjectId()
      if (selectedPoseBone.value && objectId) {
        const chain = findIkChainForBone(objectId, selectedPoseBone.value)
        selectedIkChainId.value = chain?.id ?? null
      } else if (!selectedPoseBone.value) {
        selectedIkChainId.value = null
      }
    }
    syncPoseBoneGizmo()
    requestRender()
  }

  function isPoseEditActive(): boolean {
    return !!poseSkeletonOverlay?.getTargetObjectId()
  }

  function ensureIkChains(objectId: string): IkChain[] {
    const mesh = objectMeshes.get(objectId)
    if (!mesh) return []
    const obj = stage.value.objects.find((item) => item.id === objectId)
    const chains = mergeIkChains(mesh, obj?.ikChains)
    ikChainsByObject.set(objectId, chains)
    return chains
  }

  function listObjectIkTargetSlots(objectId: string): {
    id: IkChainSlot
    effector: string | null
    links: string[]
    manual: boolean
    autoEffector: string | null
  }[] {
    void previewRevision.value
    const mesh = objectMeshes.get(objectId)
    const obj = stage.value.objects.find((item) => item.id === objectId)
    const auto = mesh ? detectDefaultIkChains(mesh) : []
    const autoById = new Map(auto.map((c) => [c.id, c]))
    const merged = ensureIkChains(objectId)
    const mergedById = new Map(merged.map((c) => [c.id, c]))
    return IK_CHAIN_SLOTS.map((id) => {
      const cur = mergedById.get(id)
      const a = autoById.get(id)
      const override = obj?.ikChains?.find((c) => c.id === id)
      return {
        id,
        effector: cur?.effector ?? null,
        links: cur?.links.slice() ?? [],
        manual: !!override,
        autoEffector: a?.effector ?? null
      }
    })
  }

  /** ?????? IK ?????????????? / null ???????? */
  function setObjectIkChainEffector(
    objectId: string,
    slotId: DirectorIkChainSlotId,
    effector: string | null
  ): boolean {
    const idx = stage.value.objects.findIndex((item) => item.id === objectId)
    if (idx < 0) return false
    const obj = stage.value.objects[idx]
    if (obj.locked) return false
    const mesh = objectMeshes.get(objectId)
    if (!mesh) return false

    const nextName = effector?.trim() || ''
    const prev = (obj.ikChains ?? []).filter((c) => c.id !== slotId)
    let nextSpecs: DirectorIkChainSpec[] | undefined
    if (!nextName) {
      nextSpecs = prev.length ? prev : undefined
    } else {
      const resolved = mergeIkChains(mesh, [{ id: slotId, effector: nextName }]).find(
        (c) => c.id === slotId && c.manual
      )
      if (!resolved) return false
      nextSpecs = [...prev, { id: slotId, effector: resolved.effector }]
    }

    stage.value.objects = stage.value.objects.map((item, i) =>
      i === idx ? { ...item, ikChains: nextSpecs } : item
    )
    ikChainsByObject.delete(objectId)
    const chains = ensureIkChains(objectId)
    if (poseEditMode.value === 'ik') {
      if (nextName && chains.some((c) => c.id === slotId)) {
        selectedIkChainId.value = slotId
        selectedPoseBone.value = nextName
        poseSkeletonOverlay?.setSelectedBone(nextName)
      } else if (selectedIkChainId.value === slotId) {
        selectedIkChainId.value = chains[0]?.id ?? null
        selectedPoseBone.value = chains[0]?.effector ?? null
        poseSkeletonOverlay?.setSelectedBone(selectedPoseBone.value)
      }
    }
    previewRevision.value += 1
    schedulePersist()
    syncPoseBoneGizmo()
    requestRender()
    return true
  }

  function findIkChainForBone(objectId: string, boneName: string): IkChain | null {
    const key = boneName.trim()
    for (const chain of ensureIkChains(objectId)) {
      if (chain.effector === key || chain.links.includes(key)) return chain
    }
    return null
  }

  function getSelectedIkChain(): IkChain | null {
    const objectId = poseSkeletonOverlay?.getTargetObjectId()
    const id = selectedIkChainId.value
    if (!objectId || !id) return null
    return ensureIkChains(objectId).find((c) => c.id === id) ?? null
  }

  function setPoseEditMode(mode: 'fk' | 'ik' | 'ai'): void {
    if (poseEditMode.value === mode) return
    poseEditMode.value = mode
    if (mode === 'fk') {
      selectedIkChainId.value = null
      if (ikTarget) ikTarget.visible = false
    } else if (mode === 'ik') {
      selectedPoseBone.value = null
      poseSkeletonOverlay?.setSelectedBone(null)
      const objectId = poseSkeletonOverlay?.getTargetObjectId()
      if (objectId) {
        const chains = ensureIkChains(objectId)
        if (!selectedIkChainId.value && chains[0]) selectedIkChainId.value = chains[0].id
      }
    } else {
      // AI：不挂 FK/IK gizmo
      selectedIkChainId.value = null
      selectedPoseBone.value = null
      poseSkeletonOverlay?.setSelectedBone(null)
      if (ikTarget) ikTarget.visible = false
    }
    syncPoseBoneGizmo()
    requestRender()
  }

  function setSelectedIkChain(chainId: IkChainSlot | null): void {
    selectedIkChainId.value = chainId
    if (chainId) {
      const chain = getSelectedIkChain()
      if (chain) {
        selectedPoseBone.value = chain.effector
        poseSkeletonOverlay?.setSelectedBone(chain.effector)
      }
    }
    syncPoseBoneGizmo()
    requestRender()
  }

  function findSkinningBone(objectId: string, boneName: string): THREE.Bone | null {
    const fromOverlay = poseSkeletonOverlay?.findBone(boneName)
    if (fromOverlay) return fromOverlay
    const root = objectMeshes.get(objectId)
    if (!root) return null
    const key = boneName.trim()
    for (const bone of collectSkinningBones(root)) {
      if (bone.name?.trim() === key) return bone
    }
    return null
  }

  function ensureIkTarget(): THREE.Object3D | null {
    if (!scene) return null
    if (ikTarget) return ikTarget
    ikTargetGeom = new THREE.SphereGeometry(1, 16, 16)
    ikTargetMat = new THREE.MeshBasicMaterial({
      color: 0xff6b4a,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.95
    })
    const mesh = new THREE.Mesh(ikTargetGeom, ikTargetMat)
    mesh.name = 'pose-ik-target'
    mesh.renderOrder = 1002
    mesh.frustumCulled = false
    mesh.visible = false
    scene.add(mesh)
    ikTarget = mesh
    return ikTarget
  }

  function positionIkTargetAtEffector(objectId: string, chain: IkChain): void {
    const target = ensureIkTarget()
    const effector = findSkinningBone(objectId, chain.effector)
    const root = objectMeshes.get(objectId)
    if (!target || !effector || !root) return
    root.updateMatrixWorld(true)
    effector.getWorldPosition(poseTmpVec3)
    target.position.copy(poseTmpVec3)
    const box = new THREE.Box3().setFromObject(root)
    const size = new THREE.Vector3()
    box.getSize(size)
    const r = Math.max(0.02, Math.max(size.x, size.y, size.z) * 0.018)
    target.scale.setScalar(r)
    target.visible = true
    target.updateMatrixWorld(true)
  }

  function applyIkSolveFromTarget(): void {
    const objectId = poseSkeletonOverlay?.getTargetObjectId()
    const chain = getSelectedIkChain()
    const target = ikTarget
    if (!objectId || !chain || !target) return
    const root = objectMeshes.get(objectId)
    const effector = findSkinningBone(objectId, chain.effector)
    if (!root || !effector) return
    const links: THREE.Bone[] = []
    for (const name of chain.links) {
      const bone = findSkinningBone(objectId, name)
      if (bone) links.push(bone)
    }
    if (!links.length) return
    solveCcdIk({
      effector,
      links,
      targetWorld: target.getWorldPosition(poseTmpVec3),
      iteration: 12,
      root
    })
    poseSkeletonOverlay?.update()
  }

  /** 把当前骨骼局部旋转相对 bind 烘焙进 bonePose */
  function bakeNamedBonesPose(objectId: string, boneNames: string[], persist: boolean): void {
    const idx = stage.value.objects.findIndex((item) => item.id === objectId)
    if (idx < 0) return
    const obj = stage.value.objects[idx]
    if (obj.locked) return

    const nextPose = { ...(obj.bonePose ?? {}) }
    for (const name of boneNames) {
      const bone = findSkinningBone(objectId, name)
      const bindQuat = bindPoseSnapshots.get(objectId)?.get(name)?.quaternion
      if (!bone || !bindQuat) continue
      lockBoneBindPositionScale(objectId, name, bone)
      boneOffsetFromBase(bindQuat, bone.quaternion, poseTmpQuat)
      setBonePoseOffsetCacheQuat(objectId, name, poseTmpQuat)
      if (isNearIdentityQuat(poseTmpQuat)) delete nextPose[name]
      else {
        poseBoneEditEuler.setFromQuaternion(poseTmpQuat, 'XYZ')
        nextPose[name] = { x: poseBoneEditEuler.x, y: poseBoneEditEuler.y, z: poseBoneEditEuler.z }
      }
    }
    if (!persist) {
      requestRender()
      return
    }
    const bonePose = Object.keys(nextPose).length ? nextPose : undefined
    stage.value.objects = stage.value.objects.map((item, i) =>
      i === idx ? { ...item, bonePose } : item
    )
    previewRevision.value += 1
    schedulePersist()
    poseSkeletonOverlay?.update()
    requestRender()
  }

  /** ??IK ?????? links ?? bind ??????cache + bonePose */
  function bakeIkChainPose(persist: boolean): void {
    const objectId = poseSkeletonOverlay?.getTargetObjectId()
    const chain = getSelectedIkChain()
    if (!objectId || !chain) return
    bakeNamedBonesPose(objectId, chain.links, persist)
  }

  function detachPoseBoneGizmo(): void {
    if (!poseBoneTransform) return
    suppressTransformEvent = true
    poseBoneTransform.detach()
    suppressTransformEvent = false
  }

  function beginPoseBoneDrag(boneName: string, bone: THREE.Bone): void {
    const objectId = poseSkeletonOverlay?.getTargetObjectId()
    const bindQuat =
      objectId != null ? bindPoseSnapshots.get(objectId)?.get(boneName)?.quaternion : undefined
    dragBindLocalQuat.copy(bindQuat ?? bone.quaternion)
  }

  /** TransformControls ?????????????? position/scale??????bind */
  function lockBoneBindPositionScale(objectId: string, boneName: string, bone: THREE.Bone): void {
    const rec = bindPoseSnapshots.get(objectId)?.get(boneName)
    if (!rec) return
    bone.position.copy(rec.position)
    bone.scale.copy(rec.scale)
  }

  /**
   * TC ??????bone.quaternion?local?????????bind ?????   * ???????????????? stage????Vue deep watch ??????
   * ?????????????????   */
  function writePoseBoneOffsetFromGizmo(persist: boolean): void {
    const objectId = poseSkeletonOverlay?.getTargetObjectId()
    const boneName = selectedPoseBone.value
    if (!objectId || !boneName || !poseSkeletonOverlay) return
    const bone = poseSkeletonOverlay.findBone(boneName)
    if (!bone) return
    const idx = stage.value.objects.findIndex((item) => item.id === objectId)
    if (idx < 0) return
    const obj = stage.value.objects[idx]
    if (obj.locked) return

    // ???????? TC ???????????? bind
    lockBoneBindPositionScale(objectId, boneName, bone)

    boneOffsetFromBase(dragBindLocalQuat, bone.quaternion, poseTmpQuat)
    setBonePoseOffsetCacheQuat(objectId, boneName, poseTmpQuat)

    if (!persist) {
      poseSkeletonOverlay.update()
      requestRender()
      return
    }

    // ???????????bind TRS ? ??????????????????
    applyBonePoseForObject(objectId)

    poseBoneEditEuler.setFromQuaternion(poseTmpQuat, 'XYZ')
    const nextPose = { ...(obj.bonePose ?? {}) }
    if (isNearIdentityQuat(poseTmpQuat)) delete nextPose[boneName]
    else nextPose[boneName] = { x: poseBoneEditEuler.x, y: poseBoneEditEuler.y, z: poseBoneEditEuler.z }
    const bonePose = Object.keys(nextPose).length ? nextPose : undefined
    stage.value.objects = stage.value.objects.map((item, i) =>
      i === idx ? { ...item, bonePose } : item
    )
    previewRevision.value += 1
    schedulePersist()
    poseSkeletonOverlay.update()
    requestRender()
  }

  function syncPoseBoneGizmoSize(): void {
    if (!poseBoneTransform || !camera) return
    const obj = poseBoneTransform.object
    if (!obj) return
    const dist = camera.position.distanceTo(obj.getWorldPosition(new THREE.Vector3()))
    poseBoneTransform.setSize(Math.min(1.2, Math.max(0.45, dist * 0.12)))
  }

  function syncPoseBoneGizmo(): void {
    if (!poseBoneTransform || !poseSkeletonOverlay) {
      detachPoseBoneGizmo()
      if (ikTarget) ikTarget.visible = false
      return
    }
    if (!isPoseEditActive() || poseEditMode.value === 'ai') {
      detachPoseBoneGizmo()
      if (ikTarget) ikTarget.visible = false
      return
    }
    const objectId = poseSkeletonOverlay.getTargetObjectId()
    if (!objectId || isObjectLocked(objectId)) {
      detachPoseBoneGizmo()
      if (ikTarget) ikTarget.visible = false
      return
    }
    if (transform?.object) {
      suppressTransformEvent = true
      transform.detach()
      suppressTransformEvent = false
    }

    if (poseEditMode.value === 'ik') {
      const chain = getSelectedIkChain()
      if (!chain) {
        detachPoseBoneGizmo()
        if (ikTarget) ikTarget.visible = false
        return
      }
      if (!poseBoneDragging) positionIkTargetAtEffector(objectId, chain)
      const target = ensureIkTarget()
      if (!target) return
      if (!poseBoneDragging && poseBoneTransform.object !== target) {
        suppressTransformEvent = true
        poseBoneTransform.setMode('translate')
        poseBoneTransform.setSpace('world')
        poseBoneTransform.enabled = true
        poseBoneTransform.attach(target)
        suppressTransformEvent = false
      }
      syncPoseBoneGizmoSize()
      return
    }

    if (ikTarget) ikTarget.visible = false
    const boneName = selectedPoseBone.value
    if (!boneName) {
      detachPoseBoneGizmo()
      return
    }
    const bone = poseSkeletonOverlay.findBone(boneName)
    if (!bone) {
      detachPoseBoneGizmo()
      return
    }
    // ?? / ?????? bind ???? Gizmo??? refresh ???
    if (!poseBoneDragging) {
      beginPoseBoneDrag(boneName, bone)
      if (poseBoneTransform.object !== bone) {
        suppressTransformEvent = true
        poseBoneTransform.setMode('rotate')
        poseBoneTransform.setSpace('local')
        poseBoneTransform.enabled = true
        poseBoneTransform.attach(bone)
        suppressTransformEvent = false
      }
    }
    syncPoseBoneGizmoSize()
  }

  function cloneBonePoseMap(
    raw: Record<string, StageVec3> | undefined | null
  ): Record<string, StageVec3> | undefined {
    if (!raw) return undefined
    const out: Record<string, StageVec3> = {}
    for (const [name, rot] of Object.entries(raw)) {
      const key = name.trim()
      if (!key || !rot) continue
      const x = Number.isFinite(rot.x) ? rot.x : 0
      const y = Number.isFinite(rot.y) ? rot.y : 0
      const z = Number.isFinite(rot.z) ? rot.z : 0
      if (x === 0 && y === 0 && z === 0) continue
      out[key] = { x, y, z }
    }
    return Object.keys(out).length ? out : undefined
  }

  function patchObjectBonePose(
    objectId: string,
    bonePose: Record<string, StageVec3> | undefined
  ): void {
    const idx = stage.value.objects.findIndex((item) => item.id === objectId)
    if (idx < 0) return
    const obj = stage.value.objects[idx]
    if (obj.locked) return
    const cleaned = cloneBonePoseMap(bonePose)
    stage.value.objects = stage.value.objects.map((item, i) =>
      i === idx ? { ...item, bonePose: cleaned } : item
    )
    syncBonePoseOffsetCacheFromEuler(objectId, cleaned)
    refreshObjectSkeletonPose(objectId)
    syncPoseBoneGizmo()
    previewRevision.value += 1
    requestRender()
    schedulePersist()
  }

  /**
   * 应用 AI / 外部生成的骨骼姿势（弧度）。
   * replace：整图替换；merge：写入列出的骨，零旋转删除该骨偏移。
   */
  function applyObjectBonePoseMap(
    objectId: string,
    bonePose: Record<string, StageVec3>,
    mode: 'replace' | 'merge' = 'replace'
  ): void {
    const obj = stage.value.objects.find((item) => item.id === objectId)
    if (!obj || obj.locked) return
    if (mode === 'replace') {
      const next: Record<string, StageVec3> = {}
      for (const [name, rot] of Object.entries(bonePose)) {
        if (!rot) continue
        if (rot.x === 0 && rot.y === 0 && rot.z === 0) continue
        next[name] = { x: rot.x, y: rot.y, z: rot.z }
      }
      patchObjectBonePose(objectId, Object.keys(next).length ? next : undefined)
      return
    }
    const next = { ...(obj.bonePose ?? {}) }
    for (const [name, rot] of Object.entries(bonePose)) {
      if (!rot) continue
      if (rot.x === 0 && rot.y === 0 && rot.z === 0) delete next[name]
      else next[name] = { x: rot.x, y: rot.y, z: rot.z }
    }
    patchObjectBonePose(objectId, Object.keys(next).length ? next : undefined)
  }

  function listObjectPosePresets(objectId: string): DirectorPosePreset[] {
    const obj = stage.value.objects.find((item) => item.id === objectId)
    return obj?.posePresets?.slice() ?? []
  }

  function applyObjectPosePreset(objectId: string, presetId: string): boolean {
    const obj = stage.value.objects.find((item) => item.id === objectId)
    if (!obj || obj.locked) return false
    const preset = obj.posePresets?.find((item) => item.id === presetId)
    if (!preset) return false
    patchObjectBonePose(objectId, cloneBonePoseMap(preset.bones) ?? undefined)
    return true
  }

  function saveObjectPosePreset(objectId: string, name?: string): string | null {
    const idx = stage.value.objects.findIndex((item) => item.id === objectId)
    if (idx < 0) return null
    const obj = stage.value.objects[idx]
    if (obj.locked) return null
    const bones = cloneBonePoseMap(obj.bonePose) ?? {}
    const existing = obj.posePresets ?? []
    const trimmed = name?.trim()
    const presetName =
      trimmed ||
      `${t('director.stage.posePresetDefault')} ${existing.length + 1}`
    const id = `pose:${crypto.randomUUID()}`
    const next: DirectorPosePreset = { id, name: presetName, bones }
    stage.value.objects = stage.value.objects.map((item, i) =>
      i === idx ? { ...item, posePresets: [...existing, next] } : item
    )
    previewRevision.value += 1
    schedulePersist()
    return id
  }

  function removeObjectPosePreset(objectId: string, presetId: string): boolean {
    const idx = stage.value.objects.findIndex((item) => item.id === objectId)
    if (idx < 0) return false
    const obj = stage.value.objects[idx]
    if (obj.locked) return false
    const existing = obj.posePresets ?? []
    if (!existing.some((item) => item.id === presetId)) return false
    const posePresets = existing.filter((item) => item.id !== presetId)
    stage.value.objects = stage.value.objects.map((item, i) =>
      i === idx
        ? { ...item, posePresets: posePresets.length ? posePresets : undefined }
        : item
    )
    previewRevision.value += 1
    schedulePersist()
    return true
  }

  function resetObjectBonePose(objectId: string): void {
    patchObjectBonePose(objectId, undefined)
  }

  function listPoseAssets(): AssetInfo[] {
    return project.assets.filter((item) => isPoseModelAsset(item))
  }

  async function saveObjectPoseAsAsset(
    objectId: string,
    name?: string,
    folderId: string | null = null
  ): Promise<AssetInfo | null> {
    const obj = stage.value.objects.find((item) => item.id === objectId)
    if (!obj || obj.locked) return null
    const bones = encodeBonePoseNormalized(obj.bonePose)
    if (!Object.keys(bones).length) return null
    const trimmed = name?.trim()
    const assetName =
      trimmed || `${t('director.stage.poseAssetDefault')} ${listPoseAssets().length + 1}`
    const asset = await window.studio.createAsset({
      type: 'model',
      name: assetName,
      folderId,
      genParams: buildPoseAssetGenParams(bones, obj.modelAssetId ?? null)
    })
    // ??????????refreshAssets ????????????????
    project.patchAssets([asset])
    return asset
  }

  function applyPoseAssetToObject(
    objectId: string,
    assetId: string
  ): { matched: number; total: number } | null {
    const obj = stage.value.objects.find((item) => item.id === objectId)
    if (!obj || obj.locked) return null
    const asset = project.assets.find((item) => item.id === assetId)
    if (!asset || !isPoseModelAsset(asset)) return null
    const data = readPoseAssetData(asset.genParams)
    if (!data) return null
    const targetBones = listObjectBones(objectId)
    const mapped = mapNormalizedPoseToTargetBones(data.bones, targetBones)
    patchObjectBonePose(
      objectId,
      Object.keys(mapped.bonePose).length ? mapped.bonePose : undefined
    )
    return { matched: mapped.matched, total: mapped.total }
  }

  function listObjectSkeletonClips(objectId: string): SkeletonClipOption[] {
    void skeletonClipsRevision.value
    const runtime = skeletonRuntimes.get(objectId)
    if (!runtime) return []
    return runtime.embeddedClips.map((clip, index) => skeletonClipOption(clip.name, index))
  }

  function listTrackSkeletonClips(trackId: string): SkeletonClipOption[] {
    void skeletonClipsRevision.value
    const track = stage.value.animation?.tracks.find((item) => item.id === trackId)
    if (!track || track.targetKind !== 'object') return []
    const segments = directorTrackSkeletonClips(track)
    const selected = segments.find((item) => item.id === animSelectedSkeletonClipId.value)
    const assetId = selected?.assetId?.trim()
    if (assetId) {
      const clips = animationAssetCache.get(assetId)?.clips ?? []
      return clips.map((clip, index) => skeletonClipOption(clip.name, index))
    }
    return listObjectSkeletonClips(track.targetId)
  }

  function patchTrackSkeletonClips(
    trackId: string,
    nextClips: DirectorSkeletonClipSegment[]
  ): void {
    const anim = ensureAnimation()
    const idx = anim.tracks.findIndex((t) => t.id === trackId)
    if (idx < 0) return
    const track = anim.tracks[idx]
    if (track.targetKind !== 'object') return
    const sorted = [...nextClips].sort((a, b) => a.start - b.start)
    anim.tracks[idx] = {
      ...track,
      skeletonClips: sorted
    }
    if (
      animSelectedSkeletonClipId.value &&
      !sorted.some((item) => item.id === animSelectedSkeletonClipId.value)
    ) {
      animSelectedSkeletonClipId.value = sorted[0]?.id ?? null
    }
    applyAnimationAtTime(animTime.value, false)
    schedulePersist()
    requestRender()
  }

  function selectSkeletonClipSegment(trackId: string, segmentId: string | null): void {
    selectAnimTrack(trackId)
    animSelectedSkeletonClipId.value = segmentId
  }

  function setSkeletonClipSegmentRange(
    trackId: string,
    segmentId: string,
    start: number,
    end: number
  ): void {
    const anim = ensureAnimation()
    const track = anim.tracks.find((t) => t.id === trackId)
    if (!track || track.targetKind !== 'object') return
    const clips = directorTrackSkeletonClips(track)
    const clamped = clampSkeletonSegmentRange(clips, segmentId, start, end, anim.duration)
    patchTrackSkeletonClips(
      trackId,
      clips.map((item) =>
        item.id === segmentId ? { ...item, start: clamped.start, end: clamped.end } : item
      )
    )
  }

  function updateSkeletonClipSegment(
    trackId: string,
    segmentId: string,
    opts: Partial<Pick<DirectorSkeletonClipSegment, 'clip' | 'speed' | 'loop' | 'assetId'>>
  ): void {
    const track = ensureAnimation().tracks.find((t) => t.id === trackId)
    if (!track || track.targetKind !== 'object') return
    const clips = directorTrackSkeletonClips(track)
    patchTrackSkeletonClips(
      trackId,
      clips.map((item) => {
        if (item.id !== segmentId) return item
        const nextClip =
          opts.clip === undefined
            ? item.clip
            : opts.clip && opts.clip.trim()
              ? opts.clip.trim()
              : item.clip
        const nextSpeed =
          opts.speed === undefined
            ? item.speed
            : Number.isFinite(opts.speed) && (opts.speed as number) > 0
              ? opts.speed
              : 1
        const nextLoop = opts.loop === undefined ? item.loop : opts.loop
        const nextAssetId =
          opts.assetId === undefined
            ? item.assetId
            : opts.assetId && opts.assetId.trim()
              ? opts.assetId.trim()
              : null
        return {
          ...item,
          clip: nextClip,
          speed: nextSpeed,
          loop: nextLoop,
          assetId: nextAssetId
        }
      })
    )
  }

  function removeSkeletonClipSegment(trackId: string, segmentId: string): void {
    const track = ensureAnimation().tracks.find((t) => t.id === trackId)
    if (!track || track.targetKind !== 'object') return
    patchTrackSkeletonClips(
      trackId,
      directorTrackSkeletonClips(track).filter((item) => item.id !== segmentId)
    )
  }

  /**
   * ?????? clip(s) ?????????????   * ????????`allClips` ??true ??????????   */
  async function applyAnimationAssetToAnimTrack(
    trackId: string,
    assetId: string,
    atTime?: number,
    allClips = false
  ): Promise<boolean> {
    const asset = project.assets.find((item) => item.id === assetId)
    if (!asset || !isAnimationModelAsset(asset)) return false
    const anim = ensureAnimation()
    const track = anim.tracks.find((t) => t.id === trackId)
    if (!track || track.targetKind !== 'object') return false
    if (!skeletonRuntimes.get(track.targetId)) return false

    const sourceClips = await loadAnimationClipsFromAsset(assetId)
    if (!sourceClips.length) return false

    // ????????clip ??????
    for (const source of sourceClips) {
      ensureRetargetedClip(track.targetId, assetId, source)
    }

    const existing = directorTrackSkeletonClips(track)
    const toAdd = allClips ? sourceClips : [sourceClips[0]!]
    let cursor =
      typeof atTime === 'number' && Number.isFinite(atTime)
        ? Math.max(0, atTime)
        : existing.length
          ? Math.max(...existing.map((item) => item.end))
          : animTime.value

    const next = [...existing]
    let firstAddedId: string | null = null
    for (let index = 0; index < toAdd.length; index++) {
      const source = toAdd[index]!
      const duration = Math.max(0.5, source.duration || 1)
      const placed = placeSkeletonSegmentRange(next, cursor, duration, anim.duration)
      if (!placed) break
      const clipName = source.name?.trim() || skeletonClipLabel(source.name, index)
      const segment: DirectorSkeletonClipSegment = {
        id: `skel:${crypto.randomUUID()}`,
        clip: clipName,
        assetId,
        start: placed.start,
        end: placed.end,
        speed: 1,
        loop: true
      }
      next.push(segment)
      if (!firstAddedId) firstAddedId = segment.id
      cursor = placed.end
    }

    if (!firstAddedId) return false
    patchTrackSkeletonClips(trackId, next)
    animSelectedTrackId.value = trackId
    animSelectedSkeletonClipId.value = firstAddedId
    return true
  }

  function clearAnimTrackSkeletonAsset(trackId: string): void {
    const track = ensureAnimation().tracks.find((t) => t.id === trackId)
    if (!track || track.targetKind !== 'object') return
    patchTrackSkeletonClips(trackId, [])
    animSelectedSkeletonClipId.value = null
  }

  function setStageEditMode(mode: DirectorStageEditMode): void {
    if (stageEditMode.value === mode) return
    stageEditMode.value = mode
    // 进入动画模式时确保动画数据与内置机位轨存在，避免面板打开时空列表
    if (mode === 'animation') {
      ensureAnimation()
    }
    if (mode === 'scene') {
      if (animPlaying.value) pauseAnimation()
      cancelPathDraw()
      clearPathEditOverlays()
      restoreBasePoseFromStage()
    } else {
      applyAnimationAtTime(animTime.value, false)
    }
    syncAllPathVisuals()
    requestRender()
  }

  function cancelPathDraw(): void {
    pathDrawMode.value = null
    pathDrawDraft.value = []
    pathDrawPencilActive = false
    clearPathDraftVisual()
    clearPathDrawMarkers()
    disposePathDrawGuide()
    if (orbit && viewMode.value === 'director') orbit.enabled = true
    applySelectionToScene()
    syncPathEditOverlays()
    requestRender()
  }

  function beginPathDraw(trackId: string, kind: DirectorAnimPathKind): void {
    const anim = ensureAnimation()
    const track = anim.tracks.find((t) => t.id === trackId)
    if (!track) return
    cancelPathDraw()
    animSelectedTrackId.value = trackId
    const origin = targetWorldPosition(track.targetKind, track.targetId)
    pathDrawPlaneY = origin.y
    pathDrawMode.value = { trackId, kind }
    pathDrawDraft.value = []
    setupPathDrawGuide(origin)
    refreshPathDrawVisual(origin)
    if (orbit) orbit.enabled = false
    requestRender(500)
  }

  function commitPathDraw(points: StageVec3[]): void {
    const mode = pathDrawMode.value
    if (!mode) return
    const path = finalizeDrawnPath(mode.kind, points)
    cancelPathDraw()
    if (!path) return
    setTrackPath(mode.trackId, path)
  }

  function handlePathDrawPointerDown(e: PointerEvent): boolean {
    const mode = pathDrawMode.value
    if (!mode || e.button !== 0) return false
    const hit = resolvePathDrawHit(e.clientX, e.clientY)
    if (!hit) return true
    if (mode.kind === 'pencil') {
      pathDrawPencilActive = true
      pathDrawDraft.value = [hit]
      setPathDrawGuidePosition(hit)
      clearPathDraftVisual()
      syncPathDrawPointMarkers([hit])
      requestRender(500)
      try {
        renderer?.domElement.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      return true
    }
    const next = [...pathDrawDraft.value, hit]
    pathDrawDraft.value = next
    setPathDrawGuidePosition(hit)
    refreshPathDrawVisual(hit)
    requestRender()
    const needed = requiredDrawClicks(mode.kind)
    if (needed !== null && next.length >= needed) {
      commitPathDraw(next)
      return true
    }
    if (mode.kind === 'pen' && e.detail >= 2 && next.length >= 2) {
      commitPathDraw(next)
    }
    return true
  }

  function appendPencilSample(hit: StageVec3): void {
    const draft = pathDrawDraft.value
    const last = draft[draft.length - 1]
    // ???????????????????
    if (last) {
      const dist = Math.hypot(hit.x - last.x, hit.z - last.z)
      if (dist < 0.02) return
      if (dist > 0.35) {
        const mid = {
          x: (last.x + hit.x) * 0.5,
          y: (last.y + hit.y) * 0.5,
          z: (last.z + hit.z) * 0.5
        }
        pathDrawDraft.value = [...draft, mid, hit]
      } else {
        pathDrawDraft.value = [...draft, hit]
      }
    } else {
      pathDrawDraft.value = [hit]
    }
    setPathDrawGuidePosition(hit)
    updatePathDraftVisual(pathDrawDraft.value)
    requestRender(200)
  }

  function handlePathDrawPointerMove(e: PointerEvent): void {
    const mode = pathDrawMode.value
    if (!mode) return
    const hit = raycastPathPlane(e.clientX, e.clientY)
    if (!hit) return
    if (mode.kind === 'pencil') {
      const pressing = pathDrawPencilActive || (e.buttons & 1) !== 0
      if (!pressing) {
        setPathDrawGuidePosition(hit)
        requestRender()
        return
      }
      if (!pathDrawPencilActive) {
        pathDrawPencilActive = true
        if (pathDrawDraft.value.length === 0) pathDrawDraft.value = [hit]
      }
      appendPencilSample(hit)
      return
    }
    setPathDrawGuidePosition(hit)
    refreshPathDrawVisual(hit)
    requestRender()
  }

  function handlePathDrawPointerUp(e: PointerEvent): void {
    const mode = pathDrawMode.value
    if (!mode || mode.kind !== 'pencil' || !pathDrawPencilActive) return
    pathDrawPencilActive = false
    try {
      renderer?.domElement.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    const draft = pathDrawDraft.value
    if (draft.length >= 2) {
      commitPathDraw(draft)
      return
    }
    // ?????????
    pathDrawDraft.value = []
    clearPathDraftVisual()
    clearPathDrawMarkers()
    requestRender()
  }

  function getSelectedAnimKeyframe(): {
    track: DirectorAnimTrack
    keyframe: DirectorAnimKeyframe
  } | null {
    const trackId = animSelectedTrackId.value
    const keyframeId = animSelectedKeyframeId.value
    if (!trackId || !keyframeId) return null
    const track = ensureAnimation().tracks.find((t) => t.id === trackId)
    const keyframe = track?.keyframes.find((kf) => kf.id === keyframeId)
    if (!track || !keyframe) return null
    return { track, keyframe }
  }

  function isEditingAnimKeyframeFor(
    targetKind: 'camera' | 'object',
    targetId: string
  ): boolean {
    if (stageEditMode.value !== 'animation') return false
    const selected = getSelectedAnimKeyframe()
    if (!selected) return false
    return selected.track.targetKind === targetKind && selected.track.targetId === targetId
  }

  function targetAnimFallbackTransform(
    track: DirectorAnimTrack
  ): { rotation: StageVec3; scale: StageVec3 } {
    if (track.targetKind === 'object') {
      const obj = stage.value.objects.find((o) => o.id === track.targetId)
      return {
        rotation: obj ? { ...obj.rotation } : { x: 0, y: 0, z: 0 },
        scale: obj ? { ...obj.scale } : { x: 1, y: 1, z: 1 }
      }
    }
    const cam = getCameraState(track.targetId)
    const rotation =
      cam?.viewer.rotation ??
      (cam
        ? directorViewerRotationFromLook(cam.viewer.position, cam.viewer.target)
        : { x: 0, y: 0, z: 0 })
    const scale = cam?.viewer.scale ?? { x: 1, y: 1, z: 1 }
    return { rotation: { ...rotation }, scale: { ...scale } }
  }

  function setAnimKeyframeTransform(
    trackId: string,
    keyframeId: string,
    patch: Partial<Pick<DirectorAnimKeyframe, 'position' | 'rotation' | 'scale'>>
  ): void {
    const anim = ensureAnimation()
    const idx = anim.tracks.findIndex((t) => t.id === trackId)
    if (idx < 0) return
    const track = anim.tracks[idx]
    anim.tracks[idx] = {
      ...track,
      keyframes: track.keyframes.map((kf) =>
        kf.id === keyframeId
          ? {
              ...kf,
              ...(patch.position ? { position: { ...patch.position } } : {}),
              ...(patch.rotation ? { rotation: { ...patch.rotation } } : {}),
              ...(patch.scale ? { scale: { ...patch.scale } } : {})
            }
          : kf
      )
    }
    schedulePersist()
    if (
      animSelectedKeyframeId.value === keyframeId &&
      animSelectedTrackId.value === trackId
    ) {
      previewRevision.value += 1
    }
    requestRender()
  }

  function writeTransformToSelectedKeyframe(
    targetKind: 'camera' | 'object',
    targetId: string,
    transform: {
      position?: StageVec3
      rotation?: StageVec3
      scale?: StageVec3
    }
  ): void {
    const selected = getSelectedAnimKeyframe()
    if (!selected) return
    if (selected.track.targetKind !== targetKind || selected.track.targetId !== targetId) return
    setAnimKeyframeTransform(selected.track.id, selected.keyframe.id, transform)
  }

  function applyAnimSampleToTarget(
    track: DirectorAnimTrack,
    sample: AnimKeyframeSample,
    persistState: boolean
  ): void {
    if (track.targetKind === 'object') {
      const idx = stage.value.objects.findIndex((o) => o.id === track.targetId)
      if (idx < 0) return
      const next = {
        ...stage.value.objects[idx],
        position: { ...sample.position },
        rotation: { ...sample.rotation },
        scale: { ...sample.scale }
      }
      if (persistState) stage.value.objects[idx] = next
      const mesh = objectMeshes.get(track.targetId)
      if (mesh) {
        applyTransform(mesh, next)
        if (selectionHelper && selectedObjectId.value === track.targetId) selectionHelper.update()
      }
      return
    }

    const cameraState = getCameraState(track.targetId)
    if (!cameraState) return
    const prev = cameraState.viewer
    const forward = directorViewerForwardFromRotation(sample.rotation)
    const lookDist = Math.max(
      0.5,
      Math.hypot(
        prev.target.x - prev.position.x,
        prev.target.y - prev.position.y,
        prev.target.z - prev.position.z
      )
    )
    const viewer: DirectorViewerState = {
      ...prev,
      position: { ...sample.position },
      rotation: { ...sample.rotation },
      scale: { ...sample.scale },
      target: {
        x: sample.position.x + forward.x * lookDist,
        y: sample.position.y + forward.y * lookDist,
        z: sample.position.z + forward.z * lookDist
      }
    }
    if (persistState) updateCamera(track.targetId, { viewer })
    else {
      const viz = shotVisuals.get(track.targetId)
      if (viz) {
        viz.root.position.set(viewer.position.x, viewer.position.y, viewer.position.z)
        viz.root.rotation.set(sample.rotation.x, sample.rotation.y, sample.rotation.z, 'XYZ')
        viz.root.scale.set(sample.scale.x, sample.scale.y, sample.scale.z)
        viz.camera.position.copy(viz.root.position)
        viz.camera.quaternion.copy(viz.root.quaternion)
        viz.helper.update()
      }
      if (stage.value.activeCameraId === track.targetId && viewMode.value === 'camera' && camera) {
        camera.position.set(viewer.position.x, viewer.position.y, viewer.position.z)
        camera.rotation.set(sample.rotation.x, sample.rotation.y, sample.rotation.z, 'XYZ')
        camera.scale.set(sample.scale.x, sample.scale.y, sample.scale.z)
        camera.lookAt(viewer.target.x, viewer.target.y, viewer.target.z)
      }
    }
  }

  function applyAnimationAtTime(time: number, persistState = false): void {
    const anim = stage.value.animation
    if (!anim) return
    for (const track of anim.tracks) {
      if (track.cameraCut) {
        applyCameraCutAtTime(track, time, persistState)
        continue
      }
      const keyframes = track.keyframes ?? []
      let sample: AnimKeyframeSample | null = null
      if (keyframes.length >= 1) {
        if (time < track.start - 1e-6 || time > track.end + 1e-6) continue
        sample = sampleAnimKeyframes(keyframes, time, targetAnimFallbackTransform(track))
      } else if (track.path && track.path.points.length >= 2) {
        const span = Math.max(0.001, track.end - track.start)
        let u = (time - track.start) / span
        if (u < 0 || u > 1) continue
        u = Math.min(1, Math.max(0, u))
        const pathSample = sampleAnimPath(track.path, u)
        if (!pathSample) continue
        const fallback = targetAnimFallbackTransform(track)
        sample = {
          position: pathSample.position,
          rotation: fallback.rotation,
          scale: fallback.scale,
          tangent: pathSample.tangent
        }
      }
      if (!sample) continue
      if (track.orientToPath) {
        const fallback = targetAnimFallbackTransform(track)
        const forwardAxis =
          track.pathForwardAxis ??
          (track.targetKind === 'camera' ? '-z' : DEFAULT_PATH_FORWARD_AXIS)
        sample = {
          ...sample,
          rotation: rotationFromPathTangent(
            sample.tangent,
            fallback.rotation,
            forwardAxis
          )
        }
      }
      applyAnimSampleToTarget(track, sample, persistState)
    }
    applySkeletonAnimationsAtTime(time)
  }

  /** ?????????????? bonePose ???????????? */
  function resetAllBonePosesForPlayback(): boolean {
    detachPoseBoneGizmo()
    selectedPoseBone.value = null
    selectedIkChainId.value = null
    poseEditMode.value = 'fk'
    poseSkeletonOverlay?.setSelectedBone(null)
    if (ikTarget) ikTarget.visible = false
    if (poseSkeletonOverlay?.getTargetObjectId()) {
      poseSkeletonOverlay.setTarget(null)
      poseSkeletonOverlay.setTargetObjectId(null)
    }
    clearBonePoseOffsetCache()
    let changed = false
    stage.value.objects = stage.value.objects.map((item) => {
      if (item.locked || !item.bonePose || !Object.keys(item.bonePose).length) return item
      changed = true
      return { ...item, bonePose: undefined }
    })
    for (const [objectId, mesh] of objectMeshes) {
      if (!bindPoseSnapshots.has(objectId)) resetSkeletonBindPose(mesh)
      else applyBonePoseForObject(objectId)
    }
    return changed
  }

  function playAnimation(): void {
    const anim = ensureAnimation()
    if (!anim.tracks.some((t) => directorAnimTrackHasContent(t))) return
    if (animTime.value >= anim.duration - 1e-4) animTime.value = 0
    cancelPathDraw()
    const poseCleared = resetAllBonePosesForPlayback()
    animPlaying.value = true
    applyAnimationAtTime(animTime.value, false)
    if (poseCleared) {
      previewRevision.value += 1
      schedulePersist()
    }
    requestRender(1000)
  }

  function pauseAnimation(): void {
    if (!animPlaying.value) return
    animPlaying.value = false
    applyAnimationAtTime(animTime.value, false)
    requestRender()
  }

  function stopAnimation(): void {
    animPlaying.value = false
    animTime.value = 0
    applyAnimationAtTime(0, false)
    requestRender()
  }

  function seekAnimation(time: number, opts?: { persist?: boolean }): void {
    const anim = ensureAnimation()
    animTime.value = Math.min(anim.duration, Math.max(0, time))
    const defaultPersist =
      stageEditMode.value === 'animation' ? false : !animPlaying.value
    const persist = opts?.persist ?? defaultPersist
    applyAnimationAtTime(animTime.value, persist)
    if (persist) schedulePersist()
    requestRender()
  }

  function setAnimDuration(duration: number): void {
    const anim = ensureAnimation()
    anim.duration = Math.max(0.1, duration)
    for (let i = 0; i < anim.tracks.length; i++) {
      const track = anim.tracks[i]
      if (track.end > anim.duration) {
        anim.tracks[i] = {
          ...track,
          end: anim.duration,
          start: Math.min(track.start, Math.max(0, anim.duration - 0.1))
        }
      }
    }
    if (animTime.value > anim.duration) animTime.value = anim.duration
    schedulePersist()
  }

  function setAnimLoop(loop: boolean): void {
    ensureAnimation().loop = loop
    schedulePersist()
  }

  function addAnimTrack(targetKind: 'camera' | 'object', targetId: string): void {
    const anim = ensureAnimation()
    if (anim.tracks.some((t) => t.targetKind === targetKind && t.targetId === targetId)) {
      const existing = anim.tracks.find((t) => t.targetKind === targetKind && t.targetId === targetId)
      if (existing) {
        animSelectedTrackId.value = existing.id
        syncSelectionFromAnimTrack(existing.id)
      }
      return
    }
    const name =
      targetKind === 'camera'
        ? getCameraState(targetId)?.name ?? 'Camera'
        : stage.value.objects.find((o) => o.id === targetId)?.name ?? 'Object'
    const track: DirectorAnimTrack = {
      id: `anim:${crypto.randomUUID()}`,
      name,
      targetKind,
      targetId,
      start: 0,
      end: anim.duration,
      path: null,
      keyframes: [],
      orientToPath: false,
      pathForwardAxis: targetKind === 'camera' ? '-z' : DEFAULT_PATH_FORWARD_AXIS
    }
    anim.tracks = [...anim.tracks, track]
    animSelectedTrackId.value = track.id
    syncSelectionFromAnimTrack(track.id)
    schedulePersist()
  }

  function removeAnimTrack(trackId: string): void {
    const anim = ensureAnimation()
    const target = anim.tracks.find((t) => t.id === trackId)
    if (target?.cameraCut) return
    anim.tracks = anim.tracks.filter((t) => t.id !== trackId)
    if (animSelectedTrackId.value === trackId) {
      animSelectedTrackId.value = anim.tracks[0]?.id ?? null
      animSelectedSkeletonClipId.value = null
      animSelectedCameraCutSegmentId.value = null
    }
    if (pathDrawMode.value?.trackId === trackId) cancelPathDraw()
    if (animSelectedKeyframeId.value) animSelectedKeyframeId.value = null
    syncPathVisual(trackId, null)
    syncPathEditOverlays()
    schedulePersist()
  }

  /** 机位切换轨：按当前时间激活对应相机（只切 activeCameraId，不改选中） */
  function applyCameraCutAtTime(track: DirectorAnimTrack, time: number, persistState = false): void {
    const segments = track.cameraSegments ?? []
    const seg = segments.find((s) => time >= s.start - 1e-6 && time < s.end)
    if (!seg) return
    if (stage.value.activeCameraId === seg.cameraId) return
    if (!getCameraState(seg.cameraId)) return
    stage.value.activeCameraId = seg.cameraId
    if (persistState) schedulePersist()
    if (viewMode.value === 'camera') applyCameraView()
    syncShotVisuals()
    previewRevision.value += 1
  }

  /** 添加机位切换轨（同一舞台只允许一条，重复调用回到已有轨） */
  function addCameraCutTrack(): string | null {
    const anim = ensureAnimation()
    const cameras = listCameras()
    if (!cameras.length) return null
    const existing = anim.tracks.find((t) => t.cameraCut)
    if (existing) {
      animSelectedTrackId.value = existing.id
      syncSelectionFromAnimTrack(existing.id)
      return existing.id
    }
    const active = stage.value.activeCameraId ?? cameras[0].id
    const track: DirectorAnimTrack = {
      id: `anim:${crypto.randomUUID()}`,
      name: t('director.stage.anim.cameraCutTrack'),
      targetKind: 'camera',
      targetId: active,
      start: 0,
      end: anim.duration,
      path: null,
      keyframes: [],
      cameraCut: true,
      cameraSegments: []
    }
    // 机位轨固定在时间线最上面
    anim.tracks = [track, ...anim.tracks]
    animSelectedTrackId.value = track.id
    syncSelectionFromAnimTrack(track.id)
    schedulePersist()
    return track.id
  }

  function addCameraCutSegment(
    trackId: string,
    cameraId: string,
    start: number,
    end: number
  ): void {
    const anim = ensureAnimation()
    const idx = anim.tracks.findIndex((t) => t.id === trackId && t.cameraCut)
    if (idx < 0) return
    if (!getCameraState(cameraId)) return
    const s = Math.max(0, Math.min(start, end - 0.05))
    const e = Math.min(anim.duration, Math.max(s + 0.05, end))
    const track = anim.tracks[idx]
    const existing = track.cameraSegments ?? []
    const next: DirectorCameraCutSegment[] = []
    for (const seg of existing) {
      if (seg.end <= s || seg.start >= e) {
        next.push(seg)
        continue
      }
      if (seg.start < s) next.push({ ...seg, end: s })
      if (seg.end > e) next.push({ ...seg, start: e })
    }
    next.push({ id: `cut:${crypto.randomUUID()}`, cameraId, start: s, end: e })
    next.sort((a, b) => a.start - b.start)
    anim.tracks[idx] = { ...track, cameraSegments: next }
    schedulePersist()
    requestRender()
  }

  function removeCameraCutSegment(trackId: string, segmentId: string): void {
    const anim = ensureAnimation()
    const idx = anim.tracks.findIndex((t) => t.id === trackId)
    if (idx < 0) return
    const track = anim.tracks[idx]
    const next = (track.cameraSegments ?? []).filter((seg) => seg.id !== segmentId)
    anim.tracks[idx] = { ...track, cameraSegments: next.length ? next : undefined }
    if (animSelectedCameraCutSegmentId.value === segmentId) {
      animSelectedCameraCutSegmentId.value = null
    }
    schedulePersist()
    requestRender()
  }

  function setCameraCutSegmentRange(
    trackId: string,
    segmentId: string,
    start: number,
    end: number
  ): void {
    const anim = ensureAnimation()
    const idx = anim.tracks.findIndex((t) => t.id === trackId)
    if (idx < 0) return
    const track = anim.tracks[idx]
    const segments = track.cameraSegments ?? []
    const segIdx = segments.findIndex((seg) => seg.id === segmentId)
    if (segIdx < 0) return
    const s = Math.max(0, Math.min(start, anim.duration - 0.05))
    const e = Math.min(anim.duration, Math.max(s + 0.05, end))
    const next = segments.slice()
    next[segIdx] = { ...next[segIdx]!, start: s, end: e }
    next.sort((a, b) => a.start - b.start)
    anim.tracks[idx] = { ...track, cameraSegments: next }
    schedulePersist()
    requestRender()
  }

  function syncSelectionFromAnimTrack(trackId: string | null): void {
    if (!trackId) return
    const track = ensureAnimation().tracks.find((t) => t.id === trackId)
    if (!track) return
    if (track.targetKind === 'camera') {
      selectCamera(track.targetId)
      return
    }
    if (stage.value.objects.some((o) => o.id === track.targetId)) {
      selectObject(track.targetId)
    }
  }

  function selectAnimTrack(trackId: string | null): void {
    animSelectedTrackId.value = trackId
    animSelectedCameraCutSegmentId.value = null
    if (!trackId) {
      animSelectedKeyframeId.value = null
      clearPathEditOverlays()
      syncAllPathVisuals()
      return
    }
    syncSelectionFromAnimTrack(trackId)
    syncAllPathVisuals()
  }

  function selectCameraCutSegment(trackId: string, segmentId: string | null): void {
    animSelectedTrackId.value = trackId
    animSelectedCameraCutSegmentId.value = segmentId
  }

  function selectAnimKeyframe(trackId: string, keyframeId: string | null): void {
    animSelectedTrackId.value = trackId
    animSelectedKeyframeId.value = keyframeId
    syncSelectionFromAnimTrack(trackId)
    syncAllPathVisuals()
    if (!keyframeId) return
    const track = ensureAnimation().tracks.find((t) => t.id === trackId)
    const keyframe = track?.keyframes.find((kf) => kf.id === keyframeId)
    if (keyframe) seekAnimation(keyframe.time, { persist: false })
  }

  function snapAnimTime(time: number): number {
    return Math.round(time * 10) / 10
  }

  function addAnimKeyframe(trackId?: string, time?: number): void {
    const anim = ensureAnimation()
    const id = trackId ?? animSelectedTrackId.value
    if (!id) return
    const idx = anim.tracks.findIndex((t) => t.id === id)
    if (idx < 0) return
    let track = anim.tracks[idx]
    // 机位切换轨不参与位置关键帧
    if (track.cameraCut) return
    const rawTime = time ?? animTime.value
    const t = snapAnimTime(Math.min(anim.duration, Math.max(0, rawTime)))
    // ????????????????????????
    let start = track.start
    let end = track.end
    if (t < start) start = t
    if (t > end) end = Math.max(t, start + 0.1)
    if (start !== track.start || end !== track.end) {
      track = { ...track, start, end }
      anim.tracks[idx] = track
    }
    const existing = (track.keyframes ?? []).find((kf) => Math.abs(kf.time - t) < 0.05)
    let localPos: StageVec3
    let localRot: StageVec3
    let localScale: StageVec3
    if (track.targetKind === 'object') {
      const obj = stage.value.objects.find((o) => o.id === track.targetId)
      localPos = obj ? { ...obj.position } : { x: 0, y: 0, z: 0 }
      localRot = obj ? { ...obj.rotation } : { x: 0, y: 0, z: 0 }
      localScale = obj ? { ...obj.scale } : { x: 1, y: 1, z: 1 }
    } else {
      const cam = getCameraState(track.targetId)
      localPos = cam ? { ...cam.viewer.position } : { x: 0, y: 1.5, z: 0 }
      localRot = cam
        ? {
            ...(cam.viewer.rotation ??
              directorViewerRotationFromLook(cam.viewer.position, cam.viewer.target))
          }
        : { x: 0, y: 0, z: 0 }
      localScale = cam?.viewer.scale
        ? { ...cam.viewer.scale }
        : { x: 1, y: 1, z: 1 }
    }
    const list = track.keyframes ?? []
    if (existing) {
      anim.tracks[idx] = {
        ...track,
        keyframes: list.map((kf) =>
          kf.id === existing.id
            ? {
                ...kf,
                position: localPos,
                rotation: localRot,
                scale: localScale
              }
            : kf
        )
      }
      animSelectedKeyframeId.value = existing.id
    } else {
      const kf: DirectorAnimKeyframe = {
        id: `kf:${crypto.randomUUID()}`,
        time: t,
        position: localPos,
        rotation: localRot,
        scale: localScale
      }
      anim.tracks[idx] = {
        ...track,
        keyframes: [...list, kf].sort((a, b) => a.time - b.time)
      }
      animSelectedKeyframeId.value = kf.id
    }
    animSelectedTrackId.value = id
    seekAnimation(t, { persist: false })
    schedulePersist()
    requestRender()
  }

  function removeAnimKeyframe(trackId?: string, keyframeId?: string): void {
    const anim = ensureAnimation()
    const tid = trackId ?? animSelectedTrackId.value
    const kid = keyframeId ?? animSelectedKeyframeId.value
    if (!tid || !kid) return
    const idx = anim.tracks.findIndex((t) => t.id === tid)
    if (idx < 0) return
    const track = anim.tracks[idx]
    const next = track.keyframes.filter((kf) => kf.id !== kid)
    if (next.length === track.keyframes.length) return
    anim.tracks[idx] = { ...track, keyframes: next }
    if (animSelectedKeyframeId.value === kid) animSelectedKeyframeId.value = null
    schedulePersist()
    requestRender()
  }

  function moveAnimKeyframe(trackId: string, keyframeId: string, time: number): void {
    const anim = ensureAnimation()
    const idx = anim.tracks.findIndex((t) => t.id === trackId)
    if (idx < 0) return
    const track = anim.tracks[idx]
    const t = snapAnimTime(Math.min(track.end, Math.max(track.start, time)))
    anim.tracks[idx] = {
      ...track,
      keyframes: track.keyframes
        .map((kf) => (kf.id === keyframeId ? { ...kf, time: t } : kf))
        .sort((a, b) => a.time - b.time)
    }
    if (animSelectedKeyframeId.value === keyframeId) {
      seekAnimation(t, { persist: false })
    }
    schedulePersist()
    requestRender()
  }

  function setAnimTrackRange(trackId: string, start: number, end: number): void {
    const anim = ensureAnimation()
    const idx = anim.tracks.findIndex((t) => t.id === trackId)
    if (idx < 0) return
    const s = Math.max(0, Math.min(start, anim.duration - 0.1))
    const e = Math.max(s + 0.1, Math.min(end, anim.duration))
    const track = anim.tracks[idx]
    anim.tracks[idx] = {
      ...track,
      start: s,
      end: e,
      keyframes: track.keyframes.map((kf) => ({
        ...kf,
        time: Math.min(e, Math.max(s, kf.time))
      }))
    }
    schedulePersist()
  }

  function setAnimTrackOrientToPath(trackId: string, orientToPath: boolean): void {
    const anim = ensureAnimation()
    const idx = anim.tracks.findIndex((t) => t.id === trackId)
    if (idx < 0) return
    const track = anim.tracks[idx]
    if (track.orientToPath === orientToPath) return
    anim.tracks[idx] = { ...track, orientToPath }
    applyAnimationAtTime(animTime.value, false)
    schedulePersist()
    requestRender()
  }

  function setAnimTrackPathForwardAxis(
    trackId: string,
    pathForwardAxis: DirectorPathForwardAxis
  ): void {
    const anim = ensureAnimation()
    const idx = anim.tracks.findIndex((t) => t.id === trackId)
    if (idx < 0) return
    const track = anim.tracks[idx]
    if (track.pathForwardAxis === pathForwardAxis) return
    anim.tracks[idx] = { ...track, pathForwardAxis }
    applyAnimationAtTime(animTime.value, false)
    schedulePersist()
    requestRender()
  }

  function tickAnimation(deltaSeconds: number): void {
    if (!animPlaying.value) return
    const anim = ensureAnimation()
    const rate = Number.isFinite(animPlaybackRate.value) ? Math.max(0.05, animPlaybackRate.value) : 1
    let next = animTime.value + deltaSeconds * rate
    if (next >= anim.duration) {
      if (anim.loop) {
        next = next % anim.duration
      } else {
        next = anim.duration
        animPlaying.value = false
        applyAnimationAtTime(next, false)
        animTime.value = next
        return
      }
    }
    animTime.value = next
    applyAnimationAtTime(next, false)
    requestRender(80)
  }

  function setAnimPlaybackRate(rate: number): void {
    if (!Number.isFinite(rate)) return
    animPlaybackRate.value = Math.min(8, Math.max(0.1, rate))
  }

  function pickExportMimeType(): string {
    if (typeof MediaRecorder === 'undefined') return ''
    const candidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ]
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
  }

  async function exportAnimationVideo(): Promise<string | null> {
    if (animExporting.value) return null
    if (!renderer || !scene) throw new Error('Stage is not ready')
    const anim = ensureAnimation()
    const hasContent = anim.tracks.some((track) => directorAnimTrackHasContent(track))
    if (!hasContent) throw new Error('No animation content to export')
    const mimeType = pickExportMimeType()
    if (!mimeType) throw new Error('WebM export is not supported')

    const fps = 30
    const el = options.viewportEl.value
    const ratio = directorAspectRatioValue(
      aspectRatio.value,
      el?.clientWidth ?? 16,
      el?.clientHeight ?? 9
    )
    const width = 1280
    const height = Math.max(1, Math.round(width / Math.max(0.01, ratio)))
    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = width
    exportCanvas.height = height

    const stream = exportCanvas.captureStream(0)
    const videoTrack = stream.getVideoTracks()[0] as MediaStreamTrack & {
      requestFrame?: () => void
    }
    const canRequestFrame = typeof videoTrack.requestFrame === 'function'
    if (!canRequestFrame) {
      // ??requestFrame ????????
      stream.getTracks().forEach((track) => track.stop())
    }
    const recordStream = canRequestFrame ? stream : exportCanvas.captureStream(fps)
    const recordTrack = recordStream.getVideoTracks()[0] as MediaStreamTrack & {
      requestFrame?: () => void
    }
    const chunks: BlobPart[] = []
    const recorder = new MediaRecorder(recordStream, {
      mimeType,
      videoBitsPerSecond: 8_000_000
    })
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }

    const prevPlaying = animPlaying.value
    const prevTime = animTime.value
    pauseAnimation()
    animExporting.value = true

    const frameCount = Math.max(1, Math.round(anim.duration * fps))
    const frameDelayMs = Math.max(1, Math.round(1000 / fps))
    const stopPromise = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve()
      recorder.onerror = () => reject(new Error('??????'))
    })

    try {
      recorder.start(100)
      for (let i = 0; i <= frameCount; i++) {
        const t = Math.min(anim.duration, i / fps)
        animTime.value = t
        applyAnimationAtTime(t, false)
        const shotCam = buildShotCamera(width / Math.max(1, height))
        if (
          !renderCameraToCanvas2D(
            shotCam,
            width,
            height,
            exportCanvas,
            captureLabelsVisible.value || captureCameraLabelsVisible.value
          )
        ) {
          throw new Error('Failed to render export frame')
        }
        recordTrack.requestFrame?.()
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve())
        })
        if (!canRequestFrame) {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, frameDelayMs)
          })
        }
      }
      if (recorder.state !== 'inactive') recorder.stop()
      await stopPromise
    } catch (error) {
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop()
        } catch {
          /* ignore */
        }
      }
      throw error
    } finally {
      recordStream.getTracks().forEach((track) => track.stop())
      animTime.value = prevTime
      applyAnimationAtTime(prevTime, false)
      animExporting.value = false
      if (prevPlaying) playAnimation()
      else requestRender()
    }

    const blob = new Blob(chunks, { type: mimeType.includes('webm') ? 'video/webm' : 'video/webm' })
    if (!blob.size) throw new Error('Empty recording')
    const dataUrl = await blobToDataUrl(blob)
    const node = directorProcessingNode()
    if (!node) throw new Error('Director processing node not found')
    const hostAsset = asset.value
    const key = buildGeneratedMediaFileKey({
      hostAssetName: hostAsset?.name,
      nodeTitle: node.title || 'director-action',
      stamp: new Date().toISOString().replace(/[:.]/g, '-')
    })
    const { saveGraphRunMediaForNode } = await import('../graph/saveGraphRunMediaForNode')
    const relativePath = await saveGraphRunMediaForNode({
      dataUrl,
      key,
      node,
      hostAssetId: options.directorAssetId,
      kind: 'video'
    })
    const video: DirectorCameraVideo = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      relativePath
    }
    const list = [...(stage.value.cameraVideos ?? []), video].slice(-24)
    stage.value.cameraVideos = list
    syncCameraNodeFromStage()
    schedulePersist()
    openMediaGallery('actions')
    return relativePath
  }

  function requestRender(holdMs = 250): void {
    forceRenderUntil = Math.max(forceRenderUntil, performance.now() + holdMs)
    lastRenderAt = 0
  }

  function ensurePoseSkeletonOverlay(): PoseSkeletonOverlay | null {
    if (!scene) return null
    if (!poseSkeletonOverlay) poseSkeletonOverlay = createPoseSkeletonOverlay(scene)
    return poseSkeletonOverlay
  }

  function clearPoseSkeletonOverlay(): void {
    detachPoseBoneGizmo()
    poseSkeletonOverlay?.clear()
    poseSkeletonOverlay = null
    selectedPoseBone.value = null
    selectedIkChainId.value = null
    poseEditMode.value = 'fk'
    if (ikTarget) ikTarget.visible = false
  }

  /** ?????????????????????? null ?? */
  function setPoseSkeletonVisible(objectId: string | null): void {
    const overlay = ensurePoseSkeletonOverlay()
    if (!overlay) return
    // ??????????????Inspector watch ??overlay ????
    if (objectId && animPlaying.value) objectId = null
    if (!objectId) {
      detachPoseBoneGizmo()
      overlay.setTarget(null)
      overlay.setTargetObjectId(null)
      overlay.setSelectedBone(null)
      selectedPoseBone.value = null
      selectedIkChainId.value = null
      if (ikTarget) ikTarget.visible = false
      applySelectionToScene()
      requestRender()
      return
    }
    const mesh = objectMeshes.get(objectId)
    if (!mesh || !objectHasSkeleton(mesh)) {
      detachPoseBoneGizmo()
      overlay.setTarget(null)
      overlay.setTargetObjectId(null)
      overlay.setSelectedBone(null)
      selectedPoseBone.value = null
      selectedIkChainId.value = null
      if (ikTarget) ikTarget.visible = false
      applySelectionToScene()
      requestRender()
      return
    }
    const alreadyTarget = overlay.getTargetObjectId() === objectId
    if (alreadyTarget) {
      // previewRevision ?????????????? / Gizmo???????
      overlay.setSelectedBone(selectedPoseBone.value)
      overlay.update()
      syncPoseBoneGizmo()
      requestRender()
      return
    }
    overlay.setTarget(mesh)
    overlay.setTargetObjectId(objectId)
    overlay.setSelectedBone(selectedPoseBone.value)
    ikChainsByObject.delete(objectId)
    ensureIkChains(objectId)
    // ?????????? bind + ?? bonePose
    refreshObjectSkeletonPose(objectId)
    // ???????? gizmo????????/ IK ?? gizmo
    if (transform) {
      suppressTransformEvent = true
      transform.detach()
      suppressTransformEvent = false
    }
    syncPoseBoneGizmo()
    requestRender()
  }

  function objectSupportsPose(objectId: string | null | undefined): boolean {
    if (!objectId) return false
    const obj = stage.value.objects.find((item) => item.id === objectId)
    if (!obj || (obj.kind !== 'model' && obj.kind !== 'character')) return false
    const mesh = objectMeshes.get(objectId)
    return !!mesh && objectHasSkeleton(mesh)
  }

  function fingerprintStage(raw: unknown): string {
    try {
      return JSON.stringify(raw ?? null)
    } catch {
      return String(raw)
    }
  }

  function hasStoredCameraViewer(raw: unknown): boolean {
    if (!raw || typeof raw !== 'object') return false
    const cameras = (raw as Record<string, unknown>).cameras
    if (!Array.isArray(cameras)) return false
    return cameras.some(
      (cam) => !!cam && typeof cam === 'object' && !!(cam as Record<string, unknown>).viewer
    )
  }

  function directorStagePatch() {
    const a = asset.value
    if (!a) return null
    const nodeId = boundProcessingNodeId()
    if (!nodeId) return null
    const stagePayload: DirectorStageState = {
      linkedPanoramaAssetId: linkedPanoramaId.value,
      transformMode: transformMode.value,
      selectedObjectId: selectionKind.value === 'object' ? selectedObjectId.value : null,
      cameras: listCameras(),
      cameraGroups: stage.value.cameraGroups ?? [],
      activeCameraId: stage.value.activeCameraId,
      gridVisible: stage.value.gridVisible !== false,
      gridOpacity: clampGridOpacity(stage.value.gridOpacity ?? DEFAULT_GRID_OPACITY),
      gridOffsetY: stage.value.gridOffsetY ?? DEFAULT_GRID_OFFSET_Y,
      gridDensity: DEFAULT_GRID_DENSITY,
      cameraShots: stage.value.cameraShots ?? [],
      cameraVideos: stage.value.cameraVideos ?? [],
      aspectRatio: normalizeDirectorAspectRatio(stage.value.aspectRatio),
      world: readDirectorSceneWorld(stage.value.world),
      // 存跟随哨兵/自定义色，不要写主题解析后的颜色（否则浅色主题会锁死 #e8eaee）
      skyColor: isDirectorSkyFollowTheme(stage.value.skyColor)
        ? DEFAULT_DIRECTOR_SKY_COLOR
        : normalizeDirectorSkyColor(stage.value.skyColor),
      panoramaVisible: stage.value.panoramaVisible !== false,
      panoramaYaw: typeof stage.value.panoramaYaw === 'number' ? stage.value.panoramaYaw : 0,
      panoramaRadius: currentPanoramaRadius(),
      animation: readDirectorAnimation(stage.value.animation),
      ownerProcessingNodeId: nodeId,
      objects: stage.value.objects
    }
    return {
      genParams: patchGenParamsWithNodeStage(a.genParams, nodeId, stagePayload)
    }
  }

  async function persistStageNow(): Promise<void> {
    const patch = directorStagePatch()
    if (!patch) return
    const nodeId = boundProcessingNodeId()
    const previousFingerprint = appliedStageFingerprint
    // 指纹必须与资产 watch 里的 nextFingerprint 同表示（readDirectorStage normalize 后）。
    // 若用落盘 raw 计算，只要 normalize 与 raw 有字段差异（如新建物体缺 nameVisible），
    // 下一次资产写回就会被误判为外部变更 → 重载舞台 → frameShotCameraInDirectorView
    // 把编辑器相机拉回机位后方，表现为“创建物体后视图突然缩放一下”。
    appliedStageFingerprint = fingerprintStage(
      resolveDirectorStageForNode(patch.genParams, patch.genParams?.graphJson, nodeId)
    )
    try {
      skipAssetWatch = true
      await persistAssetRecord(options.directorAssetId, patch, {
        recordCommand: true,
        label: 'Edit director stage'
      })
      await nextTick()
      syncCameraNodeFromStage()
      await graphEditorHosts.flush(graphHostId.value)
    } catch (e) {
      appliedStageFingerprint = previousFingerprint
      error.value = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      skipAssetWatch = false
    }
  }

  const directorDocument = useEditorDocumentSession({
    id: () =>
      `asset:${options.directorAssetId}:director-stage:${boundProcessingNodeId() ?? 'none'}`,
    parentId: () => `asset:${options.directorAssetId}`,
    save: persistStageNow,
    autoSaveEnabled: () => true,
    autoSaveDelayMs: () => 1000,
    saveOnUnmount: false
  })

  async function saveNow(): Promise<void> {
    if (savedBeforeUnmount) return
    savedBeforeUnmount = true
    try {
      await directorDocument.save()
    } catch (error) {
      savedBeforeUnmount = false
      throw error
    }
  }

  function readSelectionBoundsVisiblePref(): boolean {
    try {
      return localStorage.getItem(SELECTION_BOUNDS_STORAGE_KEY) === '1'
    } catch {
      return false
    }
  }

  function clearSelectionHelper(): void {
    if (selectionHelper && scene) {
      scene.remove(selectionHelper)
      selectionHelper.dispose()
      selectionHelper = null
    }
  }

  function updateSelectionHelper(mesh: THREE.Object3D | null): void {
    clearSelectionHelper()
    if (!mesh || !scene || !selectionBoundsVisible.value) return
    selectionHelper = new THREE.BoxHelper(mesh, 0x5b9cf5)
    selectionHelper.renderOrder = 10
    scene.add(selectionHelper)
  }

  function setSelectionBoundsVisible(visible: boolean): void {
    const next = !!visible
    if (selectionBoundsVisible.value === next) return
    selectionBoundsVisible.value = next
    try {
      localStorage.setItem(SELECTION_BOUNDS_STORAGE_KEY, next ? '1' : '0')
    } catch {
      /* ignore */
    }
    applySelectionToScene()
    requestRender()
  }

  function toggleSelectionBoundsVisible(): void {
    setSelectionBoundsVisible(!selectionBoundsVisible.value)
  }

  function setGizmoSize(size: number): void {
    gizmoSize.value = Math.min(2, Math.max(0.1, Number.isFinite(size) ? size : 1))
    syncTransformGizmoScale()
    syncShotVisuals()
    requestRender()
  }

  function setSceneLabelsVisible(visible: boolean): void {
    sceneLabelsVisible.value = !!visible
    for (const obj of stage.value.objects) {
      const mesh = objectMeshes.get(obj.id)
      if (mesh) syncObjectNameLabel(obj, mesh)
    }
    syncShotVisuals()
    requestRender()
  }

  function setCameraGizmosVisible(visible: boolean): void {
    cameraGizmosVisible.value = !!visible
    syncShotVisuals()
    requestRender()
  }

  function setGridGizmoVisible(visible: boolean): void {
    gridGizmoVisible.value = !!visible
    applyGridVisuals()
    requestRender()
  }

  function setCaptureLabelsVisible(visible: boolean): void {
    captureLabelsVisible.value = !!visible
  }

  function setCaptureCameraLabelsVisible(visible: boolean): void {
    captureCameraLabelsVisible.value = !!visible
  }

  function disposeLabel(label: CSS2DObject): void {
    label.element.remove()
  }

  function createNameLabel(text: string): CSS2DObject {
    const el = document.createElement('div')
    el.className = 'director-stage-label'
    el.textContent = text
    const label = new CSS2DObject(el)
    label.position.y = 2.1
    return label
  }

  function clearLabels(): void {
    for (const label of objectLabels.values()) {
      label.parent?.remove(label)
      disposeLabel(label)
    }
    objectLabels.clear()
  }

  function applyTransform(obj: THREE.Object3D, state: StageObjectState): void {
    obj.position.set(state.position.x, state.position.y, state.position.z)
    obj.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z)
    obj.scale.set(state.scale.x, state.scale.y, state.scale.z)
  }

  function syncSelectedFromTransform(): void {
    if (pathEditSelection) {
      syncPathEditFromTransform(true)
      return
    }
    if (selectionKind.value === 'camera') {
      const id = selectedCameraId.value
      const viz = id ? shotVisuals.get(id) : null
      const selected = id ? getCameraState(id) : null
      if (!id || !selected || isCameraLocked(id) || !viz) return
      const rotation = {
        x: viz.root.rotation.x,
        y: viz.root.rotation.y,
        z: viz.root.rotation.z
      }
      const scale = {
        x: Math.max(0.001, viz.root.scale.x),
        y: Math.max(0.001, viz.root.scale.y),
        z: Math.max(0.001, viz.root.scale.z)
      }
      if (isEditingAnimKeyframeFor('camera', id)) {
        writeTransformToSelectedKeyframe('camera', id, {
          position: {
            x: viz.root.position.x,
            y: viz.root.position.y,
            z: viz.root.position.z
          },
          rotation,
          scale
        })
        viz.helper.update()
        previewRevision.value += 1
        return
      }
      const prev = selected.viewer
      const forward = directorViewerForwardFromRotation(rotation)
      const lookDist = Math.max(
        0.5,
        Math.hypot(
          prev.target.x - prev.position.x,
          prev.target.y - prev.position.y,
          prev.target.z - prev.position.z
        )
      )
      updateCamera(id, { viewer: {
        ...prev,
        position: {
          x: viz.root.position.x,
          y: viz.root.position.y,
          z: viz.root.position.z
        },
        rotation,
        scale,
        target: {
          x: viz.root.position.x + forward.x * lookDist,
          y: viz.root.position.y + forward.y * lookDist,
          z: viz.root.position.z + forward.z * lookDist
        }
      } })
      viz.root.scale.set(1, 1, 1)
      viz.helper.update()
      previewRevision.value += 1
      return
    }
    const id = selectedObjectId.value
    if (!id || selectionKind.value !== 'object') return
    if (isObjectLocked(id)) return
    const mesh = objectMeshes.get(id)
    const idx = stage.value.objects.findIndex((o) => o.id === id)
    if (!mesh || idx < 0) return
    const position = { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }
    const rotation = { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z }
    const scale = { x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z }
    if (isEditingAnimKeyframeFor('object', id)) {
      writeTransformToSelectedKeyframe('object', id, { position, rotation, scale })
      if (selectionHelper) selectionHelper.update()
      previewRevision.value += 1
      return
    }
    const o = stage.value.objects[idx]
    stage.value.objects[idx] = {
      ...o,
      position,
      rotation,
      scale
    }
    if (selectionHelper) selectionHelper.update()
  }

  function applyObjectColor(mesh: THREE.Object3D, color?: string): void {
    const hex = parseColor(color)
    mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const materials = Array.isArray(child.material) ? child.material : [child.material]
        for (const material of materials) {
          const materialColor = (material as THREE.Material & { color?: THREE.Color }).color
          if (materialColor instanceof THREE.Color) materialColor.setHex(hex)
        }
      }
    })
  }

  /**
   * GLTF ???????????????????????????????
   * ?????????????????????????????
   */
  function instantiateObjectMaterials(root: THREE.Object3D): void {
    const instances = new Map<THREE.Material, THREE.Material>()
    const instantiate = (material: THREE.Material): THREE.Material => {
      const existing = instances.get(material)
      if (existing) return existing
      const instance = material.clone()
      instances.set(material, instance)
      return instance
    }
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      child.material = Array.isArray(child.material)
        ? child.material.map(instantiate)
        : instantiate(child.material)
    })
  }

  // ---- 材质贴图覆盖（Unity 式贴图槽：按材质名设置 / 隐藏 / 还原 map 与 normalMap） ----

  /** objectId → 材质键 → 槽 → 本功能创建的覆盖贴图（负责释放） */
  const objectOverrideTextures = new Map<
    string,
    Map<string, Partial<Record<StageTextureSlot, THREE.Texture>>>
  >()
  /** objectId → 材质键 → 槽 → 覆盖前的原始贴图（移除覆盖时还原；网格重建后作废） */
  const objectOriginalTextures = new Map<
    string,
    Map<string, Partial<Record<StageTextureSlot, THREE.Texture | null>>>
  >()
  /** 异步加载竞态令牌：`objectId|材质键|槽` → 最新令牌 */
  const objectTextureLoadTokens = new Map<string, number>()

  /** 枚举网格上的材质槽（遍历顺序稳定，供 collectStageMaterialSlots 合成材质键） */
  function collectMeshMaterials(
    root: THREE.Object3D
  ): Array<{ material: THREE.Material; name?: string }> {
    const out: Array<{ material: THREE.Material; name?: string }> = []
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      for (const material of materials) {
        if (material) out.push({ material, name: material.name })
      }
    })
    return out
  }

  function readMaterialSlotTexture(
    material: THREE.Material,
    slot: StageTextureSlot
  ): THREE.Texture | null {
    const value = (material as THREE.MeshStandardMaterial)[slot]
    return value instanceof THREE.Texture ? value : null
  }

  function getOverrideEntry(
    objectId: string,
    materialKey: string
  ): Partial<Record<StageTextureSlot, THREE.Texture>> {
    let byMaterial = objectOverrideTextures.get(objectId)
    if (!byMaterial) {
      byMaterial = new Map()
      objectOverrideTextures.set(objectId, byMaterial)
    }
    let entry = byMaterial.get(materialKey)
    if (!entry) {
      entry = {}
      byMaterial.set(materialKey, entry)
    }
    return entry
  }

  function getOriginalEntry(
    objectId: string,
    materialKey: string
  ): Partial<Record<StageTextureSlot, THREE.Texture | null>> {
    let byMaterial = objectOriginalTextures.get(objectId)
    if (!byMaterial) {
      byMaterial = new Map()
      objectOriginalTextures.set(objectId, byMaterial)
    }
    let entry = byMaterial.get(materialKey)
    if (!entry) {
      entry = {}
      byMaterial.set(materialKey, entry)
    }
    return entry
  }

  /** 释放为物体创建的覆盖贴图；clearOriginals 用于网格重建后作废原始贴图记录 */
  function disposeObjectOverrideTextures(objectId: string, clearOriginals: boolean): void {
    const byMaterial = objectOverrideTextures.get(objectId)
    if (byMaterial) {
      for (const entry of byMaterial.values()) {
        for (const texture of Object.values(entry)) texture?.dispose()
      }
      objectOverrideTextures.delete(objectId)
    }
    if (clearOriginals) objectOriginalTextures.delete(objectId)
    const prefix = `${objectId}|`
    for (const tokenKey of [...objectTextureLoadTokens.keys()]) {
      if (tokenKey.startsWith(prefix)) objectTextureLoadTokens.delete(tokenKey)
    }
  }

  /** GLTF 几何 UV 以左上为原点（flipY=false）；内置几何体保持 three.js 默认 flipY=true */
  function resolveStageTextureFlipY(obj: StageObjectState): boolean {
    return !(obj.kind === 'model' && obj.modelAssetId)
  }

  async function loadStageTexture(
    relativePath: string,
    opts: { srgb: boolean; flipY: boolean }
  ): Promise<THREE.Texture> {
    const url = await resolveAssetFileUrl(relativePath)
    if (!url) throw new Error(`asset url unavailable: ${relativePath}`)
    const texture = await new Promise<THREE.Texture>((resolve, reject) => {
      new THREE.TextureLoader().load(url, resolve, undefined, reject)
    })
    // 基础色贴图用 sRGB；法线贴图保持线性色彩空间
    if (opts.srgb) texture.colorSpace = THREE.SRGBColorSpace
    texture.flipY = opts.flipY
    return texture
  }

  /** 把覆盖贴图写入材质槽：首次覆盖前记录原始贴图，替换时释放旧覆盖贴图 */
  function writeObjectMaterialTexture(
    objectId: string,
    materialKey: string,
    material: THREE.Material,
    slot: StageTextureSlot,
    texture: THREE.Texture
  ): void {
    const originals = getOriginalEntry(objectId, materialKey)
    if (originals[slot] === undefined) {
      originals[slot] = readMaterialSlotTexture(material, slot)
    }
    const overrides = getOverrideEntry(objectId, materialKey)
    overrides[slot]?.dispose()
    overrides[slot] = texture
    ;(material as THREE.MeshStandardMaterial)[slot] = texture
    material.needsUpdate = true
  }

  /** 显式隐藏单个槽：记录原始贴图后清空，用于隐藏模型自带的嵌入贴图 */
  function hideObjectMaterialTexture(
    objectId: string,
    materialKey: string,
    material: THREE.Material,
    slot: StageTextureSlot
  ): void {
    const tokenKey = `${objectId}|${materialKey}|${slot}`
    objectTextureLoadTokens.set(tokenKey, (objectTextureLoadTokens.get(tokenKey) ?? 0) + 1)
    const originals = getOriginalEntry(objectId, materialKey)
    if (originals[slot] === undefined) {
      originals[slot] = readMaterialSlotTexture(material, slot)
    }
    const overrides = objectOverrideTextures.get(objectId)?.get(materialKey)
    if (overrides?.[slot]) {
      overrides[slot]?.dispose()
      delete overrides[slot]
    }
    ;(material as THREE.MeshStandardMaterial)[slot] = null
    material.needsUpdate = true
  }

  /** 移除单个槽的覆盖：还原原始贴图并释放我们的 Texture，同时作废在途加载 */
  function restoreObjectMaterialTexture(
    objectId: string,
    materialKey: string,
    material: THREE.Material,
    slot: StageTextureSlot
  ): void {
    const tokenKey = `${objectId}|${materialKey}|${slot}`
    objectTextureLoadTokens.set(tokenKey, (objectTextureLoadTokens.get(tokenKey) ?? 0) + 1)
    const overrides = objectOverrideTextures.get(objectId)?.get(materialKey)
    const original = objectOriginalTextures.get(objectId)?.get(materialKey)?.[slot]
    if (overrides?.[slot]) {
      overrides[slot]?.dispose()
      delete overrides[slot]
    }
    ;(material as THREE.MeshStandardMaterial)[slot] = original ?? null
    material.needsUpdate = true
  }

  /** 应用 / 替换单个材质槽的贴图覆盖（异步加载；竞态与网格重建安全） */
  function applyObjectMaterialTexture(
    objectId: string,
    obj: StageObjectState,
    material: THREE.Material,
    materialKey: string,
    slot: StageTextureSlot,
    relativePath: string
  ): void {
    const tokenKey = `${objectId}|${materialKey}|${slot}`
    const token = (objectTextureLoadTokens.get(tokenKey) ?? 0) + 1
    objectTextureLoadTokens.set(tokenKey, token)
    void loadStageTexture(relativePath, {
      srgb: slot === 'map',
      flipY: resolveStageTextureFlipY(obj)
    })
      .then((texture) => {
        if (objectTextureLoadTokens.get(tokenKey) !== token) {
          texture.dispose()
          return
        }
        // 异步加载期间网格可能已重建：仅当材质仍在当前网格上时生效
        const currentRoot = objectMeshes.get(objectId)
        const stillThere =
          !!currentRoot &&
          collectStageMaterialSlots(collectMeshMaterials(currentRoot)).some(
            (item) => item.material === material
          )
        if (!stillThere) {
          texture.dispose()
          return
        }
        writeObjectMaterialTexture(objectId, materialKey, material, slot, texture)
        requestRender()
      })
      .catch(() => {
        /* 贴图加载失败：保留原材质 */
      })
  }

  /** 按物体状态把已保存的贴图覆盖应用到当前网格（网格注册后调用） */
  function applyObjectTextureOverrides(objectId: string, obj: StageObjectState): void {
    const root = objectMeshes.get(objectId)
    const overrides = obj.materialTextures
    if (!root || !overrides) return
    // 材质实例不变时保留原始贴图记录，保证之后移除覆盖仍可还原
    disposeObjectOverrideTextures(objectId, false)
    for (const slotRef of collectStageMaterialSlots(collectMeshMaterials(root))) {
      const entry = overrides[slotRef.key]
      if (!entry) continue
      for (const slot of STAGE_TEXTURE_SLOTS) {
        const rel = entry[slot]
        if (rel === null) {
          hideObjectMaterialTexture(objectId, slotRef.key, slotRef.material, slot)
          continue
        }
        if (!rel) continue
        applyObjectMaterialTexture(objectId, obj, slotRef.material, slotRef.key, slot, rel)
      }
    }
  }

  /** 列出物体材质与贴图覆盖（inspector 用）；网格未就绪时回退到已保存的覆盖键 */
  function listObjectMaterialSlots(objectId: string): Array<{
    key: string
    label: string
    map?: string | null
    normalMap?: string | null
  }> {
    const obj = stage.value.objects.find((o) => o.id === objectId)
    if (!obj) return []
    const overrides = obj.materialTextures ?? {}
    const root = objectMeshes.get(objectId)
    if (!root) {
      return Object.entries(overrides).map(([key, entry]) => ({
        key,
        label: key,
        ...(entry ?? {})
      }))
    }
    const rows = collectStageMaterialSlots(collectMeshMaterials(root)).map((slotRef) => ({
      key: slotRef.key,
      label: slotRef.label,
      ...(overrides[slotRef.key] ?? {})
    }))
    // 状态里存在但网格上已不存在的材质键（如模型被更换）：追加列出便于清理
    for (const [key, entry] of Object.entries(overrides)) {
      if (!rows.some((row) => row.key === key)) {
        rows.push({ key, label: key, ...(entry ?? {}) })
      }
    }
    return rows
  }

  /**
   * Unity 式材质贴图槽写入，三态：
   * - 相对路径：替换为该图片
   * - `null`：显式隐藏该槽（清掉模型自带的嵌入贴图）
   * - `undefined`：移除覆盖，还原模型自带贴图
   */
  function setObjectMaterialTexture(
    id: string,
    materialKey: string,
    slot: StageTextureSlot,
    relativePath: string | null | undefined
  ): void {
    const idx = stage.value.objects.findIndex((o) => o.id === id)
    if (idx < 0) return
    const obj = stage.value.objects[idx]
    // 1) 持久化状态：空记录整体删除，避免残留空对象
    const overrides: Record<string, StageMaterialTextureOverrides> = {
      ...(obj.materialTextures ?? {})
    }
    const entry: StageMaterialTextureOverrides = { ...(overrides[materialKey] ?? {}) }
    if (relativePath === undefined) delete entry[slot]
    else entry[slot] = relativePath || null
    if (Object.keys(entry).length > 0) overrides[materialKey] = entry
    else delete overrides[materialKey]
    const next = { ...obj }
    if (Object.keys(overrides).length > 0) next.materialTextures = overrides
    else delete next.materialTextures
    stage.value.objects[idx] = next
    // 2) 应用到网格
    const root = objectMeshes.get(id)
    if (root) {
      const slotRef = collectStageMaterialSlots(collectMeshMaterials(root)).find(
        (item) => item.key === materialKey
      )
      if (slotRef) {
        if (relativePath) {
          applyObjectMaterialTexture(id, next, slotRef.material, materialKey, slot, relativePath)
        } else if (relativePath === null) {
          hideObjectMaterialTexture(id, materialKey, slotRef.material, slot)
        } else {
          restoreObjectMaterialTexture(id, materialKey, slotRef.material, slot)
        }
      }
    }
    previewRevision.value += 1
    requestRender()
    schedulePersist()
  }

  // ---- 材质贴图覆盖结束 ----

  function updateObjectTransform(
    id: string,
    patch: Partial<Pick<StageObjectState, 'position' | 'rotation' | 'scale' | 'name' | 'color'>>
  ): void {
    if (isStageCameraId(id)) {
      if (patch.name === undefined) return
      const nextName = patch.name.trim()
      const camera = getCameraState(id)
      if (!camera || !nextName || nextName === camera.name) return
      updateCamera(id, { name: nextName })
      previewRevision.value += 1
      schedulePersist()
      return
    }
    if (isObjectLocked(id) && (patch.position || patch.rotation || patch.scale)) return
    const idx = stage.value.objects.findIndex((o) => o.id === id)
    if (idx < 0) return
    const hasTransform = !!(patch.position || patch.rotation || patch.scale)
    if (hasTransform && isEditingAnimKeyframeFor('object', id)) {
      writeTransformToSelectedKeyframe('object', id, {
        ...(patch.position ? { position: patch.position } : {}),
        ...(patch.rotation ? { rotation: patch.rotation } : {}),
        ...(patch.scale ? { scale: patch.scale } : {})
      })
      const mesh = objectMeshes.get(id)
      const fresh = getSelectedAnimKeyframe()
      if (mesh && fresh) {
        const kf = fresh.keyframe
        const position = patch.position ?? kf.position
        const rotation = patch.rotation ?? kf.rotation ?? stage.value.objects[idx].rotation
        const scale = patch.scale ?? kf.scale ?? stage.value.objects[idx].scale
        mesh.position.set(position.x, position.y, position.z)
        mesh.rotation.set(rotation.x, rotation.y, rotation.z)
        mesh.scale.set(scale.x, scale.y, scale.z)
        if (selectionHelper) selectionHelper.update()
      }
      if (patch.name !== undefined || patch.color !== undefined) {
        const o = stage.value.objects[idx]
        const meta = {
          ...o,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.color !== undefined ? { color: patch.color } : {})
        }
        stage.value.objects[idx] = meta
        const meshMeta = objectMeshes.get(id)
        if (meshMeta) {
          const label = objectLabels.get(id)
          if (label && patch.name) label.element.textContent = meta.name
          if (patch.color !== undefined) applyObjectColor(meshMeta, meta.color)
        }
        schedulePersist()
      }
      previewRevision.value += 1
      requestRender()
      return
    }
    const next = { ...stage.value.objects[idx], ...patch }
    stage.value.objects[idx] = next
    const mesh = objectMeshes.get(id)
    if (mesh) {
      applyTransform(mesh, next)
      const label = objectLabels.get(id)
      if (label && patch.name) label.element.textContent = patch.name
      if (patch.color !== undefined) applyObjectColor(mesh, next.color)
      if (selectionHelper) selectionHelper.update()
    }
    previewRevision.value += 1
    requestRender()
    schedulePersist()
  }

  function patchObjectFlags(
    id: string,
    patch: Partial<Pick<StageObjectState, 'visible' | 'locked' | 'parentId' | 'nameVisible'>>
  ): void {
    const idx = stage.value.objects.findIndex((o) => o.id === id)
    if (idx < 0) return
    const next = { ...stage.value.objects[idx], ...patch }
    stage.value.objects[idx] = next
    const mesh = objectMeshes.get(id)
    if (mesh) {
      if (patch.visible !== undefined) mesh.visible = patch.visible !== false
      if (
        patch.visible !== undefined ||
        patch.nameVisible !== undefined
      ) {
        syncObjectNameLabel(next, mesh)
      }
    }
    if (patch.locked !== undefined && selectedObjectId.value === id) {
      applySelectionToScene()
    }
    previewRevision.value += 1
    requestRender()
    schedulePersist()
  }

  function setObjectVisible(id: string, visible: boolean): void {
    if (isStageCameraId(id)) {
      updateCamera(id, { visible })
      syncShotVisuals()
      if (!visible && selectionKind.value === 'camera') applySelectionToScene()
      previewRevision.value += 1
      requestRender()
      schedulePersist()
      return
    }
    patchObjectFlags(id, { visible })
  }

  function setObjectLocked(id: string, locked: boolean): void {
    if (isStageCameraId(id)) {
      updateCamera(id, { locked })
      applySelectionToScene()
      previewRevision.value += 1
      requestRender()
      schedulePersist()
      return
    }
    patchObjectFlags(id, { locked })
  }

  function setObjectNameVisible(id: string, nameVisible: boolean): void {
    if (isStageCameraId(id)) return
    patchObjectFlags(id, { nameVisible })
  }

  function writeLocalTransformFromMesh(id: string, mesh: THREE.Object3D): void {
    const idx = stage.value.objects.findIndex((o) => o.id === id)
    if (idx < 0) return
    const o = stage.value.objects[idx]
    stage.value.objects[idx] = {
      ...o,
      position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
      rotation: { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z },
      scale: { x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z }
    }
  }

  function reparentObject(childId: string, parentId: string | null): void {
    if (isStageCameraId(childId)) return
    if (parentId && isStageCameraId(parentId)) parentId = null
    if (wouldCreateCycle(childId, parentId)) return
    const idx = stage.value.objects.findIndex((o) => o.id === childId)
    if (idx < 0) return
    const current = stage.value.objects[idx]
    const nextParent = parentId && stage.value.objects.some((o) => o.id === parentId) ? parentId : null
    if ((current.parentId ?? null) === nextParent) return

    const childMesh = objectMeshes.get(childId)
    const parentMesh = nextParent ? objectMeshes.get(nextParent) : null
    if (childMesh && scene) {
      childMesh.updateWorldMatrix(true, false)
      const worldPos = new THREE.Vector3()
      const worldQuat = new THREE.Quaternion()
      const worldScale = new THREE.Vector3()
      childMesh.matrixWorld.decompose(worldPos, worldQuat, worldScale)
      const host = parentMesh ?? scene
      host.attach(childMesh)
      writeLocalTransformFromMesh(childId, childMesh)
    }

    stage.value.objects[idx] = {
      ...stage.value.objects[idx],
      parentId: nextParent
    }
    if (selectionHelper) selectionHelper.update()
    previewRevision.value += 1
    requestRender()
    schedulePersist()
  }

  function resolveUniqueObjectName(baseName: string): string {
    const existingNames = stage.value.objects.map((o) => o.name)
    if (!existingNames.includes(baseName)) return baseName
    let n = 2
    let name = `${baseName} ${n}`
    while (existingNames.includes(name)) {
      n += 1
      name = `${baseName} ${n}`
    }
    return name
  }

  function resolveUniqueCameraName(baseName: string): string {
    const existingNames = listCameras().map((camera) => camera.name)
    if (!existingNames.includes(baseName)) return baseName
    let n = 2
    let name = `${baseName} ${n}`
    while (existingNames.includes(name)) name = `${baseName} ${++n}`
    return name
  }

  function updateCamera(id: string, patch: Partial<DirectorCameraState>): void {
    const index = listCameras().findIndex((camera) => camera.id === id)
    if (index < 0) return
    const cameras = listCameras().slice()
    cameras[index] = { ...cameras[index], ...patch }
    stage.value.cameras = cameras
  }

  function resolveCreateParentId(parentId: string | null = null): string | null {
    return parentId &&
      !isStageCameraId(parentId) &&
      stage.value.objects.some((o) => o.id === parentId)
      ? parentId
      : null
  }

  function attachObjectNameLabel(obj: StageObjectState, mesh: THREE.Object3D): void {
    syncObjectNameLabel(obj, mesh)
  }

  /** 只统计可见 Mesh 的世界包围盒（跳过隐藏 / 辅助几何，兼容 SkinnedMesh 对象级包围盒） */
  function computeVisibleWorldBox(root: THREE.Object3D): THREE.Box3 | null {
    const box = new THREE.Box3()
    const tmp = new THREE.Box3()
    let found = false
    root.updateWorldMatrix(true, true)
    root.traverse((child) => {
      if (child.visible === false) return
      if (!(child instanceof THREE.Mesh)) return
      const geometry = child.geometry
      if (!geometry) return
      const skinned = child as THREE.SkinnedMesh
      if (skinned.isSkinnedMesh && skinned.boundingBox !== undefined) {
        if (skinned.boundingBox === null) skinned.computeBoundingBox()
        if (!skinned.boundingBox) return
        tmp.copy(skinned.boundingBox)
      } else {
        if (geometry.boundingBox === null) geometry.computeBoundingBox()
        if (!geometry.boundingBox) return
        tmp.copy(geometry.boundingBox)
      }
      tmp.applyMatrix4(child.matrixWorld)
      box.union(tmp)
      found = true
    })
    return found ? box : null
  }

  function syncObjectNameLabel(obj: StageObjectState, mesh: THREE.Object3D): void {
    const show = sceneLabelsVisible.value && obj.visible !== false && isObjectNameVisible(obj)
    let label = objectLabels.get(obj.id)
    if (!show) {
      if (label) label.visible = false
      return
    }
    if (!label) {
      label = createNameLabel(obj.name)
      mesh.add(label)
      objectLabels.set(obj.id, label)
    } else {
      label.element.textContent = obj.name
    }
    // 标签贴在「可见网格」包围盒顶部中心上方（跳过隐藏/辅助几何），并按网格缩放抵消，避免缩放后标签远离物体
    const box = computeVisibleWorldBox(mesh)
    const worldScaleY = Math.max(0.0001, mesh.getWorldScale(new THREE.Vector3()).y)
    if (box && !box.isEmpty()) {
      const anchor = mesh.worldToLocal(
        new THREE.Vector3(
          (box.min.x + box.max.x) / 2,
          box.max.y,
          (box.min.z + box.max.z) / 2
        )
      )
      label.position.set(anchor.x, anchor.y + 0.1 / worldScaleY, anchor.z)
    } else {
      label.position.set(0, 2.1 / worldScaleY, 0)
    }
    label.visible = true
  }

  function insertObjectMesh(obj: StageObjectState, mesh: THREE.Object3D): void {
    mesh.name = obj.name
    mesh.userData.stageId = obj.id
    applyTransform(mesh, obj)
    mesh.visible = obj.visible !== false
    attachObjectNameLabel(obj, mesh)
    const parentMesh = obj.parentId ? objectMeshes.get(obj.parentId) : null
    if (parentMesh) parentMesh.add(mesh)
    else getStageRoot()?.add(mesh)
    objectMeshes.set(obj.id, mesh)
    applyObjectTextureOverrides(obj.id, obj)
    stage.value.objects = [...stage.value.objects, obj]
    selectObject(obj.id)
    schedulePersist()
    requestRender()
  }

  function createEmptyObject(parentId: string | null = null): string {
    const name = resolveUniqueObjectName('Empty')
    const id = `empty:${crypto.randomUUID()}`
    const obj: StageObjectState = {
      id,
      name,
      kind: 'empty',
      parentId: resolveCreateParentId(parentId),
      visible: true,
      locked: false,
      nameVisible: false,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    }
    insertObjectMesh(obj, new THREE.Group())
    return id
  }

  function createCameraObject(): string {
    const cameras = listCameras()
    const id = `camera:${crypto.randomUUID()}`
    const viewer = createDefaultDirectorViewer()
    viewer.position.x += cameras.length * 2.5
    const name = resolveUniqueCameraName(`Camera ${cameras.length + 1}`)
    const camera = createDefaultDirectorCamera(id, name)
    camera.viewer = viewer
    stage.value.cameras = [...cameras, camera]
    ensureShotCameraVisual(camera)
    selectCamera(id)
    schedulePersist()
    requestRender()
    return id
  }

  function createPrimitiveObject(
    primitive: StagePrimitive,
    parentId: string | null = null
  ): string {
    const labels: Record<StagePrimitive, string> = {
      box: 'Cube',
      sphere: 'Sphere',
      capsule: 'Capsule',
      cone: 'Cone',
      cylinder: 'Cylinder',
      pyramid: 'Pyramid',
      hemisphere: 'Hemisphere',
      torus: 'Torus',
      arch: 'Arch',
      pointedArch: 'Pointed Arch',
      cross: 'Cross',
      tube: 'Tube',
      prism: 'Prism',
      tetrahedron: 'Tetrahedron',
      octahedron: 'Octahedron',
      icosphere: 'Icosphere',
      wedge: 'Wedge',
      disc: 'Disc',
      ring: 'Ring',
      plane: 'Plane',
      quad: 'Quad'
    }
    const name = resolveUniqueObjectName(labels[primitive])
    const id = `primitive:${crypto.randomUUID()}`
    const obj: StageObjectState = {
      id,
      name,
      kind: 'primitive',
      primitive,
      color: '#4f8ef7',
      parentId: resolveCreateParentId(parentId),
      visible: true,
      locked: false,
      position: { x: 0, y: 0, z: 0 },
      rotation:
        primitive === 'plane'
          ? { x: -Math.PI / 2, y: 0, z: 0 }
          : { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    }
    insertObjectMesh(obj, makePrimitive(obj.name, primitive, parseColor(obj.color)))
    return id
  }

  /**
   * ???????????transform / ?????? GLTF ????????? genParams?
   */
  async function createModelObject(
    modelAssetId: string,
    parentId: string | null = null,
    position?: StageVec3,
    /** Cache 产物（如 in-model 端口的 3D 生成）不入资产库，用回传的 relativePath 直接实例化 */
    incoming?: { relativePath?: string; name?: string }
  ): Promise<string | null> {
    const libraryModel = project.assets.find(
      (item) => item.id === modelAssetId && item.type === 'model'
    )
    const model: Pick<AssetInfo, 'id' | 'type' | 'name' | 'relativePath' | 'genParams'> | null =
      libraryModel ??
      (incoming?.relativePath
        ? {
            id: modelAssetId,
            type: 'model',
            name: incoming.name?.trim() || t('director.stage.incomingModelName'),
            relativePath: incoming.relativePath,
            genParams: {}
          }
        : null)
    if (!model?.relativePath) return null
    if (isNonPlaceableModelAsset(model)) return null

    let xf = readModelAssetTransform(model.genParams)
    let color = readModelAssetColor(model.genParams) ?? '#ffffff'

    try {
      const url = await window.studio.getAssetFileUrl(model.relativePath)
      const loaded = await loadModelScene(url, model.relativePath)
      const extracted = extractModelSceneDefaults(loaded.scene)
      xf = extracted.transform
      color = extracted.color
      if (libraryModel) {
        const nextGen: Record<string, unknown> = {
          ...(model.genParams ?? {}),
          transform: { ...xf },
          color
        }
        project.patchAssets([{ ...libraryModel, genParams: nextGen }])
        void persistAssetRecord(libraryModel.id, { genParams: nextGen }).catch(() => {
          /* ????????? patch */
        })
      }
    } catch (err) {
      // 仅跳过 transform / 颜色提取，物体仍按模型类型创建
      console.warn('[director-stage] 模型默认值提取失败:', model.relativePath, err)
    }

    const id = `model:${crypto.randomUUID()}`
    const obj: StageObjectState = {
      id,
      name: resolveUniqueObjectName(model.name),
      kind: 'model',
      modelAssetId: model.id,
      modelRelativePath: model.relativePath,
      color,
      parentId: resolveCreateParentId(parentId),
      visible: true,
      locked: false,
      position: position ? { ...position } : { ...xf.position },
      rotation: { ...xf.rotation },
      scale: { ...xf.scale }
    }
    stage.value.objects = [...stage.value.objects, obj]
    selectObject(id)
    schedulePersist()
    if (scene) await rebuildObjects()
    else requestRender()
    return id
  }

  function currentPrimarySelectionId(): string | null {
    if (selectionKind.value === 'camera') return selectedCameraId.value
    if (selectionKind.value === 'object') return selectedObjectId.value
    return null
  }

  /** 舞台状态为可序列化纯数据（且是 Vue 响应式代理），用 JSON 深拷贝替代 structuredClone */
  function cloneStageState<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
  }

  function setMultiSelection(ids: Iterable<string>): void {
    multiSelectedIds.value = [...new Set(ids)]
  }

  /** 复制选中项（对象 / 相机）到内部剪贴板；ids 缺省时用层级多选或当前主选中 */
  function copyStageSelection(ids?: string[]): void {
    const candidates =
      ids && ids.length
        ? ids
        : multiSelectedIds.value.length
          ? multiSelectedIds.value
          : currentPrimarySelectionId()
            ? [currentPrimarySelectionId()!]
            : []
    const copied: typeof stageClipboard.value = []
    for (const id of candidates) {
      if (isStageCameraId(id)) {
        const cam = getCameraState(id)
        if (cam) copied.push({ kind: 'camera', data: cloneStageState(cam) })
      } else {
        const obj = stage.value.objects.find((o) => o.id === id)
        if (obj) copied.push({ kind: 'object', data: cloneStageState(obj) })
      }
    }
    if (copied.length) stageClipboard.value = copied
  }

  function canPasteStageClipboard(): boolean {
    return stageClipboard.value.length > 0
  }

  function pasteCameraState(src: DirectorCameraState): string | null {
    const cameras = listCameras()
    const id = `camera:${crypto.randomUUID()}`
    const viewer = cloneStageState(src.viewer)
    viewer.position.x += 1.5
    const camera = createDefaultDirectorCamera(id, resolveUniqueCameraName(`${src.name} Copy`))
    camera.viewer = viewer
    if (src.visible !== undefined) camera.visible = src.visible
    if (src.locked !== undefined) camera.locked = src.locked
    stage.value.cameras = [...cameras, camera]
    ensureShotCameraVisual(camera)
    return id
  }

  function pasteObjectState(src: StageObjectState, blank = false): string | null {
    const prefix = (src.id.match(/^[a-zA-Z0-9_-]+/) ?? ['object'])[0] ?? 'object'
    const id = `${prefix}:${crypto.randomUUID()}`
    // 选中物体 → 粘贴为选中物体的子结点；未选中（空白处）→ 与来源同级
    const selectedParent =
      !blank && selectionKind.value === 'object'
        ? resolveCreateParentId(selectedObjectId.value)
        : null
    const obj: StageObjectState = {
      ...cloneStageState(src),
      id,
      name: resolveUniqueObjectName(`${src.name} Copy`),
      parentId: selectedParent ?? src.parentId,
      position: {
        x: src.position.x + 0.5,
        y: src.position.y,
        z: src.position.z + 0.5
      }
    }
    stage.value.objects = [...stage.value.objects, obj]
    return id
  }

  async function pasteStageClipboard(opts?: { blank?: boolean }): Promise<void> {
    const entries = stageClipboard.value
    if (!entries.length) return
    try {
      const pastedObjectIds: string[] = []
      const pastedCameraIds: string[] = []
      for (const entry of entries) {
        if (entry.kind === 'camera') {
          const id = pasteCameraState(entry.data)
          if (id) pastedCameraIds.push(id)
        } else {
          const id = pasteObjectState(entry.data, opts?.blank)
          if (id) pastedObjectIds.push(id)
        }
      }
      if (pastedObjectIds.length && scene) {
        await rebuildObjects()
      }
      if (pastedCameraIds.length) {
        selectCamera(pastedCameraIds[0]!)
      }
      if (pastedObjectIds.length) {
        selectObject(pastedObjectIds[pastedObjectIds.length - 1]!)
      }
      if (pastedObjectIds.length || pastedCameraIds.length) {
        previewRevision.value += 1
        requestRender()
        schedulePersist()
        void directorDocument.save().catch(() => {
          /* 持久化失败不阻塞 */
        })
      }
    } catch (err) {
      console.error('[stage] paste failed', err)
    }
  }

  /** ???????????????????*/
  function canDeleteObject(id: string): boolean {
    if (isStageCameraId(id)) return listCameras().length > 1
    if (isCameraGroupId(id)) return true
    const obj = stage.value.objects.find((o) => o.id === id)
    if (!obj) return false
    return true
  }

  function detachObjectVisual(id: string): void {
    clearSkeletonRuntime(id)
    const mesh = objectMeshes.get(id)
    if (mesh) {
      mesh.removeFromParent()
      disposeObject(mesh)
      objectMeshes.delete(id)
    }
    disposeObjectOverrideTextures(id, true)
    const label = objectLabels.get(id)
    if (label) {
      label.parent?.remove(label)
      disposeLabel(label)
      objectLabels.delete(id)
    }
  }

  /**
   * ?????????????????? model ???????????????
   */
  /** 删除物体/相机后，清理仍引用它们的动画轨道与机位组，避免孤儿动画数据残留 */
  function pruneStageAnimationForRemoved(removeIds: Set<string>): void {
    const anim = stage.value.animation
    if (anim?.tracks?.length) {
      const tracks: DirectorAnimTrack[] = []
      for (const track of anim.tracks) {
        if (track.targetKind === 'object') {
          if (removeIds.has(track.targetId)) continue
          tracks.push(track)
          continue
        }
        if (track.targetKind === 'camera') {
          if (track.cameraCut) {
            const segments = (track.cameraSegments ?? []).filter(
              (seg) => !removeIds.has(seg.cameraId)
            )
            if (segments.length === 0) continue
            const targetId = removeIds.has(track.targetId)
              ? segments[0].cameraId
              : track.targetId
            tracks.push(
              segments.length === (track.cameraSegments?.length ?? 0)
                ? { ...track, targetId }
                : { ...track, targetId, cameraSegments: segments }
            )
            continue
          }
          if (removeIds.has(track.targetId)) continue
          tracks.push(track)
          continue
        }
        tracks.push(track)
      }
      stage.value.animation = { ...anim, tracks }
    }
    if (stage.value.cameraGroups?.length) {
      stage.value.cameraGroups = stage.value.cameraGroups.filter(
        (group) => !removeIds.has(group.parentId ?? '')
      )
    }
  }

  /**
   * 删除单个对象/相机/机位组。
   * persist=false 供批量删除（removeObjectsWithUndo）使用：循环内不落盘，
   * 由调用方在全部删除完成后统一持久化一次——否则首次保存的快照只含
   * 第一个删除（documents.save 对进行中的保存去重），其余删除会被丢掉，
   * 落盘成“只删了一个”的中间态并触发舞台按旧数据重载。
   */
  function removeObject(id: string, persist = true): boolean {
    if (!canDeleteObject(id)) return false
    if (isCameraGroupId(id)) {
      // 机位组：删除组及其下的预设相机
      const groupCameraIds = new Set(
        listCameras()
          .filter((camera) => camera.parentId === id)
          .map((camera) => camera.id)
      )
      const wasActiveInGroup = groupCameraIds.has(stage.value.activeCameraId ?? '')
      const wasSelectedInGroup = groupCameraIds.has(selectedCameraId.value ?? '')
      for (const cameraId of groupCameraIds) disposeShotCameraVisual(cameraId)
      stage.value.cameras = listCameras().filter((camera) => !groupCameraIds.has(camera.id))
      stage.value.cameraGroups = (stage.value.cameraGroups ?? []).filter(
        (group) => group.id !== id
      )
      if (wasActiveInGroup || !getCameraState(stage.value.activeCameraId ?? '')) {
        stage.value.activeCameraId = listCameras()[0]?.id ?? null
      }
      if (wasSelectedInGroup) {
        const nextCameraId = stage.value.activeCameraId ?? listCameras()[0]?.id ?? null
        if (nextCameraId) {
          selectCamera(nextCameraId)
        } else {
          selectedCameraId.value = null
          selectionKind.value = null
          applySelectionToScene()
        }
      }
      pruneStageAnimationForRemoved(new Set([id, ...groupCameraIds]))
      previewRevision.value += 1
      requestRender()
      if (persist) {
        schedulePersist()
        void directorDocument.save().catch(() => {
          /* 持久化失败不阻塞 */
        })
      }
      return true
    }
    if (isStageCameraId(id)) {
      const wasActive = stage.value.activeCameraId === id
      const wasSelected = selectedCameraId.value === id
      const cameras = listCameras().filter((camera) => camera.id !== id)
      stage.value.cameras = cameras
      disposeShotCameraVisual(id)
      if (wasActive) stage.value.activeCameraId = cameras[0]?.id ?? null
      if (wasSelected) selectCamera(stage.value.activeCameraId ?? cameras[0]?.id ?? '')
      pruneStageAnimationForRemoved(new Set([id]))
      previewRevision.value += 1
      requestRender()
      if (persist) {
        schedulePersist()
        void directorDocument.save().catch(() => {
          /* persistStageNow ????error */
        })
      }
      return true
    }
    const root = stage.value.objects.find((o) => o.id === id)
    if (!root) return false

    const removeIds = new Set<string>([id, ...collectDescendantIds(id)])
    const fallbackParent =
      root.parentId && stage.value.objects.some((o) => o.id === root.parentId)
        ? root.parentId
        : null

    const keptModels = stage.value.objects
      // 只保留被删物体的子级模型（随父删除时提升到父级同层），删除目标本身不保留
      .filter((o) => o.id !== id && removeIds.has(o.id) && o.kind === 'model')
      .map((o) => {
        const parentId = o.parentId ?? null
        if (!parentId || !removeIds.has(parentId)) return { ...o, parentId }
        const parent = stage.value.objects.find((p) => p.id === parentId)
        // ??????????????????????????????
        if (parent?.kind === 'model') return { ...o, parentId }
        return { ...o, parentId: fallbackParent }
      })

    for (const rid of removeIds) {
      if (keptModels.some((m) => m.id === rid)) continue
      detachObjectVisual(rid)
    }

    stage.value.objects = [
      ...stage.value.objects.filter((o) => !removeIds.has(o.id)),
      ...keptModels
    ]
    pruneStageAnimationForRemoved(removeIds)

    // ???? model mesh ??????
    for (const model of keptModels) {
      const mesh = objectMeshes.get(model.id)
      if (!mesh || !scene) continue
      const parentMesh = model.parentId ? objectMeshes.get(model.parentId) : null
      const host = parentMesh ?? scene
      if (mesh.parent !== host) host.add(mesh)
    }

    if (
      selectionKind.value === 'object' &&
      selectedObjectId.value &&
      removeIds.has(selectedObjectId.value) &&
      !keptModels.some((m) => m.id === selectedObjectId.value)
    ) {
      selectedObjectId.value = null
      selectionKind.value = null
      applySelectionToScene()
      syncEditorStageSelection()
    } else {
      applySelectionToScene()
    }

    previewRevision.value += 1
    requestRender()
    if (persist) {
      schedulePersist()
      void directorDocument.save().catch(() => {
        /* persistStageNow ????error */
      })
    }
    return true
  }

  /** 舞台对象/相机快照回放（撤销/重做用） */
  async function applyStageSnapshot(
    objects: StageObjectState[],
    cameras: DirectorCameraState[],
    activeCameraId: string | null,
    selection?: {
      kind: DirectorSelectionKind
      objectId: string | null
      cameraId: string | null
    },
    cameraGroups?: DirectorCameraGroup[]
  ): Promise<void> {
    stage.value.objects = objects
    stage.value.cameras = cameras
    if (cameraGroups) stage.value.cameraGroups = cameraGroups
    stage.value.activeCameraId =
      activeCameraId && cameras.some((c) => c.id === activeCameraId)
        ? activeCameraId
        : (cameras[0]?.id ?? null)
    if (scene) await rebuildObjects()
    const knownCameraIds = new Set(listCameras().map((c) => c.id))
    for (const id of [...shotVisuals.keys()]) {
      if (!knownCameraIds.has(id)) disposeShotCameraVisual(id)
    }
    for (const cam of listCameras()) ensureShotCameraVisual(cam)
    if (selection) {
      if (
        selection.kind === 'camera' &&
        selection.cameraId &&
        getCameraState(selection.cameraId)
      ) {
        selectCamera(selection.cameraId)
      } else if (
        selection.kind === 'object' &&
        selection.objectId &&
        stage.value.objects.some((o) => o.id === selection.objectId)
      ) {
        selectObject(selection.objectId)
      } else {
        selectScene()
      }
    } else {
      applySelectionToScene()
    }
    previewRevision.value += 1
    requestRender()
    schedulePersist()
    void directorDocument.save().catch(() => {
      /* 持久化失败不阻塞撤销 */
    })
  }

  /** 批量删除（物体/相机）并登记一次可撤销历史 */
  function removeObjectsWithUndo(ids: string[]): boolean {
    const valid = [...new Set(ids)].filter((id) => canDeleteObject(id))
    if (!valid.length) return false

    const beforeObjects = cloneStageState(stage.value.objects)
    const beforeCameras = cloneStageState(listCameras())
    const beforeActive = stage.value.activeCameraId ?? null
    const beforeGroups = cloneStageState(stage.value.cameraGroups ?? [])
    const beforeSelection = {
      kind: selectionKind.value,
      objectId: selectedObjectId.value,
      cameraId: selectedCameraId.value
    }

    let removed = 0
    // persist=false：循环内逐个落盘会与 documents.save 的去重竞态，
    // 只有第一次保存（快照仅含第一个删除）真正执行，其余删除被丢弃
    for (const id of valid) {
      if (removeObject(id, false)) removed += 1
    }
    if (!removed) return false
    schedulePersist()
    void directorDocument.save().catch(() => {
      /* persistStageNow ????error */
    })

    const afterObjects = cloneStageState(stage.value.objects)
    const afterCameras = cloneStageState(listCameras())
    const afterActive = stage.value.activeCameraId ?? null
    const afterGroups = cloneStageState(stage.value.cameraGroups ?? [])

    const scope = `director-stage:${options.directorAssetId}`
    editor.commands.setActiveScope(scope)
    editor.commands.recordExecuted({
      id: `director.remove.${crypto.randomUUID()}`,
      label: t('director.stage.deleteObject'),
      scope,
      execute: () =>
        applyStageSnapshot(afterObjects, afterCameras, afterActive, undefined, afterGroups),
      undo: () =>
        applyStageSnapshot(
          beforeObjects,
          beforeCameras,
          beforeActive,
          beforeSelection,
          beforeGroups
        )
    })
    return true
  }

  function applySelectionToScene(): void {
    if (pathDrawMode.value) return
    if (isPoseEditActive()) {
      // ????????/?? gizmo????????
      if (transform) {
        suppressTransformEvent = true
        transform.detach()
        suppressTransformEvent = false
      }
      if (selectionKind.value === 'object' && selectedObjectId.value) {
        const mesh = objectMeshes.get(selectedObjectId.value) ?? null
        if (mesh) updateSelectionHelper(mesh)
        else clearSelectionHelper()
      } else {
        clearSelectionHelper()
      }
      syncPoseBoneGizmo()
      return
    }
    detachPoseBoneGizmo()
    if (isPenPathEditActive()) {
      if (pathEditSelection) {
        const mesh = meshForPathEdit(pathEditSelection)
        if (mesh && transform) {
          suppressTransformEvent = true
          transform.setMode('translate')
          transform.attach(mesh)
          suppressTransformEvent = false
          if (selectionKind.value === 'object' && selectedObjectId.value) {
            const objMesh = objectMeshes.get(selectedObjectId.value) ?? null
            if (objMesh) updateSelectionHelper(objMesh)
            else clearSelectionHelper()
          } else {
            clearSelectionHelper()
          }
          syncTransformGizmoScale()
          return
        }
      }
      if (transform) {
        suppressTransformEvent = true
        transform.detach()
        suppressTransformEvent = false
      }
      if (selectionKind.value === 'object' && selectedObjectId.value) {
        const mesh = objectMeshes.get(selectedObjectId.value) ?? null
        if (mesh) updateSelectionHelper(mesh)
        else clearSelectionHelper()
      } else {
        clearSelectionHelper()
      }
      return
    }
    if (selectionKind.value === 'camera') {
      const id = selectedCameraId.value
      const cameraState = id ? getCameraState(id) : null
      const viz = id ? shotVisuals.get(id) : null
      if (viz && cameraState && transform) {
        if (
          cameraState.locked === true ||
          viewMode.value !== 'director' ||
          cameraState.visible === false
        ) {
          suppressTransformEvent = true
          transform.detach()
          suppressTransformEvent = false
          return
        }
        suppressTransformEvent = true
        transform.attach(viz.root)
        suppressTransformEvent = false
        syncTransformGizmoScale()
        return
      }
      transform?.detach()
      clearSelectionHelper()
      return
    }
    if (selectionKind.value === 'object' && selectedObjectId.value) {
      const mesh = objectMeshes.get(selectedObjectId.value) ?? null
      if (mesh && transform) {
        if (isObjectLocked(selectedObjectId.value)) {
          suppressTransformEvent = true
          transform.detach()
          suppressTransformEvent = false
          updateSelectionHelper(mesh)
          return
        }
        suppressTransformEvent = true
        transform.attach(mesh)
        suppressTransformEvent = false
        updateSelectionHelper(mesh)
        syncTransformGizmoScale()
        return
      }
      selectedObjectId.value = null
      selectionKind.value = null
      syncEditorStageSelection()
    }
    transform?.detach()
    clearSelectionHelper()
  }

  function isEditorStageSelection(): boolean {
    const kind = editor.selection.current.value.kind
    return (
      kind === 'stage.object' ||
      kind === 'stage.camera' ||
      kind === 'stage.scene' ||
      kind === 'stage.panorama'
    )
  }

  function syncEditorStageSelection(): void {
    const kind = selectionKind.value
    if (kind === 'object' && selectedObjectId.value) {
      editor.selection.select({
        kind: 'stage.object',
        key: `stage.object:${selectedObjectId.value}`,
        id: selectedObjectId.value
      })
      return
    }
    if (kind === 'camera' && selectedCameraId.value) {
      editor.selection.select({
        kind: 'stage.camera',
        key: `stage.camera:${selectedCameraId.value}`,
        id: selectedCameraId.value
      })
      return
    }
    if (kind === 'panorama') {
      editor.selection.select({
        kind: 'stage.panorama',
        key: 'stage.panorama',
        id: DIRECTOR_PANORAMA_HIERARCHY_ID
      })
      return
    }
    if (kind === 'scene') {
      editor.selection.select({
        kind: 'stage.scene',
        key: 'stage.scene'
      })
      return
    }
    if (isEditorStageSelection()) editor.selection.clear()
  }

  function selectObject(id: string | null): void {
    if (!id) {
      selectScene()
      return
    }
    if (poseSkeletonOverlay?.getTargetObjectId() && poseSkeletonOverlay.getTargetObjectId() !== id) {
      setPoseSkeletonVisible(null)
    }
    selectedObjectId.value = id
    selectedCameraId.value = null
    selectionKind.value = 'object'
    applySelectionToScene()
    syncShotVisuals()
    syncEditorStageSelection()
  }

  function selectCamera(id: string): void {
    if (!getCameraState(id)) return
    setPoseSkeletonVisible(null)
    selectedObjectId.value = null
    selectedCameraId.value = id
    selectionKind.value = 'camera'
    stage.value.activeCameraId = id
    if (viewMode.value === 'camera') applyCameraView()
    applySelectionToScene()
    syncShotVisuals()
    previewRevision.value += 1
    requestRender()
    schedulePersist()
    syncEditorStageSelection()
  }

  function selectScene(): void {
    setPoseSkeletonVisible(null)
    selectedObjectId.value = null
    selectedCameraId.value = null
    selectionKind.value = 'scene'
    if (stageEditMode.value === 'animation' && animSelectedTrackId.value) {
      animSelectedTrackId.value = null
      animSelectedKeyframeId.value = null
      clearPathEditOverlays()
      syncAllPathVisuals()
    }
    applySelectionToScene()
    syncShotVisuals()
    previewRevision.value += 1
    requestRender()
    syncEditorStageSelection()
  }

  function selectPanorama(): void {
    setPoseSkeletonVisible(null)
    selectedObjectId.value = null
    selectedCameraId.value = null
    selectionKind.value = 'panorama'
    applySelectionToScene()
    syncShotVisuals()
    previewRevision.value += 1
    requestRender()
    syncEditorStageSelection()
  }

  function selectHierarchyItem(id: string): void {
    if (id === DIRECTOR_PANORAMA_HIERARCHY_ID) selectPanorama()
    else if (isStageCameraId(id)) selectCamera(id)
    else if (stage.value.cameraGroups?.some((g) => g.id === id)) {
      // 机位组：选中其所属物体
      const group = stage.value.cameraGroups.find((g) => g.id === id)
      if (group?.parentId && stage.value.objects.some((o) => o.id === group.parentId)) {
        selectObject(group.parentId)
      } else {
        selectScene()
      }
    }
    else selectObject(id)
  }

  /** ?????????????????? Hierarchy ?????*/
  function focusHierarchyItem(id: string): void {
    selectHierarchyItem(id)
    if (!camera || !orbit) return
    if (isStageCameraId(id)) {
      if (viewMode.value === 'director') frameShotCameraInDirectorView()
      syncShotVisuals()
      requestRender()
      return
    }
    const mesh = objectMeshes.get(id)
    if (!mesh) return

    const box = new THREE.Box3().setFromObject(mesh)
    const center = new THREE.Vector3()
    let distance = 4
    if (box.isEmpty()) {
      mesh.getWorldPosition(center)
    } else {
      box.getCenter(center)
      const size = box.getSize(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z, 0.5)
      const fov = (camera.fov * Math.PI) / 180
      distance = (maxDim / 2 / Math.tan(fov / 2)) * 1.8
    }

    const dir = new THREE.Vector3().subVectors(camera.position, orbit.target)
    if (dir.lengthSq() < 1e-8) dir.set(0, 0.25, 1)
    dir.normalize()
    const nextPos = center.clone().addScaledVector(dir, Math.max(distance, 1.5))

    if (viewMode.value === 'director') {
      orbit.target.copy(center)
      camera.position.copy(nextPos)
      orbit.update()
      requestRender()
      return
    }

    const prev = activeCameraState().viewer
    setViewerFromInspector({
      ...prev,
      position: { x: nextPos.x, y: nextPos.y, z: nextPos.z },
      target: { x: center.x, y: center.y, z: center.z },
      rotation: directorViewerRotationFromLook(
        { x: nextPos.x, y: nextPos.y, z: nextPos.z },
        { x: center.x, y: center.y, z: center.z }
      )
    })
  }

  function resolveActionIds(ids?: string[]): string[] {
    if (ids && ids.length > 0) return [...new Set(ids)]
    if (selectionKind.value === 'camera' && selectedCameraId.value) return [selectedCameraId.value]
    if (selectionKind.value === 'object' && selectedObjectId.value) return [selectedObjectId.value]
    return []
  }

  /** ???????????????Orbit ??????????????*/
  function readViewWorldPose(): {
    position: THREE.Vector3
    quaternion: THREE.Quaternion
    pivot: THREE.Vector3
    rotation: { x: number; y: number; z: number }
  } | null {
    if (!camera || !orbit) return null
    if (viewMode.value === 'camera') {
      const viewer = activeCameraState().viewer
      const rotation =
        viewer.rotation ?? directorViewerRotationFromLook(viewer.position, viewer.target)
      const quaternion = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rotation.x, rotation.y, rotation.z, 'XYZ')
      )
      return {
        position: new THREE.Vector3(viewer.position.x, viewer.position.y, viewer.position.z),
        quaternion,
        pivot: new THREE.Vector3(viewer.target.x, viewer.target.y, viewer.target.z),
        rotation: { ...rotation }
      }
    }
    orbit.update()
    camera.updateMatrixWorld(true)
    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'XYZ')
    return {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      pivot: orbit.target.clone(),
      rotation: { x: euler.x, y: euler.y, z: euler.z }
    }
  }

  function setObjectWorldPositionRotation(
    id: string,
    worldPos: THREE.Vector3,
    worldQuat: THREE.Quaternion | null
  ): boolean {
    if (isObjectLocked(id) || isStageCameraId(id)) return false
    const mesh = objectMeshes.get(id)
    if (!mesh || !scene) return false
    mesh.updateWorldMatrix(true, false)
    const parent = mesh.parent
    if (!worldQuat) {
      if (parent && parent !== scene) {
        parent.updateWorldMatrix(true, false)
        mesh.position.copy(parent.worldToLocal(worldPos.clone()))
      } else {
        mesh.position.copy(worldPos)
      }
      writeLocalTransformFromMesh(id, mesh)
      if (selectionHelper && selectedObjectId.value === id) selectionHelper.update()
      return true
    }
    if (parent && parent !== scene) {
      parent.updateWorldMatrix(true, false)
      const parentInv = parent.matrixWorld.clone().invert()
      const worldScale = new THREE.Vector3()
      mesh.getWorldScale(worldScale)
      const worldMat = new THREE.Matrix4().compose(worldPos, worldQuat, worldScale)
      const localMat = parentInv.multiply(worldMat)
      const pos = new THREE.Vector3()
      const quat = new THREE.Quaternion()
      const scl = new THREE.Vector3()
      localMat.decompose(pos, quat, scl)
      mesh.position.copy(pos)
      mesh.setRotationFromQuaternion(quat)
    } else {
      mesh.position.copy(worldPos)
      mesh.setRotationFromQuaternion(worldQuat)
    }
    writeLocalTransformFromMesh(id, mesh)
    if (selectionHelper && selectedObjectId.value === id) selectionHelper.update()
    return true
  }

  function lookTargetFromPose(
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
    distance = 5
  ): THREE.Vector3 {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion)
    return position.clone().addScaledVector(forward, distance)
  }

  function applyCameraViewerPose(
    id: string,
    position: THREE.Vector3,
    rotation: { x: number; y: number; z: number },
    quaternion: THREE.Quaternion,
    options?: { keepRotation?: boolean }
  ): boolean {
    const cameraState = getCameraState(id)
    if (!cameraState || cameraState.locked) return false
    const nextRotation = options?.keepRotation
      ? (cameraState.viewer.rotation ??
        directorViewerRotationFromLook(cameraState.viewer.position, cameraState.viewer.target))
      : rotation
    const quat = options?.keepRotation
      ? new THREE.Quaternion().setFromEuler(
          new THREE.Euler(nextRotation.x, nextRotation.y, nextRotation.z, 'XYZ')
        )
      : quaternion
    const lookDist = Math.max(
      0.5,
      new THREE.Vector3(
        cameraState.viewer.target.x - cameraState.viewer.position.x,
        cameraState.viewer.target.y - cameraState.viewer.position.y,
        cameraState.viewer.target.z - cameraState.viewer.position.z
      ).length() || 5
    )
    const target = lookTargetFromPose(position, quat, lookDist)
    updateCamera(id, {
      viewer: {
        ...cameraState.viewer,
        position: { x: position.x, y: position.y, z: position.z },
        rotation: { ...nextRotation },
        target: { x: target.x, y: target.y, z: target.z }
      }
    })
    return true
  }

  /** Unity: Move To View ??????????????????*/
  function moveSelectionToView(ids?: string[]): void {
    const pose = readViewWorldPose()
    if (!pose) return
    let changed = false
    for (const id of resolveActionIds(ids)) {
      if (isStageCameraId(id)) {
        if (
          applyCameraViewerPose(id, pose.pivot, pose.rotation, pose.quaternion, {
            keepRotation: true
          })
        ) {
          changed = true
        }
        continue
      }
      if (setObjectWorldPositionRotation(id, pose.pivot, null)) changed = true
    }
    if (!changed) return
    syncShotVisuals()
    applySelectionToScene()
    previewRevision.value += 1
    requestRender()
    schedulePersist()
  }

  /** Unity: Align With View ??????????????????*/
  function alignSelectionWithView(ids?: string[]): void {
    const pose = readViewWorldPose()
    if (!pose) return
    let changed = false
    for (const id of resolveActionIds(ids)) {
      if (isStageCameraId(id)) {
        if (applyCameraViewerPose(id, pose.position, pose.rotation, pose.quaternion)) {
          changed = true
        }
        continue
      }
      if (setObjectWorldPositionRotation(id, pose.position, pose.quaternion)) changed = true
    }
    if (!changed) return
    if (viewMode.value === 'camera') applyCameraView()
    syncShotVisuals()
    applySelectionToScene()
    previewRevision.value += 1
    requestRender()
    schedulePersist()
  }

  /** Unity: Align View to Selected ?????????????/????*/
  function alignViewToSelected(id?: string): void {
    if (!camera || !orbit) return
    const targetId = id ?? resolveActionIds()[0]
    if (!targetId) return

    if (viewMode.value !== 'director') {
      viewMode.value = 'director'
      orbit.enabled = true
    }

    if (isStageCameraId(targetId)) {
      const cameraState = getCameraState(targetId)
      if (!cameraState) return
      const viewer = cameraState.viewer
      const rotation =
        viewer.rotation ?? directorViewerRotationFromLook(viewer.position, viewer.target)
      camera.position.set(viewer.position.x, viewer.position.y, viewer.position.z)
      camera.rotation.set(rotation.x, rotation.y, rotation.z, 'XYZ')
      orbit.target.set(viewer.target.x, viewer.target.y, viewer.target.z)
      orbit.update()
      syncShotVisuals()
      applySelectionToScene()
      requestRender()
      return
    }

    const mesh = objectMeshes.get(targetId)
    if (!mesh) return
    mesh.updateWorldMatrix(true, false)
    const worldPos = new THREE.Vector3()
    const worldQuat = new THREE.Quaternion()
    mesh.getWorldPosition(worldPos)
    mesh.getWorldQuaternion(worldQuat)
    camera.position.copy(worldPos)
    camera.quaternion.copy(worldQuat)
    const target = lookTargetFromPose(worldPos, worldQuat, 5)
    orbit.target.copy(target)
    orbit.update()
    syncShotVisuals()
    applySelectionToScene()
    requestRender()
  }

  function setMode(mode: TransformMode): void {
    transformMode.value = mode
    if (transform) transform.setMode(mode)
    schedulePersist()
  }

  function setAspectRatio(ratio: DirectorAspectRatio): void {
    aspectRatio.value = normalizeDirectorAspectRatio(ratio)
    resize()
    schedulePersist()
    requestRender()
  }

  function resetViewer(): void {
    const active = activeCameraState()
    if (active.locked) return
    updateCamera(active.id, { viewer: createDefaultDirectorViewer() })
    syncShotVisuals()
    previewRevision.value += 1
    requestRender()
    schedulePersist()
    if (viewMode.value === 'camera') applyCameraView()
    if (viewMode.value === 'director') frameShotCameraInDirectorView()
  }

  /** ?? Gizmo???????????????? orbit ?? */
  function setViewOrientation(axis: 'x' | '-x' | 'y' | '-y' | 'z' | '-z'): void {
    if (!camera || !orbit) return
    if (viewMode.value !== 'director') {
      viewMode.value = 'director'
      orbit.enabled = true
    }
    const target = orbit.target.clone()
    let dist = camera.position.distanceTo(target)
    if (!Number.isFinite(dist) || dist < 0.2) dist = 5
    const offset = new THREE.Vector3()
    switch (axis) {
      case 'x':
        offset.set(dist, 0, 0)
        break
      case '-x':
        offset.set(-dist, 0, 0)
        break
      case 'y':
        offset.set(0, dist, 0)
        break
      case '-y':
        offset.set(0, -dist, 0)
        break
      case 'z':
        offset.set(0, 0, dist)
        break
      case '-z':
        offset.set(0, 0, -dist)
        break
    }
    camera.position.copy(target).add(offset)
    if (axis === 'y') camera.up.set(0, 0, -1)
    else if (axis === '-y') camera.up.set(0, 0, 1)
    else camera.up.set(0, 1, 0)
    camera.lookAt(target)
    orbit.target.copy(target)
    orbit.update()
    syncShotVisuals()
    requestRender(400)
  }

  function parseColor(c?: string): number {
    if (!c) return 0x888888
    const hex = c.startsWith('#') ? c.slice(1) : c
    const n = Number.parseInt(hex, 16)
    return Number.isFinite(n) ? n : 0x888888
  }

  function makeCharacter(name: string, color: number): THREE.Group {
    const g = new THREE.Group()
    const bodyMat = new THREE.MeshStandardMaterial({ color })
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.0, 8, 16), bodyMat)
    body.position.y = 1.0
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 16), bodyMat)
    head.position.y = 1.85
    g.add(body, head)
    g.name = name
    return g
  }

  function makeProp(name: string, color: number): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.8, 0.8),
      new THREE.MeshStandardMaterial({ color })
    )
    mesh.position.y = 0.4
    mesh.name = name
    return mesh
  }

  function makeWedgeGeometry(): THREE.BufferGeometry {
    const shape = new THREE.Shape()
    shape.moveTo(-0.5, -0.5)
    shape.lineTo(0.5, -0.5)
    shape.lineTo(-0.5, 0.5)
    shape.closePath()
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, steps: 1 })
    geo.translate(0, 0, -0.5)
    geo.computeVertexNormals()
    return geo
  }

  function makeHemisphereGeometry(): THREE.BufferGeometry {
    const geo = new THREE.SphereGeometry(0.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2)
    geo.translate(0, -0.25, 0)
    return geo
  }

  function makeHorizontalCircleGeometry(innerRadius: number, outerRadius: number): THREE.BufferGeometry {
    const geo =
      innerRadius > 0
        ? new THREE.RingGeometry(innerRadius, outerRadius, 32)
        : new THREE.CircleGeometry(outerRadius, 32)
    geo.rotateX(-Math.PI / 2)
    return geo
  }

  function makeArchGeometry(): THREE.BufferGeometry {
    const radius = 0.5
    const halfThick = 0.08
    const halfDepth = 0.16
    const path = new (class extends THREE.Curve<THREE.Vector3> {
      getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
        const a = Math.PI * t
        return target.set(Math.cos(a) * radius, Math.sin(a) * radius, 0)
      }
    })()
    const profile = new THREE.Shape()
    profile.moveTo(-halfThick, -halfDepth)
    profile.lineTo(halfThick, -halfDepth)
    profile.lineTo(halfThick, halfDepth)
    profile.lineTo(-halfThick, halfDepth)
    profile.closePath()
    const geo = new THREE.ExtrudeGeometry(profile, {
      steps: 24,
      bevelEnabled: false,
      extrudePath: path
    })
    geo.computeBoundingBox()
    const center = geo.boundingBox?.getCenter(new THREE.Vector3())
    if (center) geo.translate(-center.x, -center.y, -center.z)
    geo.computeVertexNormals()
    return geo
  }

  function makePointedArchGeometry(): THREE.BufferGeometry {
    const spanHalf = 0.5
    const radius = spanHalf * 2
    const halfThick = 0.08
    const halfDepth = 0.16
    const path = new (class extends THREE.Curve<THREE.Vector3> {
      getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
        const s = Math.min(1, Math.max(0, t))
        let cx: number
        let angle: number
        if (s <= 0.5) {
          const u = s / 0.5
          cx = spanHalf
          angle = Math.PI - (Math.PI / 3) * u
        } else {
          const u = (s - 0.5) / 0.5
          cx = -spanHalf
          angle = Math.PI / 3 - (Math.PI / 3) * u
        }
        return target.set(cx + Math.cos(angle) * radius, Math.sin(angle) * radius, 0)
      }
    })()
    const profile = new THREE.Shape()
    profile.moveTo(-halfThick, -halfDepth)
    profile.lineTo(halfThick, -halfDepth)
    profile.lineTo(halfThick, halfDepth)
    profile.lineTo(-halfThick, halfDepth)
    profile.closePath()
    const geo = new THREE.ExtrudeGeometry(profile, {
      steps: 24,
      bevelEnabled: false,
      extrudePath: path
    })
    geo.computeBoundingBox()
    const center = geo.boundingBox?.getCenter(new THREE.Vector3())
    if (center) geo.translate(-center.x, -center.y, -center.z)
    geo.computeVertexNormals()
    return geo
  }

  function makeCrossGeometry(): THREE.BufferGeometry {
    const arm = 0.18
    const half = 0.5
    const barHalf = 0.25
    const barBottom = 0.16
    const barTop = 0.34
    const depth = 0.18
    const shape = new THREE.Shape()
    shape.moveTo(-arm / 2, -half)
    shape.lineTo(arm / 2, -half)
    shape.lineTo(arm / 2, barBottom)
    shape.lineTo(barHalf, barBottom)
    shape.lineTo(barHalf, barTop)
    shape.lineTo(arm / 2, barTop)
    shape.lineTo(arm / 2, half)
    shape.lineTo(-arm / 2, half)
    shape.lineTo(-arm / 2, barTop)
    shape.lineTo(-barHalf, barTop)
    shape.lineTo(-barHalf, barBottom)
    shape.lineTo(-arm / 2, barBottom)
    shape.closePath()
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 })
    geo.translate(0, 0, -depth / 2)
    geo.computeVertexNormals()
    return geo
  }

  function makeTubeGeometry(): THREE.BufferGeometry {
    const inner = 0.32
    const outer = 0.5
    const half = 0.5
    const pts = [
      new THREE.Vector2(inner, -half),
      new THREE.Vector2(outer, -half),
      new THREE.Vector2(outer, half),
      new THREE.Vector2(inner, half)
    ]
    return new THREE.LatheGeometry(pts, 32)
  }

  function makePrimitive(name: string, primitive: StagePrimitive, color: number): THREE.Object3D {
    const twoSided =
      primitive === 'plane' ||
      primitive === 'quad' ||
      primitive === 'disc' ||
      primitive === 'ring' ||
      primitive === 'tube'
    const mat = new THREE.MeshStandardMaterial({
      color,
      side: twoSided ? THREE.DoubleSide : THREE.FrontSide
    })
    let mesh: THREE.Mesh
    switch (primitive) {
      case 'sphere':
        mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 16), mat)
        break
      case 'capsule':
        mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1, 8, 16), mat)
        break
      case 'cylinder':
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 48), mat)
        break
      case 'cone':
        mesh = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 48), mat)
        break
      case 'pyramid':
        mesh = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 4), mat)
        break
      case 'hemisphere':
        mesh = new THREE.Mesh(makeHemisphereGeometry(), mat)
        break
      case 'torus':
        mesh = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.12, 24, 48), mat)
        break
      case 'arch':
        mesh = new THREE.Mesh(makeArchGeometry(), mat)
        break
      case 'pointedArch':
        mesh = new THREE.Mesh(makePointedArchGeometry(), mat)
        break
      case 'cross':
        mesh = new THREE.Mesh(makeCrossGeometry(), mat)
        break
      case 'tube':
        mesh = new THREE.Mesh(makeTubeGeometry(), mat)
        break
      case 'prism':
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 6), mat)
        break
      case 'tetrahedron':
        mesh = new THREE.Mesh(new THREE.TetrahedronGeometry(0.6), mat)
        break
      case 'octahedron':
        mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), mat)
        break
      case 'icosphere':
        mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), mat)
        break
      case 'wedge':
        mesh = new THREE.Mesh(makeWedgeGeometry(), mat)
        break
      case 'disc':
        mesh = new THREE.Mesh(makeHorizontalCircleGeometry(0, 0.5), mat)
        break
      case 'ring':
        mesh = new THREE.Mesh(makeHorizontalCircleGeometry(0.28, 0.5), mat)
        break
      case 'plane':
        mesh = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), mat)
        break
      case 'quad':
        mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
        break
      case 'box':
      default:
        mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat)
        break
    }
    mesh.name = name
    return mesh
  }

  async function buildMeshForObject(
    obj: StageObjectState
  ): Promise<{ mesh: THREE.Object3D; clips: THREE.AnimationClip[] }> {
    if (obj.kind === 'empty') {
      const g = new THREE.Group()
      g.name = obj.name
      return { mesh: g, clips: [] }
    }
    if (obj.kind === 'model' && (obj.modelAssetId || obj.modelRelativePath)) {
      const modelAsset = obj.modelAssetId
        ? project.assets.find((a) => a.id === obj.modelAssetId)
        : undefined
      // 资产库查不到（Cache 产物）时回退到物化路径
      const rel = modelAsset?.relativePath?.trim() || obj.modelRelativePath?.trim()
      if (rel) {
        try {
          const url = await window.studio.getAssetFileUrl(rel)
          const loaded = await loadModelScene(url, rel)
          const root = loaded.scene
          root.name = obj.name
          instantiateObjectMaterials(root)
          // ??????????????????????????????
          const assetColor = readModelAssetColor(modelAsset?.genParams)
          if (obj.color && (!assetColor || obj.color.toLowerCase() !== assetColor.toLowerCase())) {
            applyObjectColor(root, obj.color)
          }
          return { mesh: root, clips: loaded.animations.slice() }
        } catch (err) {
          // 模型加载失败会退化为占位方块，这里把真实原因打到控制台便于排查
          console.warn('[director-stage] 模型加载失败，已用占位方块替代:', rel, err)
        }
      }
    }
    const color = parseColor(obj.color)
    if (obj.kind === 'primitive' && obj.primitive) {
      return { mesh: makePrimitive(obj.name, obj.primitive, color), clips: [] }
    }
    if (obj.kind === 'character') return { mesh: makeCharacter(obj.name, color), clips: [] }
    return { mesh: makeProp(obj.name, color), clips: [] }
  }

  function disposeObject(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose())
        else child.material.dispose()
      }
    })
  }

  function applyObjectHierarchy(): void {
    const root = getStageRoot()
    if (!root) return
    const objects = stage.value.objects
    for (const obj of objects) {
      const mesh = objectMeshes.get(obj.id)
      if (!mesh) continue
      const parentId =
        obj.parentId && objects.some((item) => item.id === obj.parentId) ? obj.parentId : null
      const parentMesh = parentId ? objectMeshes.get(parentId) : null
      const host = parentMesh ?? root
      if (mesh.parent !== host) host.add(mesh)
      mesh.visible = obj.visible !== false
      syncObjectNameLabel(obj, mesh)
    }
  }

  async function rebuildObjects(): Promise<void> {
    const root = getStageRoot()
    if (!root) return
    const generation = ++rebuildGeneration
    const host = root
    clearSelectionHelper()
    clearLabels()
    clearAllSkeletonRuntimes()
    clearBonePoseOffsetCache()
    bindPoseSnapshots.clear()
    ikChainsByObject.clear()
    for (const [id, mesh] of objectMeshes) {
      mesh.removeFromParent()
      disposeObject(mesh)
      disposeObjectOverrideTextures(id, true)
    }
    objectMeshes.clear()
    transform?.detach()

    const snapshot = stage.value.objects.slice()
    for (const obj of snapshot) {
      if (generation !== rebuildGeneration || getStageRoot() !== host) return
      const { mesh, clips } = await buildMeshForObject(obj)
      // await ??????????rebuild??????mesh
      if (generation !== rebuildGeneration || getStageRoot() !== host) {
        disposeObject(mesh)
        return
      }
      mesh.userData.stageId = obj.id
      applyTransform(mesh, obj)
      mesh.visible = obj.visible !== false
      attachObjectNameLabel(obj, mesh)
      objectMeshes.set(obj.id, mesh)
      applyObjectTextureOverrides(obj.id, obj)
      registerSkeletonRuntime(obj.id, mesh, clips)
      // ??????? bind ?? TRS????????????????? SET?
      snapshotObjectBindPose(obj.id, mesh)
    }

    if (generation !== rebuildGeneration || getStageRoot() !== host) return
    applyObjectHierarchy()
    await hydrateExternalSkeletonAssets()
    if (generation !== rebuildGeneration || getStageRoot() !== host) return
    if (
      selectionKind.value === 'object' &&
      selectedObjectId.value &&
      !objectMeshes.has(selectedObjectId.value)
    ) {
      selectedObjectId.value = null
      selectionKind.value = null
      syncEditorStageSelection()
    }
    applySelectionToScene()
    if (stageEditMode.value === 'animation') {
      applyAnimationAtTime(animTime.value, false)
    } else {
      applyAllBonePoses()
    }
    // ???? overlay ?? mesh ?????
    if (poseSkeletonOverlay?.getTargetObjectId()) {
      const poseId = poseSkeletonOverlay.getTargetObjectId()
      setPoseSkeletonVisible(poseId)
    }
    previewRevision.value += 1
  }

  function disposePanoramaSphere(): void {
    if (panoramaSphere && contentRoot) {
      contentRoot.remove(panoramaSphere)
      panoramaSphere.geometry.dispose()
      ;(panoramaSphere.material as THREE.Material).dispose()
      panoramaSphere = null
    }
    panoramaTexture?.dispose()
    panoramaTexture = null
  }

  async function createPanoramaSphere(url: string): Promise<void> {
    if (!contentRoot) return
    panoramaTexture = await new Promise<THREE.Texture>((resolve, reject) => {
      new THREE.TextureLoader().load(url, resolve, undefined, reject)
    })
    panoramaTexture.colorSpace = THREE.SRGBColorSpace
    const geo = new THREE.SphereGeometry(currentPanoramaRadius(), 64, 40)
    geo.scale(-1, 1, 1)
    panoramaSphere = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        map: panoramaTexture,
        depthWrite: false
      })
    )
    panoramaSphere.renderOrder = -1
    panoramaSphere.userData.stagePanorama = true
    contentRoot.add(panoramaSphere)
    applyPanoramaVisuals()
    syncCameraClipPlanes()
  }

  async function loadPanoramaFromUrl(url: string): Promise<void> {
    if (!scene || !contentRoot || !url) return
    disposePanoramaSphere()
    try {
      await createPanoramaSphere(url)
    } catch (e) {
      error.value = e instanceof Error ? e.message : t('director.error.panoramaLoad')
      applyBorderlessStyle(false)
    } finally {
      previewRevision.value += 1
      requestRender()
    }
  }

  async function loadPanorama(panoramaAssetId: string | null): Promise<void> {
    if (!scene || !contentRoot) return
    disposePanoramaSphere()

    if (!panoramaAssetId) {
      applyBorderlessStyle(false)
      syncCameraClipPlanes()
      previewRevision.value += 1
      requestRender()
      return
    }
    const sceneAsset = project.assets.find((a) => a.id === panoramaAssetId)
    if (!sceneAsset?.relativePath) {
      applyBorderlessStyle(false)
      previewRevision.value += 1
      requestRender()
      return
    }

    try {
      const url = await window.studio.getAssetFileUrl(sceneAsset.relativePath)
      await createPanoramaSphere(url)
    } catch (e) {
      error.value = e instanceof Error ? e.message : t('director.error.panoramaLoad')
      applyBorderlessStyle(false)
    } finally {
      previewRevision.value += 1
      requestRender()
    }
  }

  interface IncomingPanoramaImage {
    key: string
    url: string
    assetId: string
  }

  async function resolveIncomingPanoramaImage(): Promise<IncomingPanoramaImage | null> {
    const nodeId = boundProcessingNodeId()
    if (!nodeId) return null
    const doc = graphEditorHosts.getDocument(graphHostId.value)
    if (!doc) return null
    const edge = (doc.edges ?? []).find(
      (item) => item.target === nodeId && (item.targetPort ?? 'in') === 'in-panorama'
    )
    if (!edge) return null
    const source = (doc.nodes ?? []).find((item) => item.id === edge.source)
    if (!source) return null

    const runOut = doc.runStates?.[source.id]?.outputs?.out
    if (runOut?.kind === 'asset' && runOut.assetType === 'image' && runOut.assetId) {
      return { key: `asset:${runOut.assetId}`, url: '', assetId: runOut.assetId }
    }
    for (const item of flattenImagesValues(runOut ? [runOut] : [])) {
      if (item.dataUrl?.trim()) {
        return { key: `data:${item.dataUrl.slice(-192)}`, url: item.dataUrl, assetId: '' }
      }
      const path = item.relativePath?.trim()
      if (path) {
        try {
          return { key: `path:${path}`, url: await resolveAssetFileUrl(path), assetId: '' }
        } catch {
          // ignore unreadable relative path and keep scanning
        }
      }
    }
    if (source.params.previewDataUrl?.trim()) {
      const dataUrl = source.params.previewDataUrl.trim()
      return { key: `data:${dataUrl.slice(-192)}`, url: dataUrl, assetId: '' }
    }
    const previewPath = source.params.previewRelativePath?.trim()
    if (previewPath) {
      try {
        return { key: `path:${previewPath}`, url: await resolveAssetFileUrl(previewPath), assetId: '' }
      } catch {
        // ignore
      }
    }
    if (source.assetType === 'image' && source.assetId) {
      return { key: `asset:${source.assetId}`, url: '', assetId: source.assetId }
    }
    return null
  }

  let appliedIncomingPanoramaKey = ''

  async function syncIncomingPanorama(): Promise<void> {
    const incoming = await resolveIncomingPanoramaImage()
    if (!incoming) {
      appliedIncomingPanoramaKey = ''
      await loadPanorama(linkedPanoramaId.value)
      return
    }
    if (incoming.key !== appliedIncomingPanoramaKey) {
      appliedIncomingPanoramaKey = incoming.key
      if (incoming.assetId) linkedPanoramaId.value = incoming.assetId
    }
    if (incoming.assetId) {
      await loadPanorama(incoming.assetId)
    } else if (incoming.url) {
      await loadPanoramaFromUrl(incoming.url)
    } else {
      await loadPanorama(linkedPanoramaId.value)
    }
  }

  interface IncomingModelInfo {
    assetId: string
    /** Cache 产物不入资产库，实例化需要物化路径 */
    relativePath?: string
    name?: string
  }

  /**
   * 解析导演台节点 `in-model` 端口连接的上游 3D 模型。
   * 优先取上游节点的已物化模型输出（runStates.out），其次取模型引用节点自身的 assetId。
   */
  async function resolveIncomingModel(): Promise<IncomingModelInfo | null> {
    const nodeId = boundProcessingNodeId()
    if (!nodeId) return null
    const doc = graphEditorHosts.getDocument(graphHostId.value)
    if (!doc) return null
    const edge = (doc.edges ?? []).find(
      (item) => item.target === nodeId && (item.targetPort ?? 'in') === 'in-model'
    )
    if (!edge) return null
    const source = (doc.nodes ?? []).find((item) => item.id === edge.source)
    if (!source) return null

    const fromValue = (value: GraphValue): IncomingModelInfo | null => {
      if (value.kind !== 'asset' || value.assetType !== 'model' || !value.assetId) return null
      return {
        assetId: value.assetId,
        ...(value.relativePath?.trim() ? { relativePath: value.relativePath.trim() } : {}),
        ...(value.title?.trim() ? { name: value.title.trim() } : {})
      }
    }
    const runOut = doc.runStates?.[source.id]?.outputs?.out
    const direct = runOut ? fromValue(runOut) : null
    if (direct) return direct
    for (const item of flattenAssetValues(runOut ? [runOut] : [])) {
      const info = fromValue(item)
      if (info) return info
    }
    if (source.assetType === 'model' && source.assetId) {
      return { assetId: source.assetId }
    }
    return null
  }

  let appliedIncomingModelKey = ''

  /** dive 进入导演台时，把 `in-model` 端口的 3D 模型自动实例化到舞台模型列表（去重）。 */
  async function syncIncomingModel(): Promise<void> {
    const incoming = await resolveIncomingModel()
    if (!incoming) {
      appliedIncomingModelKey = ''
      return
    }
    if (incoming.assetId === appliedIncomingModelKey) return
    appliedIncomingModelKey = incoming.assetId
    const existing = stage.value.objects.find(
      (o) => o.kind === 'model' && o.modelAssetId === incoming.assetId
    )
    if (existing) {
      // 旧数据可能丢了物化路径（Cache 产物查不到资产），补回后才不会退化成占位方块
      if (incoming.relativePath && !existing.modelRelativePath?.trim()) {
        stage.value.objects = stage.value.objects.map((o) =>
          o.id === existing.id ? { ...o, modelRelativePath: incoming.relativePath } : o
        )
        schedulePersist()
        await rebuildObjects()
      }
      return
    }
    await createModelObject(incoming.assetId, null, undefined, {
      relativePath: incoming.relativePath,
      name: incoming.name
    })
  }

  function clearFlyKeys(): void {
    flyKeys.forward = false
    flyKeys.back = false
    flyKeys.left = false
    flyKeys.right = false
    flyKeys.up = false
    flyKeys.down = false
    flyKeys.boost = false
  }

  function syncOrbitTargetFromCamera(): void {
    if (!camera || !orbit) return
    camera.getWorldDirection(flyForward)
    if (flyForward.lengthSq() < 1e-8) flyForward.set(0, 0, -1)
    orbit.target.copy(camera.position).addScaledVector(flyForward, FLY_ORBIT_TARGET_DIST)
  }

  function beginFlyNavigate(e: PointerEvent): boolean {
    if (!camera || !renderer) return false
    if (viewMode.value !== 'director') return false
    if (pathDrawMode.value) return false
    if (transform?.dragging || poseBoneTransform?.dragging) return false
    flyNavigateActive = true
    isOrbiting.value = true
    flyLastClientX = e.clientX
    flyLastClientY = e.clientY
    flyEuler.setFromQuaternion(camera.quaternion)
    clearFlyKeys()
    if (orbit) orbit.enabled = false
    try {
      renderer.domElement.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    requestRender(500)
    return true
  }

  function endFlyNavigate(e?: PointerEvent): void {
    if (!flyNavigateActive) return
    flyNavigateActive = false
    clearFlyKeys()
    isOrbiting.value = false
    if (e && renderer) {
      try {
        renderer.domElement.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    }
    syncOrbitTargetFromCamera()
    if (orbit && viewMode.value === 'director' && !transform?.dragging && !poseBoneTransform?.dragging) {
      orbit.enabled = true
    }
    syncShotVisuals()
    requestRender()
  }

  function applyFlyLook(dx: number, dy: number): void {
    if (!camera || (!dx && !dy)) return
    flyEuler.setFromQuaternion(camera.quaternion)
    flyEuler.y -= dx * FLY_LOOK_SPEED
    flyEuler.x -= dy * FLY_LOOK_SPEED
    const limit = Math.PI / 2 - 0.01
    flyEuler.x = Math.max(-limit, Math.min(limit, flyEuler.x))
    camera.quaternion.setFromEuler(flyEuler)
    requestRender()
  }

  function tickFlyNavigate(deltaSeconds: number): boolean {
    if (!flyNavigateActive || !camera) return false
    const speed =
      FLY_MOVE_SPEED * (flyKeys.boost ? FLY_BOOST_MULT : 1) * Math.max(0, Math.min(0.1, deltaSeconds))
    camera.getWorldDirection(flyForward)
    flyRight.crossVectors(flyForward, flyWorldUp)
    if (flyRight.lengthSq() < 1e-8) {
      flyRight.set(1, 0, 0).applyQuaternion(camera.quaternion)
    } else {
      flyRight.normalize()
    }
    flyMove.set(0, 0, 0)
    if (flyKeys.forward) flyMove.add(flyForward)
    if (flyKeys.back) flyMove.sub(flyForward)
    if (flyKeys.right) flyMove.sub(flyRight)
    if (flyKeys.left) flyMove.add(flyRight)
    if (flyKeys.up) flyMove.add(flyWorldUp)
    if (flyKeys.down) flyMove.sub(flyWorldUp)
    if (flyMove.lengthSq() < 1e-8) return true
    flyMove.normalize().multiplyScalar(speed)
    camera.position.add(flyMove)
    return true
  }

  function handleFlyKeyDown(e: KeyboardEvent): boolean {
    if (!flyNavigateActive || e.ctrlKey || e.metaKey || e.altKey) return false
    switch (e.code) {
      case 'KeyW':
        flyKeys.forward = true
        break
      case 'KeyS':
        flyKeys.back = true
        break
      case 'KeyA':
        flyKeys.left = true
        break
      case 'KeyD':
        flyKeys.right = true
        break
      case 'KeyQ':
        flyKeys.down = true
        break
      case 'KeyE':
        flyKeys.up = true
        break
      case 'ShiftLeft':
      case 'ShiftRight':
        flyKeys.boost = true
        break
      default:
        return false
    }
    e.preventDefault()
    requestRender(200)
    return true
  }

  function handleFlyKeyUp(e: KeyboardEvent): void {
    switch (e.code) {
      case 'KeyW':
        flyKeys.forward = false
        break
      case 'KeyS':
        flyKeys.back = false
        break
      case 'KeyA':
        flyKeys.left = false
        break
      case 'KeyD':
        flyKeys.right = false
        break
      case 'KeyQ':
        flyKeys.down = false
        break
      case 'KeyE':
        flyKeys.up = false
        break
      case 'ShiftLeft':
      case 'ShiftRight':
        flyKeys.boost = false
        break
      default:
        break
    }
  }

  function onContextMenu(e: Event): void {
    e.preventDefault()
  }

  function onWindowBlur(): void {
    endFlyNavigate()
  }

  /** 舞台撤销/重做：按舞台作用域处理，避免活动作用域被切走后 Ctrl+Z 找不到历史 */
  let stageUndoRetryTimer: ReturnType<typeof setTimeout> | null = null
  let stageUndoRetryCount = 0

  function cancelStageUndoRetry(): void {
    if (stageUndoRetryTimer) {
      clearTimeout(stageUndoRetryTimer)
      stageUndoRetryTimer = null
    }
    stageUndoRetryCount = 0
  }

  /** 有历史但撤销栈正被其他命令占用（如保存中）：稍后重试，最多约 2 秒 */
  function retryStageUndo(scope: string, redo: boolean): void {
    if (stageUndoRetryTimer) return
    stageUndoRetryTimer = setTimeout(() => {
      stageUndoRetryTimer = null
      const can = redo
        ? editor.commands.canRedoInScope(scope)
        : editor.commands.canUndoInScope(scope)
      if (can) {
        stageUndoRetryCount = 0
        void (redo
          ? editor.commands.redoInScope(scope)
          : editor.commands.undoInScope(scope))
        return
      }
      const has = redo
        ? editor.commands.hasRedoInScope(scope)
        : editor.commands.hasUndoInScope(scope)
      if (has && stageUndoRetryCount < 25) {
        stageUndoRetryCount += 1
        retryStageUndo(scope, redo)
      } else {
        stageUndoRetryCount = 0
      }
    }, 80)
  }

  function onStageUndoKeydown(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey
    if (!mod || e.altKey) return
    const target = e.target as HTMLElement | null
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
    const key = e.key.toLowerCase()
    const scope = `director-stage:${options.directorAssetId}`
    if (key === 'z' && !e.shiftKey) {
      if (editor.commands.canUndoInScope(scope)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        void editor.commands.undoInScope(scope)
      } else if (editor.commands.hasUndoInScope(scope)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        retryStageUndo(scope, false)
      }
      return
    }
    if (key === 'y' || (key === 'z' && e.shiftKey)) {
      if (editor.commands.canRedoInScope(scope)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        void editor.commands.redoInScope(scope)
      } else if (editor.commands.hasRedoInScope(scope)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        retryStageUndo(scope, true)
      }
    }
  }

  function onScenePick(): void {
    void loadPanorama(linkedPanoramaId.value)
    schedulePersist()
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Alt') {
      pathEditBreakHandles = true
    }
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      e.target instanceof HTMLSelectElement ||
      (e.target as HTMLElement | null)?.isContentEditable
    ) {
      return
    }
    if (handleFlyKeyDown(e)) return
    if (pathDrawMode.value) {
      if (e.code === 'Escape') {
        e.preventDefault()
        cancelPathDraw()
        return
      }
      if (e.code === 'Enter' && pathDrawMode.value.kind === 'pen' && pathDrawDraft.value.length >= 2) {
        e.preventDefault()
        commitPathDraw(pathDrawDraft.value)
        return
      }
    }
    if (e.code === 'Escape' && pathEditSelection) {
      e.preventDefault()
      pathEditSelection = null
      applySelectionToScene()
      requestRender()
      return
    }
    if (
      e.code === 'Space' &&
      stageEditMode.value === 'animation' &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      e.preventDefault()
      if (animPlaying.value) pauseAnimation()
      else playAnimation()
      return
    }
    if (e.code === 'KeyK' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      addAnimKeyframe()
      return
    }
    if ((e.code === 'Delete' || e.code === 'Backspace') && animSelectedKeyframeId.value) {
      e.preventDefault()
      removeAnimKeyframe()
      return
    }
    if (
      (e.code === 'Delete' || e.code === 'Backspace') &&
      animSelectedCameraCutSegmentId.value &&
      animSelectedTrackId.value
    ) {
      e.preventDefault()
      removeCameraCutSegment(animSelectedTrackId.value, animSelectedCameraCutSegmentId.value)
      return
    }
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.altKey && !e.shiftKey && e.code === 'KeyF') {
      e.preventDefault()
      moveSelectionToView()
      return
    }
    if (mod && e.shiftKey && !e.altKey && e.code === 'KeyF') {
      e.preventDefault()
      alignSelectionWithView()
      return
    }
    if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyC') {
      e.preventDefault()
      copyStageSelection()
      return
    }
    if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyV') {
      e.preventDefault()
      void pasteStageClipboard()
      return
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
      if (e.code === 'KeyQ') {
        e.preventDefault()
        setMode('translate')
        return
      }
      if (e.code === 'KeyR') {
        if (pathEditSelection) return
        e.preventDefault()
        setMode('rotate')
        return
      }
      if (e.code === 'KeyS') {
        if (pathEditSelection) return
        e.preventDefault()
        setMode('scale')
      }
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (e.key === 'Alt') {
      pathEditBreakHandles = false
    }
    handleFlyKeyUp(e)
  }

  function resize(): void {
    const el = options.viewportEl.value
    if (!el || !renderer || !camera) return
    const w = el.clientWidth
    const h = el.clientHeight
    if (w <= 0 || h <= 0) return
    renderer.setSize(w, h, false)
    labelRenderer?.setSize(w, h)
    syncPathLineResolution()
    // ??????????????????+ ?????????????????
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    syncShotVisuals()
  }

  /** ????????????????TransformControls ????*/
  function onPathDrawPointerDownCapture(e: PointerEvent): void {
    if (!pathDrawMode.value || e.button !== 0) return
    e.stopImmediatePropagation()
    handlePathDrawPointerDown(e)
  }

  function onPointerDown(e: PointerEvent): void {
    if (!camera || !scene || !renderer) return
    if (pathDrawMode.value) return
    // TransformControls ????????gizmo ????????
    if (transform?.dragging || transform?.axis) return
    if (poseBoneTransform?.dragging || poseBoneTransform?.axis) return
    if (e.button === 1) isPanning.value = true
    if (e.button === 2) {
      if (beginFlyNavigate(e)) return
      isOrbiting.value = true
      return
    }
    if (e.button !== 0) return
    if (viewMode.value === 'camera') return

    const rect = renderer.domElement.getBoundingClientRect()
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)

    if (isPoseEditActive() && poseSkeletonOverlay) {
      const joints = poseSkeletonOverlay.getJointMeshes()
      if (joints.length) {
        const jointHits = raycaster.intersectObjects(joints, false)
        if (jointHits.length) {
          const hit = jointHits[0].object
          const boneName =
            typeof hit.userData.poseBoneName === 'string'
              ? hit.userData.poseBoneName
              : hit.name.startsWith('pose-joint:')
                ? hit.name.slice('pose-joint:'.length)
                : null
          if (boneName) {
            setSelectedPoseBone(boneName)
            return
          }
        }
      }
      // ?????????????????????
      setSelectedPoseBone(null)
      return
    }

    const pickables: THREE.Object3D[] = []
    if (stageEditMode.value === 'animation') {
      if (pathEditPickables.length) pickables.push(...pathEditPickables)
      for (const line of pathVisuals.values()) pickables.push(line)
      raycaster.params.Line2 = { threshold: PATH_LINE2_PICK_THRESHOLD }
    }
    pickables.push(...objectMeshes.values())
    for (const viz of shotVisuals.values()) {
      if (viz.root.visible) pickables.push(viz.root)
      if (viz.body.visible) pickables.push(viz.body)
    }
    const hits = raycaster.intersectObjects(pickables, true)
    if (!hits.length) {
      selectScene()
      return
    }

    if (stageEditMode.value === 'animation') {
      const editHit = findPathEditHit(hits)
      if (editHit) {
        selectPathEditTarget(editHit)
        return
      }
      const pathTrackId = findPathLineHit(hits)
      if (pathTrackId) {
        pathEditSelection = null
        selectAnimTrack(pathTrackId)
        applySelectionToScene()
        return
      }
    }

    let obj: THREE.Object3D | null = hits[0].object
    while (obj && !obj.userData.stageId && !obj.userData.stageCameraId) obj = obj.parent
    if (typeof obj?.userData.stageCameraId === 'string') {
      if (stageEditMode.value === 'animation' && animSelectedTrackId.value) {
        animSelectedTrackId.value = null
        animSelectedKeyframeId.value = null
        clearPathEditOverlays()
        for (const track of stage.value.animation?.tracks ?? []) {
          syncPathVisual(track.id, track.path)
        }
      }
      selectCamera(obj.userData.stageCameraId)
      return
    }
    if (stageEditMode.value === 'animation' && animSelectedTrackId.value) {
      animSelectedTrackId.value = null
      animSelectedKeyframeId.value = null
      clearPathEditOverlays()
      for (const track of stage.value.animation?.tracks ?? []) {
        syncPathVisual(track.id, track.path)
      }
    }
    selectObject(typeof obj?.userData.stageId === 'string' ? obj.userData.stageId : null)
  }

  function onPointerMove(e: PointerEvent): void {
    if (flyNavigateActive) {
      const dx = e.clientX - flyLastClientX
      const dy = e.clientY - flyLastClientY
      flyLastClientX = e.clientX
      flyLastClientY = e.clientY
      applyFlyLook(dx, dy)
      return
    }
    handlePathDrawPointerMove(e)
  }

  function onPointerUp(e: PointerEvent): void {
    if (e.button === 1) isPanning.value = false
    if (e.button === 2) {
      if (flyNavigateActive) endFlyNavigate(e)
      else isOrbiting.value = false
    }
    handlePathDrawPointerUp(e)
  }

  function onPointerCancel(e: PointerEvent): void {
    if (e.button === 2 || flyNavigateActive) endFlyNavigate(e)
  }

  function initThree(): void {
    const el = options.viewportEl.value
    if (!el) return

    scene = new THREE.Scene()
    contentRoot = new THREE.Group()
    contentRoot.name = 'StageContent'
    scene.add(contentRoot)

    const viewer = activeCameraState().viewer
    camera = new THREE.PerspectiveCamera(
      viewer.fov ?? DEFAULT_DIRECTOR_CAMERA_FOV,
      1,
      0.1,
      currentPanoramaRadius() * DIRECTOR_CAMERA_FAR_RADIUS_MULTIPLIER
    )
    camera.position.set(viewer.position.x, viewer.position.y, viewer.position.z)

    renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    applyBorderlessStyle(false)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    el.appendChild(renderer.domElement)

    labelRenderer = new CSS2DRenderer()
    labelRenderer.setSize(el.clientWidth, el.clientHeight)
    labelRenderer.domElement.style.cssText =
      'position:absolute;inset:0;pointer-events:none;overflow:hidden;'
    el.appendChild(labelRenderer.domElement)

    orbit = new OrbitControls(camera, renderer.domElement)
    orbit.enableDamping = true
    orbit.enablePan = true
    orbit.screenSpacePanning = true
    // 最小缩放距离再缩小 10 倍：0.05 → 0.005，小模型也能推得更近
    orbit.minDistance = 0.005
    // 无全景时放开拉远上限；若后续加载全景，syncCameraClipPlanes 会收回到球体内
    orbit.maxDistance = currentPanoramaRadius() * DIRECTOR_MAX_ZOOMOUT_RADIUS_MULTIPLIER
    orbit.target.set(viewer.target.x, viewer.target.y, viewer.target.z)
    // ????????????????????
    orbit.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: null
    }
    orbit.addEventListener('start', () => {
      isOrbiting.value = true
    })
    orbit.addEventListener('end', () => {
      isPanning.value = false
      isOrbiting.value = false
      syncShotVisuals()
    })

    transform = new TransformControls(camera, renderer.domElement)
    transform.addEventListener('dragging-changed', (e) => {
      if (orbit && viewMode.value === 'director') orbit.enabled = !(e.value as boolean)
      if (pathEditSelection) {
        pathEditDragging = !!(e.value as boolean)
        if (e.value === false) {
          syncPathEditFromTransform(true)
          pathEditDragging = false
          previewRevision.value += 1
          requestRender()
          schedulePersist()
        }
        return
      }
      if (e.value === false) {
        syncSelectedFromTransform()
        previewRevision.value += 1
        requestRender()
        schedulePersist()
      }
    })
    transform.addEventListener('change', () => {
      if (suppressTransformEvent) return
      if (pathEditSelection && transform?.dragging) {
        syncPathEditFromTransform(false)
        requestRender()
        return
      }
      if (selectionHelper) selectionHelper.update()
      if (transform?.dragging) {
        if (selectionKind.value === 'camera') {
          syncSelectedFromTransform()
          requestRender()
        }
        return
      }
      syncSelectedFromTransform()
      previewRevision.value += 1
    })
    transformHelper = transform.getHelper()
    scene.add(transformHelper)

    poseBoneTransform = new TransformControls(camera, renderer.domElement)
    poseBoneTransform.setMode('rotate')
    poseBoneTransform.setSpace('local')
    poseBoneTransform.addEventListener('dragging-changed', (e) => {
      poseBoneDragging = !!(e.value as boolean)
      if (orbit && viewMode.value === 'director') orbit.enabled = !poseBoneDragging
      if (poseBoneDragging) {
        if (poseEditMode.value === 'fk') {
          const boneName = selectedPoseBone.value
          const bone = boneName ? poseSkeletonOverlay?.findBone(boneName) : null
          if (boneName && bone) beginPoseBoneDrag(boneName, bone)
        }
        requestRender()
        return
      }
      if (poseEditMode.value === 'ik') {
        bakeIkChainPose(true)
      } else {
        writePoseBoneOffsetFromGizmo(true)
      }
      requestRender()
    })
    poseBoneTransform.addEventListener('change', () => {
      if (suppressTransformEvent) return
      if (!poseBoneTransform?.dragging) return
      if (poseEditMode.value === 'ik') {
        applyIkSolveFromTarget()
        requestRender()
      } else {
        writePoseBoneOffsetFromGizmo(false)
      }
    })
    poseBoneTransformHelper = poseBoneTransform.getHelper()
    scene.add(poseBoneTransformHelper)

    rebuildGrid()

    syncShotVisuals()
    frameShotCameraInDirectorView()

    const hemi = new THREE.HemisphereLight(0xe8eef8, 0x3a3f48, 0.9)
    hemi.name = 'Default Hemisphere Light'
    contentRoot.add(hemi)
    contentRoot.add(new THREE.AmbientLight(0xffffff, 0.35))

    const lightDirection = directorViewerForwardFromRotation({
      x: THREE.MathUtils.degToRad(50),
      y: THREE.MathUtils.degToRad(-30),
      z: 0
    })
    const key = new THREE.DirectionalLight(0xffffff, 1.15)
    key.name = 'Default Directional Light'
    // DirectionalLight ?????? position ??target????????????????
    key.position.set(-lightDirection.x * 10, -lightDirection.y * 10, -lightDirection.z * 10)
    key.target.position.set(0, 0, 0)

    const fill = new THREE.DirectionalLight(0xdde6ff, 0.45)
    fill.name = 'Default Fill Light'
    fill.position.set(lightDirection.x * 8, Math.abs(lightDirection.y) * 4 + 2, lightDirection.z * 8)
    fill.target.position.set(0, 1, 0)
    contentRoot.add(key, key.target, fill, fill.target)
    applySceneWorldTransform()

    // ?????????????????? TransformControls ?????
    renderer.domElement.addEventListener('pointerdown', onPathDrawPointerDownCapture, true)
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    renderer.domElement.addEventListener('pointercancel', onPointerCancel)
    renderer.domElement.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keydown', onStageUndoKeydown, true)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onWindowBlur)

    resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(el)
    resize()
    syncAllPathVisuals()

    const loop = (now: number): void => {
      rafId = requestAnimationFrame(loop)
      if (offscreenCaptureLock > 0) return
      const deltaSeconds = lastFrameAt ? (now - lastFrameAt) / 1000 : 1 / 60
      lastFrameAt = now
      tickAnimation(deltaSeconds)
      const flyMoved = tickFlyNavigate(deltaSeconds)
      const controlsChanged =
        viewMode.value === 'director' && !flyNavigateActive ? (orbit?.update() ?? false) : false
      const interacting =
        controlsChanged ||
        flyMoved ||
        flyNavigateActive ||
        isPanning.value ||
        isOrbiting.value ||
        !!transform?.dragging ||
        !!poseBoneTransform?.dragging ||
        animPlaying.value ||
        !!pathDrawMode.value ||
        !!poseSkeletonOverlay?.getTargetObjectId() ||
        now < forceRenderUntil
      // ????????????????????????????15fps???????? UI ?? GPU??
      if (now - lastRenderAt < (interacting ? 16 : 66)) return
      lastRenderAt = now
      if (selectionHelper) selectionHelper.update()
      syncShotVisuals()
      if (poseBoneTransform?.dragging) syncPoseBoneGizmoSize()
      poseSkeletonOverlay?.update()
      if (renderer && scene && camera) {
        renderer.render(scene, camera)
        labelRenderer?.render(scene, camera)
      }
      refreshCameraPreviews()
    }
    rafId = requestAnimationFrame(loop)
  }

  function disposeThree(): void {
    rebuildGeneration += 1
    cancelAnimationFrame(rafId)
    resizeObserver?.disconnect()
    endFlyNavigate()
    renderer?.domElement.removeEventListener('pointerdown', onPathDrawPointerDownCapture, true)
    renderer?.domElement.removeEventListener('pointerdown', onPointerDown)
    renderer?.domElement.removeEventListener('pointermove', onPointerMove)
    renderer?.domElement.removeEventListener('pointerup', onPointerUp)
    renderer?.domElement.removeEventListener('pointercancel', onPointerCancel)
    renderer?.domElement.removeEventListener('contextmenu', onContextMenu)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keydown', onStageUndoKeydown, true)
    cancelStageUndoRetry()
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onWindowBlur)
    animPlaying.value = false
    cancelPathDraw()
    clearAllPathVisuals()
    clearAllSkeletonRuntimes()
    clearPoseSkeletonOverlay()
    clearSelectionHelper()
    clearLabels()
    for (const id of [...shotVisuals.keys()]) disposeShotCameraVisual(id)
    if (poseBoneTransformHelper && scene) scene.remove(poseBoneTransformHelper)
    poseBoneTransform?.dispose()
    poseBoneTransform = null
    poseBoneTransformHelper = null
    poseBoneDragging = false
    if (ikTarget && scene) scene.remove(ikTarget)
    ikTargetGeom?.dispose()
    ikTargetMat?.dispose()
    ikTarget = null
    ikTargetGeom = null
    ikTargetMat = null
    selectedIkChainId.value = null
    poseEditMode.value = 'fk'
    ikChainsByObject.clear()
    clearBonePoseOffsetCache()
    bindPoseSnapshots.clear()
    if (transformHelper && scene) scene.remove(transformHelper)
    transform?.dispose()
    transformHelper = null
    orbit?.dispose()
    for (const mesh of objectMeshes.values()) disposeObject(mesh)
    objectMeshes.clear()
    if (panoramaSphere) {
      contentRoot?.remove(panoramaSphere)
      panoramaSphere.geometry.dispose()
      ;(panoramaSphere.material as THREE.Material).dispose()
      panoramaSphere = null
    }
    panoramaTexture?.dispose()
    panoramaTexture = null
    if (grid) {
      contentRoot?.remove(grid)
      disposeGridHelper(grid)
      grid = null
    }
    cameraPreviewCanvases.clear()
    shotRenderTarget?.dispose()
    shotRenderTarget = null
    labelRenderer?.domElement.remove()
    labelRenderer = null
    renderer?.dispose()
    renderer?.domElement.remove()
    renderer = null
    contentRoot = null
    scene = null
    camera = null
  }

  function getViewer(): DirectorViewerState {
    return activeCameraState().viewer
  }

  /** ??????????????????????*/
  function getSharedScene(): THREE.Scene | null {
    return scene
  }

  /** ??/????? gizmo????????????? */
  function runWithoutStageGizmos(fn: () => void): void {
    const shotVis = [...shotVisuals.values()].map((viz) => ({
      viz,
      helper: viz.helper.visible,
      root: viz.root.visible,
      body: viz.body.visible
    }))
    const pathVis = [...pathVisuals.values()].map((line) => ({
      line,
      visible: line.visible
    }))
    const pathEditVis = [
      ...pathEditAnchorMeshes,
      ...pathEditHandleInMeshes,
      ...pathEditHandleOutMeshes,
      ...pathEditRodLines,
      ...pathDrawPointMarkers
    ].map((obj) => ({
      obj,
      visible: obj.visible
    }))
    const prevDraft = pathDraftLine?.visible ?? false
    const prevGuide = pathDrawGuide?.visible ?? false
    const prevSelection = selectionHelper?.visible ?? false
    const prevTransform = transformHelper?.visible ?? false
    const prevPoseBone = poseBoneTransformHelper?.visible ?? false
    const poseGroup = scene?.getObjectByName('pose-skeleton-overlay') ?? null
    const prevPose = poseGroup?.visible ?? false
    for (const { viz } of shotVis) {
      viz.helper.visible = false
      viz.root.visible = false
      viz.body.visible = false
    }
    for (const { line } of pathVis) line.visible = false
    for (const { obj } of pathEditVis) obj.visible = false
    if (pathDraftLine) pathDraftLine.visible = false
    if (pathDrawGuide) pathDrawGuide.visible = false
    if (selectionHelper) selectionHelper.visible = false
    if (transformHelper) transformHelper.visible = false
    if (poseBoneTransformHelper) poseBoneTransformHelper.visible = false
    if (poseGroup) poseGroup.visible = false
    try {
      fn()
    } finally {
      for (const { viz, helper, root, body } of shotVis) {
        viz.helper.visible = helper
        viz.root.visible = root
        viz.body.visible = body
      }
      for (const { line, visible } of pathVis) line.visible = visible
      for (const { obj, visible } of pathEditVis) obj.visible = visible
      if (pathDraftLine) pathDraftLine.visible = prevDraft
      if (pathDrawGuide) pathDrawGuide.visible = prevGuide
      if (selectionHelper) selectionHelper.visible = prevSelection
      if (transformHelper) transformHelper.visible = prevTransform
      if (poseBoneTransformHelper) poseBoneTransformHelper.visible = prevPoseBone
      if (poseGroup) poseGroup.visible = prevPose
    }
  }

  function renderSceneWithoutGizmos(
    targetRenderer: THREE.WebGLRenderer,
    cam: THREE.Camera
  ): void {
    if (!scene) return
    runWithoutStageGizmos(() => {
      targetRenderer.render(scene!, cam)
    })
  }

  function getMainRenderer(): THREE.WebGLRenderer | null {
    return renderer
  }

  watch(inputPanoramaAssets, () => {
    const id = linkedPanoramaId.value
    if (!id) return
    const asset = project.assets.find((item) => item.id === id)
    // ??????????????????????????
    if (asset && asset.type === 'image') return
    linkedPanoramaId.value = null
    void loadPanorama(null)
    schedulePersist()
  })

  watch(themePreference, () => {
    applyPanoramaVisuals()
    requestRender()
  })

  watch(
    () => stage.value.panoramaVisible,
    () => {
      applyPanoramaVisuals()
    }
  )

  watch(
    asset,
    async (a) => {
      if (!a || skipAssetWatch) return
      const graphJson = a.genParams?.graphJson
      const nodeId = boundProcessingNodeId()
      const processingNode = findDirectorProcessingNode(graphJson, nodeId)
      const resolved = resolveDirectorStageForNode(a.genParams, graphJson, nodeId)
      const map = readStagesByNodeId(a.genParams, graphJson)
      const forceReload =
        !!nodeId &&
        !map[nodeId] &&
        shouldResetDirectorStage(resolved.ownerProcessingNodeId ?? null, processingNode?.id ?? null)
      const nextFingerprint = fingerprintStage(resolved)
      // ????????????????????????????????????
      // ?????????GLTF ???????
      if (nextFingerprint === appliedStageFingerprint) return
      // ??????????????????????????????????????
      if (directorDocument.isDirty() && !forceReload) return
      appliedStageFingerprint = nextFingerprint
      const keepId = selectedObjectId.value
      const keepCameraId = selectedCameraId.value
      const keepKind = selectionKind.value
      stage.value = resolved
      const storedForNode = nodeId ? map[nodeId] : undefined
      if (!hasStoredCameraViewer(storedForNode)) {
        const graphViewer = directorProcessingNode()?.params.viewer
        if (graphViewer) {
          const active = activeCameraState()
          updateCamera(active.id, { viewer: graphViewer })
        }
      }
      linkedPanoramaId.value = stage.value.linkedPanoramaAssetId ?? null
      transformMode.value = stage.value.transformMode
      // ??????????? / ?? / ?? / ???
      if (keepKind === 'camera') {
        selectedObjectId.value = null
        selectedCameraId.value =
          keepCameraId && isStageCameraId(keepCameraId)
            ? keepCameraId
            : stage.value.activeCameraId ?? null
        selectionKind.value = selectedCameraId.value ? 'camera' : 'scene'
      } else if (
        keepKind === 'object' &&
        keepId &&
        stage.value.objects.some((o) => o.id === keepId)
      ) {
        selectedObjectId.value = keepId
        selectionKind.value = 'object'
      } else if (keepKind === 'scene' || keepKind === 'panorama') {
        selectedObjectId.value = null
        selectedCameraId.value = null
        selectionKind.value = keepKind
      } else {
        selectedObjectId.value = stage.value.selectedObjectId ?? null
        selectionKind.value = selectedObjectId.value ? 'object' : 'scene'
      }
      if (transform) transform.setMode(transformMode.value)
      if (camera && orbit) {
        if (viewMode.value === 'director') {
          frameShotCameraInDirectorView()
        } else {
          applyCameraView()
        }
      }
      syncShotVisuals()
      rebuildGrid()
      applySceneWorldTransform()
      syncCameraClipPlanes()
      syncAllPathVisuals()
      await syncIncomingPanorama()
      await syncIncomingModel()
      if (skipAssetWatch) return
      await rebuildObjects()
    },
    { immediate: true }
  )

  function mount(): void {
    const nodeId = boundProcessingNodeId()
    const map = readStagesByNodeId(asset.value?.genParams, asset.value?.genParams?.graphJson)
    const stored = nodeId ? map[nodeId] : undefined
    if (!hasStoredCameraViewer(stored)) {
      const graphViewer = directorProcessingNode()?.params.viewer
      if (graphViewer) {
        const active = activeCameraState()
        updateCamera(active.id, { viewer: graphViewer })
      }
    }
    initThree()
    if (transform) transform.setMode(transformMode.value)
    if (camera && orbit) {
      if (viewMode.value === 'director') frameShotCameraInDirectorView()
      else applyCameraView()
    }
    syncShotVisuals()
    rebuildGrid()
    applySceneWorldTransform()
    void syncIncomingPanorama()
    void syncIncomingModel()
    void rebuildObjects()
    selectScene()
  }

  function unmount(): void {
    // ??/?????????????????????
    flushPreview()
    if (!savedBeforeUnmount) {
      void persistStageNow().catch(() => {
        // persistStageNow ????error??????????????
      })
    }
    disposeThree()
  }

  onBeforeUnmount(() => {
    unmount()
  })

  return {
    error,
    stage,
    linkedPanoramaId,
    transformMode,
    selectedObjectId,
    selectedCameraId,
    selectionKind,
    selectedObject,
    viewMode,
    aspectRatio,
    previewRevision,
    isPanning,
    isOrbiting,
    inputPanoramaAssets,
    hierarchyItems,
    hierarchyRows,
    mount,
    unmount,
    flushPreview,
    saveNow,
    selectObject,
    selectCamera,
    selectScene,
    selectPanorama,
    selectHierarchyItem,
    focusHierarchyItem,
    updateSceneWorld,
    updateSkyColor,
    updatePanoramaVisible,
    updatePanoramaYaw,
    updatePanoramaRadius,
    updateGround,
    moveSelectionToView,
    alignSelectionWithView,
    alignViewToSelected,
    setMode,
    setAspectRatio,
    setViewMode,
    setViewer: setViewerFromInspector,
    applyCameraPreset,
    canApplyComboPresets,
    canApplyComboPreset,
    getViewer,
    updateObjectTransform,
    listObjectMaterialSlots,
    setObjectMaterialTexture,
    setObjectVisible,
    setObjectLocked,
    setObjectNameVisible,
    reparentObject,
    createEmptyObject,
    createCameraObject,
    createPrimitiveObject,
    createModelObject,
    canDeleteObject,
    removeObject,
    onScenePick,
    resetViewer,
    setViewOrientation,
    takeCameraShot,
    removeCameraShot,
    removeCameraVideo,
    mediaGallerySignal,
    openMediaGallery,
    renderCameraPreviewToCanvas,
    cameraPreviewOpen,
    cameraPreviewIds,
    cameraPreviewDetached,
    setCameraPreviewSelection,
    toggleCameraPreview,
    setCameraPreviewOpen,
    setCameraPreviewDetached,
    registerCameraPreviewCanvas,
    unregisterCameraPreviewCanvas,
    setMultiSelection,
    copyStageSelection,
    pasteStageClipboard,
    canPasteStageClipboard,
    removeObjectsWithUndo,
    getSharedScene,
    renderSceneWithoutGizmos,
    getMainRenderer,
    schedulePersist,
    setPoseSkeletonVisible,
    selectionBoundsVisible,
    setSelectionBoundsVisible,
    toggleSelectionBoundsVisible,
    gizmoSize,
    sceneLabelsVisible,
    cameraGizmosVisible,
    gridGizmoVisible,
    captureLabelsVisible,
    captureCameraLabelsVisible,
    setGizmoSize,
    setSceneLabelsVisible,
    setCameraGizmosVisible,
    setGridGizmoVisible,
    setCaptureLabelsVisible,
    setCaptureCameraLabelsVisible,
    objectSupportsPose,
    listObjectBones,
    listObjectBoneHierarchy,
    getObjectBonePoseDeg,
    setObjectBonePoseDeg,
    patchObjectBonePose,
    applyObjectBonePoseMap,
    setSelectedPoseBone,
    selectedPoseBone,
    poseEditMode,
    setPoseEditMode,
    selectedIkChainId,
    setSelectedIkChain,
    listObjectIkTargetSlots,
    setObjectIkChainEffector,
    listObjectPosePresets,
    applyObjectPosePreset,
    saveObjectPosePreset,
    removeObjectPosePreset,
    resetObjectBonePose,
    listPoseAssets,
    saveObjectPoseAsAsset,
    applyPoseAssetToObject,
    animPlaying,
    animTime,
    animPlaybackRate,
    animExporting,
    animSelectedTrackId,
    animSelectedKeyframeId,
    animSelectedSkeletonClipId,
    pathDrawMode,
    stageEditMode,
    setStageEditMode,
    ensureAnimation,
    addAnimTrack,
    removeAnimTrack,
    addCameraCutTrack,
    addCameraCutSegment,
    removeCameraCutSegment,
    setCameraCutSegmentRange,
    selectCameraCutSegment,
    animSelectedCameraCutSegmentId,
    selectAnimTrack,
    selectAnimKeyframe,
    addAnimKeyframe,
    removeAnimKeyframe,
    moveAnimKeyframe,
    getSelectedAnimKeyframe,
    setAnimKeyframeTransform,
    setAnimDuration,
    setAnimLoop,
    setAnimTrackRange,
    setAnimTrackOrientToPath,
    setAnimTrackPathForwardAxis,
    applyAnimationAssetToAnimTrack,
    clearAnimTrackSkeletonAsset,
    selectSkeletonClipSegment,
    setSkeletonClipSegmentRange,
    updateSkeletonClipSegment,
    removeSkeletonClipSegment,
    listObjectSkeletonClips,
    listTrackSkeletonClips,
    skeletonClipsRevision,
    setAnimPlaybackRate,
    exportAnimationVideo,
    beginPathDraw,
    cancelPathDraw,
    playAnimation,
    pauseAnimation,
    stopAnimation,
    seekAnimation
  }
}

export type DirectorStageSceneApi = ReturnType<typeof useDirectorStageScene>
