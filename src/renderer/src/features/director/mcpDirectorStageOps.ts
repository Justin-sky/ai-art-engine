import {
  createDefaultDirectorCamera,
  createDefaultDirectorViewer,
  createDefaultStageLightParams,
  DEFAULT_DIRECTOR_CAMERA_FOV,
  DEFAULT_DIRECTOR_SKY_COLOR,
  DIRECTOR_EXPRESSIVE_POSE_PRESETS,
  directorViewerForwardFromRotation,
  directorViewerRotationFromLook,
  normalizeDirectorAspectRatio,
  normalizeDirectorShadingMode,
  normalizeStageLightParams,
  readDirectorSceneWorld,
  type DirectorAspectRatio,
  type DirectorCameraState,
  type DirectorCinemachineAimMode,
  type DirectorCinemachineAimPart,
  type DirectorCinemachineBodyMode,
  type DirectorCinemachineConfig,
  type DirectorCinemachineFollowSpace,
  type DirectorCinemachineNoisePreset,
  type DirectorShadingMode,
  type DirectorStageState,
  type DirectorViewMode,
  type StageLightType,
  type StageMannequinPreset,
  type StageObjectState,
  type StagePrimitive,
  type StageTextureSlot,
  type StageVec3,
  type TransformMode
} from '@shared/domain'
import {
  buildDirectorCinematographyPrompt,
  buildLightingPresetObjects,
  focalLengthToVerticalFov,
  normalizeDirectorCapturePass,
  normalizeDirectorCompositionGuide,
  verticalFovToFocalLength,
  type DirectorCapturePass,
  type DirectorCompositionGuide,
  type DirectorLightingPresetId
} from '@shared/directorCinematography'
import type { DirectorCinemachinePrevizPackId } from './directorAiBlocking'
import { defaultStageControls } from './stageControlItems'
import { persistStageControls } from './persistStageControls'
import { stageControls, setStageControls } from '../../editor/preferences'
import { persistAssetRecord } from '../../composables/useAssetRecord'
import { useProjectStore } from '../../stores/project'
import { useWorkspaceStore } from '../../stores/workspace'
import { graphEditorHosts } from '../graph/model/graphEditorHosts'
import { resolveDirectorStageScene } from './activeDirectorStageScene'
import {
  findDirectorProcessingNode,
  patchGenParamsWithNodeStage,
  resolveDirectorStageForNode
} from './directorStageBinding'
import type { DirectorStageSceneApi } from './useDirectorStageScene'

const RAD_TO_DEG = 180 / Math.PI
const DEG_TO_RAD = Math.PI / 180

const NAMED_COLORS: Record<string, string> = {
  red: '#ef4444',
  红: '#ef4444',
  红色: '#ef4444',
  大红: '#dc2626',
  深红: '#991b1b',
  blue: '#3b82f6',
  蓝: '#3b82f6',
  蓝色: '#3b82f6',
  深蓝: '#1d4ed8',
  天蓝: '#38bdf8',
  浅蓝: '#60a5fa',
  green: '#22c55e',
  绿: '#22c55e',
  绿色: '#22c55e',
  深绿: '#15803d',
  浅绿: '#4ade80',
  yellow: '#eab308',
  黄: '#eab308',
  黄色: '#eab308',
  金黄: '#f59e0b',
  orange: '#f97316',
  橙: '#f97316',
  橙色: '#f97316',
  橘色: '#f97316',
  purple: '#a855f7',
  紫: '#a855f7',
  紫色: '#a855f7',
  pink: '#ec4899',
  粉: '#ec4899',
  粉色: '#ec4899',
  粉红: '#ec4899',
  cyan: '#06b6d4',
  青: '#06b6d4',
  青色: '#06b6d4',
  white: '#ffffff',
  白: '#ffffff',
  白色: '#ffffff',
  纯白: '#ffffff',
  black: '#1e293b',
  黑: '#1e293b',
  黑色: '#0f172a',
  纯黑: '#000000',
  gray: '#64748b',
  grey: '#64748b',
  灰: '#64748b',
  灰色: '#64748b',
  深灰: '#334155',
  浅灰: '#94a3b8',
  silver: '#cbd5e1',
  银: '#cbd5e1',
  银色: '#cbd5e1',
  gold: '#f59e0b',
  金: '#f59e0b',
  金色: '#f59e0b',
  brown: '#92400e',
  棕: '#92400e',
  棕色: '#92400e',
  褐色: '#92400e',
  warm: '#fff4e6',
  暖白: '#fff4e6',
  暖色: '#fde68a',
  cool: '#e0f2fe',
  冷白: '#e0f2fe',
  冷色: '#bae6fd'
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function num(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

function bool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function normalizeColorInput(value: unknown): string {
  const raw = str(value)
  if (!raw) return ''
  const lower = raw.toLowerCase()
  if (NAMED_COLORS[lower]) return NAMED_COLORS[lower]
  if (NAMED_COLORS[raw]) return NAMED_COLORS[raw]
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw)) return raw
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw}`
  for (const [k, hex] of Object.entries(NAMED_COLORS)) {
    if (k.length >= 2 && lower.includes(k)) return hex
  }
  return raw
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function radToDegVec(v: StageVec3): StageVec3 {
  return {
    x: round2(v.x * RAD_TO_DEG),
    y: round2(v.y * RAD_TO_DEG),
    z: round2(v.z * RAD_TO_DEG)
  }
}

function patchVec3(base: StageVec3, patch: unknown, delta?: unknown): StageVec3 {
  const next = { ...base }
  if (patch && typeof patch === 'object') {
    const p = patch as Record<string, unknown>
    const x = num(p.x)
    const y = num(p.y)
    const z = num(p.z)
    if (x !== undefined) next.x = x
    if (y !== undefined) next.y = y
    if (z !== undefined) next.z = z
  }
  if (delta && typeof delta === 'object') {
    const d = delta as Record<string, unknown>
    const dx = num(d.x)
    const dy = num(d.y)
    const dz = num(d.z)
    if (dx !== undefined) next.x = round2(next.x + dx)
    if (dy !== undefined) next.y = round2(next.y + dy)
    if (dz !== undefined) next.z = round2(next.z + dz)
  }
  return next
}

function patchRotationRad(baseRad: StageVec3, op: Record<string, unknown>): StageVec3 | undefined {
  const rotDeg = op.rotationDeg ?? (op.rotationUnit === 'deg' ? op.rotation : undefined)
  const rotDeltaDeg = op.rotationDeltaDeg ?? op.rotationDelta
  const rotRaw = rotDeg === undefined ? op.rotation : undefined
  if (rotDeg === undefined && rotDeltaDeg === undefined && rotRaw === undefined) {
    return undefined
  }
  const next = { ...baseRad }
  if (rotDeg && typeof rotDeg === 'object') {
    const r = rotDeg as Record<string, unknown>
    const x = num(r.x)
    const y = num(r.y)
    const z = num(r.z)
    if (x !== undefined) next.x = x * DEG_TO_RAD
    if (y !== undefined) next.y = y * DEG_TO_RAD
    if (z !== undefined) next.z = z * DEG_TO_RAD
  } else if (rotRaw && typeof rotRaw === 'object') {
    const r = rotRaw as Record<string, unknown>
    const x = num(r.x)
    const y = num(r.y)
    const z = num(r.z)
    const isLikelyDeg = [x, y, z].some((v) => v !== undefined && Math.abs(v) > Math.PI * 2 + 0.01)
    const factor = isLikelyDeg ? DEG_TO_RAD : 1
    if (x !== undefined) next.x = x * factor
    if (y !== undefined) next.y = y * factor
    if (z !== undefined) next.z = z * factor
  }
  if (rotDeltaDeg && typeof rotDeltaDeg === 'object') {
    const d = rotDeltaDeg as Record<string, unknown>
    const dx = num(d.x)
    const dy = num(d.y)
    const dz = num(d.z)
    if (dx !== undefined) next.x += dx * DEG_TO_RAD
    if (dy !== undefined) next.y += dy * DEG_TO_RAD
    if (dz !== undefined) next.z += dz * DEG_TO_RAD
  }
  return next
}

function patchScaleVec(base: StageVec3, raw: unknown, uniformRaw?: unknown): StageVec3 | undefined {
  const uniform = num(uniformRaw) ?? num(raw)
  if (uniform !== undefined) {
    const s = Math.max(0.01, uniform)
    return { x: s, y: s, z: s }
  }
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>
    const x = num(r.x)
    const y = num(r.y)
    const z = num(r.z)
    return {
      x: Math.max(0.01, x ?? base.x),
      y: Math.max(0.01, y ?? base.y),
      z: Math.max(0.01, z ?? base.z)
    }
  }
  return undefined
}

const EXPRESSIVE_POSE_ALIASES: Array<[string, string[]]> = [
  ['hand.relaxed', ['hand.relaxed', 'relaxed', '自然垂手', '放松手势', '自然手势']],
  ['hand.fist', ['hand.fist', 'fist', '握拳', '双拳紧握']],
  ['hand.open', ['hand.open', 'open', '张手', '张开手掌', '摊手']],
  ['hand.pointRight', ['hand.pointright', 'pointright', 'point', '右手指引', '指向前方', '手指']],
  ['gaze.lookUp', ['gaze.lookup', 'lookup', '仰视', '抬头', '向上看', '仰望']],
  ['gaze.lookDown', ['gaze.lookdown', 'lookdown', '俯视', '低头', '向下看', '沉思']],
  [
    'gaze.tiltCuriosity',
    ['gaze.tiltcuriosity', 'tiltcuriosity', 'curiosity', '歪头', '好奇', '歪头好奇']
  ],
  ['gaze.heroic', ['gaze.heroic', 'heroic', '英雄凝视', '英雄姿态', '挺胸凝视', '坚定凝视']],
  [
    'gaze.combatReady',
    ['gaze.combatready', 'combatready', 'combat', '战斗戒备', '战斗姿态', '备战']
  ]
]

function resolveExpressivePosePresetId(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  const lower = trimmed.toLowerCase()
  for (const preset of DIRECTOR_EXPRESSIVE_POSE_PRESETS) {
    if (preset.id === trimmed || preset.id.toLowerCase() === lower) {
      return preset.id
    }
  }
  for (const [presetId, aliases] of EXPRESSIVE_POSE_ALIASES) {
    if (
      aliases.some((alias) => alias === lower || lower.includes(alias) || alias.includes(lower))
    ) {
      return presetId
    }
  }
  return trimmed
}

function matchStageObjects(
  objects: StageObjectState[],
  op: Record<string, unknown>,
  fallbackObjectId?: string | null
): StageObjectState[] {
  const id = str(op.objectId) || str(op.id)
  if (id) {
    const exactId = objects.filter((o) => o.id === id)
    if (exactId.length) return exactId
  }
  const targetName = str(op.targetName) || (id ? '' : str(op.name))
  const kindFilter = str(op.kind)
  const matchAll = op.all === true

  if (targetName) {
    const lower = targetName.toLowerCase()
    const exact = objects.filter(
      (o) =>
        (!kindFilter || o.kind === kindFilter) &&
        (o.name.trim() === targetName ||
          o.name.trim().toLowerCase() === lower ||
          o.id === targetName ||
          o.id.toLowerCase() === lower)
    )
    if (exact.length) return matchAll ? exact : [exact[0]]
    const partial = objects.filter(
      (o) =>
        (!kindFilter || o.kind === kindFilter) &&
        (o.name.toLowerCase().includes(lower) ||
          lower.includes(o.name.trim().toLowerCase()) ||
          o.id.toLowerCase().includes(lower))
    )
    if (partial.length) return matchAll ? partial : [partial[0]]
  }

  if (id && !targetName) {
    const lowerId = id.toLowerCase()
    const byIdOrName = objects.filter(
      (o) =>
        o.id.toLowerCase() === lowerId ||
        o.name.trim().toLowerCase() === lowerId ||
        o.name.toLowerCase().includes(lowerId) ||
        o.id.toLowerCase().includes(lowerId)
    )
    if (byIdOrName.length) return matchAll ? byIdOrName : [byIdOrName[0]]
  }

  if (kindFilter && (matchAll || (!id && !targetName))) {
    const byKind = objects.filter((o) => o.kind === kindFilter)
    return matchAll ? byKind : byKind.slice(0, 1)
  }

  if (matchAll) return [...objects]

  if (!id && !targetName && !kindFilter && fallbackObjectId) {
    const selected = objects.find((o) => o.id === fallbackObjectId)
    if (selected) return [selected]
  }
  return []
}

function matchStageCameras(
  cameras: DirectorCameraState[],
  op: Record<string, unknown>,
  fallbackCameraId?: string | null
): DirectorCameraState[] {
  const id = str(op.cameraId) || str(op.objectId) || str(op.id)
  if (id) {
    const exactId = cameras.filter((c) => c.id === id)
    if (exactId.length) return exactId
  }
  const targetName = str(op.targetName) || (id ? '' : str(op.name))
  if (targetName) {
    const lower = targetName.toLowerCase()
    const exact = cameras.filter(
      (c) =>
        c.name.trim() === targetName || c.name.trim().toLowerCase() === lower || c.id === targetName
    )
    if (exact.length) return [exact[0]]
    const partial = cameras.filter(
      (c) => c.name.toLowerCase().includes(lower) || lower.includes(c.name.trim().toLowerCase())
    )
    if (partial.length) return [partial[0]]
  }
  if (!id && !targetName && fallbackCameraId) {
    const active = cameras.find((c) => c.id === fallbackCameraId)
    if (active) return [active]
  }
  return []
}

function resolveSubjectObjectId(objects: StageObjectState[], idOrName: unknown): string | null {
  const raw = str(idOrName)
  if (!raw || raw === 'none' || raw === 'null') return null
  const matched = matchStageObjects(objects, { targetName: raw, objectId: raw })
  return matched[0]?.id ?? raw
}

export function serializeDirectorStageSnapshot(
  stage: DirectorStageState,
  meta: {
    live: boolean
    directorAssetId: string
    processingNodeId: string | null
    viewMode?: DirectorViewMode
    shadingMode?: DirectorShadingMode
    selectionKind?: string | null
    selectedObjectId?: string | null
    selectedCameraId?: string | null
    animPlaying?: boolean
    animTime?: number
    liveScene?: DirectorStageSceneApi | null
  }
): Record<string, unknown> {
  const activeCameraId = stage.activeCameraId ?? stage.cameras?.[0]?.id ?? null
  const world = readDirectorSceneWorld(stage.world)
  const selectedObjId = meta.selectedObjectId ?? stage.selectedObjectId ?? null
  const selectedObj = selectedObjId
    ? (stage.objects.find((o) => o.id === selectedObjId) ?? null)
    : null
  const liveScene = meta.liveScene ?? null

  return {
    live: meta.live,
    directorAssetId: meta.directorAssetId,
    processingNodeId: meta.processingNodeId,
    viewMode: meta.viewMode ?? 'director',
    shadingMode: meta.shadingMode ?? 'shaded',
    stageEditMode: liveScene?.stageEditMode?.value ?? 'scene',
    transformMode: liveScene?.transformMode?.value ?? stage.transformMode ?? 'translate',
    aspectRatio: normalizeDirectorAspectRatio(stage.aspectRatio),
    compositionGuide: normalizeDirectorCompositionGuide(stage.compositionGuide),
    capturePass: normalizeDirectorCapturePass(stage.capturePass),
    activeCameraId,
    selectionKind: meta.selectionKind ?? (stage.selectedObjectId ? 'object' : 'scene'),
    selectedObjectId: selectedObjId,
    selectedCameraId: meta.selectedCameraId ?? activeCameraId,
    lightingPreset: stage.lightingPreset ?? null,
    skyColor: stage.skyColor ?? null,
    panoramaAssetId: stage.linkedPanoramaAssetId ?? null,
    panoramaVisible: stage.panoramaVisible !== false,
    panoramaYaw: stage.panoramaYaw ?? 0,
    panoramaRadius: stage.panoramaRadius ?? 500,
    world: {
      scalePercent: world.scalePercent,
      position: {
        x: round2(world.position.x),
        y: round2(world.position.y),
        z: round2(world.position.z)
      },
      rotationDeg: radToDegVec(world.rotation)
    },
    ground: {
      visible: stage.gridVisible !== false,
      opacity: stage.gridOpacity ?? 0.35,
      offsetY: stage.gridOffsetY ?? 0,
      shadowCatcherEnabled: stage.shadowCatcherEnabled !== false,
      shadowCatcherOpacity: stage.shadowCatcherOpacity ?? 0.36
    },
    environment: {
      fogEnabled: stage.fogEnabled === true,
      fogDensity: stage.fogDensity ?? 0.018,
      fogColor: stage.fogColor ?? null
    },
    ...(selectedObj
      ? {
          selectedObjectInspector: {
            id: selectedObj.id,
            name: selectedObj.name,
            kind: selectedObj.kind,
            visible: selectedObj.visible !== false,
            locked: selectedObj.locked === true,
            nameVisible: selectedObj.nameVisible !== false,
            parentId: selectedObj.parentId ?? null,
            color: selectedObj.color ?? null,
            position: {
              x: round2(selectedObj.position.x),
              y: round2(selectedObj.position.y),
              z: round2(selectedObj.position.z)
            },
            rotationDeg: radToDegVec(selectedObj.rotation),
            scale: {
              x: round2(selectedObj.scale.x),
              y: round2(selectedObj.scale.y),
              z: round2(selectedObj.scale.z)
            },
            ...(selectedObj.light ? { light: selectedObj.light } : {}),
            ...(selectedObj.materialTextures
              ? { materialTextures: selectedObj.materialTextures }
              : {}),
            ...(liveScene &&
            typeof liveScene.objectSupportsPose === 'function' &&
            liveScene.objectSupportsPose(selectedObj.id)
              ? {
                  supportsPose: true,
                  poseEditMode: liveScene.poseEditMode?.value ?? 'fk',
                  selectedPoseBone: liveScene.selectedPoseBone?.value ?? null,
                  selectedIkChainId: liveScene.selectedIkChainId?.value ?? null,
                  bonePose: selectedObj.bonePose ?? {}
                }
              : {})
          }
        }
      : {}),
    objectCount: stage.objects.length,
    objects: stage.objects.map((o) => ({
      id: o.id,
      name: o.name,
      kind: o.kind,
      ...(o.primitive ? { primitive: o.primitive } : {}),
      ...(o.mannequinPreset ? { mannequinPreset: o.mannequinPreset } : {}),
      ...(o.modelAssetId ? { modelAssetId: o.modelAssetId } : {}),
      parentId: o.parentId ?? null,
      visible: o.visible !== false,
      locked: o.locked === true,
      nameVisible: o.nameVisible !== false,
      ...(o.color ? { color: o.color } : {}),
      position: {
        x: round2(o.position.x),
        y: round2(o.position.y),
        z: round2(o.position.z)
      },
      rotationDeg: radToDegVec(o.rotation),
      scale: {
        x: round2(o.scale.x),
        y: round2(o.scale.y),
        z: round2(o.scale.z)
      },
      ...(o.light ? { light: o.light } : {}),
      hasBonePose: Boolean(o.bonePose && Object.keys(o.bonePose).length > 0)
    })),
    cameraCount: (stage.cameras ?? []).length,
    cameras: (stage.cameras ?? []).map((c) => {
      const rot =
        c.viewer.rotation ?? directorViewerRotationFromLook(c.viewer.position, c.viewer.target)
      return {
        id: c.id,
        name: c.name,
        visible: c.visible !== false,
        locked: c.locked === true,
        parentId: c.parentId ?? null,
        isActive: c.id === activeCameraId,
        viewer: {
          position: {
            x: round2(c.viewer.position.x),
            y: round2(c.viewer.position.y),
            z: round2(c.viewer.position.z)
          },
          target: {
            x: round2(c.viewer.target.x),
            y: round2(c.viewer.target.y),
            z: round2(c.viewer.target.z)
          },
          rotationDeg: radToDegVec(rot),
          fov: round2(c.viewer.fov ?? DEFAULT_DIRECTOR_CAMERA_FOV),
          ...(c.viewer.focalLengthMm != null
            ? { focalLengthMm: round2(c.viewer.focalLengthMm) }
            : {}),
          ...(c.viewer.aperture != null ? { aperture: c.viewer.aperture } : {}),
          ...(c.viewer.focusDistance != null ? { focusDistance: c.viewer.focusDistance } : {}),
          ...(c.viewer.dollyZoomLock != null ? { dollyZoomLock: c.viewer.dollyZoomLock } : {}),
          ...(c.viewer.handheldShake ? { handheldShake: c.viewer.handheldShake } : {}),
          ...(c.viewer.cinemachine ? { cinemachine: c.viewer.cinemachine } : {})
        }
      }
    }),
    animation: stage.animation
      ? {
          duration: stage.animation.duration,
          loop: stage.animation.loop,
          playing: meta.animPlaying ?? false,
          currentTime: round2(meta.animTime ?? 0),
          trackCount: stage.animation.tracks.length,
          tracks: stage.animation.tracks.map((t) => ({
            id: t.id,
            name: t.name,
            targetKind: t.targetKind,
            targetId: t.targetId,
            cameraCut: t.cameraCut === true,
            keyframeCount: t.keyframes?.length ?? 0,
            skeletonClipCount: t.skeletonClips?.length ?? 0,
            cutSegmentCount: t.cameraSegments?.length ?? 0
          }))
        }
      : null,
    shotsCount: stage.cameraShots?.length ?? 0,
    cinematographyPrompt: buildDirectorCinematographyPrompt(stage).prompt
  }
}

function resolveStageTarget(args: Record<string, unknown>): {
  liveScene: DirectorStageSceneApi | null
  directorAssetId: string
  processingNodeId: string | null
  stage: DirectorStageState
} {
  const requestedAssetId = str(args.assetId) || str(args.directorAssetId)
  const requestedNodeId = str(args.nodeId) || str(args.processingNodeId)
  const activeScene = resolveDirectorStageScene(null)

  if (activeScene) {
    const activeAssetId = activeScene.directorAssetId
    const activeNodeId =
      activeScene.processingNodeId ?? activeScene.stage.value.ownerProcessingNodeId ?? null
    const assetMatches = !requestedAssetId || requestedAssetId === activeAssetId
    const nodeMatches = !requestedNodeId || requestedNodeId === activeNodeId
    if (assetMatches && nodeMatches) {
      return {
        liveScene: activeScene,
        directorAssetId: activeAssetId,
        processingNodeId: activeNodeId,
        stage: activeScene.stage.value
      }
    }
  }

  const project = useProjectStore()
  const workspace = useWorkspaceStore()
  const fallbackAssetId =
    requestedAssetId ||
    workspace.openDirectorEditorIds.at(-1) ||
    workspace.openCanvasEditorIds.at(-1) ||
    workspace.selectedAssetId ||
    ''
  const asset = project.assets.find((item) => item.id === fallbackAssetId)
  if (!asset) {
    throw new Error(
      requestedAssetId
        ? `Asset not found: ${requestedAssetId}`
        : 'No active 3D Director Stage or host asset found; pass assetId or open the 3D Director Stage first'
    )
  }
  const genParams = (asset.genParams as Record<string, unknown> | undefined) ?? {}
  const liveGraph = graphEditorHosts.getLiveAssetDocument(asset.id) ?? genParams.graphJson
  const procNode = findDirectorProcessingNode(liveGraph, requestedNodeId || null)
  const resolvedNodeId = requestedNodeId || procNode?.id || null
  const stage = resolveDirectorStageForNode(genParams, liveGraph, resolvedNodeId)
  return {
    liveScene: null,
    directorAssetId: asset.id,
    processingNodeId: resolvedNodeId,
    stage
  }
}

export async function executeDirectorStageRead(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { liveScene, directorAssetId, processingNodeId, stage } = resolveStageTarget(args)
  return serializeDirectorStageSnapshot(stage, {
    live: Boolean(liveScene),
    directorAssetId,
    processingNodeId,
    viewMode: liveScene?.viewMode?.value,
    shadingMode: liveScene?.shadingMode?.value,
    selectionKind: liveScene?.selectionKind?.value,
    selectedObjectId: liveScene?.selectedObjectId?.value,
    selectedCameraId: liveScene?.selectedCameraId?.value,
    animPlaying: liveScene?.animPlaying?.value,
    animTime: liveScene?.animTime?.value,
    liveScene
  })
}

function normalizeSingleOp(item: Record<string, unknown>): Record<string, unknown> {
  const nestedPatch =
    item.patch && typeof item.patch === 'object' ? (item.patch as Record<string, unknown>) : {}
  const nestedParams =
    item.params && typeof item.params === 'object' ? (item.params as Record<string, unknown>) : {}
  const merged: Record<string, unknown> = {
    ...nestedParams,
    ...nestedPatch,
    ...item
  }
  if (!str(merged.op)) {
    const typeAlias = str(merged.type) || str(merged.action)
    if (
      typeAlias &&
      (typeAlias.includes('object') ||
        typeAlias.includes('camera') ||
        typeAlias.includes('light') ||
        typeAlias.includes('env') ||
        typeAlias.includes('scene') ||
        typeAlias.includes('viewport') ||
        typeAlias.includes('anim') ||
        typeAlias.includes('capture') ||
        typeAlias.includes('blocking') ||
        typeAlias.includes('previz'))
    ) {
      merged.op = typeAlias
    } else if (
      str(merged.cameraId) ||
      merged.cinemachine !== undefined ||
      merged.fov !== undefined ||
      merged.focalLengthMm !== undefined ||
      merged.aperture !== undefined ||
      merged.focusDistance !== undefined ||
      merged.dollyZoomLock !== undefined ||
      merged.handheldShake !== undefined
    ) {
      merged.op = 'camera_update'
    } else if (
      merged.skyColor !== undefined ||
      merged.ground !== undefined ||
      merged.environment !== undefined ||
      merged.sceneWorld !== undefined ||
      merged.world !== undefined ||
      merged.sceneScalePercent !== undefined ||
      merged.fogEnabled !== undefined ||
      merged.fogDensity !== undefined ||
      merged.fogColor !== undefined ||
      merged.shadowCatcherEnabled !== undefined ||
      merged.panoramaVisible !== undefined ||
      merged.panoramaYaw !== undefined ||
      merged.panoramaRadius !== undefined ||
      merged.panoramaAssetId !== undefined ||
      merged.panoramaName !== undefined ||
      merged.clearPanorama !== undefined
    ) {
      merged.op = 'environment_update'
    } else if (
      merged.viewMode !== undefined ||
      merged.shadingMode !== undefined ||
      merged.aspectRatio !== undefined ||
      merged.compositionGuide !== undefined ||
      merged.capturePass !== undefined ||
      merged.transformMode !== undefined ||
      merged.stageEditMode !== undefined ||
      merged.viewOrientation !== undefined ||
      merged.moveToView !== undefined ||
      merged.alignWithView !== undefined ||
      merged.alignViewToSelected !== undefined ||
      merged.gizmoSize !== undefined ||
      merged.sceneLabelsVisible !== undefined ||
      merged.cameraGizmosVisible !== undefined ||
      merged.lightGizmosVisible !== undefined ||
      merged.gridGizmoVisible !== undefined ||
      merged.selectionBoundsVisible !== undefined ||
      merged.stageControls !== undefined
    ) {
      merged.op = 'viewport_update'
    } else if (str(merged.lightingPreset)) {
      merged.op = 'lighting_preset'
      merged.presetId = merged.lightingPreset
    } else {
      merged.op = 'object_update'
    }
  }
  return merged
}

function normalizeRawOps(args: Record<string, unknown>): Array<Record<string, unknown>> {
  const list = Array.isArray(args.ops)
    ? args.ops
    : Array.isArray(args.operations)
      ? args.operations
      : null
  if (list && list.length > 0) {
    return list
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item) => normalizeSingleOp(item))
  }
  const copy = { ...args }
  delete copy.assetId
  delete copy.directorAssetId
  delete copy.nodeId
  delete copy.processingNodeId
  delete copy.ops
  delete copy.operations
  if (Object.keys(copy).length > 0) {
    return [normalizeSingleOp(copy)]
  }
  return []
}

export async function executeDirectorStageEdit(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { liveScene, directorAssetId, processingNodeId, stage } = resolveStageTarget(args)
  const rawOps = normalizeRawOps(args)
  if (!rawOps.length) {
    throw new Error('Missing ops array for director_stage_edit')
  }

  const applied: string[] = []
  const warnings: string[] = []

  for (const rawOp of rawOps) {
    if (!rawOp || typeof rawOp !== 'object') continue
    const opKind = str(rawOp.op)
    const fallbackObjId = liveScene?.selectedObjectId?.value ?? stage.selectedObjectId ?? null
    const fallbackCamId =
      liveScene?.selectedCameraId?.value ?? stage.activeCameraId ?? stage.cameras?.[0]?.id ?? null

    if (
      opKind === 'object_update' ||
      opKind === 'update_object' ||
      opKind === 'hide_object' ||
      opKind === 'show_object' ||
      opKind === 'lock_object' ||
      opKind === 'unlock_object' ||
      opKind === 'set_visible' ||
      opKind === 'transform_object' ||
      opKind === 'pose_update' ||
      opKind === 'light_update' ||
      opKind === 'material_update' ||
      opKind === 'reparent_object'
    ) {
      const explicitVisible =
        opKind === 'hide_object' ? false : opKind === 'show_object' ? true : bool(rawOp.visible)
      const explicitLocked =
        opKind === 'lock_object' ? true : opKind === 'unlock_object' ? false : bool(rawOp.locked)

      const matchedObjects = matchStageObjects(stage.objects, rawOp, fallbackObjId)
      if (!matchedObjects.length) {
        const matchedCams = matchStageCameras(stage.cameras ?? [], rawOp)
        if (matchedCams.length) {
          for (const cam of matchedCams) {
            if (explicitVisible !== undefined) {
              if (liveScene) liveScene.setObjectVisible(cam.id, explicitVisible)
              else cam.visible = explicitVisible
            }
            if (explicitLocked !== undefined) {
              if (liveScene) liveScene.setObjectLocked(cam.id, explicitLocked)
              else cam.locked = explicitLocked
            }
            const newName =
              str(rawOp.newName) || (str(rawOp.objectId) || str(rawOp.id) ? str(rawOp.name) : '')
            if (newName) {
              if (liveScene) liveScene.updateObjectTransform(cam.id, { name: newName })
              else cam.name = newName
            }
            applied.push(`camera_update:${cam.name}(${cam.id})`)
          }
          continue
        }
        warnings.push(
          `Object not found for ${opKind}: ${str(rawOp.objectId) || str(rawOp.id) || str(rawOp.targetName) || str(rawOp.name) || 'selected'}`
        )
        continue
      }

      for (const obj of matchedObjects) {
        if (explicitVisible !== undefined) {
          if (liveScene) liveScene.setObjectVisible(obj.id, explicitVisible)
          else obj.visible = explicitVisible
        }
        if (explicitLocked !== undefined) {
          if (liveScene) liveScene.setObjectLocked(obj.id, explicitLocked)
          else obj.locked = explicitLocked
        }
        const nameVisible = bool(rawOp.nameVisible)
        if (nameVisible !== undefined) {
          if (liveScene) liveScene.setObjectNameVisible(obj.id, nameVisible)
          else obj.nameVisible = nameVisible
        }

        const hasExplicitId = Boolean(str(rawOp.objectId) || str(rawOp.id))
        const newName = str(rawOp.newName) || (hasExplicitId ? str(rawOp.name) : '')
        const nextColor = normalizeColorInput(rawOp.color)
        const hasPosPatch = Boolean(rawOp.position || rawOp.positionDelta)
        const nextPos = hasPosPatch
          ? patchVec3(obj.position, rawOp.position, rawOp.positionDelta)
          : undefined
        const nextRot = patchRotationRad(obj.rotation, rawOp)
        const nextScale = patchScaleVec(obj.scale, rawOp.scale, rawOp.uniformScale)

        let nextLight: StageObjectState['light'] | undefined
        const rawLightPatch =
          rawOp.light && typeof rawOp.light === 'object'
            ? (rawOp.light as Record<string, unknown>)
            : obj.kind === 'light' &&
                (rawOp.intensity !== undefined ||
                  rawOp.distance !== undefined ||
                  rawOp.decay !== undefined ||
                  rawOp.angleDeg !== undefined ||
                  rawOp.angle !== undefined ||
                  rawOp.penumbra !== undefined ||
                  rawOp.castShadow !== undefined ||
                  rawOp.lightType !== undefined)
              ? rawOp
              : null
        if (rawLightPatch) {
          const nextType = (str(rawLightPatch.type) ||
            str(rawLightPatch.lightType) ||
            obj.light?.type ||
            'directional') as StageLightType
          const angleRad =
            num(rawLightPatch.angleDeg) !== undefined
              ? Math.min(90, Math.max(1, num(rawLightPatch.angleDeg)!)) * DEG_TO_RAD
              : num(rawLightPatch.angle)
          nextLight = normalizeStageLightParams(
            {
              ...(obj.light ?? {}),
              type: nextType,
              ...(num(rawLightPatch.intensity) !== undefined
                ? { intensity: Math.max(0, num(rawLightPatch.intensity)!) }
                : {}),
              ...(num(rawLightPatch.distance) !== undefined
                ? { distance: Math.max(0, num(rawLightPatch.distance)!) }
                : {}),
              ...(num(rawLightPatch.decay) !== undefined
                ? { decay: Math.max(0, num(rawLightPatch.decay)!) }
                : {}),
              ...(angleRad !== undefined ? { angle: angleRad } : {}),
              ...(num(rawLightPatch.penumbra) !== undefined
                ? { penumbra: Math.min(1, Math.max(0, num(rawLightPatch.penumbra)!)) }
                : {}),
              ...(bool(rawLightPatch.castShadow) !== undefined
                ? { castShadow: bool(rawLightPatch.castShadow)! }
                : {})
            },
            nextType
          )
        }

        if (newName || nextColor || nextPos || nextRot || nextScale || nextLight) {
          const wasLocked = obj.locked === true
          if (
            wasLocked &&
            (nextPos || nextRot || nextScale || nextColor || nextLight) &&
            liveScene
          ) {
            liveScene.setObjectLocked(obj.id, false)
          }
          const transformPatch: Partial<
            Pick<StageObjectState, 'position' | 'rotation' | 'scale' | 'name' | 'color' | 'light'>
          > = {
            ...(newName ? { name: newName } : {}),
            ...(nextColor ? { color: nextColor } : {}),
            ...(nextPos ? { position: nextPos } : {}),
            ...(nextRot ? { rotation: nextRot } : {}),
            ...(nextScale ? { scale: nextScale } : {}),
            ...(nextLight ? { light: nextLight } : {})
          }
          if (liveScene) {
            liveScene.updateObjectTransform(obj.id, transformPatch)
            if (
              wasLocked &&
              (nextPos || nextRot || nextScale || nextColor || nextLight) &&
              explicitLocked === undefined
            ) {
              liveScene.setObjectLocked(obj.id, true)
            }
          } else {
            Object.assign(obj, transformPatch)
          }
        }

        if (rawOp.parentId !== undefined || rawOp.parentName !== undefined) {
          const rawParent = str(rawOp.parentId) || str(rawOp.parentName)
          const resolvedParent =
            !rawParent || rawParent === 'null' || rawParent === 'none' || rawParent === 'root'
              ? null
              : resolveSubjectObjectId(stage.objects, rawParent)
          if (liveScene) liveScene.reparentObject(obj.id, resolvedParent)
          else obj.parentId = resolvedParent
        }

        if (rawOp.textures || rawOp.materialTextures) {
          const texRaw = (rawOp.textures ?? rawOp.materialTextures) as Record<string, unknown>
          const project = useProjectStore()
          const slots = liveScene ? liveScene.listObjectMaterialSlots(obj.id) : []
          const defaultMatKey = slots[0]?.key ?? 'material-0'
          for (const [keyOrSlot, val] of Object.entries(texRaw)) {
            if (val && typeof val === 'object' && !Array.isArray(val)) {
              for (const [slotName, slotVal] of Object.entries(val as Record<string, unknown>)) {
                const slot = slotName as StageTextureSlot
                const sVal = str(slotVal)
                let relPath: string | null | undefined
                if (slotVal === null || sVal === 'hide' || sVal === 'none') relPath = null
                else if (slotVal === undefined || sVal === 'reset' || sVal === 'restore')
                  relPath = undefined
                else {
                  const foundAsset = project.assets.find(
                    (a) => a.id === sVal || a.name === sVal || a.relativePath === sVal
                  )
                  relPath = foundAsset?.relativePath ?? sVal
                }
                if (liveScene) liveScene.setObjectMaterialTexture(obj.id, keyOrSlot, slot, relPath)
              }
            } else {
              const slot = keyOrSlot as StageTextureSlot
              const sVal = str(val)
              let relPath: string | null | undefined
              if (val === null || sVal === 'hide' || sVal === 'none') relPath = null
              else if (val === undefined || sVal === 'reset' || sVal === 'restore')
                relPath = undefined
              else {
                const foundAsset = project.assets.find(
                  (a) => a.id === sVal || a.name === sVal || a.relativePath === sVal
                )
                relPath = foundAsset?.relativePath ?? sVal
              }
              if (liveScene) {
                liveScene.setObjectMaterialTexture(obj.id, defaultMatKey, slot, relPath)
              }
            }
          }
        }

        if (liveScene) {
          const poseMode = str(rawOp.poseEditMode)
          if (poseMode === 'fk' || poseMode === 'ik') {
            liveScene.setPoseEditMode(poseMode)
          }
          if (rawOp.selectedPoseBone !== undefined) {
            liveScene.setSelectedPoseBone(str(rawOp.selectedPoseBone) || null)
          }
          if (rawOp.selectedIkChainId !== undefined) {
            const chainId = str(rawOp.selectedIkChainId) as
              'slot1' | 'slot2' | 'slot3' | 'slot4' | ''
            liveScene.setSelectedIkChain(chainId || null)
          }
          if (rawOp.ikEffectors && typeof rawOp.ikEffectors === 'object') {
            const slotAliases: Record<string, 'slot1' | 'slot2' | 'slot3' | 'slot4'> = {
              slot1: 'slot1',
              slot2: 'slot2',
              slot3: 'slot3',
              slot4: 'slot4',
              arml: 'slot1',
              lefthand: 'slot1',
              armr: 'slot2',
              righthand: 'slot2',
              legl: 'slot3',
              leftfoot: 'slot3',
              legr: 'slot4',
              rightfoot: 'slot4'
            }
            for (const [rawSlot, val] of Object.entries(
              rawOp.ikEffectors as Record<string, unknown>
            )) {
              const mappedSlot = slotAliases[rawSlot.toLowerCase()]
              if (mappedSlot) {
                const effectorBone =
                  typeof val === 'string'
                    ? val.trim() || null
                    : val && typeof val === 'object' && 'bone' in val
                      ? str((val as Record<string, unknown>).bone) || null
                      : null
                liveScene.setObjectIkChainEffector(obj.id, mappedSlot, effectorBone)
              }
            }
          }
          if (rawOp.resetPose === true) {
            liveScene.resetObjectBonePose(obj.id)
          }
          const rawPosePreset = str(rawOp.posePreset) || str(rawOp.expressivePosePreset)
          if (rawPosePreset) {
            const presetId = resolveExpressivePosePresetId(rawPosePreset)
            const appliedExpressive = liveScene.applyExpressivePosePreset(obj.id, presetId)
            if (!appliedExpressive) {
              liveScene.applyObjectPosePreset(obj.id, rawPosePreset)
            }
          }
          const poseAssetRef = str(rawOp.poseAssetId) || str(rawOp.poseAssetName)
          if (poseAssetRef) {
            const poseAssets = liveScene.listPoseAssets()
            const matchedAsset = poseAssets.find(
              (a) =>
                a.id === poseAssetRef ||
                a.name.trim().toLowerCase() === poseAssetRef.toLowerCase() ||
                a.name.toLowerCase().includes(poseAssetRef.toLowerCase())
            )
            if (matchedAsset) {
              liveScene.applyPoseAssetToObject(obj.id, matchedAsset.id)
            }
          }
          if (rawOp.bonePose && typeof rawOp.bonePose === 'object') {
            const boneMap: Record<string, StageVec3> = {}
            for (const [boneName, euler] of Object.entries(
              rawOp.bonePose as Record<string, Record<string, unknown>>
            )) {
              if (!euler || typeof euler !== 'object') continue
              const existingDeg = liveScene.getObjectBonePoseDeg(obj.id, boneName)
              boneMap[boneName] = {
                x: num(euler.x) ?? existingDeg.x,
                y: num(euler.y) ?? existingDeg.y,
                z: num(euler.z) ?? existingDeg.z
              }
            }
            if (Object.keys(boneMap).length > 0) {
              liveScene.applyObjectBonePoseMap(obj.id, boneMap, 'merge')
            }
          }
          const savePoseName = str(rawOp.savePoseAssetName)
          if (savePoseName) {
            await liveScene.saveObjectPoseAsAsset(obj.id, savePoseName, null)
          }
        }

        if (rawOp.select === true) {
          if (liveScene) liveScene.selectObject(obj.id)
          else stage.selectedObjectId = obj.id
        }
        if (rawOp.focus === true && liveScene) {
          liveScene.focusHierarchyItem(obj.id)
        }

        applied.push(`object_update:${newName || obj.name}(${obj.id})`)
      }
      continue
    }

    if (
      opKind === 'object_duplicate' ||
      opKind === 'duplicate_object' ||
      opKind === 'object_copy' ||
      opKind === 'object_paste'
    ) {
      if (!liveScene) {
        warnings.push(`${opKind} requires the 3D Director Stage to be open in the left window`)
        continue
      }
      if (opKind === 'object_paste') {
        const beforeIds = new Set(stage.objects.map((o) => o.id))
        const rawRet = (await liveScene.pasteStageClipboard()) as unknown
        const pastedIds = Array.isArray(rawRet)
          ? (rawRet as string[])
          : stage.objects.filter((o) => !beforeIds.has(o.id)).map((o) => o.id)
        applied.push(`object_paste:${pastedIds.join(',')}`)
        continue
      }
      const matched = matchStageObjects(stage.objects, rawOp, fallbackObjId)
      const targetIds = matched.length
        ? matched.map((o) => o.id)
        : matchStageCameras(stage.cameras ?? [], rawOp, fallbackCamId).map((c) => c.id)
      if (!targetIds.length) {
        warnings.push(`No target found for ${opKind}`)
        continue
      }
      liveScene.copyStageSelection(targetIds)
      if (opKind === 'object_copy') {
        applied.push(`object_copy:${targetIds.join(',')}`)
        continue
      }
      const beforeIds = new Set(stage.objects.map((o) => o.id))
      const rawRet = (await liveScene.pasteStageClipboard()) as unknown
      const pastedIds = Array.isArray(rawRet)
        ? (rawRet as string[])
        : stage.objects.filter((o) => !beforeIds.has(o.id)).map((o) => o.id)
      if (pastedIds.length && (rawOp.position || rawOp.positionDelta || rawOp.newName)) {
        const firstId = pastedIds[0]
        const createdObj = stage.objects.find((o) => o.id === firstId)
        if (createdObj) {
          const nextPos =
            rawOp.position || rawOp.positionDelta
              ? patchVec3(createdObj.position, rawOp.position, rawOp.positionDelta)
              : undefined
          const newName = str(rawOp.newName)
          liveScene.updateObjectTransform(firstId, {
            ...(newName ? { name: newName } : {}),
            ...(nextPos ? { position: nextPos } : {})
          })
        }
      }
      applied.push(`object_duplicate:${pastedIds.join(',')}`)
      continue
    }

    if (opKind === 'object_add' || opKind === 'add_object' || opKind === 'create_object') {
      const kind = str(rawOp.kind) || 'primitive'
      const rawParent = str(rawOp.parentId) || str(rawOp.parentName)
      const parentId = rawParent ? resolveSubjectObjectId(stage.objects, rawParent) : null
      let createdId = ''

      if (kind === 'camera') {
        if (liveScene) {
          createdId = liveScene.createCameraObject()
          const name = str(rawOp.name)
          if (name) liveScene.updateObjectTransform(createdId, { name })
        } else {
          const cams = stage.cameras ?? []
          createdId = `camera:${crypto.randomUUID()}`
          const cam = createDefaultDirectorCamera(
            createdId,
            str(rawOp.name) || `Camera ${cams.length + 1}`
          )
          stage.cameras = [...cams, cam]
        }
        applied.push(`camera_add:${createdId}`)
        continue
      }

      if (liveScene) {
        if (kind === 'character' || kind === 'mannequin') {
          const preset = (str(rawOp.mannequinPreset) || 'humanoid') as StageMannequinPreset
          createdId = liveScene.createMannequinObject(preset, parentId)
        } else if (kind === 'light') {
          const lightType = (str(rawOp.lightType) ||
            str((rawOp.light as Record<string, unknown> | undefined)?.type) ||
            'spot') as StageLightType
          createdId = liveScene.createLightObject(lightType, parentId)
        } else if (kind === 'empty') {
          createdId = liveScene.createEmptyObject(parentId)
        } else if (kind === 'model' && (str(rawOp.assetId) || str(rawOp.modelName))) {
          const project = useProjectStore()
          const refStr = str(rawOp.assetId) || str(rawOp.modelName)
          const modelAsset = project.assets.find(
            (a) =>
              a.id === refStr ||
              (a.type === 'model' &&
                (a.name.trim().toLowerCase() === refStr.toLowerCase() ||
                  a.name.toLowerCase().includes(refStr.toLowerCase())))
          )
          if (modelAsset) {
            createdId = (await liveScene.createModelObject(modelAsset.id, parentId)) ?? ''
          } else {
            warnings.push(`Model asset not found: ${refStr}`)
            continue
          }
        } else {
          const primitive = (str(rawOp.primitive) || 'box') as StagePrimitive
          createdId = liveScene.createPrimitiveObject(primitive, parentId)
        }

        if (createdId) {
          const createdObj = stage.objects.find((o) => o.id === createdId)
          if (createdObj) {
            const name = str(rawOp.name)
            const color = normalizeColorInput(rawOp.color)
            const position = rawOp.position
              ? patchVec3(createdObj.position, rawOp.position)
              : undefined
            const rotation = patchRotationRad(createdObj.rotation, rawOp)
            const scale = patchScaleVec(createdObj.scale, rawOp.scale, rawOp.uniformScale)
            const light =
              rawOp.light && typeof rawOp.light === 'object'
                ? normalizeStageLightParams(
                    { ...(createdObj.light ?? {}), ...(rawOp.light as Record<string, unknown>) },
                    createdObj.light?.type
                  )
                : undefined
            if (name || color || position || rotation || scale || light) {
              liveScene.updateObjectTransform(createdId, {
                ...(name ? { name } : {}),
                ...(color ? { color } : {}),
                ...(position ? { position } : {}),
                ...(rotation ? { rotation } : {}),
                ...(scale ? { scale } : {}),
                ...(light ? { light } : {})
              })
            }
            if (bool(rawOp.visible) !== undefined) {
              liveScene.setObjectVisible(createdId, bool(rawOp.visible)!)
            }
            if (bool(rawOp.locked) !== undefined) {
              liveScene.setObjectLocked(createdId, bool(rawOp.locked)!)
            }
            if (bool(rawOp.nameVisible) !== undefined) {
              liveScene.setObjectNameVisible(createdId, bool(rawOp.nameVisible)!)
            }
            const rawPosePreset = str(rawOp.posePreset) || str(rawOp.expressivePosePreset)
            if (rawPosePreset) {
              liveScene.applyExpressivePosePreset(
                createdId,
                resolveExpressivePosePresetId(rawPosePreset)
              )
            }
          }
          applied.push(`object_add:${createdId}`)
        }
      } else {
        const isChar = kind === 'character' || kind === 'mannequin'
        const isLight = kind === 'light'
        const isEmpty = kind === 'empty'
        const primitive = (str(rawOp.primitive) || 'box') as StagePrimitive
        const lightType = (str(rawOp.lightType) || 'spot') as StageLightType
        const preset = (str(rawOp.mannequinPreset) || 'humanoid') as StageMannequinPreset
        createdId = `${isChar ? 'mannequin' : isLight ? 'light' : isEmpty ? 'empty' : 'primitive'}:${crypto.randomUUID()}`
        const baseObj: StageObjectState = {
          id: createdId,
          name: str(rawOp.name) || (isChar ? 'Character' : isLight ? 'Light' : 'Object'),
          kind: isChar ? 'character' : isLight ? 'light' : isEmpty ? 'empty' : 'primitive',
          ...(isChar ? { mannequinPreset: preset } : {}),
          ...(!isChar && !isLight && !isEmpty ? { primitive } : {}),
          ...(isLight ? { light: createDefaultStageLightParams(lightType) } : {}),
          color:
            normalizeColorInput(rawOp.color) ||
            (isChar ? '#64748b' : isLight ? '#ffffff' : '#4f8ef7'),
          parentId,
          visible: bool(rawOp.visible) ?? true,
          locked: bool(rawOp.locked) ?? false,
          nameVisible: bool(rawOp.nameVisible) ?? true,
          position: patchVec3({ x: 0, y: 0, z: 0 }, rawOp.position),
          rotation: patchRotationRad({ x: 0, y: 0, z: 0 }, rawOp) ?? { x: 0, y: 0, z: 0 },
          scale: patchScaleVec({ x: 1, y: 1, z: 1 }, rawOp.scale, rawOp.uniformScale) ?? {
            x: 1,
            y: 1,
            z: 1
          }
        }
        stage.objects = [...stage.objects, baseObj]
        applied.push(`object_add:${baseObj.name}(${createdId})`)
      }
      continue
    }

    if (opKind === 'object_delete' || opKind === 'delete_object' || opKind === 'remove_object') {
      const matched = matchStageObjects(stage.objects, rawOp, fallbackObjId)
      if (!matched.length) {
        const matchedCams = matchStageCameras(stage.cameras ?? [], rawOp)
        if (matchedCams.length) {
          for (const cam of matchedCams) {
            if (liveScene) liveScene.removeObject(cam.id)
            else stage.cameras = (stage.cameras ?? []).filter((c) => c.id !== cam.id)
            applied.push(`camera_delete:${cam.name}(${cam.id})`)
          }
          continue
        }
        warnings.push(
          `Object not found for delete: ${str(rawOp.objectId) || str(rawOp.id) || str(rawOp.targetName) || str(rawOp.name)}`
        )
        continue
      }
      for (const obj of matched) {
        if (liveScene) {
          liveScene.removeObject(obj.id)
        } else {
          stage.objects = stage.objects.filter((o) => o.id !== obj.id)
        }
        applied.push(`object_delete:${obj.name}(${obj.id})`)
      }
      continue
    }

    if (
      opKind === 'object_select' ||
      opKind === 'select_object' ||
      opKind === 'select' ||
      opKind === 'focus_object' ||
      opKind === 'select_scene' ||
      opKind === 'select_panorama'
    ) {
      const targetStr = str(rawOp.target) || str(rawOp.selectionKind) || str(rawOp.name)
      if (opKind === 'select_scene' || targetStr === 'scene' || targetStr === '场景') {
        if (liveScene) liveScene.selectScene()
        else stage.selectedObjectId = null
        applied.push('select_scene')
        continue
      }
      if (opKind === 'select_panorama' || targetStr === 'panorama' || targetStr === '全景图') {
        if (liveScene) liveScene.selectPanorama()
        applied.push('select_panorama')
        continue
      }
      const matchedObj = matchStageObjects(stage.objects, rawOp)[0]
      if (matchedObj) {
        if (liveScene) {
          liveScene.selectObject(matchedObj.id)
          if (rawOp.focus === true || opKind === 'focus_object') {
            liveScene.focusHierarchyItem(matchedObj.id)
          }
        } else {
          stage.selectedObjectId = matchedObj.id
        }
        applied.push(`object_select:${matchedObj.name}(${matchedObj.id})`)
        continue
      }
      const matchedCam = matchStageCameras(stage.cameras ?? [], rawOp)[0]
      if (matchedCam) {
        if (liveScene) {
          liveScene.selectCamera(matchedCam.id)
          if (rawOp.focus === true || opKind === 'focus_object') {
            liveScene.focusHierarchyItem(matchedCam.id)
          }
        } else {
          stage.activeCameraId = matchedCam.id
        }
        applied.push(`camera_select:${matchedCam.name}(${matchedCam.id})`)
        continue
      }
      warnings.push(
        `Target not found for select: ${str(rawOp.objectId) || str(rawOp.cameraId) || str(rawOp.id) || str(rawOp.name)}`
      )
      continue
    }

    if (opKind === 'camera_update' || opKind === 'update_camera') {
      const matchedCams = matchStageCameras(stage.cameras ?? [], rawOp, fallbackCamId)
      if (!matchedCams.length) {
        warnings.push(
          `Camera not found for camera_update: ${str(rawOp.cameraId) || str(rawOp.name)}`
        )
        continue
      }
      for (const cam of matchedCams) {
        const hasExplicitId = Boolean(str(rawOp.cameraId) || str(rawOp.id))
        const newName = str(rawOp.newName) || (hasExplicitId ? str(rawOp.name) : '')
        if (newName) {
          if (liveScene) liveScene.updateObjectTransform(cam.id, { name: newName })
          else cam.name = newName
        }
        if (bool(rawOp.visible) !== undefined) {
          if (liveScene) liveScene.setObjectVisible(cam.id, bool(rawOp.visible)!)
          else cam.visible = bool(rawOp.visible)!
        }
        if (bool(rawOp.locked) !== undefined) {
          if (liveScene) liveScene.setObjectLocked(cam.id, bool(rawOp.locked)!)
          else cam.locked = bool(rawOp.locked)!
        }
        if (rawOp.setActive === true || rawOp.active === true || liveScene) {
          if (liveScene) liveScene.selectCamera(cam.id)
          else stage.activeCameraId = cam.id
        }
        if (rawOp.resetViewer === true && liveScene) {
          liveScene.resetViewer()
        }
        const presetId = str(rawOp.presetId)
        if (presetId && liveScene) {
          liveScene.applyCameraPreset(presetId)
        }

        const hasViewerPatch =
          rawOp.position !== undefined ||
          rawOp.positionDelta !== undefined ||
          rawOp.target !== undefined ||
          rawOp.targetDelta !== undefined ||
          rawOp.rotationDeg !== undefined ||
          rawOp.rotationDeltaDeg !== undefined ||
          rawOp.rotation !== undefined ||
          rawOp.scale !== undefined ||
          rawOp.fov !== undefined ||
          rawOp.focalLengthMm !== undefined ||
          rawOp.aperture !== undefined ||
          rawOp.focusDistance !== undefined ||
          rawOp.dollyZoomLock !== undefined ||
          rawOp.handheldShake !== undefined ||
          rawOp.shakeEnabled !== undefined ||
          rawOp.shakeIntensity !== undefined ||
          rawOp.shakeFrequency !== undefined ||
          rawOp.cinemachine !== undefined

        if (hasViewerPatch) {
          const prevViewer = cam.viewer ?? createDefaultDirectorViewer()
          const nextPosition = patchVec3(prevViewer.position, rawOp.position, rawOp.positionDelta)
          const baseRotation =
            prevViewer.rotation ??
            directorViewerRotationFromLook(prevViewer.position, prevViewer.target)
          const patchedRotation = patchRotationRad(baseRotation, rawOp)

          let nextTarget = patchVec3(prevViewer.target, rawOp.target, rawOp.targetDelta)
          let nextRotation = directorViewerRotationFromLook(nextPosition, nextTarget)

          if (patchedRotation && rawOp.target === undefined && rawOp.targetDelta === undefined) {
            nextRotation = patchedRotation
            const forward = directorViewerForwardFromRotation(patchedRotation)
            const lookDist = Math.max(
              0.5,
              Math.hypot(
                prevViewer.target.x - prevViewer.position.x,
                prevViewer.target.y - prevViewer.position.y,
                prevViewer.target.z - prevViewer.position.z
              ) || 5
            )
            nextTarget = {
              x: round2(nextPosition.x + forward.x * lookDist),
              y: round2(nextPosition.y + forward.y * lookDist),
              z: round2(nextPosition.z + forward.z * lookDist)
            }
          }

          const nextScale = patchScaleVec(
            prevViewer.scale ?? { x: 1, y: 1, z: 1 },
            rawOp.scale,
            rawOp.uniformScale
          )

          const reqFocal = num(rawOp.focalLengthMm)
          const reqFov = num(rawOp.fov)
          const nextFov =
            reqFov ??
            (reqFocal !== undefined
              ? focalLengthToVerticalFov(reqFocal)
              : (prevViewer.fov ?? DEFAULT_DIRECTOR_CAMERA_FOV))
          const nextFocal = reqFocal ?? verticalFovToFocalLength(nextFov)

          const shakeRaw =
            rawOp.handheldShake && typeof rawOp.handheldShake === 'object'
              ? (rawOp.handheldShake as Record<string, unknown>)
              : rawOp
          const nextShake =
            rawOp.handheldShake !== undefined ||
            rawOp.shakeEnabled !== undefined ||
            rawOp.shakeIntensity !== undefined ||
            rawOp.shakeFrequency !== undefined
              ? {
                  enabled:
                    bool(shakeRaw.enabled) ??
                    bool(rawOp.shakeEnabled) ??
                    prevViewer.handheldShake?.enabled ??
                    false,
                  intensity:
                    num(shakeRaw.intensity) ??
                    num(rawOp.shakeIntensity) ??
                    prevViewer.handheldShake?.intensity ??
                    0.25,
                  frequency:
                    num(shakeRaw.frequency) ??
                    num(rawOp.shakeFrequency) ??
                    prevViewer.handheldShake?.frequency ??
                    1.2
                }
              : prevViewer.handheldShake

          let nextCm: DirectorCinemachineConfig | undefined = prevViewer.cinemachine
          if (rawOp.cinemachine && typeof rawOp.cinemachine === 'object') {
            const cmRaw = rawOp.cinemachine as Record<string, unknown>
            if (cmRaw.reset === true) {
              nextCm = {
                bodyMode: 'none',
                aimMode: 'none',
                noisePreset: 'none',
                impulseIntensity: 0,
                impulseTimeSec: 0,
                autoFocusPull: false
              }
            } else {
              const prevCm = prevViewer.cinemachine ?? {}
              const followTargetId =
                cmRaw.followTargetId !== undefined || cmRaw.followTargetName !== undefined
                  ? resolveSubjectObjectId(
                      stage.objects,
                      cmRaw.followTargetId ?? cmRaw.followTargetName
                    )
                  : (prevCm.followTargetId ?? null)
              const lookAtTargetId =
                cmRaw.lookAtTargetId !== undefined || cmRaw.lookAtTargetName !== undefined
                  ? resolveSubjectObjectId(
                      stage.objects,
                      cmRaw.lookAtTargetId ?? cmRaw.lookAtTargetName
                    )
                  : (prevCm.lookAtTargetId ?? null)

              let screenOffset = prevCm.screenOffset ?? { x: 0, y: 0 }
              const compPreset = str(cmRaw.screenCompositionPreset)
              if (compPreset === 'center') screenOffset = { x: 0, y: 0 }
              else if (compPreset === 'leftThird') screenOffset = { x: -0.33, y: 0.12 }
              else if (compPreset === 'rightThird') screenOffset = { x: 0.33, y: 0.12 }
              else if (compPreset === 'heroLow') screenOffset = { x: 0, y: -0.22 }
              if (cmRaw.screenOffset && typeof cmRaw.screenOffset === 'object') {
                const so = cmRaw.screenOffset as Record<string, unknown>
                screenOffset = {
                  x: num(so.x) ?? screenOffset.x,
                  y: num(so.y) ?? screenOffset.y
                }
              }
              if (num(cmRaw.screenOffsetX) !== undefined) {
                screenOffset = { ...screenOffset, x: num(cmRaw.screenOffsetX)! }
              }
              if (num(cmRaw.screenOffsetY) !== undefined) {
                screenOffset = { ...screenOffset, y: num(cmRaw.screenOffsetY)! }
              }

              let followOffset = prevCm.followOffset ?? { x: 0, y: 1.6, z: 3.2 }
              if (cmRaw.followOffset && typeof cmRaw.followOffset === 'object') {
                followOffset = patchVec3(followOffset, cmRaw.followOffset)
              }

              nextCm = {
                ...prevCm,
                bodyMode: (str(cmRaw.bodyMode) ||
                  prevCm.bodyMode ||
                  'none') as DirectorCinemachineBodyMode,
                followTargetId,
                followSpace: (str(cmRaw.followSpace) ||
                  prevCm.followSpace ||
                  'targetLocal') as DirectorCinemachineFollowSpace,
                followOffset,
                positionDamping: num(cmRaw.positionDamping) ?? prevCm.positionDamping ?? 0.35,
                orbitRadius: num(cmRaw.orbitRadius) ?? prevCm.orbitRadius ?? 3.2,
                orbitHeight: num(cmRaw.orbitHeight) ?? prevCm.orbitHeight ?? 1.5,
                orbitSpeedDegPerSec:
                  num(cmRaw.orbitSpeedDegPerSec) ??
                  num(cmRaw.orbitSpeed) ??
                  prevCm.orbitSpeedDegPerSec ??
                  36,
                orbitStartAngleDeg:
                  num(cmRaw.orbitStartAngleDeg) ??
                  num(cmRaw.orbitStartAngle) ??
                  prevCm.orbitStartAngleDeg ??
                  0,
                groupFramingScale: num(cmRaw.groupFramingScale) ?? prevCm.groupFramingScale ?? 1.35,
                aimMode: (str(cmRaw.aimMode) ||
                  prevCm.aimMode ||
                  'none') as DirectorCinemachineAimMode,
                lookAtTargetId,
                aimTargetPart: (str(cmRaw.aimTargetPart) ||
                  prevCm.aimTargetPart ||
                  'head') as DirectorCinemachineAimPart,
                screenOffset,
                deadZoneWidth: num(cmRaw.deadZoneWidth) ?? prevCm.deadZoneWidth ?? 0,
                deadZoneHeight: num(cmRaw.deadZoneHeight) ?? prevCm.deadZoneHeight ?? 0,
                aimDamping: num(cmRaw.aimDamping) ?? prevCm.aimDamping ?? 0.25,
                autoFocusPull: bool(cmRaw.autoFocusPull) ?? prevCm.autoFocusPull ?? false,
                noisePreset: (str(cmRaw.noisePreset) ||
                  prevCm.noisePreset ||
                  'none') as DirectorCinemachineNoisePreset,
                impulseTimeSec:
                  cmRaw.triggerImpulse === true
                    ? round2(liveScene?.animTime.value ?? 0)
                    : (num(cmRaw.impulseTimeSec) ?? prevCm.impulseTimeSec ?? 0),
                impulseIntensity:
                  cmRaw.triggerImpulse === true && (num(cmRaw.impulseIntensity) ?? 0) <= 0
                    ? 0.5
                    : (num(cmRaw.impulseIntensity) ?? prevCm.impulseIntensity ?? 0)
              }
            }
          }

          const nextViewer = {
            ...prevViewer,
            position: nextPosition,
            target: nextTarget,
            rotation: nextRotation,
            ...(nextScale ? { scale: nextScale } : {}),
            fov: nextFov,
            focalLengthMm: nextFocal,
            ...(num(rawOp.aperture) !== undefined ? { aperture: num(rawOp.aperture) } : {}),
            ...(num(rawOp.focusDistance) !== undefined
              ? { focusDistance: num(rawOp.focusDistance) }
              : {}),
            ...(bool(rawOp.dollyZoomLock) !== undefined
              ? { dollyZoomLock: bool(rawOp.dollyZoomLock) }
              : {}),
            ...(nextShake ? { handheldShake: nextShake } : {}),
            ...(nextCm ? { cinemachine: nextCm } : {})
          }
          if (liveScene) {
            const wasLocked = cam.locked === true
            if (wasLocked) liveScene.setObjectLocked(cam.id, false)
            liveScene.selectCamera(cam.id)
            liveScene.setViewer(nextViewer)
            if (wasLocked && bool(rawOp.locked) === undefined) {
              liveScene.setObjectLocked(cam.id, true)
            }
          } else {
            cam.viewer = nextViewer
          }
        }
        applied.push(`camera_update:${newName || cam.name}(${cam.id})`)
      }
      continue
    }

    if (opKind === 'camera_add' || opKind === 'add_camera' || opKind === 'create_camera') {
      let camId = ''
      if (liveScene) {
        camId = liveScene.createCameraObject()
        const name = str(rawOp.name)
        if (name) liveScene.updateObjectTransform(camId, { name })
        const presetId = str(rawOp.presetId)
        if (presetId) liveScene.applyCameraPreset(presetId)
        const cam = (stage.cameras ?? []).find((c) => c.id === camId)
        if (
          cam &&
          (rawOp.position ||
            rawOp.target ||
            rawOp.rotationDeg ||
            rawOp.fov !== undefined ||
            rawOp.focalLengthMm !== undefined)
        ) {
          const prevViewer = cam.viewer ?? createDefaultDirectorViewer()
          const nextPosition = patchVec3(prevViewer.position, rawOp.position)
          let nextTarget = patchVec3(prevViewer.target, rawOp.target)
          const patchedRot = patchRotationRad(
            prevViewer.rotation ?? directorViewerRotationFromLook(nextPosition, nextTarget),
            rawOp
          )
          if (patchedRot && !rawOp.target) {
            const fwd = directorViewerForwardFromRotation(patchedRot)
            nextTarget = {
              x: round2(nextPosition.x + fwd.x * 5),
              y: round2(nextPosition.y + fwd.y * 5),
              z: round2(nextPosition.z + fwd.z * 5)
            }
          }
          const reqFocal = num(rawOp.focalLengthMm)
          const reqFov = num(rawOp.fov)
          const nextFov =
            reqFov ??
            (reqFocal !== undefined
              ? focalLengthToVerticalFov(reqFocal)
              : (prevViewer.fov ?? DEFAULT_DIRECTOR_CAMERA_FOV))
          liveScene.setViewer({
            ...prevViewer,
            position: nextPosition,
            target: nextTarget,
            rotation: patchedRot ?? directorViewerRotationFromLook(nextPosition, nextTarget),
            fov: nextFov,
            focalLengthMm: reqFocal ?? verticalFovToFocalLength(nextFov)
          })
        }
      } else {
        const cams = stage.cameras ?? []
        camId = `camera:${crypto.randomUUID()}`
        const cam = createDefaultDirectorCamera(
          camId,
          str(rawOp.name) || `Camera ${cams.length + 1}`
        )
        if (rawOp.position) cam.viewer.position = patchVec3(cam.viewer.position, rawOp.position)
        if (rawOp.target) cam.viewer.target = patchVec3(cam.viewer.target, rawOp.target)
        if (num(rawOp.fov) !== undefined) cam.viewer.fov = num(rawOp.fov)!
        stage.cameras = [...cams, cam]
        stage.activeCameraId = camId
      }
      applied.push(`camera_add:${camId}`)
      continue
    }

    if (opKind === 'camera_delete' || opKind === 'delete_camera' || opKind === 'remove_camera') {
      const matchedCams = matchStageCameras(stage.cameras ?? [], rawOp, fallbackCamId)
      if (!matchedCams.length) {
        warnings.push(`Camera not found for delete: ${str(rawOp.cameraId) || str(rawOp.name)}`)
        continue
      }
      for (const cam of matchedCams) {
        if (liveScene) liveScene.removeObject(cam.id)
        else stage.cameras = (stage.cameras ?? []).filter((c) => c.id !== cam.id)
        applied.push(`camera_delete:${cam.name}(${cam.id})`)
      }
      continue
    }

    if (opKind === 'lighting_preset' || opKind === 'set_lighting_preset') {
      const presetId = (str(rawOp.presetId) ||
        str(rawOp.lightingPreset)) as DirectorLightingPresetId
      if (!presetId) {
        warnings.push('Missing presetId for lighting_preset')
        continue
      }
      if (liveScene) {
        liveScene.applyLightingPreset(presetId)
      } else {
        const remaining = stage.objects.filter(
          (o) => !(o.kind === 'light' && o.id.startsWith('light:preset:'))
        )
        const presetRes = buildLightingPresetObjects(
          presetId,
          { x: 0, y: 0, z: 0 },
          1.8,
          null,
          'zh-CN'
        )
        const presetLights = presetRes.lights.map((l) => ({
          ...l,
          id: `light:preset:${presetId}:${crypto.randomUUID()}`
        }))
        stage.lightingPreset = presetId
        stage.objects = [...remaining, ...presetLights]
      }
      applied.push(`lighting_preset:${presetId}`)
      continue
    }

    if (
      opKind === 'environment_update' ||
      opKind === 'update_environment' ||
      opKind === 'scene_update' ||
      opKind === 'panorama_update'
    ) {
      const rawSky = str(rawOp.skyColor)
      if (rawSky) {
        const skyColor =
          rawSky === 'theme' || rawSky === 'followTheme' || rawSky === 'default'
            ? DEFAULT_DIRECTOR_SKY_COLOR
            : normalizeColorInput(rawSky)
        if (liveScene) liveScene.updateSkyColor(skyColor)
        else stage.skyColor = skyColor
      }

      if (rawOp.clearPanorama === true || rawOp.panoramaAssetId === null) {
        if (liveScene) {
          liveScene.linkedPanoramaId.value = null
          liveScene.onScenePick()
        } else {
          stage.linkedPanoramaAssetId = null
        }
      } else if (str(rawOp.panoramaAssetId) || str(rawOp.panoramaName)) {
        const refStr = str(rawOp.panoramaAssetId) || str(rawOp.panoramaName)
        const project = useProjectStore()
        const found = project.assets.find(
          (a) =>
            a.id === refStr ||
            (a.type === 'image' &&
              (a.name.trim().toLowerCase() === refStr.toLowerCase() ||
                a.name.toLowerCase().includes(refStr.toLowerCase())))
        )
        const targetId = found?.id ?? refStr
        if (liveScene) {
          liveScene.linkedPanoramaId.value = targetId
          liveScene.onScenePick()
        } else {
          stage.linkedPanoramaAssetId = targetId
        }
      }

      const worldRaw =
        rawOp.sceneWorld && typeof rawOp.sceneWorld === 'object'
          ? (rawOp.sceneWorld as Record<string, unknown>)
          : rawOp.world && typeof rawOp.world === 'object'
            ? (rawOp.world as Record<string, unknown>)
            : rawOp.sceneScalePercent !== undefined ||
                rawOp.scenePosition !== undefined ||
                rawOp.sceneRotationDeg !== undefined
              ? {
                  scalePercent: rawOp.sceneScalePercent,
                  position: rawOp.scenePosition,
                  rotationDeg: rawOp.sceneRotationDeg
                }
              : null
      if (worldRaw) {
        const curWorld = readDirectorSceneWorld(stage.world)
        const nextScalePct =
          num(worldRaw.scalePercent) ?? num(worldRaw.sceneScalePercent) ?? curWorld.scalePercent
        const nextPos = worldRaw.position
          ? patchVec3(curWorld.position, worldRaw.position)
          : curWorld.position
        const nextRot = patchRotationRad(curWorld.rotation, worldRaw) ?? curWorld.rotation
        if (liveScene) {
          liveScene.updateSceneWorld({
            scalePercent: nextScalePct,
            position: nextPos,
            rotation: nextRot
          })
        } else {
          stage.world = {
            scalePercent: nextScalePct,
            position: nextPos,
            rotation: nextRot
          }
        }
      }

      const gSource =
        rawOp.ground && typeof rawOp.ground === 'object'
          ? (rawOp.ground as Record<string, unknown>)
          : rawOp
      const hasGroundPatch =
        rawOp.ground !== undefined ||
        rawOp.gridVisible !== undefined ||
        rawOp.gridOpacity !== undefined ||
        rawOp.gridOffsetY !== undefined
      if (hasGroundPatch) {
        const gPatch = {
          ...(bool(gSource.visible ?? rawOp.gridVisible) !== undefined
            ? { visible: bool(gSource.visible ?? rawOp.gridVisible) }
            : {}),
          ...(bool(gSource.enabled) !== undefined ? { visible: bool(gSource.enabled) } : {}),
          ...(num(gSource.opacity ?? rawOp.gridOpacity) !== undefined
            ? { opacity: num(gSource.opacity ?? rawOp.gridOpacity) }
            : {}),
          ...(num(gSource.offsetY ?? rawOp.gridOffsetY) !== undefined
            ? { offsetY: num(gSource.offsetY ?? rawOp.gridOffsetY) }
            : {}),
          ...(bool(gSource.shadowCatcherEnabled) !== undefined
            ? { shadowCatcherEnabled: bool(gSource.shadowCatcherEnabled) }
            : {}),
          ...(num(gSource.shadowCatcherOpacity) !== undefined
            ? { shadowCatcherOpacity: num(gSource.shadowCatcherOpacity) }
            : {})
        }
        if (liveScene) liveScene.updateGround(gPatch)
        else {
          if (gPatch.visible !== undefined) stage.gridVisible = gPatch.visible
          if (gPatch.opacity !== undefined) stage.gridOpacity = gPatch.opacity
          if (gPatch.offsetY !== undefined) stage.gridOffsetY = gPatch.offsetY
          if (gPatch.shadowCatcherEnabled !== undefined)
            stage.shadowCatcherEnabled = gPatch.shadowCatcherEnabled
          if (gPatch.shadowCatcherOpacity !== undefined)
            stage.shadowCatcherOpacity = gPatch.shadowCatcherOpacity
        }
      }

      const envSource =
        rawOp.environment && typeof rawOp.environment === 'object'
          ? (rawOp.environment as Record<string, unknown>)
          : rawOp
      const hasEnvPatch =
        rawOp.environment !== undefined ||
        rawOp.fogEnabled !== undefined ||
        rawOp.fogDensity !== undefined ||
        rawOp.fogColor !== undefined ||
        rawOp.shadowCatcherEnabled !== undefined ||
        rawOp.shadowCatcherOpacity !== undefined
      if (hasEnvPatch) {
        const fogCol = normalizeColorInput(envSource.fogColor ?? rawOp.fogColor)
        const envPatch = {
          ...(bool(envSource.fogEnabled ?? rawOp.fogEnabled) !== undefined
            ? { fogEnabled: bool(envSource.fogEnabled ?? rawOp.fogEnabled) }
            : {}),
          ...(num(envSource.fogDensity ?? rawOp.fogDensity) !== undefined
            ? { fogDensity: num(envSource.fogDensity ?? rawOp.fogDensity) }
            : {}),
          ...(fogCol ? { fogColor: fogCol } : {}),
          ...(bool(envSource.shadowCatcherEnabled ?? rawOp.shadowCatcherEnabled) !== undefined
            ? {
                shadowCatcherEnabled: bool(
                  envSource.shadowCatcherEnabled ?? rawOp.shadowCatcherEnabled
                )
              }
            : {}),
          ...(num(envSource.shadowCatcherOpacity ?? rawOp.shadowCatcherOpacity) !== undefined
            ? {
                shadowCatcherOpacity: num(
                  envSource.shadowCatcherOpacity ?? rawOp.shadowCatcherOpacity
                )
              }
            : {})
        }
        if (liveScene) liveScene.updateStageEnvironment(envPatch)
        else {
          if (envPatch.fogEnabled !== undefined) stage.fogEnabled = envPatch.fogEnabled
          if (envPatch.fogDensity !== undefined) stage.fogDensity = envPatch.fogDensity
          if (envPatch.fogColor !== undefined) stage.fogColor = envPatch.fogColor
          if (envPatch.shadowCatcherEnabled !== undefined)
            stage.shadowCatcherEnabled = envPatch.shadowCatcherEnabled
          if (envPatch.shadowCatcherOpacity !== undefined)
            stage.shadowCatcherOpacity = envPatch.shadowCatcherOpacity
        }
      }

      if (bool(rawOp.panoramaVisible) !== undefined) {
        if (liveScene) liveScene.updatePanoramaVisible(bool(rawOp.panoramaVisible)!)
        else stage.panoramaVisible = bool(rawOp.panoramaVisible)!
      }
      if (num(rawOp.panoramaYaw) !== undefined) {
        if (liveScene) liveScene.updatePanoramaYaw(num(rawOp.panoramaYaw)!)
        else stage.panoramaYaw = num(rawOp.panoramaYaw)!
      }
      if (num(rawOp.panoramaRadius) !== undefined) {
        if (liveScene) liveScene.updatePanoramaRadius(num(rawOp.panoramaRadius)!)
        else stage.panoramaRadius = num(rawOp.panoramaRadius)!
      }
      if (str(rawOp.lightingPreset)) {
        const presetId = str(rawOp.lightingPreset) as DirectorLightingPresetId
        if (liveScene) liveScene.applyLightingPreset(presetId)
        else stage.lightingPreset = presetId
      }
      applied.push('environment_update')
      continue
    }

    if (opKind === 'viewport_update' || opKind === 'set_viewport' || opKind === 'view_action') {
      const vm = str(rawOp.viewMode)
      if ((vm === 'director' || vm === 'camera') && liveScene) {
        liveScene.setViewMode(vm)
      }
      const editMode = str(rawOp.stageEditMode)
      if ((editMode === 'scene' || editMode === 'animation') && liveScene) {
        liveScene.setStageEditMode(editMode)
      }
      const tm = str(rawOp.transformMode)
      if (tm === 'translate' || tm === 'rotate' || tm === 'scale') {
        if (liveScene) liveScene.setMode(tm as TransformMode)
        else stage.transformMode = tm as TransformMode
      }
      if (bool(rawOp.cameraPreviewOpen) !== undefined && liveScene) {
        liveScene.setCameraPreviewOpen(bool(rawOp.cameraPreviewOpen)!)
      }
      const sm = str(rawOp.shadingMode)
      if (sm && liveScene) {
        const normalized = normalizeDirectorShadingMode(sm as DirectorShadingMode)
        liveScene.setShadingMode(normalized)
      }
      const ar = str(rawOp.aspectRatio)
      if (ar) {
        const normalized = normalizeDirectorAspectRatio(ar as DirectorAspectRatio)
        if (liveScene) liveScene.setAspectRatio(normalized)
        else stage.aspectRatio = normalized
      }
      const cg = str(rawOp.compositionGuide)
      if (cg) {
        const normalized = normalizeDirectorCompositionGuide(cg as DirectorCompositionGuide)
        if (liveScene) liveScene.setCompositionGuide(normalized)
        else stage.compositionGuide = normalized
      }
      const cp = str(rawOp.capturePass)
      if (cp) {
        const normalized = normalizeDirectorCapturePass(cp as DirectorCapturePass)
        if (liveScene) liveScene.setCapturePass(normalized)
        else stage.capturePass = normalized
      }
      if (liveScene) {
        if (rawOp.moveToView === true) liveScene.moveSelectionToView()
        if (rawOp.alignWithView === true) liveScene.alignSelectionWithView()
        if (rawOp.alignViewToSelected === true) liveScene.alignViewToSelected()
        const orient = str(rawOp.viewOrientation).toLowerCase()
        if (orient) {
          const orientMap: Record<string, 'x' | '-x' | 'y' | '-y' | 'z' | '-z'> = {
            x: 'x',
            right: 'x',
            右: 'x',
            '-x': '-x',
            left: '-x',
            左: '-x',
            y: 'y',
            top: 'y',
            顶: 'y',
            上: 'y',
            '-y': '-y',
            bottom: '-y',
            底: '-y',
            下: '-y',
            z: 'z',
            front: 'z',
            前: 'z',
            正: 'z',
            '-z': '-z',
            back: '-z',
            后: '-z'
          }
          if (orientMap[orient]) {
            liveScene.setViewOrientation(orientMap[orient])
          }
        }
        if (num(rawOp.gizmoSize) !== undefined) {
          liveScene.setGizmoSize(num(rawOp.gizmoSize)!)
        }
        if (bool(rawOp.sceneLabelsVisible) !== undefined) {
          liveScene.setSceneLabelsVisible(bool(rawOp.sceneLabelsVisible)!)
        }
        if (bool(rawOp.cameraGizmosVisible) !== undefined) {
          liveScene.setCameraGizmosVisible(bool(rawOp.cameraGizmosVisible)!)
        }
        if (bool(rawOp.pathGizmosVisible) !== undefined) {
          liveScene.setPathGizmosVisible(bool(rawOp.pathGizmosVisible)!)
        }
        if (bool(rawOp.lightGizmosVisible) !== undefined) {
          liveScene.setLightGizmosVisible(bool(rawOp.lightGizmosVisible)!)
        }
        if (bool(rawOp.gridGizmoVisible) !== undefined) {
          liveScene.setGridGizmoVisible(bool(rawOp.gridGizmoVisible)!)
        }
        if (bool(rawOp.selectionBoundsVisible) !== undefined) {
          liveScene.setSelectionBoundsVisible(bool(rawOp.selectionBoundsVisible)!)
        }
        if (bool(rawOp.captureLabelsVisible) !== undefined) {
          liveScene.setCaptureLabelsVisible(bool(rawOp.captureLabelsVisible)!)
        }
        if (bool(rawOp.captureCameraLabelsVisible) !== undefined) {
          liveScene.setCaptureCameraLabelsVisible(bool(rawOp.captureCameraLabelsVisible)!)
        }
      }
      if (rawOp.stageControls && typeof rawOp.stageControls === 'object') {
        const sc = rawOp.stageControls as Record<string, unknown>
        const nextControls =
          sc.reset === true
            ? defaultStageControls()
            : {
                ...stageControls.value,
                ...(num(sc.orbitSensitivity) !== undefined
                  ? { orbitSensitivity: num(sc.orbitSensitivity)! }
                  : {}),
                ...(num(sc.panSensitivity) !== undefined
                  ? { panSensitivity: num(sc.panSensitivity)! }
                  : {}),
                ...(num(sc.zoomSensitivity) !== undefined
                  ? { zoomSensitivity: num(sc.zoomSensitivity)! }
                  : {}),
                ...(num(sc.flyMoveSpeed) !== undefined
                  ? { flyMoveSpeed: num(sc.flyMoveSpeed)! }
                  : {})
              }
        setStageControls(nextControls)
        void persistStageControls(nextControls)
      }
      applied.push('viewport_update')
      continue
    }

    if (opKind === 'ai_blocking' || opKind === 'director_blocking') {
      const prompt = str(rawOp.prompt)
      if (!prompt) {
        warnings.push('Missing prompt for ai_blocking')
        continue
      }
      if (!liveScene) {
        warnings.push('ai_blocking requires the 3D Director Stage to be open in the left window')
        continue
      }
      const res = await liveScene.applyAiDirectorBlocking(prompt)
      applied.push(`ai_blocking:${res.summary}`)
      continue
    }

    if (opKind === 'cinemachine_pack' || opKind === 'previz_pack') {
      const packId = (str(rawOp.packId) || 'dialogue_ab') as DirectorCinemachinePrevizPackId
      if (!liveScene) {
        warnings.push(
          'cinemachine_pack requires the 3D Director Stage to be open in the left window'
        )
        continue
      }
      const res = await liveScene.applyCinemachinePrevizPack(packId)
      applied.push(`cinemachine_pack:${packId}:${res.summary}`)
      continue
    }

    if (opKind === 'storyboard_previz') {
      if (!liveScene) {
        warnings.push(
          'storyboard_previz requires the 3D Director Stage to be open in the left window'
        )
        continue
      }
      const res = await liveScene.applyStoryboardPreviz({
        sceneId: str(rawOp.sceneId) || null,
        shotId: str(rawOp.shotId) || null
      })
      applied.push(`storyboard_previz:${res.summary}`)
      if (rawOp.captureAndWriteBack === true) {
        const wb = await liveScene.captureStoryboardPrevizAndWriteBack()
        applied.push(`storyboard_capture:${wb.count}`)
      }
      continue
    }

    if (opKind === 'capture_shot' || opKind === 'bake_storyboard') {
      if (!liveScene) {
        warnings.push('capture_shot requires the 3D Director Stage to be open in the left window')
        continue
      }
      if (opKind === 'bake_storyboard' || rawOp.cutTrackStoryboard === true) {
        const shots = liveScene.captureCutTrackStoryboard()
        applied.push(`capture_cut_track_storyboard:${shots.length}`)
      } else if (rawOp.allCameras === true) {
        const shots = liveScene.captureAllCameras()
        applied.push(`capture_all_cameras:${shots.length}`)
      } else if (rawOp.firstLastPair === true) {
        liveScene.takeFirstLastFramePair()
        applied.push('capture_first_last_pair')
      } else {
        liveScene.takeCameraShot()
        applied.push('capture_shot')
      }
      continue
    }

    if (opKind === 'anim_control') {
      if (!liveScene) {
        warnings.push('anim_control requires the 3D Director Stage to be open in the left window')
        continue
      }
      if (num(rawOp.duration) !== undefined) liveScene.setAnimDuration(num(rawOp.duration)!)
      if (bool(rawOp.loop) !== undefined) liveScene.setAnimLoop(bool(rawOp.loop)!)
      if (num(rawOp.playbackRate) !== undefined) {
        liveScene.setAnimPlaybackRate(num(rawOp.playbackRate)!)
      }
      const action = str(rawOp.action)
      if (action === 'play') liveScene.playAnimation()
      else if (action === 'pause') liveScene.pauseAnimation()
      else if (action === 'stop') liveScene.stopAnimation()
      else if (action === 'seek' && num(rawOp.time) !== undefined) {
        liveScene.seekAnimation(num(rawOp.time)!)
      } else if (action === 'add_track') {
        const targetKind = str(rawOp.targetKind) === 'camera' ? 'camera' : 'object'
        const targetId =
          str(rawOp.targetId) ||
          (targetKind === 'camera'
            ? fallbackCamId
            : (resolveSubjectObjectId(stage.objects, rawOp.targetName ?? rawOp.name) ??
              fallbackObjId))
        if (targetId) liveScene.addAnimTrack(targetKind, targetId)
      } else if (action === 'remove_track' && str(rawOp.trackId)) {
        liveScene.removeAnimTrack(str(rawOp.trackId))
      } else if (action === 'add_keyframe') {
        const trackId = str(rawOp.trackId) || liveScene.animSelectedTrackId.value || ''
        if (trackId) liveScene.addAnimKeyframe(trackId, num(rawOp.time))
      } else if (action === 'remove_keyframe') {
        const trackId = str(rawOp.trackId) || liveScene.animSelectedTrackId.value || ''
        const kfId = str(rawOp.keyframeId) || liveScene.animSelectedKeyframeId.value || ''
        if (trackId && kfId) liveScene.removeAnimKeyframe(trackId, kfId)
      } else if (action === 'add_cut_segment') {
        const cutTrackId = str(rawOp.trackId) || liveScene.addCameraCutTrack()
        const camId = str(rawOp.cameraId) || fallbackCamId || ''
        if (cutTrackId && camId) {
          liveScene.addCameraCutSegment(
            cutTrackId,
            camId,
            num(rawOp.start) ?? 0,
            num(rawOp.end) ?? 2
          )
        }
      } else if (action === 'export_video') {
        await liveScene.exportAnimationVideo()
      }
      applied.push(`anim_control:${action || 'update'}`)
      continue
    }

    warnings.push(`Unknown director_stage_edit op: ${opKind}`)
  }

  if (liveScene) {
    liveScene.flushPreview()
    await liveScene.saveNow()
  } else if (processingNodeId) {
    const project = useProjectStore()
    const asset = project.assets.find((item) => item.id === directorAssetId)
    if (asset) {
      const nextGenParams = patchGenParamsWithNodeStage(
        asset.genParams as Record<string, unknown> | undefined,
        processingNodeId,
        stage
      )
      await persistAssetRecord(directorAssetId, { genParams: nextGenParams })
    }
  }

  return {
    ok: true,
    applied,
    warnings,
    stageControls: stageControls.value,
    stage: serializeDirectorStageSnapshot(stage, {
      live: Boolean(liveScene),
      directorAssetId,
      processingNodeId,
      viewMode: liveScene?.viewMode?.value,
      shadingMode: liveScene?.shadingMode?.value,
      selectionKind: liveScene?.selectionKind?.value,
      selectedObjectId: liveScene?.selectedObjectId?.value,
      selectedCameraId: liveScene?.selectedCameraId?.value,
      animPlaying: liveScene?.animPlaying?.value,
      animTime: liveScene?.animTime?.value,
      liveScene
    })
  }
}
