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
  const isRun = /奔跑|跑|追逐|run|chase|sprint/.test(lower)
  const isWalk = /行走|漫步|走|walk|stroll/.test(lower)
  const isCombat = /战斗|对决|攻击|英雄|格斗|combat|fight|hero|action/.test(lower)
  const isStandoff = /对峙|正反打|越肩|交谈|对话|standoff|ots|reverse|dialogue|talk/.test(lower)
  const isOrbit = /环绕|旋转运镜|orbit|turntable|360/.test(lower)
  const hasFog =
    /雾|迷雾|雨夜|赛博|黄昏|大气|fog|mist|haze|cyber|golden/.test(lower) ||
    lightingPreset === 'cyberpunk' ||
    lightingPreset === 'silhouette'

  const baseY = typeof currentStage.gridOffsetY === 'number' ? currentStage.gridOffsetY : -0.8

  // Preserve non-generated user models/props unless user is starting fresh, or replace previous AI-blocked actors/lights
  const keptObjects = currentStage.objects.filter(
    (obj) =>
      !obj.id.startsWith('ai-actor:') && !obj.id.startsWith('light:preset:') && obj.kind !== 'light'
  )

  const actorColors = ['#56b8ff', '#ff7a90', '#a6e3a1', '#f9e2af']
  const actors: StageObjectState[] = []

  if (actorCount === 2 && isStandoff) {
    // Two characters facing each other along X axis
    actors.push({
      id: 'ai-actor:1',
      name: isZh ? '角色 A' : 'Actor A',
      kind: 'character',
      mannequinPreset,
      color: actorColors[0],
      visible: true,
      locked: false,
      nameVisible: true,
      position: { x: -1.15, y: baseY, z: 0 },
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      bonePose: clonePoseBones('hand.pointRight')
    })
    actors.push({
      id: 'ai-actor:2',
      name: isZh ? '角色 B' : 'Actor B',
      kind: 'character',
      mannequinPreset,
      color: actorColors[1],
      visible: true,
      locked: false,
      nameVisible: true,
      position: { x: 1.15, y: baseY, z: 0 },
      rotation: { x: 0, y: -Math.PI / 2, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      bonePose: clonePoseBones('gaze.heroic')
    })
  } else {
    const spacing = 1.35
    for (let i = 0; i < actorCount; i++) {
      const offsetIndex = i - (actorCount - 1) / 2
      const x = Number((offsetIndex * spacing).toFixed(2))
      const z = actorCount >= 3 && i === 0 ? 0.45 : actorCount >= 3 ? -0.35 : 0
      const poseId = isCombat ? 'gaze.combatReady' : i % 2 === 1 ? 'hand.relaxed' : 'gaze.heroic'
      const letter = String.fromCharCode(65 + i)
      actors.push({
        id: `ai-actor:${i + 1}`,
        name: isZh ? `角色 ${letter}` : `Actor ${letter}`,
        kind: 'character',
        mannequinPreset,
        color: actorColors[i % actorColors.length],
        visible: true,
        locked: false,
        nameVisible: true,
        position: { x, y: baseY, z },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        bonePose: clonePoseBones(poseId)
      })
    }
  }

  const centerTarget: StageVec3 = { x: 0, y: baseY + 1.25, z: 0 }
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
    // 1. Wide Establishing (24mm)
    const widePos = { x: 0, y: baseY + 1.5, z: 4.2 }
    const wideCam: DirectorCameraState = {
      id: 'cam:ai:wide',
      name: isZh ? '机位 1 · 全景 24mm' : 'Cam 1 · Wide 24mm',
      visible: true,
      locked: false,
      viewer: {
        position: widePos,
        target: centerTarget,
        rotation: directorViewerRotationFromLook(widePos, centerTarget),
        fov: focalLengthMmToFovDeg(24),
        focalLengthMm: 24
      }
    }
    // 2. OTS A -> B (50mm)
    const otsAPos = { x: -1.65, y: baseY + 1.48, z: 0.72 }
    const otsATarget = { x: 1.15, y: baseY + 1.32, z: 0 }
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
        aperture: 2.8,
        focusDistance: 2.8
      }
    }
    // 3. OTS B -> A (50mm)
    const otsBPos = { x: 1.65, y: baseY + 1.48, z: 0.72 }
    const otsBTarget = { x: -1.15, y: baseY + 1.32, z: 0 }
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
        aperture: 2.8,
        focusDistance: 2.8
      }
    }
    // 4. Close-Up A (85mm)
    const cuPos = { x: -0.35, y: baseY + 1.45, z: 1.25 }
    const cuTarget = { x: -1.15, y: baseY + 1.42, z: 0 }
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
        aperture: 1.8,
        focusDistance: 1.5
      }
    }
    cameras.push(wideCam, otsACam, otsBCam, cuCam)

    // Camera Cut Track across 8s
    const cutSegments: DirectorCameraCutSegment[] = [
      { id: 'cut:1', cameraId: wideCam.id, start: 0, end: 2.2 },
      { id: 'cut:2', cameraId: otsACam.id, start: 2.2, end: 4.4 },
      { id: 'cut:3', cameraId: otsBCam.id, start: 4.4, end: 6.4 },
      { id: 'cut:4', cameraId: cuCam.id, start: 6.4, end: duration }
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
    const startPos: StageVec3 = isCombat
      ? { x: 0.4, y: baseY + 0.65, z: 4.2 }
      : { x: -1.6, y: baseY + 1.45, z: 4.6 }
    const endPos: StageVec3 = isOrbit
      ? { x: 2.8, y: baseY + 1.55, z: 2.8 }
      : { x: 0.15, y: baseY + 1.38, z: 2.1 }
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
        ...(isRun ? { handheldShake: { enabled: true, intensity: 0.45, frequency: 1.2 } } : {})
      }
    }

    const closePos = { x: 0.6, y: baseY + 1.42, z: 1.85 }
    const closeCam: DirectorCameraState = {
      id: 'cam:ai:close',
      name: isZh ? '机位 2 · 人像特写 85mm' : 'Cam 2 · Portrait 85mm',
      visible: true,
      locked: false,
      viewer: {
        position: closePos,
        target: centerTarget,
        rotation: directorViewerRotationFromLook(closePos, centerTarget),
        fov: focalLengthMmToFovDeg(85),
        focalLengthMm: 85,
        aperture: 2.0,
        focusDistance: 1.9
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

  // Add skeletal animation clips for each actor
  for (let i = 0; i < actors.length; i++) {
    const actor = actors[i]
    const clipName = isRun ? 'Run' : isWalk ? 'Walk' : isCombat ? 'Action' : 'Idle'
    const secondClip = isRun ? 'Action' : isCombat ? 'Wave' : 'Wave'
    tracks.push({
      id: `track:ai:actor:${i + 1}`,
      name: isZh ? `${actor.name} 动作轨` : `${actor.name} Motion`,
      targetKind: 'object',
      targetId: actor.id,
      start: 0,
      end: duration,
      path: null,
      keyframes: [
        {
          id: `kf:ai:actor:${i + 1}:0`,
          time: 0,
          position: { ...actor.position },
          rotation: { ...actor.rotation },
          easing: 'easeInOut'
        },
        {
          id: `kf:ai:actor:${i + 1}:1`,
          time: duration,
          position: isRun
            ? { x: actor.position.x, y: actor.position.y, z: actor.position.z + 1.8 }
            : isWalk
              ? { x: actor.position.x, y: actor.position.y, z: actor.position.z + 1.0 }
              : { ...actor.position },
          rotation: { ...actor.rotation },
          easing: 'easeInOut'
        }
      ],
      skeletonClips: [
        {
          id: `sk:ai:${i + 1}:1`,
          clip: clipName,
          start: 0,
          end: 5.2,
          speed: 1,
          loop: true,
          crossFadeSec: 0.35
        },
        {
          id: `sk:ai:${i + 1}:2`,
          clip: secondClip,
          start: 5.2,
          end: duration,
          speed: 1,
          loop: true,
          crossFadeSec: 0.35
        }
      ]
    })
  }

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
    objects: [...keptObjects, ...actors, ...lights]
  }
}
