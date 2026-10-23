import * as THREE from 'three'
import {
  DEFAULT_DIRECTOR_CAMERA_FOV,
  DEFAULT_GRID_OFFSET_Y,
  buildGeneratedMediaFileKey,
  directorAspectRatioValue,
  directorViewerRotationFromLook,
  extractStoryboardShotIdFromDirectorId,
  normalizeDirectorSkyColor,
  type DirectorAnimKeyframe,
  type DirectorAnimTrack,
  type DirectorCameraState,
  type DirectorStageState,
  type StageObjectState,
  type StagePrimitive,
  type StageVec3
} from '@shared/domain'
import type { FilmShot } from '@shared/graph/film/storyboard'
import type { GraphNode } from '@shared/graph/types'
import { createBuiltinMannequin } from './builtinMannequin'
import { saveGraphRunMediaForNode } from '../graph/saveGraphRunMediaForNode'

export interface OffscreenPrevizShotResult {
  shotId: string
  cameraId: string
  cameraName: string
  label: string
  keyframeDataUrl?: string
  keyframePath?: string
  videoDataUrl?: string
  videoPath?: string
}

function pickExportMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read video blob'))
    reader.readAsDataURL(blob)
  })
}

function parseHexColor(hex: string | undefined, fallback = 0x9aa4b2): number {
  if (!hex || typeof hex !== 'string') return fallback
  const trimmed = hex.trim()
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) {
    return new THREE.Color(trimmed).getHex()
  }
  return fallback
}

function makeSimplePrimitiveMesh(
  name: string,
  primitive: StagePrimitive | undefined,
  colorHex: number
): THREE.Mesh {
  const twoSided =
    primitive === 'plane' || primitive === 'quad' || primitive === 'disc' || primitive === 'ring'
  const mat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.65,
    metalness: 0.1,
    side: twoSided ? THREE.DoubleSide : THREE.FrontSide
  })
  let geo: THREE.BufferGeometry
  switch (primitive) {
    case 'sphere':
      geo = new THREE.SphereGeometry(0.5, 24, 16)
      break
    case 'capsule':
      geo = new THREE.CapsuleGeometry(0.5, 1, 8, 16)
      break
    case 'cylinder':
      geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 32)
      break
    case 'cone':
      geo = new THREE.ConeGeometry(0.5, 1, 32)
      break
    case 'pyramid':
      geo = new THREE.ConeGeometry(0.5, 1, 4)
      break
    case 'torus':
      geo = new THREE.TorusGeometry(0.35, 0.12, 16, 32)
      break
    case 'prism':
      geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 6)
      break
    case 'plane':
      geo = new THREE.PlaneGeometry(10, 10)
      break
    case 'quad':
      geo = new THREE.PlaneGeometry(1, 1)
      break
    case 'box':
    default:
      geo = new THREE.BoxGeometry(1, 1, 1)
      break
  }
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = name
  mesh.castShadow = primitive !== 'plane'
  mesh.receiveShadow = true
  return mesh
}

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpVec3(a: StageVec3, b: StageVec3, t: number): StageVec3 {
  return {
    x: lerpNum(a.x, b.x, t),
    y: lerpNum(a.y, b.y, t),
    z: lerpNum(a.z, b.z, t)
  }
}

function easeAlpha(raw: number, easing?: string): number {
  const t = Math.max(0, Math.min(1, raw))
  if (easing === 'easeIn') return t * t
  if (easing === 'easeOut') return 1 - (1 - t) * (1 - t)
  if (easing === 'easeInOut') return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
  if (easing === 'step') return t < 1 ? 0 : 1
  return t
}

function sampleTrackAtTime(
  track: DirectorAnimTrack,
  timeSec: number
): { position?: StageVec3; rotation?: StageVec3; scale?: StageVec3; fov?: number } | null {
  const kfs: DirectorAnimKeyframe[] = [...(track.keyframes ?? [])].sort((a, b) => a.time - b.time)
  if (!kfs.length) return null
  if (kfs.length === 1 || timeSec <= kfs[0].time) {
    const first = kfs[0]
    return {
      position: { ...first.position },
      rotation: first.rotation ? { ...first.rotation } : undefined,
      scale: first.scale ? { ...first.scale } : undefined,
      fov: first.fov
    }
  }
  const last = kfs[kfs.length - 1]
  if (timeSec >= last.time) {
    return {
      position: { ...last.position },
      rotation: last.rotation ? { ...last.rotation } : undefined,
      scale: last.scale ? { ...last.scale } : undefined,
      fov: last.fov
    }
  }
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i]
    const b = kfs[i + 1]
    if (timeSec >= a.time && timeSec <= b.time) {
      const span = Math.max(1e-5, b.time - a.time)
      const alpha = easeAlpha((timeSec - a.time) / span, a.easing)
      return {
        position: lerpVec3(a.position, b.position, alpha),
        rotation:
          a.rotation && b.rotation
            ? lerpVec3(a.rotation, b.rotation, alpha)
            : (b.rotation ?? a.rotation),
        scale: a.scale && b.scale ? lerpVec3(a.scale, b.scale, alpha) : (b.scale ?? a.scale),
        fov:
          typeof a.fov === 'number' && typeof b.fov === 'number'
            ? lerpNum(a.fov, b.fov, alpha)
            : (b.fov ?? a.fov)
      }
    }
  }
  return null
}

/**
 * 离屏渲染 3D 分镜白模预演的关键帧图（previzKeyframe）与逐镜运镜/调度视频（previzVideo）。
 * 无需用户手动点开 3D 舞台弹窗，即可在画布执行「3D 分镜白模预演」或「短剧工作台」时自动生成各镜头的 3D 预演视频参考。
 */
export async function renderOffscreenDirectorPreviz(options: {
  stage: DirectorStageState
  shots?: FilmShot[]
  onlyShotIds?: string[]
  node?: GraphNode
  hostAssetId?: string
  hostAssetName?: string
  includeVideo?: boolean
  includeKeyframe?: boolean
}): Promise<OffscreenPrevizShotResult[]> {
  if (typeof document === 'undefined') return []
  const {
    stage,
    shots = [],
    onlyShotIds,
    node,
    hostAssetId,
    hostAssetName,
    includeVideo = true,
    includeKeyframe = true
  } = options

  const cameras: DirectorCameraState[] = stage.cameras ?? []
  if (!cameras.length) return []

  const anim = stage.animation
  const tracks = anim?.tracks ?? []
  const cutTrack = tracks.find((tr) => tr.cameraCut && (tr.cameraSegments?.length ?? 0) > 0)
  const sortedCutSegments = cutTrack?.cameraSegments
    ? [...cutTrack.cameraSegments].sort((a, b) => a.start - b.start)
    : []

  const camMap = new Map(cameras.map((c) => [c.id, c]))
  const onlySet =
    onlyShotIds && onlyShotIds.length > 0
      ? new Set(onlyShotIds.map((id) => id.trim().toLowerCase()).filter(Boolean))
      : null

  const tasks: Array<{
    shotId: string
    cameraId: string
    cameraName: string
    startSec: number
    endSec: number
    index: number
  }> = []

  if (sortedCutSegments.length > 0) {
    for (let i = 0; i < sortedCutSegments.length; i++) {
      const seg = sortedCutSegments[i]
      const shotId =
        extractStoryboardShotIdFromDirectorId(seg.cameraId) ??
        shots[i]?.id ??
        `S${String(i + 1).padStart(2, '0')}`
      if (onlySet && !onlySet.has(shotId.trim().toLowerCase())) continue
      const cam = camMap.get(seg.cameraId) ?? cameras[0]
      tasks.push({
        shotId,
        cameraId: cam.id,
        cameraName: cam.name || shotId,
        startSec: seg.start,
        endSec: Math.max(seg.start + 0.5, seg.end),
        index: i
      })
    }
  } else {
    for (let i = 0; i < cameras.length; i++) {
      const cam = cameras[i]
      if (cam.visible === false) continue
      const shotId =
        extractStoryboardShotIdFromDirectorId(cam.id) ??
        shots[i]?.id ??
        `S${String(i + 1).padStart(2, '0')}`
      if (onlySet && !onlySet.has(shotId.trim().toLowerCase())) continue
      const camTrack = tracks.find((tr) => tr.targetKind === 'camera' && tr.targetId === cam.id)
      const startSec = camTrack?.start ?? 0
      const endSec = Math.max(
        startSec + 0.5,
        camTrack?.end ?? shots[i]?.durationSec ?? anim?.duration ?? 4
      )
      tasks.push({
        shotId,
        cameraId: cam.id,
        cameraName: cam.name || shotId,
        startSec,
        endSec,
        index: i
      })
    }
  }

  if (!tasks.length) return []

  const ratio = directorAspectRatioValue(stage.aspectRatio ?? '16:9', 16, 9)
  const width = 640
  const height = Math.max(1, Math.round(width / Math.max(0.01, ratio)))

  let webglRenderer: THREE.WebGLRenderer | null = null
  const scene = new THREE.Scene()
  const mixers: Array<{
    objectId: string
    mixer: THREE.AnimationMixer
    clips: Map<string, THREE.AnimationClip>
  }> = []

  try {
    webglRenderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    })
    webglRenderer.setSize(width, height, false)
    webglRenderer.setPixelRatio(1)
    webglRenderer.shadowMap.enabled = true
    webglRenderer.shadowMap.type = THREE.PCFSoftShadowMap

    const skyHex = stage.skyColor ? normalizeDirectorSkyColor(stage.skyColor) : '#1a1d24'
    scene.background = new THREE.Color(skyHex)
    if (stage.fogEnabled) {
      scene.fog = new THREE.FogExp2(stage.fogColor || skyHex, stage.fogDensity ?? 0.018)
    }

    // 地面与参考网格
    const gridY = typeof stage.gridOffsetY === 'number' ? stage.gridOffsetY : DEFAULT_GRID_OFFSET_Y
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x232730,
      roughness: 0.9,
      metalness: 0.05
    })
    const groundPlane = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), groundMat)
    groundPlane.rotation.x = -Math.PI / 2
    groundPlane.position.y = gridY - 0.01
    groundPlane.receiveShadow = true
    scene.add(groundPlane)

    if (stage.gridVisible !== false) {
      const gridHelper = new THREE.GridHelper(40, 40, 0x4b5563, 0x374151)
      gridHelper.position.y = gridY
      scene.add(gridHelper)
    }

    // 基础三点布光
    const ambient = new THREE.AmbientLight(0xdbeafe, 0.75)
    scene.add(ambient)
    const keyLight = new THREE.DirectionalLight(0xfffbeb, 1.35)
    keyLight.position.set(6, 10, 7)
    keyLight.castShadow = true
    keyLight.shadow.mapSize.set(1024, 1024)
    scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.45)
    fillLight.position.set(-7, 5, -5)
    scene.add(fillLight)

    // 构建场景白模物体
    const objectMeshes = new Map<string, THREE.Object3D>()
    const initialObjects = new Map<string, StageObjectState>()
    for (const obj of stage.objects ?? []) {
      initialObjects.set(obj.id, obj)
      let mesh: THREE.Object3D
      if (obj.kind === 'empty') {
        mesh = new THREE.Group()
        mesh.name = obj.name
      } else if (obj.kind === 'light') {
        const g = new THREE.Group()
        const lColor = parseHexColor(obj.color, 0xffffff)
        const pt = new THREE.PointLight(lColor, obj.light?.intensity ?? 1.2, 20)
        g.add(pt)
        mesh = g
      } else if (obj.mannequinPreset || obj.kind === 'character') {
        const built = createBuiltinMannequin(obj.mannequinPreset ?? 'humanoid', obj.color)
        built.root.name = obj.name
        mesh = built.root
        if (built.clips.length > 0) {
          const mixer = new THREE.AnimationMixer(built.root)
          const clipMap = new Map<string, THREE.AnimationClip>()
          for (const clip of built.clips) {
            clipMap.set(clip.name.toLowerCase(), clip)
          }
          mixers.push({ objectId: obj.id, mixer, clips: clipMap })
        }
      } else {
        mesh = makeSimplePrimitiveMesh(
          obj.name,
          obj.primitive ?? 'box',
          parseHexColor(obj.color, 0x9aa4b2)
        )
      }
      mesh.position.set(obj.position.x, obj.position.y, obj.position.z)
      mesh.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z, 'XYZ')
      mesh.scale.set(obj.scale.x, obj.scale.y, obj.scale.z)
      mesh.visible = obj.visible !== false
      objectMeshes.set(obj.id, mesh)
    }

    for (const obj of stage.objects ?? []) {
      const mesh = objectMeshes.get(obj.id)
      if (!mesh) continue
      const parentMesh = obj.parentId ? objectMeshes.get(obj.parentId) : null
      if (parentMesh) parentMesh.add(mesh)
      else scene.add(mesh)
    }

    const renderCam = new THREE.PerspectiveCamera(
      DEFAULT_DIRECTOR_CAMERA_FOV,
      width / Math.max(1, height),
      0.1,
      500
    )
    renderCam.rotation.order = 'YXZ'

    const applySceneAtTime = (cameraId: string, timeSec: number): void => {
      // 1. 物体轨迹与骨骼动画插值
      for (const [objId, mesh] of objectMeshes) {
        const baseObj = initialObjects.get(objId)
        if (!baseObj) continue
        const objTrack = tracks.find((tr) => tr.targetKind === 'object' && tr.targetId === objId)
        const sampled = objTrack ? sampleTrackAtTime(objTrack, timeSec) : null
        const pos = sampled?.position ?? baseObj.position
        const rot = sampled?.rotation ?? baseObj.rotation
        const scl = sampled?.scale ?? baseObj.scale
        mesh.position.set(pos.x, pos.y, pos.z)
        mesh.rotation.set(rot.x, rot.y, rot.z, 'XYZ')
        mesh.scale.set(scl.x, scl.y, scl.z)
      }

      for (const mEntry of mixers) {
        const objTrack = tracks.find(
          (tr) => tr.targetKind === 'object' && tr.targetId === mEntry.objectId
        )
        const activeClipSeg = objTrack?.skeletonClips?.find(
          (c) => timeSec >= c.start && timeSec <= c.end
        )
        mEntry.mixer.stopAllAction()
        const clipName = (activeClipSeg?.clip || 'idle').trim().toLowerCase()
        const clip =
          mEntry.clips.get(clipName) ??
          mEntry.clips.get('idle') ??
          mEntry.clips.values().next().value
        if (clip) {
          const action = mEntry.mixer.clipAction(clip)
          action.play()
          const localTime = activeClipSeg
            ? Math.max(0, (timeSec - activeClipSeg.start) * (activeClipSeg.speed ?? 1))
            : timeSec
          mEntry.mixer.setTime(localTime)
        }
      }

      // 2. 相机轨迹插值
      const camState = camMap.get(cameraId) ?? cameras[0]
      const baseViewer = camState.viewer
      const camTrack = tracks.find(
        (tr) => tr.targetKind === 'camera' && tr.targetId === camState.id
      )
      const sampledCam = camTrack ? sampleTrackAtTime(camTrack, timeSec) : null
      const camPos = sampledCam?.position ?? baseViewer.position
      const camRot =
        sampledCam?.rotation ??
        baseViewer.rotation ??
        directorViewerRotationFromLook(camPos, baseViewer.target)
      const camFov = sampledCam?.fov ?? baseViewer.fov ?? DEFAULT_DIRECTOR_CAMERA_FOV

      renderCam.fov = camFov
      renderCam.aspect = width / Math.max(1, height)
      renderCam.position.set(camPos.x, camPos.y, camPos.z)
      renderCam.rotation.set(camRot.x, camRot.y, camRot.z, 'YXZ')
      renderCam.updateProjectionMatrix()
      scene.updateMatrixWorld(true)
      renderCam.updateMatrixWorld(true)
    }

    const fallbackNode: GraphNode =
      node ??
      ({
        id: stage.ownerProcessingNodeId || 'director-previz',
        typeId: 'asset.motion',
        title: 'director-previz',
        position: { x: 0, y: 0 },
        params: {}
      } as GraphNode)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const mimeType = includeVideo ? pickExportMimeType() : ''
    const results: OffscreenPrevizShotResult[] = []

    for (const task of tasks) {
      const segDur = Math.max(0.5, task.endSec - task.startSec)
      const midTime = task.startSec + segDur * 0.5
      const label = `#${task.index + 1} ${task.cameraName} (${task.startSec.toFixed(1)}s-${task.endSec.toFixed(1)}s)`

      let keyframeDataUrl: string | undefined
      let keyframePath: string | undefined
      if (includeKeyframe) {
        applySceneAtTime(task.cameraId, midTime)
        webglRenderer.render(scene, renderCam)
        keyframeDataUrl = webglRenderer.domElement.toDataURL('image/jpeg', 0.78)
        if (keyframeDataUrl && node) {
          try {
            const key = buildGeneratedMediaFileKey({
              hostAssetName,
              nodeTitle: `previz-${task.shotId}`,
              index: task.index + 1,
              stamp
            })
            keyframePath = await saveGraphRunMediaForNode({
              dataUrl: keyframeDataUrl,
              key,
              node: fallbackNode,
              hostAssetId,
              kind: 'image'
            })
          } catch {
            keyframePath = keyframeDataUrl
          }
        }
      }

      let videoDataUrl: string | undefined
      let videoPath: string | undefined
      if (includeVideo && mimeType) {
        const fps = 12
        const frameCount = Math.min(36, Math.max(8, Math.round(segDur * fps)))
        const exportCanvas = document.createElement('canvas')
        exportCanvas.width = width
        exportCanvas.height = height
        const exportCtx = exportCanvas.getContext('2d')
        if (exportCtx) {
          exportCtx.fillStyle = '#000000'
          exportCtx.fillRect(0, 0, width, height)
          const recordStream = exportCanvas.captureStream(fps)
          const recordTrack = recordStream.getVideoTracks()[0] as MediaStreamTrack & {
            requestFrame?: () => void
          }
          const chunks: BlobPart[] = []
          const recorder = new MediaRecorder(recordStream, {
            mimeType,
            videoBitsPerSecond: 3_500_000
          })
          recorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) chunks.push(event.data)
          }
          const stopPromise = new Promise<void>((resolve, reject) => {
            recorder.onstop = () => resolve()
            recorder.onerror = () => reject(new Error('Offscreen previz video recording failed'))
          })
          try {
            recorder.start(80)
            for (let f = 0; f <= frameCount; f++) {
              const alpha = frameCount > 0 ? f / frameCount : 0
              const t = task.startSec + alpha * segDur
              applySceneAtTime(task.cameraId, t)
              webglRenderer.render(scene, renderCam)
              exportCtx.drawImage(webglRenderer.domElement, 0, 0)
              recordTrack?.requestFrame?.()
              await new Promise<void>((resolve) => window.setTimeout(resolve, 16))
            }
            if (recorder.state === 'recording') {
              try {
                recorder.requestData()
              } catch {
                /* ignore */
              }
            }
            if (recorder.state !== 'inactive') recorder.stop()
            await stopPromise
          } catch {
            if (recorder.state !== 'inactive') {
              try {
                recorder.stop()
              } catch {
                /* ignore */
              }
            }
          } finally {
            recordStream.getTracks().forEach((tr) => tr.stop())
          }
          const blob = new Blob(chunks, { type: 'video/webm' })
          if (blob.size > 0) {
            videoDataUrl = await blobToDataUrl(blob)
            if (videoDataUrl && node) {
              try {
                const key = buildGeneratedMediaFileKey({
                  hostAssetName,
                  nodeTitle: `previz-video-${task.shotId}`,
                  index: task.index + 1,
                  stamp
                })
                videoPath = await saveGraphRunMediaForNode({
                  dataUrl: videoDataUrl,
                  key,
                  node: fallbackNode,
                  hostAssetId,
                  kind: 'video'
                })
              } catch {
                videoPath = videoDataUrl
              }
            }
          }
        }
      }

      results.push({
        shotId: task.shotId,
        cameraId: task.cameraId,
        cameraName: task.cameraName,
        label,
        ...(keyframeDataUrl ? { keyframeDataUrl } : {}),
        ...(keyframePath ? { keyframePath } : {}),
        ...(videoDataUrl ? { videoDataUrl } : {}),
        ...(videoPath ? { videoPath } : {})
      })
    }

    return results
  } finally {
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose()
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose())
        else child.material?.dispose()
      }
    })
    webglRenderer?.dispose()
  }
}
