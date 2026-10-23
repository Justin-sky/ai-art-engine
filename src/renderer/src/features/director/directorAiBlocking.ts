import {
  DIRECTOR_EXPRESSIVE_POSE_PRESETS,
  buildLightingPresetObjects,
  directorViewerRotationFromLook,
  focalLengthMmToFovDeg,
  type DirectorAnimTrack,
  type DirectorCameraCutSegment,
  type DirectorCameraState,
  type DirectorLightingPresetId,
  type DirectorStageState,
  type StageMannequinPreset,
  type StageObjectState,
  type StageVec3
} from '@shared/domain'
import { solveDollyZoomPosition } from '@shared/directorCinematography'

export interface DirectorAiBlockingTemplate {
  id: string
  labelKey: string
  labelZh: string
  labelEn: string
  prompt: string
  promptZh: string
  promptEn: string
}

export const DIRECTOR_AI_BLOCKING_TEMPLATES: readonly DirectorAiBlockingTemplate[] = [
  {
    id: 'standoff_ots',
    labelKey: 'director.stage.aiDirector.templateDuel',
    labelZh: '双人对峙 · 越肩正反打',
    labelEn: 'Standoff · OTS Shot-Reverse-Shot',
    prompt:
      '两名角色面对面对峙交谈，雷姆布兰特戏剧布光，全景建立镜头切A/B越肩正反打与85mm特写，开启薄雾',
    promptZh:
      '两名角色面对面对峙交谈，雷姆布兰特戏剧布光，全景建立镜头切A/B越肩正反打与85mm特写，开启薄雾',
    promptEn:
      'Two characters facing each other in dramatic standoff, Rembrandt lighting, wide establishing shot cutting to OTS A/B and 85mm close-up with atmospheric fog'
  },
  {
    id: 'hero_dolly',
    labelKey: 'director.stage.aiDirector.templateReveal',
    labelZh: '英雄亮相 · 仰拍希区柯克推镜',
    labelEn: 'Hero Reveal · Low-Angle Dolly Zoom',
    prompt: '单人英雄角色战斗姿态，逆光剪影舞台布光，低机位仰拍从广角24mm缓动推近到85mm特写',
    promptZh: '单人英雄角色战斗姿态，逆光剪影舞台布光，低机位仰拍从广角24mm缓动推近到85mm特写',
    promptEn:
      'Single hero character in combat pose, silhouette rim lighting, low-angle dolly-in from 24mm wide to 85mm close-up'
  },
  {
    id: 'cyber_chase',
    labelKey: 'director.stage.aiDirector.templateChase',
    labelZh: '赛博夜行 · 奔跑跟拍运镜',
    labelEn: 'Cyberpunk Run · Tracking Shot',
    prompt: '两名角色在赛博霓虹双色光下奔跑前进，浓雾氛围，35mm手持跟拍运镜',
    promptZh: '两名角色在赛博霓虹双色光下奔跑前进，浓雾氛围，35mm手持跟拍运镜',
    promptEn:
      'Two characters running forward under cyberpunk neon dual-color lighting, dense fog, 35mm handheld tracking camera'
  },
  {
    id: 'trio_stage',
    labelKey: 'director.stage.aiDirector.templateGroup',
    labelZh: '三人小队 · 环绕运镜调度',
    labelEn: 'Trio Squad · Orbit Camera Blocking',
    prompt: '三名角色呈三角阵型站位，黄金时刻暖阳布光，50mm镜头环绕运镜配合动作表演',
    promptZh: '三名角色呈三角阵型站位，黄金时刻暖阳布光，50mm镜头环绕运镜配合动作表演',
    promptEn:
      'Three characters in triangle formation, golden hour warm sunlight, 50mm camera orbit track with action poses'
  }
] as const

function clonePoseBones(presetId: string): Record<string, StageVec3> {
  const found = DIRECTOR_EXPRESSIVE_POSE_PRESETS.find((p) => p.id === presetId)
  if (!found) return {}
  const out: Record<string, StageVec3> = {}
  for (const [k, v] of Object.entries(found.bones)) {
    out[k] = { ...v }
  }
  return out
}

function detectLightingPreset(text: string): DirectorLightingPresetId {
  const lower = text.toLowerCase()
  if (/赛博|霓虹|cyber|neon/.test(lower)) return 'cyberpunk'
  if (/剪影|逆光|silhouette|rim/.test(lower)) return 'silhouette'
  if (/伦勃朗|雷姆布兰特|戏剧|暗调|rembrandt|noir|dramatic/.test(lower)) return 'rembrandt'
  if (/黄金|夕阳|黄昏|暖阳|golden|sunset|warm/.test(lower)) return 'goldenHour'
  if (/蝴蝶|特写美颜|butterfly|paramount/.test(lower)) return 'butterfly'
  return 'studio'
}

function detectActorCount(text: string): number {
  const lower = text.toLowerCase()
  if (/四人|4人|四个|four\s+character|four\s+people|4\s+actor/.test(lower)) return 4
  if (/三人|三名|3人|三个|三人小队|trio|three\s+character|three\s+people|3\s+actor/.test(lower)) {
    return 3
  }
  if (
    /双人|两人|两名|两个人|2人|对峙|正反打|越肩|对话|two\s+character|two\s+people|standoff|ots|dialogue/.test(
      lower
    )
  ) {
    return 2
  }
  return 1
}

function detectMannequinPreset(text: string): StageMannequinPreset {
  const lower = text.toLowerCase()
  if (/q版|二头身|卡通|chibi/.test(lower)) return 'chibi'
  if (/四足|动物|狼|狗|马|兽|quadruped|animal|dog|wolf|horse/.test(lower)) return 'quadruped'
  return 'humanoid'
}

export type DirectorCinemachinePrevizPackId =
  'ots_dialogue' | 'vertigo_orbit' | 'impact_shockwave' | 'triangle_standoff' | 'oner_tracking'

export interface DirectorCinemachinePrevizPackDef {
  id: DirectorCinemachinePrevizPackId
  labelKey: string
  descKey: string
  badgeKey: string
  labelZh: string
  labelEn: string
  descZh: string
  descEn: string
  badgeZh: string
  badgeEn: string
  cameraCount: number
  actorCount: number
  durationSec: number
}

export const DIRECTOR_CINEMACHINE_PREVIZ_PACKS: readonly DirectorCinemachinePrevizPackDef[] = [
  {
    id: 'ots_dialogue',
    labelKey: 'director.stage.aiDirector.packOtsTitle',
    descKey: 'director.stage.aiDirector.packOtsDesc',
    badgeKey: 'director.stage.aiDirector.packOtsBadge',
    labelZh: '经典双人正反打 · 180° 轴线四机位',
    labelEn: 'Classic OTS Dialogue · 180° 4-Cam Rig',
    descZh: '全景群像 → A/B 越肩三分法正反打 + 自动跟焦 → 0.9s 平滑推轨 85mm 特写',
    descEn: 'Master Group 35mm → OTS A/B 50mm Rule-of-Thirds + Auto-Focus → 0.9s Blend 85mm CU',
    badgeZh: '4 机位 · 8s',
    badgeEn: '4 Cams · 8s',
    cameraCount: 4,
    actorCount: 2,
    durationSec: 8
  },
  {
    id: 'vertigo_orbit',
    labelKey: 'director.stage.aiDirector.packVertigoTitle',
    descKey: 'director.stage.aiDirector.packVertigoDesc',
    badgeKey: 'director.stage.aiDirector.packVertigoBadge',
    labelZh: '希区柯克变焦 + 360° 觉醒环绕',
    labelEn: 'Vertigo Dolly-Zoom + 360° Hero Orbit',
    descZh: '24→85mm 滑动变焦空间压缩 → 0.75s 融合切入低机位 360° 环绕仰拍',
    descEn: '24→85mm Vertigo Dolly-Zoom lock → 0.75s smooth blend into 360° low-angle orbit',
    badgeZh: '2 机位 · 7s',
    badgeEn: '2 Cams · 7s',
    cameraCount: 2,
    actorCount: 1,
    durationSec: 7
  },
  {
    id: 'impact_shockwave',
    labelKey: 'director.stage.aiDirector.packImpactTitle',
    descKey: 'director.stage.aiDirector.packImpactDesc',
    badgeKey: 'director.stage.aiDirector.packImpactBadge',
    labelZh: '动作重击落地 + 冲击波震屏',
    labelEn: 'Action Impact + Impulse Shockwave',
    descZh: '高速俯冲跟拍 → 落地瞬间硬切 28mm 仰拍触发衰减震屏 → 慢镜英雄环绕',
    descEn: 'High-speed dive follow → hard cut to 28mm low-angle Impulse shockwave → slow-mo orbit',
    badgeZh: '3 机位 · 6s',
    badgeEn: '3 Cams · 6s',
    cameraCount: 3,
    actorCount: 2,
    durationSec: 6
  },
  {
    id: 'triangle_standoff',
    labelKey: 'director.stage.aiDirector.packTriangleTitle',
    descKey: 'director.stage.aiDirector.packTriangleDesc',
    badgeKey: 'director.stage.aiDirector.packTriangleBadge',
    labelZh: '三人博弈 · 莱昂内三角极特写快切',
    labelEn: '3-Way Standoff · Leone ECU Montage',
    descZh: '28mm 群像自适应构图 → A/B/C 三机位 85mm 长焦呼吸眼神极特写节奏快切',
    descEn: '28mm Group Framing wide → A/B/C 85mm telephoto breathing ECU accelerating cuts',
    badgeZh: '4 机位 · 8s',
    badgeEn: '4 Cams · 8s',
    cameraCount: 4,
    actorCount: 3,
    durationSec: 8
  },
  {
    id: 'oner_tracking',
    labelKey: 'director.stage.aiDirector.packOnerTitle',
    descKey: 'director.stage.aiDirector.packOnerDesc',
    badgeKey: 'director.stage.aiDirector.packOnerBadge',
    labelZh: '一镜到底 · 斯坦尼康长镜头跟拍',
    labelEn: 'Single-Take Oner · Steadicam Follow',
    descZh: 'Transposer 阻尼弹簧倒退跟拍行走角色 + 1.2s 无缝甩镜切入侧向平行跟拍',
    descEn: 'Transposer damped spring lead tracking + 1.2s seamless swing to side profile tracking',
    badgeZh: '2 机位 · 8s',
    badgeEn: '2 Cams · 8s',
    cameraCount: 2,
    actorCount: 2,
    durationSec: 8
  }
] as const

interface ActorPlacementSpec {
  position: StageVec3
  rotation: StageVec3
  poseId: string
  endPosition?: StageVec3
  clipName?: string
  secondClipName?: string
}

const ACTOR_COLORS = ['#56b8ff', '#ff7a90', '#a6e3a1', '#f9e2af']

/**
 * 复用舞台上已有的非 AI 角色/模型作为主演（保留资产与模型引用，仅对齐站位与朝向），不足部分自动补齐 3D 人偶。
 */
function resolveStageActorsAndProps(
  currentStage: DirectorStageState,
  placements: readonly ActorPlacementSpec[],
  mannequinPreset: StageMannequinPreset,
  isZh: boolean
): { actors: StageObjectState[]; keptProps: StageObjectState[] } {
  const existingUserActors = currentStage.objects.filter(
    (obj) =>
      (obj.kind === 'character' || obj.kind === 'model') &&
      !obj.id.startsWith('ai-actor:') &&
      !obj.id.startsWith('light:preset:')
  )
  const usedIds = new Set<string>()
  const actors: StageObjectState[] = []

  for (let i = 0; i < placements.length; i++) {
    const spec = placements[i]
    const letter = String.fromCharCode(65 + i)
    const existing = existingUserActors[i]
    if (existing) {
      usedIds.add(existing.id)
      actors.push({
        ...existing,
        visible: true,
        locked: false,
        nameVisible: true,
        position: { ...spec.position },
        rotation: { ...spec.rotation },
        ...(existing.kind === 'character'
          ? {
              mannequinPreset: existing.mannequinPreset ?? mannequinPreset,
              bonePose: clonePoseBones(spec.poseId)
            }
          : {})
      })
    } else {
      actors.push({
        id: `ai-actor:${i + 1}`,
        name: isZh ? `角色 ${letter}` : `Actor ${letter}`,
        kind: 'character',
        mannequinPreset,
        color: ACTOR_COLORS[i % ACTOR_COLORS.length],
        visible: true,
        locked: false,
        nameVisible: true,
        position: { ...spec.position },
        rotation: { ...spec.rotation },
        scale: { x: 1, y: 1, z: 1 },
        bonePose: clonePoseBones(spec.poseId)
      })
    }
  }

  const keptProps = currentStage.objects.filter(
    (obj) =>
      !obj.id.startsWith('ai-actor:') &&
      !obj.id.startsWith('light:preset:') &&
      obj.kind !== 'light' &&
      !usedIds.has(obj.id)
  )

  return { actors, keptProps }
}

function buildActorMotionTracks(
  actors: readonly StageObjectState[],
  placements: readonly ActorPlacementSpec[],
  duration: number,
  isZh: boolean
): DirectorAnimTrack[] {
  const tracks: DirectorAnimTrack[] = []
  for (let i = 0; i < actors.length; i++) {
    const actor = actors[i]
    const spec = placements[i]
    const startPos = { ...actor.position }
    const endPos = spec?.endPosition ? { ...spec.endPosition } : { ...actor.position }
    const clipName = spec?.clipName ?? 'Idle'
    const secondClip = spec?.secondClipName ?? 'Wave'
    const splitTime = Number((duration * 0.65).toFixed(2))
    tracks.push({
      id: `track:ai:actor:${i + 1}`,
      name: isZh ? `${actor.name} 动作轨` : `${actor.name} Motion`,
      targetKind: 'object',
      targetId: actor.id,
      start: 0,
      end: duration,
      path:
        startPos.x !== endPos.x || startPos.y !== endPos.y || startPos.z !== endPos.z
          ? {
              kind: 'line',
              points: [startPos, endPos],
              closed: false
            }
          : null,
      keyframes: [
        {
          id: `kf:ai:actor:${i + 1}:0`,
          time: 0,
          position: startPos,
          rotation: { ...actor.rotation },
          easing: 'easeInOut'
        },
        {
          id: `kf:ai:actor:${i + 1}:1`,
          time: duration,
          position: endPos,
          rotation: { ...actor.rotation },
          easing: 'easeInOut'
        }
      ],
      skeletonClips: [
        {
          id: `sk:ai:${i + 1}:1`,
          clip: clipName,
          start: 0,
          end: splitTime,
          speed: 1,
          loop: true,
          crossFadeSec: 0.35
        },
        {
          id: `sk:ai:${i + 1}:2`,
          clip: secondClip,
          start: splitTime,
          end: duration,
          speed: 1,
          loop: true,
          crossFadeSec: 0.35
        }
      ]
    })
  }
  return tracks
}

/**
 * 一键生成多机位正反打 + Cinemachine 运镜预演包（Previz Pack）。
 */
export function generateCinemachinePrevizPack(
  currentStage: DirectorStageState,
  packId: DirectorCinemachinePrevizPackId,
  locale?: string
): DirectorStageState {
  const isZh = locale ? locale.toLowerCase().startsWith('zh') : true
  const baseY = typeof currentStage.gridOffsetY === 'number' ? currentStage.gridOffsetY : -0.8
  const centerTarget: StageVec3 = { x: 0, y: baseY + 1.45, z: 0 }

  let placements: ActorPlacementSpec[] = []
  let lightingPreset: DirectorLightingPresetId = 'rembrandt'
  let compositionGuide: DirectorStageState['compositionGuide'] = 'thirds'
  let duration = 8
  const cameras: DirectorCameraState[] = []
  const tracks: DirectorAnimTrack[] = []

  if (packId === 'ots_dialogue') {
    duration = 8
    lightingPreset = 'rembrandt'
    compositionGuide = 'thirds'
    placements = [
      {
        position: { x: -1.15, y: baseY, z: 0 },
        rotation: { x: 0, y: Math.PI / 2, z: 0 },
        poseId: 'hand.pointRight',
        clipName: 'Idle',
        secondClipName: 'Wave'
      },
      {
        position: { x: 1.15, y: baseY, z: 0 },
        rotation: { x: 0, y: -Math.PI / 2, z: 0 },
        poseId: 'gaze.heroic',
        clipName: 'Idle',
        secondClipName: 'Action'
      }
    ]
    const { actors, keptProps } = resolveStageActorsAndProps(
      currentStage,
      placements,
      'humanoid',
      isZh
    )
    const [actorA, actorB] = actors

    // 1. Wide Establishing Group Shot (35mm)
    const widePos: StageVec3 = { x: 0, y: baseY + 1.58, z: 3.85 }
    const wideCam: DirectorCameraState = {
      id: 'cam:cm:ots_wide',
      name: isZh ? '机位 1 · 全景主镜 35mm' : 'Cam 1 · Master Wide 35mm',
      visible: true,
      locked: false,
      viewer: {
        position: widePos,
        target: centerTarget,
        rotation: directorViewerRotationFromLook(widePos, centerTarget),
        fov: focalLengthMmToFovDeg(35),
        focalLengthMm: 35,
        aperture: 4.0,
        focusDistance: 3.85,
        cinemachine: {
          bodyMode: 'groupFraming',
          aimMode: 'groupComposer',
          groupTargetIds: [actorA.id, actorB.id],
          groupFramingScale: 1.28,
          positionDamping: 0.35,
          aimDamping: 0.25,
          screenOffset: { x: 0, y: 0.04 },
          deadZoneWidth: 0.1,
          deadZoneHeight: 0.1,
          noisePreset: 'handheld'
        }
      }
    }

    // 2. OTS A -> B (50mm f/1.8, Right Thirds + Auto Focus)
    const otsAPos: StageVec3 = { x: -1.58, y: baseY + 1.68, z: 0.68 }
    const otsATarget: StageVec3 = { x: 1.15, y: baseY + 1.68, z: 0 }
    const otsACam: DirectorCameraState = {
      id: 'cam:cm:ots_a',
      name: isZh ? '机位 2 · 过肩正打 A→B 50mm' : 'Cam 2 · OTS A→B 50mm',
      visible: true,
      locked: false,
      viewer: {
        position: otsAPos,
        target: otsATarget,
        rotation: directorViewerRotationFromLook(otsAPos, otsATarget),
        fov: focalLengthMmToFovDeg(50),
        focalLengthMm: 50,
        aperture: 1.8,
        focusDistance: 2.82,
        cinemachine: {
          bodyMode: 'none',
          aimMode: 'composer',
          lookAtTargetId: actorB.id,
          aimTargetPart: 'head',
          aimDamping: 0.22,
          screenOffset: { x: 0.18, y: 0.04 },
          deadZoneWidth: 0.06,
          deadZoneHeight: 0.06,
          autoFocusPull: true,
          noisePreset: 'handheld'
        }
      }
    }

    // 3. OTS B -> A (50mm f/1.8, Left Thirds + Auto Focus)
    const otsBPos: StageVec3 = { x: 1.58, y: baseY + 1.68, z: 0.68 }
    const otsBTarget: StageVec3 = { x: -1.15, y: baseY + 1.68, z: 0 }
    const otsBCam: DirectorCameraState = {
      id: 'cam:cm:ots_b',
      name: isZh ? '机位 3 · 过肩反打 B→A 50mm' : 'Cam 3 · OTS B→A 50mm',
      visible: true,
      locked: false,
      viewer: {
        position: otsBPos,
        target: otsBTarget,
        rotation: directorViewerRotationFromLook(otsBPos, otsBTarget),
        fov: focalLengthMmToFovDeg(50),
        focalLengthMm: 50,
        aperture: 1.8,
        focusDistance: 2.82,
        cinemachine: {
          bodyMode: 'none',
          aimMode: 'composer',
          lookAtTargetId: actorA.id,
          aimTargetPart: 'head',
          aimDamping: 0.22,
          screenOffset: { x: -0.18, y: 0.04 },
          deadZoneWidth: 0.06,
          deadZoneHeight: 0.06,
          autoFocusPull: true,
          noisePreset: 'handheld'
        }
      }
    }

    // 4. Close-Up 85mm f/1.4 on Actor A (with 0.9s smooth Cinemachine Brain transition)
    const cuPos: StageVec3 = { x: 0.05, y: baseY + 1.75, z: 1.68 }
    const cuTarget: StageVec3 = { x: -1.15, y: baseY + 1.75, z: 0 }
    const cuCam: DirectorCameraState = {
      id: 'cam:cm:ots_cu',
      name: isZh ? '机位 4 · 情绪特写 85mm' : 'Cam 4 · Close-Up 85mm',
      visible: true,
      locked: false,
      viewer: {
        position: cuPos,
        target: cuTarget,
        rotation: directorViewerRotationFromLook(cuPos, cuTarget),
        fov: focalLengthMmToFovDeg(85),
        focalLengthMm: 85,
        aperture: 1.4,
        focusDistance: 2.06,
        cinemachine: {
          bodyMode: 'none',
          aimMode: 'composer',
          lookAtTargetId: actorA.id,
          aimTargetPart: 'head',
          aimDamping: 0.28,
          screenOffset: { x: -0.06, y: 0 },
          deadZoneWidth: 0.04,
          deadZoneHeight: 0.04,
          autoFocusPull: true,
          noisePreset: 'telephoto'
        }
      }
    }

    cameras.push(wideCam, otsACam, otsBCam, cuCam)
    tracks.push(
      {
        id: 'track:cm:cuts',
        name: isZh ? 'Cinemachine 切镜轨' : 'Cinemachine Cut Track',
        targetKind: 'camera',
        targetId: wideCam.id,
        start: 0,
        end: duration,
        path: null,
        keyframes: [],
        cameraCut: true,
        cameraSegments: [
          { id: 'cut:cm:1', cameraId: wideCam.id, start: 0, end: 2.0 },
          { id: 'cut:cm:2', cameraId: otsACam.id, start: 2.0, end: 4.0, blendInSec: 0 },
          { id: 'cut:cm:3', cameraId: otsBCam.id, start: 4.0, end: 6.0, blendInSec: 0 },
          {
            id: 'cut:cm:4',
            cameraId: cuCam.id,
            start: 6.0,
            end: duration,
            blendInSec: 0.9,
            blendCurve: 'easeInOut'
          }
        ]
      },
      ...buildActorMotionTracks(actors, placements, duration, isZh)
    )

    return finalizePrevizStage(
      currentStage,
      keptProps,
      actors,
      cameras,
      tracks,
      lightingPreset,
      compositionGuide,
      duration,
      isZh
    )
  }

  if (packId === 'vertigo_orbit') {
    duration = 7
    lightingPreset = 'silhouette'
    compositionGuide = 'crosshair'
    placements = [
      {
        position: { x: 0, y: baseY, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        poseId: 'gaze.combatReady',
        clipName: 'Action',
        secondClipName: 'Idle'
      }
    ]
    const { actors, keptProps } = resolveStageActorsAndProps(
      currentStage,
      placements,
      'humanoid',
      isZh
    )
    const [actorA] = actors

    const vertigoPos: StageVec3 = { x: 0, y: baseY + 1.72, z: 2.15 }
    const vertigoTarget: StageVec3 = { x: 0, y: baseY + 1.74, z: 0 }
    const startFov = focalLengthMmToFovDeg(24)
    const endFov = focalLengthMmToFovDeg(85)
    const vertigoEndPos = solveDollyZoomPosition(vertigoPos, vertigoTarget, startFov, endFov)
    const vertigoCam: DirectorCameraState = {
      id: 'cam:cm:vertigo',
      name: isZh ? '机位 1 · 希区柯克变焦 24→85mm' : 'Cam 1 · Vertigo Zoom 24→85mm',
      visible: true,
      locked: false,
      viewer: {
        position: vertigoPos,
        target: vertigoTarget,
        rotation: directorViewerRotationFromLook(vertigoPos, vertigoTarget),
        fov: startFov,
        focalLengthMm: 24,
        dollyZoomLock: true,
        aperture: 2.0,
        focusDistance: 2.15,
        cinemachine: {
          bodyMode: 'none',
          aimMode: 'composer',
          lookAtTargetId: actorA.id,
          aimTargetPart: 'head',
          aimDamping: 0.15,
          screenOffset: { x: 0, y: 0 },
          autoFocusPull: true,
          noisePreset: 'telephoto'
        }
      }
    }

    const orbitPos: StageVec3 = { x: 0, y: baseY + 1.15, z: 2.65 }
    const orbitCam: DirectorCameraState = {
      id: 'cam:cm:orbit_hero',
      name: isZh ? '机位 2 · 360° 仰拍觉醒环绕' : 'Cam 2 · 360° Hero Orbit',
      visible: true,
      locked: false,
      viewer: {
        position: orbitPos,
        target: vertigoTarget,
        rotation: directorViewerRotationFromLook(orbitPos, vertigoTarget),
        fov: focalLengthMmToFovDeg(35),
        focalLengthMm: 35,
        aperture: 2.2,
        focusDistance: 2.65,
        cinemachine: {
          bodyMode: 'orbital',
          aimMode: 'composer',
          followTargetId: actorA.id,
          lookAtTargetId: actorA.id,
          aimTargetPart: 'chest',
          orbitRadius: 2.65,
          orbitHeight: 1.15,
          orbitSpeedDegPerSec: 85,
          positionDamping: 0.25,
          aimDamping: 0.2,
          screenOffset: { x: 0, y: 0.04 },
          autoFocusPull: true,
          noisePreset: 'droneHover'
        }
      }
    }

    cameras.push(vertigoCam, orbitCam)
    tracks.push(
      {
        id: 'track:cm:cuts',
        name: isZh ? 'Cinemachine 切镜轨' : 'Cinemachine Cut Track',
        targetKind: 'camera',
        targetId: vertigoCam.id,
        start: 0,
        end: duration,
        path: null,
        keyframes: [],
        cameraCut: true,
        cameraSegments: [
          { id: 'cut:cm:1', cameraId: vertigoCam.id, start: 0, end: 3.2 },
          {
            id: 'cut:cm:2',
            cameraId: orbitCam.id,
            start: 3.2,
            end: duration,
            blendInSec: 0.75,
            blendCurve: 'easeInOut'
          }
        ]
      },
      {
        id: 'track:cm:vertigo_fov',
        name: isZh ? '希区柯克变焦轨' : 'Vertigo FOV Track',
        targetKind: 'camera',
        targetId: vertigoCam.id,
        start: 0,
        end: 3.2,
        path: {
          kind: 'line',
          points: [vertigoPos, vertigoEndPos],
          closed: false
        },
        keyframes: [
          {
            id: 'kf:cm:vertigo:0',
            time: 0,
            position: vertigoPos,
            rotation: directorViewerRotationFromLook(vertigoPos, vertigoTarget),
            easing: 'easeInOut',
            fov: startFov
          },
          {
            id: 'kf:cm:vertigo:1',
            time: 3.2,
            position: vertigoEndPos,
            rotation: directorViewerRotationFromLook(vertigoEndPos, vertigoTarget),
            easing: 'easeInOut',
            fov: endFov
          }
        ]
      },
      ...buildActorMotionTracks(actors, placements, duration, isZh)
    )

    return finalizePrevizStage(
      currentStage,
      keptProps,
      actors,
      cameras,
      tracks,
      lightingPreset,
      compositionGuide,
      duration,
      isZh
    )
  }

  if (packId === 'impact_shockwave') {
    duration = 6
    lightingPreset = 'cyberpunk'
    compositionGuide = 'diagonal'
    placements = [
      {
        position: { x: -0.95, y: baseY, z: 0.12 },
        endPosition: { x: -0.35, y: baseY, z: 0.05 },
        rotation: { x: 0, y: Math.PI / 2, z: 0 },
        poseId: 'gaze.combatReady',
        clipName: 'Action',
        secondClipName: 'Idle'
      },
      {
        position: { x: 0.78, y: baseY, z: -0.12 },
        rotation: { x: 0, y: -Math.PI / 2, z: 0 },
        poseId: 'gaze.heroic',
        clipName: 'Action',
        secondClipName: 'Wave'
      }
    ]
    const { actors, keptProps } = resolveStageActorsAndProps(
      currentStage,
      placements,
      'humanoid',
      isZh
    )
    const [actorA, actorB] = actors

    // 1. High-speed Dive Tracking (0 ~ 1.8s)
    const divePos: StageVec3 = { x: -2.1, y: baseY + 1.68, z: 1.85 }
    const diveCam: DirectorCameraState = {
      id: 'cam:cm:impact_dive',
      name: isZh ? '机位 1 · 高速突进跟拍 24mm' : 'Cam 1 · High-Speed Dive 24mm',
      visible: true,
      locked: false,
      viewer: {
        position: divePos,
        target: centerTarget,
        rotation: directorViewerRotationFromLook(divePos, centerTarget),
        fov: focalLengthMmToFovDeg(24),
        focalLengthMm: 24,
        aperture: 2.8,
        focusDistance: 2.4,
        cinemachine: {
          bodyMode: 'transposer',
          aimMode: 'composer',
          followTargetId: actorA.id,
          lookAtTargetId: actorB.id,
          aimTargetPart: 'chest',
          followSpace: 'targetLocal',
          followOffset: { x: -1.5, y: 1.6, z: 1.45 },
          positionDamping: 0.28,
          aimDamping: 0.18,
          autoFocusPull: true,
          noisePreset: 'carMount'
        }
      }
    }

    // 2. Low-Angle Impact Shockwave (1.8 ~ 3.6s) with Impulse at t = 1.85s
    const hitPos: StageVec3 = { x: 0.12, y: baseY + 0.78, z: 2.15 }
    const hitTarget: StageVec3 = { x: 0, y: baseY + 1.42, z: 0 }
    const hitCam: DirectorCameraState = {
      id: 'cam:cm:impact_hit',
      name: isZh ? '机位 2 · 落地冲击波仰拍 28mm' : 'Cam 2 · Impact Shockwave 28mm',
      visible: true,
      locked: false,
      viewer: {
        position: hitPos,
        target: hitTarget,
        rotation: directorViewerRotationFromLook(hitPos, hitTarget),
        fov: focalLengthMmToFovDeg(28),
        focalLengthMm: 28,
        aperture: 2.8,
        focusDistance: 2.15,
        cinemachine: {
          bodyMode: 'none',
          aimMode: 'composer',
          lookAtTargetId: actorA.id,
          aimTargetPart: 'chest',
          aimDamping: 0.12,
          screenOffset: { x: -0.05, y: 0.04 },
          autoFocusPull: true,
          noisePreset: 'handheld',
          impulseTimeSec: 1.85,
          impulseIntensity: 1.35
        }
      }
    }

    // 3. Slow-Mo Orbital Hero Shot (3.6 ~ 6.0s)
    const slowPos: StageVec3 = { x: 1.45, y: baseY + 1.45, z: 2.35 }
    const slowCam: DirectorCameraState = {
      id: 'cam:cm:impact_slowmo',
      name: isZh ? '机位 3 · 慢镜英雄环绕 50mm' : 'Cam 3 · Slow-Mo Hero Orbit 50mm',
      visible: true,
      locked: false,
      viewer: {
        position: slowPos,
        target: centerTarget,
        rotation: directorViewerRotationFromLook(slowPos, centerTarget),
        fov: focalLengthMmToFovDeg(50),
        focalLengthMm: 50,
        aperture: 1.8,
        focusDistance: 2.45,
        cinemachine: {
          bodyMode: 'orbital',
          aimMode: 'composer',
          followTargetId: actorA.id,
          lookAtTargetId: actorA.id,
          aimTargetPart: 'head',
          orbitRadius: 2.45,
          orbitHeight: 1.45,
          orbitSpeedDegPerSec: 42,
          positionDamping: 0.35,
          aimDamping: 0.25,
          autoFocusPull: true,
          noisePreset: 'droneHover'
        }
      }
    }

    cameras.push(diveCam, hitCam, slowCam)
    tracks.push(
      {
        id: 'track:cm:cuts',
        name: isZh ? 'Cinemachine 切镜轨' : 'Cinemachine Cut Track',
        targetKind: 'camera',
        targetId: diveCam.id,
        start: 0,
        end: duration,
        path: null,
        keyframes: [],
        cameraCut: true,
        cameraSegments: [
          { id: 'cut:cm:1', cameraId: diveCam.id, start: 0, end: 1.8 },
          { id: 'cut:cm:2', cameraId: hitCam.id, start: 1.8, end: 3.6, blendInSec: 0 },
          {
            id: 'cut:cm:3',
            cameraId: slowCam.id,
            start: 3.6,
            end: duration,
            blendInSec: 0.8,
            blendCurve: 'easeInOut'
          }
        ]
      },
      ...buildActorMotionTracks(actors, placements, duration, isZh)
    )

    return finalizePrevizStage(
      currentStage,
      keptProps,
      actors,
      cameras,
      tracks,
      lightingPreset,
      compositionGuide,
      duration,
      isZh
    )
  }

  if (packId === 'triangle_standoff') {
    duration = 8
    lightingPreset = 'goldenHour'
    compositionGuide = 'golden'
    placements = [
      {
        position: { x: -1.45, y: baseY, z: 0.35 },
        rotation: { x: 0, y: 1.15, z: 0 },
        poseId: 'gaze.combatReady',
        clipName: 'Idle',
        secondClipName: 'Action'
      },
      {
        position: { x: 1.45, y: baseY, z: 0.35 },
        rotation: { x: 0, y: -1.15, z: 0 },
        poseId: 'hand.pointRight',
        clipName: 'Idle',
        secondClipName: 'Wave'
      },
      {
        position: { x: 0, y: baseY, z: -1.15 },
        rotation: { x: 0, y: 0, z: 0 },
        poseId: 'gaze.heroic',
        clipName: 'Idle',
        secondClipName: 'Action'
      }
    ]
    const { actors, keptProps } = resolveStageActorsAndProps(
      currentStage,
      placements,
      'humanoid',
      isZh
    )
    const [actorA, actorB, actorC] = actors

    const groupPos: StageVec3 = { x: 0, y: baseY + 1.78, z: 3.95 }
    const groupTarget: StageVec3 = { x: 0, y: baseY + 1.42, z: -0.15 }
    const groupCam: DirectorCameraState = {
      id: 'cam:cm:tri_group',
      name: isZh ? '机位 1 · 三角群像 28mm' : 'Cam 1 · Triangle Group 28mm',
      visible: true,
      locked: false,
      viewer: {
        position: groupPos,
        target: groupTarget,
        rotation: directorViewerRotationFromLook(groupPos, groupTarget),
        fov: focalLengthMmToFovDeg(28),
        focalLengthMm: 28,
        aperture: 4.0,
        focusDistance: 4.1,
        cinemachine: {
          bodyMode: 'groupFraming',
          aimMode: 'groupComposer',
          groupTargetIds: [actorA.id, actorB.id, actorC.id],
          groupFramingScale: 1.3,
          positionDamping: 0.35,
          aimDamping: 0.25,
          noisePreset: 'handheld'
        }
      }
    }

    const ecuAPos: StageVec3 = { x: -0.25, y: baseY + 1.75, z: 1.95 }
    const ecuATarget: StageVec3 = { x: -1.45, y: baseY + 1.75, z: 0.35 }
    const ecuACam: DirectorCameraState = {
      id: 'cam:cm:tri_ecu_a',
      name: isZh ? '机位 2 · 角色 A 极特写 85mm' : 'Cam 2 · Actor A ECU 85mm',
      visible: true,
      locked: false,
      viewer: {
        position: ecuAPos,
        target: ecuATarget,
        rotation: directorViewerRotationFromLook(ecuAPos, ecuATarget),
        fov: focalLengthMmToFovDeg(85),
        focalLengthMm: 85,
        aperture: 1.6,
        focusDistance: 2.0,
        cinemachine: {
          bodyMode: 'none',
          aimMode: 'composer',
          lookAtTargetId: actorA.id,
          aimTargetPart: 'head',
          aimDamping: 0.2,
          screenOffset: { x: -0.08, y: 0 },
          autoFocusPull: true,
          noisePreset: 'telephoto'
        }
      }
    }

    const ecuBPos: StageVec3 = { x: 0.25, y: baseY + 1.75, z: 1.95 }
    const ecuBTarget: StageVec3 = { x: 1.45, y: baseY + 1.75, z: 0.35 }
    const ecuBCam: DirectorCameraState = {
      id: 'cam:cm:tri_ecu_b',
      name: isZh ? '机位 3 · 角色 B 极特写 85mm' : 'Cam 3 · Actor B ECU 85mm',
      visible: true,
      locked: false,
      viewer: {
        position: ecuBPos,
        target: ecuBTarget,
        rotation: directorViewerRotationFromLook(ecuBPos, ecuBTarget),
        fov: focalLengthMmToFovDeg(85),
        focalLengthMm: 85,
        aperture: 1.6,
        focusDistance: 2.0,
        cinemachine: {
          bodyMode: 'none',
          aimMode: 'composer',
          lookAtTargetId: actorB.id,
          aimTargetPart: 'head',
          aimDamping: 0.2,
          screenOffset: { x: 0.08, y: 0 },
          autoFocusPull: true,
          noisePreset: 'telephoto'
        }
      }
    }

    const ecuCPos: StageVec3 = { x: 0, y: baseY + 1.75, z: 0.85 }
    const ecuCTarget: StageVec3 = { x: 0, y: baseY + 1.75, z: -1.15 }
    const ecuCCam: DirectorCameraState = {
      id: 'cam:cm:tri_ecu_c',
      name: isZh ? '机位 4 · 角色 C 极特写 85mm' : 'Cam 4 · Actor C ECU 85mm',
      visible: true,
      locked: false,
      viewer: {
        position: ecuCPos,
        target: ecuCTarget,
        rotation: directorViewerRotationFromLook(ecuCPos, ecuCTarget),
        fov: focalLengthMmToFovDeg(85),
        focalLengthMm: 85,
        aperture: 1.6,
        focusDistance: 2.0,
        cinemachine: {
          bodyMode: 'none',
          aimMode: 'composer',
          lookAtTargetId: actorC.id,
          aimTargetPart: 'head',
          aimDamping: 0.2,
          screenOffset: { x: 0, y: 0 },
          autoFocusPull: true,
          noisePreset: 'telephoto'
        }
      }
    }

    cameras.push(groupCam, ecuACam, ecuBCam, ecuCCam)
    tracks.push(
      {
        id: 'track:cm:cuts',
        name: isZh ? 'Cinemachine 切镜轨' : 'Cinemachine Cut Track',
        targetKind: 'camera',
        targetId: groupCam.id,
        start: 0,
        end: duration,
        path: null,
        keyframes: [],
        cameraCut: true,
        cameraSegments: [
          { id: 'cut:cm:1', cameraId: groupCam.id, start: 0, end: 2.4 },
          { id: 'cut:cm:2', cameraId: ecuACam.id, start: 2.4, end: 4.4, blendInSec: 0 },
          { id: 'cut:cm:3', cameraId: ecuBCam.id, start: 4.4, end: 6.0, blendInSec: 0 },
          { id: 'cut:cm:4', cameraId: ecuCCam.id, start: 6.0, end: duration, blendInSec: 0 }
        ]
      },
      ...buildActorMotionTracks(actors, placements, duration, isZh)
    )

    return finalizePrevizStage(
      currentStage,
      keptProps,
      actors,
      cameras,
      tracks,
      lightingPreset,
      compositionGuide,
      duration,
      isZh
    )
  }

  // Default / 'oner_tracking': Single-Take Steadicam Oner
  duration = 8
  lightingPreset = 'cyberpunk'
  compositionGuide = 'thirds'
  placements = [
    {
      position: { x: -0.45, y: baseY, z: -1.55 },
      endPosition: { x: -0.45, y: baseY, z: 1.35 },
      rotation: { x: 0, y: 0, z: 0 },
      poseId: 'gaze.heroic',
      clipName: 'Walk',
      secondClipName: 'Walk'
    },
    {
      position: { x: 0.55, y: baseY, z: -1.85 },
      endPosition: { x: 0.55, y: baseY, z: 1.05 },
      rotation: { x: 0, y: 0, z: 0 },
      poseId: 'hand.relaxed',
      clipName: 'Walk',
      secondClipName: 'Walk'
    }
  ]
  const { actors, keptProps } = resolveStageActorsAndProps(
    currentStage,
    placements,
    'humanoid',
    isZh
  )
  const [actorA] = actors

  const leadPos: StageVec3 = { x: -0.1, y: baseY + 1.62, z: 0.85 }
  const leadTarget: StageVec3 = { x: -0.45, y: baseY + 1.58, z: -1.55 }
  const leadCam: DirectorCameraState = {
    id: 'cam:cm:oner_lead',
    name: isZh ? '机位 1 · 斯坦尼康倒退跟拍 35mm' : 'Cam 1 · Steadicam Lead 35mm',
    visible: true,
    locked: false,
    viewer: {
      position: leadPos,
      target: leadTarget,
      rotation: directorViewerRotationFromLook(leadPos, leadTarget),
      fov: focalLengthMmToFovDeg(35),
      focalLengthMm: 35,
      aperture: 2.0,
      focusDistance: 2.4,
      cinemachine: {
        bodyMode: 'transposer',
        aimMode: 'composer',
        followTargetId: actorA.id,
        lookAtTargetId: actorA.id,
        aimTargetPart: 'chest',
        followSpace: 'targetLocal',
        followOffset: { x: 0.35, y: 1.62, z: 2.35 },
        positionDamping: 0.38,
        aimDamping: 0.32,
        screenOffset: { x: -0.1, y: 0.04 },
        deadZoneWidth: 0.12,
        deadZoneHeight: 0.1,
        autoFocusPull: true,
        noisePreset: 'handheld'
      }
    }
  }

  const sidePos: StageVec3 = { x: 2.15, y: baseY + 1.68, z: -0.4 }
  const sideCam: DirectorCameraState = {
    id: 'cam:cm:oner_side',
    name: isZh ? '机位 2 · 侧向平行跟拍 50mm' : 'Cam 2 · Side Profile Follow 50mm',
    visible: true,
    locked: false,
    viewer: {
      position: sidePos,
      target: leadTarget,
      rotation: directorViewerRotationFromLook(sidePos, leadTarget),
      fov: focalLengthMmToFovDeg(50),
      focalLengthMm: 50,
      aperture: 1.8,
      focusDistance: 2.3,
      cinemachine: {
        bodyMode: 'transposer',
        aimMode: 'composer',
        followTargetId: actorA.id,
        lookAtTargetId: actorA.id,
        aimTargetPart: 'head',
        followSpace: 'world',
        followOffset: { x: 2.25, y: 1.68, z: 0.45 },
        positionDamping: 0.42,
        aimDamping: 0.28,
        screenOffset: { x: 0.08, y: 0.02 },
        autoFocusPull: true,
        noisePreset: 'droneHover'
      }
    }
  }

  cameras.push(leadCam, sideCam)
  tracks.push(
    {
      id: 'track:cm:cuts',
      name: isZh ? 'Cinemachine 切镜轨' : 'Cinemachine Cut Track',
      targetKind: 'camera',
      targetId: leadCam.id,
      start: 0,
      end: duration,
      path: null,
      keyframes: [],
      cameraCut: true,
      cameraSegments: [
        { id: 'cut:cm:1', cameraId: leadCam.id, start: 0, end: 5.0 },
        {
          id: 'cut:cm:2',
          cameraId: sideCam.id,
          start: 5.0,
          end: duration,
          blendInSec: 1.2,
          blendCurve: 'easeInOut'
        }
      ]
    },
    ...buildActorMotionTracks(actors, placements, duration, isZh)
  )

  return finalizePrevizStage(
    currentStage,
    keptProps,
    actors,
    cameras,
    tracks,
    lightingPreset,
    compositionGuide,
    duration,
    isZh
  )
}

function finalizePrevizStage(
  currentStage: DirectorStageState,
  keptProps: readonly StageObjectState[],
  actors: readonly StageObjectState[],
  cameras: readonly DirectorCameraState[],
  tracks: readonly DirectorAnimTrack[],
  lightingPreset: DirectorLightingPresetId,
  compositionGuide: DirectorStageState['compositionGuide'],
  duration: number,
  isZh: boolean
): DirectorStageState {
  const baseY = typeof currentStage.gridOffsetY === 'number' ? currentStage.gridOffsetY : -0.8
  const lights = buildLightingPresetObjects(
    lightingPreset,
    { x: 0, y: baseY + 0.8, z: 0 },
    1.8,
    null,
    isZh ? 'zh-CN' : 'en-US'
  ).lights

  const presetMeta =
    lightingPreset === 'cyberpunk'
      ? { skyColor: '#0c0a1d', fogColor: '#1b1035', fogDensity: 0.028 }
      : lightingPreset === 'goldenHour'
        ? { skyColor: '#2b1d18', fogColor: '#3d251b', fogDensity: 0.016 }
        : lightingPreset === 'silhouette'
          ? { skyColor: '#090d14', fogColor: '#0f172a', fogDensity: 0.022 }
          : { skyColor: currentStage.skyColor, fogColor: '#1e293b', fogDensity: 0.015 }

  return {
    ...currentStage,
    cameras: [...cameras],
    activeCameraId: cameras[0].id,
    selectedObjectId: actors[0]?.id ?? cameras[0].id,
    lightingPreset,
    shadowCatcherEnabled: true,
    shadowCatcherOpacity: 0.42,
    fogEnabled: true,
    fogDensity: presetMeta.fogDensity,
    fogColor: presetMeta.fogColor,
    skyColor: presetMeta.skyColor,
    compositionGuide,
    animation: {
      duration,
      loop: true,
      tracks: [...tracks]
    },
    objects: [...keptProps, ...actors, ...lights]
  }
}

/**
 * 解析自然语言分镜描述，自动生成包含可摆姿人偶角色、三点布光、多机位构图与时间轴运镜/切镜的完整 3D 舞台调度。
 */
export function generateAiDirectorBlocking(
  currentStage: DirectorStageState,
  promptText: string,
  locale?: string
): DirectorStageState {
  const text = promptText.trim()
  const lower = text.toLowerCase()
  const isZh = locale ? locale.toLowerCase().startsWith('zh') : /[\u4e00-\u9fa5]/.test(text)
  const actorCount = detectActorCount(text)
  const mannequinPreset = detectMannequinPreset(text)
  const lightingPreset = detectLightingPreset(text)
  const isSprint = /冲刺|狂奔|全速跑|sprint|dash/.test(lower)
  const isRun = /奔跑|跑|追逐|run|chase|sprint/.test(lower)
  const isWalk = /行走|漫步|走|walk|stroll/.test(lower)
  const isJump = /跳|跃|腾空|jump|leap|hop/.test(lower)
  const isSitFloor = /盘腿|盘坐|打坐|冥想|席地|meditat|cross-leg/.test(lower)
  const isSit = !isSitFloor && /坐|端坐|落座|sit|seated/.test(lower)
  const isCrouch = /蹲|潜行|埋伏|crouch|squat|sneak/.test(lower)
  const isKneel = /跪|单膝|kneel/.test(lower)
  const isLieDown = /躺|卧|平躺|睡眠|睡|lie|lying|sleep/.test(lower)
  const isBow = /鞠躬|行礼|致敬|bow/.test(lower)
  const isCheer = /欢呼|庆祝|高呼|胜利|cheer|celebrat|victory/.test(lower)
  const isClap = /鼓掌|拍手|喝彩|clap|applaud/.test(lower)
  const isDance = /跳舞|舞蹈|律动|蹦迪|dance|dancing|groove/.test(lower)
  const isThink = /思考|沉思|托腮|发呆|think|ponder/.test(lower)
  const isPhone = /手机|阅读|看书|低头看|phone|read/.test(lower)
  const isStretch = /伸懒腰|舒展|哈欠|stretch|yawn/.test(lower)
  const isDrink = /喝|饮|举杯|干杯|drink|toast/.test(lower)
  const isLookAround = /张望|四处看|远眺|寻找|look\s*around|scout|search/.test(lower)
  const isPushUp = /俯卧撑|健身|锻炼|push[-\s]?up|workout/.test(lower)
  const isFall = /跌倒|摔倒|倒地|受击|fall|collapse|knock/.test(lower)
  const isCombat = /战斗|对决|攻击|英雄|格斗|combat|fight|hero|action/.test(lower)
  const isStandoff = /对峙|正反打|越肩|交谈|对话|standoff|ots|reverse|dialogue|talk/.test(lower)
  const isOrbit = /环绕|旋转运镜|orbit|turntable|360/.test(lower)
  const hasFog =
    /雾|迷雾|雨夜|赛博|黄昏|大气|fog|mist|haze|cyber|golden/.test(lower) ||
    lightingPreset === 'cyberpunk' ||
    lightingPreset === 'silhouette'

  const baseY = typeof currentStage.gridOffsetY === 'number' ? currentStage.gridOffsetY : -0.8

  const placements: ActorPlacementSpec[] = []
  if (actorCount === 2 && isStandoff) {
    placements.push(
      {
        position: { x: -1.15, y: baseY, z: 0 },
        rotation: { x: 0, y: Math.PI / 2, z: 0 },
        poseId: 'hand.pointRight',
        clipName: 'Talk',
        secondClipName: 'Wave'
      },
      {
        position: { x: 1.15, y: baseY, z: 0 },
        rotation: { x: 0, y: -Math.PI / 2, z: 0 },
        poseId: 'gaze.heroic',
        clipName: 'Idle',
        secondClipName: 'Action'
      }
    )
  } else {
    const spacing = 1.35
    for (let i = 0; i < actorCount; i++) {
      const offsetIndex = i - (actorCount - 1) / 2
      const x = Number((offsetIndex * spacing).toFixed(2))
      const z = actorCount >= 3 && i === 0 ? 0.45 : actorCount >= 3 ? -0.35 : 0
      const poseId = isJump
        ? 'body.jump'
        : isSitFloor
          ? 'body.sitFloor'
          : isSit
            ? 'body.sit'
            : isCrouch
              ? 'body.crouch'
              : isKneel
                ? 'body.kneel'
                : isLieDown
                  ? 'body.lieDown'
                  : isBow
                    ? 'body.bow'
                    : isCheer
                      ? 'body.cheer'
                      : isClap
                        ? 'body.clap'
                        : isDance
                          ? 'body.dance'
                          : isThink
                            ? 'body.think'
                            : isPhone
                              ? 'body.phone'
                              : isStretch
                                ? 'body.stretch'
                                : isDrink
                                  ? 'body.drink'
                                  : isLookAround
                                    ? 'body.lookAround'
                                    : isPushUp
                                      ? 'body.pushUp'
                                      : isFall
                                        ? 'body.fall'
                                        : isCombat
                                          ? 'gaze.combatReady'
                                          : i % 2 === 1
                                            ? 'hand.relaxed'
                                            : 'gaze.heroic'
      const primaryClip = isSprint
        ? 'Sprint'
        : isRun
          ? 'Run'
          : isWalk
            ? 'Walk'
            : isJump
              ? 'Jump'
              : isSitFloor
                ? 'SitFloor'
                : isSit
                  ? 'Sit'
                  : isCrouch
                    ? 'Crouch'
                    : isKneel
                      ? 'Kneel'
                      : isLieDown
                        ? 'LieDown'
                        : isBow
                          ? 'Bow'
                          : isCheer
                            ? 'Cheer'
                            : isClap
                              ? 'Clap'
                              : isDance
                                ? 'Dance'
                                : isThink
                                  ? 'Think'
                                  : isPhone
                                    ? 'PhoneLook'
                                    : isStretch
                                      ? 'Stretch'
                                      : isDrink
                                        ? 'Drink'
                                        : isLookAround
                                          ? 'LookAround'
                                          : isPushUp
                                            ? 'PushUp'
                                            : isFall
                                              ? 'Fall'
                                              : isCombat
                                                ? 'Action'
                                                : 'Idle'
      const secondaryClip = isRun
        ? 'Action'
        : isJump
          ? 'Cheer'
          : isSit || isSitFloor || isLieDown
            ? primaryClip
            : isDance
              ? 'Cheer'
              : isCombat
                ? 'Wave'
                : 'Wave'
      placements.push({
        position: { x, y: baseY, z },
        endPosition: isRun
          ? { x, y: baseY, z: z + 1.8 }
          : isWalk
            ? { x, y: baseY, z: z + 1.0 }
            : { x, y: baseY, z },
        rotation: { x: 0, y: 0, z: 0 },
        poseId,
        clipName: primaryClip,
        secondClipName: secondaryClip
      })
    }
  }

  const { actors, keptProps } = resolveStageActorsAndProps(
    currentStage,
    placements,
    mannequinPreset,
    isZh
  )

  const centerTarget: StageVec3 = { x: 0, y: baseY + 1.45, z: 0 }
  const lights = buildLightingPresetObjects(
    lightingPreset,
    { x: 0, y: baseY + 0.8, z: 0 },
    1.8,
    null,
    isZh ? 'zh-CN' : 'en-US'
  ).lights

  // Build Cameras
  const cameras: DirectorCameraState[] = []
  const tracks: DirectorAnimTrack[] = []
  const duration = 8

  if (actorCount >= 2 && isStandoff) {
    const [actorA, actorB] = actors
    // 1. Wide Establishing (35mm)
    const widePos = { x: 0, y: baseY + 1.58, z: 4.0 }
    const wideCam: DirectorCameraState = {
      id: 'cam:ai:wide',
      name: isZh ? '机位 1 · 全景 35mm' : 'Cam 1 · Wide 35mm',
      visible: true,
      locked: false,
      viewer: {
        position: widePos,
        target: centerTarget,
        rotation: directorViewerRotationFromLook(widePos, centerTarget),
        fov: focalLengthMmToFovDeg(35),
        focalLengthMm: 35,
        aperture: 4.0,
        cinemachine: {
          bodyMode: 'groupFraming',
          aimMode: 'groupComposer',
          groupTargetIds: [actorA.id, actorB.id],
          groupFramingScale: 1.28,
          positionDamping: 0.35,
          aimDamping: 0.25,
          noisePreset: 'handheld'
        }
      }
    }
    // 2. OTS A -> B (50mm)
    const otsAPos = { x: -1.65, y: baseY + 1.68, z: 0.72 }
    const otsATarget = { x: 1.15, y: baseY + 1.68, z: 0 }
    const otsACam: DirectorCameraState = {
      id: 'cam:ai:ots_a',
      name: isZh ? '机位 2 · 过肩 A→B 50mm' : 'Cam 2 · OTS A→B 50mm',
      visible: true,
      locked: false,
      viewer: {
        position: otsAPos,
        target: otsATarget,
        rotation: directorViewerRotationFromLook(otsAPos, otsATarget),
        fov: focalLengthMmToFovDeg(50),
        focalLengthMm: 50,
        aperture: 1.8,
        focusDistance: 2.8,
        cinemachine: {
          bodyMode: 'none',
          aimMode: 'composer',
          lookAtTargetId: actorB.id,
          aimTargetPart: 'head',
          aimDamping: 0.22,
          screenOffset: { x: 0.18, y: 0.04 },
          autoFocusPull: true,
          noisePreset: 'handheld'
        }
      }
    }
    // 3. OTS B -> A (50mm)
    const otsBPos = { x: 1.65, y: baseY + 1.68, z: 0.72 }
    const otsBTarget = { x: -1.15, y: baseY + 1.68, z: 0 }
    const otsBCam: DirectorCameraState = {
      id: 'cam:ai:ots_b',
      name: isZh ? '机位 3 · 过肩 B→A 50mm' : 'Cam 3 · OTS B→A 50mm',
      visible: true,
      locked: false,
      viewer: {
        position: otsBPos,
        target: otsBTarget,
        rotation: directorViewerRotationFromLook(otsBPos, otsBTarget),
        fov: focalLengthMmToFovDeg(50),
        focalLengthMm: 50,
        aperture: 1.8,
        focusDistance: 2.8,
        cinemachine: {
          bodyMode: 'none',
          aimMode: 'composer',
          lookAtTargetId: actorA.id,
          aimTargetPart: 'head',
          aimDamping: 0.22,
          screenOffset: { x: -0.18, y: 0.04 },
          autoFocusPull: true,
          noisePreset: 'handheld'
        }
      }
    }
    // 4. Close-Up A (85mm)
    const cuPos = { x: 0.05, y: baseY + 1.75, z: 1.68 }
    const cuTarget = { x: -1.15, y: baseY + 1.75, z: 0 }
    const cuCam: DirectorCameraState = {
      id: 'cam:ai:cu',
      name: isZh ? '机位 4 · 特写 85mm' : 'Cam 4 · Close-Up 85mm',
      visible: true,
      locked: false,
      viewer: {
        position: cuPos,
        target: cuTarget,
        rotation: directorViewerRotationFromLook(cuPos, cuTarget),
        fov: focalLengthMmToFovDeg(85),
        focalLengthMm: 85,
        aperture: 1.4,
        focusDistance: 2.06,
        cinemachine: {
          bodyMode: 'none',
          aimMode: 'composer',
          lookAtTargetId: actorA.id,
          aimTargetPart: 'head',
          aimDamping: 0.25,
          screenOffset: { x: -0.06, y: 0 },
          autoFocusPull: true,
          noisePreset: 'telephoto'
        }
      }
    }
    cameras.push(wideCam, otsACam, otsBCam, cuCam)

    // Camera Cut Track across 8s
    const cutSegments: DirectorCameraCutSegment[] = [
      { id: 'cut:1', cameraId: wideCam.id, start: 0, end: 2.2 },
      { id: 'cut:2', cameraId: otsACam.id, start: 2.2, end: 4.4, blendInSec: 0 },
      { id: 'cut:3', cameraId: otsBCam.id, start: 4.4, end: 6.4, blendInSec: 0 },
      {
        id: 'cut:4',
        cameraId: cuCam.id,
        start: 6.4,
        end: duration,
        blendInSec: 0.85,
        blendCurve: 'easeInOut'
      }
    ]
    tracks.push({
      id: 'track:ai:cuts',
      name: isZh ? '导演切镜轨' : 'Director Cut Track',
      targetKind: 'camera',
      targetId: wideCam.id,
      start: 0,
      end: duration,
      path: null,
      keyframes: [],
      cameraCut: true,
      cameraSegments: cutSegments
    })
  } else {
    // Dynamic moving camera + secondary close-up camera
    const leadActor = actors[0]
    const startPos: StageVec3 = isCombat
      ? { x: 0.4, y: baseY + 0.78, z: 4.2 }
      : { x: -1.6, y: baseY + 1.58, z: 4.6 }
    const endPos: StageVec3 = isOrbit
      ? { x: 2.8, y: baseY + 1.65, z: 2.8 }
      : { x: 0.15, y: baseY + 1.52, z: 2.1 }
    const startFov = focalLengthMmToFovDeg(isCombat ? 24 : 35)
    const endFov = focalLengthMmToFovDeg(isCombat ? 85 : 50)

    const mainCam: DirectorCameraState = {
      id: 'cam:ai:main',
      name: isCombat
        ? isZh
          ? '机位 1 · 仰拍英雄视角'
          : 'Cam 1 · Hero Low-Angle'
        : isZh
          ? '机位 1 · 跟拍 35mm'
          : 'Cam 1 · Tracking 35mm',
      visible: true,
      locked: false,
      viewer: {
        position: startPos,
        target: centerTarget,
        rotation: directorViewerRotationFromLook(startPos, centerTarget),
        fov: startFov,
        focalLengthMm: isCombat ? 24 : 35,
        ...(isRun ? { handheldShake: { enabled: true, intensity: 0.45, frequency: 1.2 } } : {}),
        ...(leadActor
          ? {
              cinemachine: {
                bodyMode: isOrbit ? 'orbital' : isRun || isWalk ? 'transposer' : 'none',
                aimMode: 'composer',
                followTargetId: isOrbit || isRun || isWalk ? leadActor.id : null,
                lookAtTargetId: leadActor.id,
                aimTargetPart: 'chest',
                positionDamping: 0.35,
                aimDamping: 0.25,
                autoFocusPull: true,
                noisePreset: isRun ? 'handheld' : 'droneHover'
              }
            }
          : {})
      }
    }

    const closePos = {
      x: (leadActor?.position.x ?? 0) + 0.55,
      y: baseY + 1.75,
      z: (leadActor?.position.z ?? 0) + 1.98
    }
    const closeTarget = {
      x: leadActor?.position.x ?? 0,
      y: baseY + 1.75,
      z: leadActor?.position.z ?? 0
    }
    const closeCam: DirectorCameraState = {
      id: 'cam:ai:close',
      name: isZh ? '机位 2 · 人像特写 85mm' : 'Cam 2 · Portrait 85mm',
      visible: true,
      locked: false,
      viewer: {
        position: closePos,
        target: closeTarget,
        rotation: directorViewerRotationFromLook(closePos, closeTarget),
        fov: focalLengthMmToFovDeg(85),
        focalLengthMm: 85,
        aperture: 2.0,
        focusDistance: 2.05,
        ...(leadActor
          ? {
              cinemachine: {
                bodyMode: 'none',
                aimMode: 'composer',
                lookAtTargetId: leadActor.id,
                aimTargetPart: 'head',
                aimDamping: 0.25,
                screenOffset: { x: 0, y: 0 },
                autoFocusPull: true,
                noisePreset: 'telephoto'
              }
            }
          : {})
      }
    }

    cameras.push(mainCam, closeCam)

    tracks.push({
      id: 'track:ai:cam_move',
      name: isZh ? '运镜推拉轨' : 'Camera Dolly Track',
      targetKind: 'camera',
      targetId: mainCam.id,
      start: 0,
      end: duration,
      path: {
        kind: 'line',
        points: [startPos, endPos],
        closed: false
      },
      keyframes: [
        {
          id: 'kf:ai:cam:0',
          time: 0,
          position: startPos,
          rotation: directorViewerRotationFromLook(startPos, centerTarget),
          easing: 'easeInOut',
          fov: startFov
        },
        {
          id: 'kf:ai:cam:1',
          time: duration,
          position: endPos,
          rotation: directorViewerRotationFromLook(endPos, centerTarget),
          easing: 'easeInOut',
          fov: endFov
        }
      ]
    })
  }

  tracks.push(...buildActorMotionTracks(actors, placements, duration, isZh))

  const presetMeta =
    lightingPreset === 'cyberpunk'
      ? { skyColor: '#0c0a1d', fogColor: '#1b1035', fogDensity: 0.028 }
      : lightingPreset === 'goldenHour'
        ? { skyColor: '#2b1d18', fogColor: '#3d251b', fogDensity: 0.016 }
        : lightingPreset === 'silhouette'
          ? { skyColor: '#090d14', fogColor: '#0f172a', fogDensity: 0.022 }
          : { skyColor: currentStage.skyColor, fogColor: '#1e293b', fogDensity: 0.015 }

  return {
    ...currentStage,
    cameras,
    activeCameraId: cameras[0].id,
    selectedObjectId: actors[0]?.id ?? cameras[0].id,
    lightingPreset,
    shadowCatcherEnabled: true,
    shadowCatcherOpacity: 0.42,
    fogEnabled: hasFog,
    fogDensity: presetMeta.fogDensity,
    fogColor: presetMeta.fogColor,
    skyColor: presetMeta.skyColor,
    compositionGuide: 'thirds',
    animation: {
      duration,
      loop: true,
      tracks
    },
    objects: [...keptProps, ...actors, ...lights]
  }
}
