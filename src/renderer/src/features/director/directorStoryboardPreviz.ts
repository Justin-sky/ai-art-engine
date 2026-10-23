import {
  DIRECTOR_EXPRESSIVE_POSE_PRESETS,
  buildLightingPresetObjects,
  directorViewerRotationFromLook,
  focalLengthMmToFovDeg,
  normalizeDirectorAspectRatio,
  type DirectorAnimKeyframe,
  type DirectorAnimTrack,
  type DirectorCameraCutSegment,
  type DirectorCameraState,
  type DirectorLightingPresetId,
  type DirectorSkeletonClipSegment,
  type DirectorStageState,
  type StageObjectState,
  type StageVec3
} from '@shared/domain'
import {
  filmBaseEntityName,
  filmNameKey,
  type FilmShot,
  type FilmStoryboard
} from '@shared/graph/film/storyboard'
import {
  buildHeuristicStoryboardLayout,
  buildStageObjectsFromWhiteModelSpec,
  planStoryboard3dLayoutWithLlm,
  type StoryboardSceneLayoutPlan
} from './directorWhiteModelBuilder'

export const STORYBOARD_CAMERA_ID_PREFIX = 'cam:sb:'
export const STORYBOARD_CUT_ID_PREFIX = 'cut:sb:'
export const STORYBOARD_ACTOR_ID_PREFIX = 'sb-actor:'
export const STORYBOARD_PROP_ID_PREFIX = 'sb-prop:'

const ACTOR_PALETTE = [
  '#56b8ff',
  '#ff7a90',
  '#a6e3a1',
  '#f9e2af',
  '#cba6f7',
  '#94e2d5',
  '#fab387',
  '#89b4fa'
]

export interface CompileStoryboardPrevizOptions {
  /** 仅预演指定场次（空 = 全部场次） */
  sceneId?: string | null
  /** 仅预演指定单镜（优先级高于 sceneId） */
  shotId?: string | null
  /** 界面语言 */
  locale?: string
  /** 可选：预生成的 3D 空间与组合素模布局（例如由 LLM 生成） */
  layoutPlan?: StoryboardSceneLayoutPlan | null
  /** 调用 LLM 时的文本生成函数或模型参数 */
  generateText?: (input: {
    prompt: string
    system?: string
    model?: string
    providerInstanceId?: string
  }) => Promise<{ text: string }>
  model?: string
  providerInstanceId?: string
}

export interface CompiledStoryboardPrevizResult {
  stage: DirectorStageState
  shots: FilmShot[]
  shotCount: number
  actorCount: number
  propCount: number
  totalDurationSec: number
  usedLlm?: boolean
}

/**
 * 从导演台机位 id (`cam:sb:<shotId>`) 或切镜片段 id (`cut:sb:<shotId>`) 提取分镜镜头 ID。
 */
export function extractStoryboardShotIdFromDirectorId(
  id: string | null | undefined
): string | null {
  const raw = (id ?? '').trim()
  if (!raw) return null
  if (raw.startsWith(STORYBOARD_CAMERA_ID_PREFIX)) {
    return raw.slice(STORYBOARD_CAMERA_ID_PREFIX.length).trim() || null
  }
  if (raw.startsWith(STORYBOARD_CUT_ID_PREFIX)) {
    return raw.slice(STORYBOARD_CUT_ID_PREFIX.length).trim() || null
  }
  return null
}

function clonePoseBones(presetId: string): Record<string, StageVec3> {
  const found = DIRECTOR_EXPRESSIVE_POSE_PRESETS.find((p) => p.id === presetId)
  if (!found) return {}
  const out: Record<string, StageVec3> = {}
  for (const [k, v] of Object.entries(found.bones)) {
    out[k] = { ...v }
  }
  return out
}

function inferLightingFromStoryboard(
  storyboard: FilmStoryboard,
  shots: readonly FilmShot[]
): DirectorLightingPresetId {
  const sceneIds = new Set(shots.map((s) => s.sceneId).filter(Boolean))
  const scenes = (storyboard.scenes ?? []).filter((sc) => sceneIds.has(sc.id))
  const combined = [
    storyboard.style,
    ...scenes.map((s) => `${s.time ?? ''} ${s.summary ?? ''} ${s.heading ?? ''}`),
    ...shots.map((s) => `${s.location ?? ''} ${s.action ?? ''}`)
  ]
    .join(' ')
    .toLowerCase()

  if (/赛博|霓虹|夜景霓虹|cyber|neon/.test(combined)) return 'cyberpunk'
  if (/剪影|逆光|silhouette|rim/.test(combined)) return 'silhouette'
  if (/黄昏|夕阳|清晨|日落|暖阳|golden|sunset|dawn|dusk/.test(combined)) return 'goldenHour'
  if (/悬疑|暗调|夜|紧张|冷峻|对抗|rembrandt|noir|night|tense|thriller/.test(combined)) {
    return 'rembrandt'
  }
  return 'studio'
}

function canonicalCharacterName(raw: string): string {
  const base = filmBaseEntityName(raw)
  return (base || raw).trim()
}

interface ShotLensSpec {
  focalLengthMm: number
  distance: number
  aperture: number
  targetHeightOffset: number
  aimTargetPart: 'root' | 'chest' | 'head'
}

function resolveShotLensSpec(shotSizeRaw: string): ShotLensSpec {
  const s = (shotSizeRaw || '').trim().toUpperCase()
  // ECU / 大特写 / 极特写
  if (s === 'ECU' || /大特写|极特写|眼神特写|EXTREME\s*CLOSE/.test(s)) {
    return {
      focalLengthMm: 105,
      distance: 1.25,
      aperture: 1.4,
      targetHeightOffset: 1.76,
      aimTargetPart: 'head'
    }
  }
  // INSERT / 细节特写
  if (s === 'INSERT' || /细节|道具特写|INSERT/.test(s)) {
    return {
      focalLengthMm: 85,
      distance: 1.45,
      aperture: 1.8,
      targetHeightOffset: 1.15,
      aimTargetPart: 'chest'
    }
  }
  // CU / 特写 / 近景
  if (s === 'CU' || /特写|CLOSE[-\s]*UP/.test(s)) {
    return {
      focalLengthMm: 85,
      distance: 1.68,
      aperture: 1.6,
      targetHeightOffset: 1.74,
      aimTargetPart: 'head'
    }
  }
  // MCU / 中近景
  if (s === 'MCU' || /中近|近景|MEDIUM\s*CLOSE/.test(s)) {
    return {
      focalLengthMm: 65,
      distance: 2.15,
      aperture: 2.0,
      targetHeightOffset: 1.66,
      aimTargetPart: 'head'
    }
  }
  // MLS / 中全景
  if (s === 'MLS' || /中全|膝景|牛仔景|MEDIUM\s*LONG|AMERICAN/.test(s)) {
    return {
      focalLengthMm: 35,
      distance: 3.35,
      aperture: 2.8,
      targetHeightOffset: 1.25,
      aimTargetPart: 'chest'
    }
  }
  // ELS / 大远景 / 远景
  if (s === 'ELS' || /大远景|远景|EXTREME\s*LONG|EXTREME\s*WIDE|ESTABLISHING/.test(s)) {
    return {
      focalLengthMm: 24,
      distance: 5.4,
      aperture: 5.6,
      targetHeightOffset: 1.18,
      aimTargetPart: 'root'
    }
  }
  // LS / 全景
  if (s === 'LS' || s === 'WS' || /全景|广角|LONG\s*SHOT|WIDE\s*SHOT/.test(s)) {
    return {
      focalLengthMm: 28,
      distance: 4.15,
      aperture: 4.0,
      targetHeightOffset: 1.22,
      aimTargetPart: 'root'
    }
  }
  // 默认 MS / 中景
  return {
    focalLengthMm: 50,
    distance: 2.65,
    aperture: 2.4,
    targetHeightOffset: 1.48,
    aimTargetPart: 'chest'
  }
}

function inferActorClipForShot(
  shot: FilmShot,
  actorName: string,
  isPrimary: boolean,
  actorPosture?: string
): string {
  const key = filmNameKey(actorName)
  const dialogueLines = Array.isArray(shot.dialogue) ? shot.dialogue : []
  const speaks = dialogueLines.some((d) => filmNameKey(canonicalCharacterName(d.speaker)) === key)
  const text = `${shot.action ?? ''} ${shot.videoPrompt ?? ''}`.toLowerCase()
  const isSeatedActor = actorPosture === 'sitting' || actorPosture === 'slumped_sitting'

  if (/百米冲刺|全速冲刺|sprint|dash/.test(text)) return 'Sprint'
  if (/奔跑|狂奔|追逐|冲刺|逃跑|逃离|run|chase/.test(text)) return 'Run'
  if (/跳跃|腾空|起跳|跃起|跳起|jump|leap|hop/.test(text)) return 'Jump'
  if (/跌倒|摔倒|倒地|受击倒|fall|collapse|knock/.test(text)) return 'Fall'
  if (/俯卧撑|push[-\s]?up/.test(text)) return 'PushUp'
  if (/跳舞|舞蹈|律动|蹦迪|dance|dancing|groove/.test(text)) return 'Dance'
  if (/欢呼|庆祝|高举双臂|欢庆|cheer|celebrat|victory/.test(text)) return 'Cheer'
  if (/鼓掌|拍手|喝彩|clap|applaud/.test(text)) return 'Clap'
  if (/鞠躬|行礼|致敬|bow/.test(text)) return 'Bow'
  if (/伸懒腰|舒展|哈欠|stretch|yawn/.test(text)) return 'Stretch'
  if (/端起咖啡|喝咖啡|喝水|举杯|干杯|畅饮|drink|toast|sip/.test(text)) return 'Drink'
  if (/看手机|刷手机|看了一眼手机|盯着手机|低头看|阅读|看书|phone|read/.test(text)) {
    return 'PhoneLook'
  }
  if (/思考|沉思|托腮|发呆|凝思|think|ponder/.test(text)) return 'Think'
  if (/四处张望|左右张望|远眺|寻找|环顾|look\s*around|scout|search/.test(text)) {
    return 'LookAround'
  }
  if (/行走|走近|走向|迈步|漫步|踱步|起身走|walk|step|approach|stroll/.test(text)) return 'Walk'
  if (/盘腿|盘坐|打坐|冥想|席地而坐|meditat|cross-leg/.test(text)) return 'SitFloor'
  if (/下蹲|蹲下|潜行|埋伏|crouch|squat|sneak/.test(text)) return 'Crouch'
  if (/单跪|跪下|半跪|kneel/.test(text)) return 'Kneel'
  if (/平躺|躺下|仰卧|睡眠|熟睡|lie\s*down|lying|sleep/.test(text)) return 'LieDown'
  if (/攻击|战斗|挥剑|格挡|格斗|出拳|搏斗|爆发|fight|attack|strike|combat|action/.test(text)) {
    return 'Action'
  }
  if (/挥手|招手|抬手|指着|递给|wave|gesture|point/.test(text)) {
    return 'Wave'
  }
  if (/交谈|争执|诉说|汇报|质问|解释|talk|argue|discuss|explain/.test(text) || speaks) {
    return 'Talk'
  }
  if (!isSeatedActor && /坐在|坐下|端坐|瘫坐|落座|sit|seated/.test(text)) {
    return 'Sit'
  }
  return isPrimary && dialogueLines.length > 0 ? 'Talk' : 'Idle'
}

function inferPosePresetForActor(index: number, total: number): string {
  if (total === 1) return 'gaze.heroic'
  if (index === 0) return 'hand.pointRight'
  if (index === 1) return 'gaze.heroic'
  return 'gaze.combatReady'
}

/**
 * 将分镜表（全部镜头 / 指定场次 / 指定单镜）编译为 3D 导演台白模预演舞台（DirectorStageState）。
 *
 * 生成内容：
 * 1. 自动按出场角色生成 3D 白模人偶（复用舞台上已有的同名角色模型），严格遵守 180° 轴线站位；
 * 2. 自动为主要道具生成带名称标签的白模几何体（桌/箱/瓶/柱/球等）；
 * 3. 为每个分镜生成一台专属机位（`cam:sb:<shotId>`），自动映射景别（焦段/距离/光圈/对焦部位）、角度（平视/仰拍/俯拍/过肩正反打）与运镜轨迹（推/拉/摇/移/升降/手持）；
 * 4. 自动生成完整的 `cameraCut` 机位切换轨与角色动作时间轴，点击播放即可预演整段分镜。
 */
function collectScopedStoryboardEntities(
  storyboard: FilmStoryboard,
  options: CompileStoryboardPrevizOptions,
  isZh: boolean
): {
  targetShots: FilmShot[]
  characterNames: string[]
  propNames: string[]
  locationNames: string[]
} {
  let targetShots = [...storyboard.shots].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  if (options.shotId?.trim()) {
    const targetId = options.shotId.trim().toLowerCase()
    const single = targetShots.find((s) => s.id.toLowerCase() === targetId)
    if (single) targetShots = [single]
  } else if (options.sceneId?.trim()) {
    const sceneKey = options.sceneId.trim()
    const filtered = targetShots.filter((s) => s.sceneId === sceneKey)
    if (filtered.length > 0) targetShots = filtered
  }

  if (targetShots.length === 0) {
    return { targetShots: [], characterNames: [], propNames: [], locationNames: [] }
  }

  const isScoped = Boolean(options.shotId?.trim() || options.sceneId?.trim())
  const scopedText = targetShots
    .map(
      (s) =>
        `${s.title ?? ''} ${s.location ?? ''} ${s.action ?? ''} ${s.imagePrompt ?? ''} ${s.videoPrompt ?? ''}`
    )
    .join(' ')
    .toLowerCase()

  const characterNames: string[] = []
  const seenCharKeys = new Set<string>()
  const pushChar = (raw: string): void => {
    const clean = canonicalCharacterName(raw)
    if (!clean) return
    const k = filmNameKey(clean)
    if (!k || seenCharKeys.has(k)) return
    seenCharKeys.add(k)
    characterNames.push(clean)
  }
  for (const shot of targetShots) {
    for (const c of shot.characters ?? []) pushChar(c)
    if (Array.isArray(shot.dialogue)) {
      for (const d of shot.dialogue) {
        if (d.speaker) pushChar(d.speaker)
      }
    }
  }
  if (characterNames.length === 0) {
    for (const ent of storyboard.entities ?? []) {
      if (ent.kind !== 'character') continue
      const base = canonicalCharacterName(ent.name)
      if (!isScoped || scopedText.includes(base.toLowerCase())) {
        pushChar(ent.name)
      }
    }
  }
  if (characterNames.length === 0) {
    for (const ent of storyboard.entities ?? []) {
      if (ent.kind === 'character') pushChar(ent.name)
    }
  }
  if (characterNames.length === 0) {
    characterNames.push(isZh ? '主角 A' : 'Actor A')
  }

  const propNames: string[] = []
  const seenPropKeys = new Set<string>()
  const pushProp = (raw: string): void => {
    const clean = raw.trim()
    if (!clean || propNames.length >= 8) return
    const k = filmNameKey(clean)
    if (!k || seenPropKeys.has(k) || seenCharKeys.has(k)) return
    seenPropKeys.add(k)
    propNames.push(clean)
  }
  for (const shot of targetShots) {
    for (const p of shot.props ?? []) {
      pushProp(p)
    }
  }
  for (const ent of storyboard.entities ?? []) {
    if (ent.kind !== 'prop') continue
    if (!isScoped || scopedText.includes(ent.name.trim().toLowerCase())) {
      pushProp(ent.name)
    }
  }

  const locationNames: string[] = []
  const seenLocKeys = new Set<string>()
  const pushLoc = (raw: string | undefined): void => {
    const clean = (raw ?? '').trim()
    if (!clean) return
    const k = filmNameKey(clean)
    if (!k || seenLocKeys.has(k)) return
    seenLocKeys.add(k)
    locationNames.push(clean)
  }
  for (const shot of targetShots) {
    pushLoc(shot.location)
  }
  for (const ent of storyboard.entities ?? []) {
    if (ent.kind !== 'location') continue
    if (!isScoped || scopedText.includes(ent.name.trim().toLowerCase())) {
      pushLoc(ent.name)
    }
  }

  return { targetShots, characterNames, propNames, locationNames }
}

export function compileStoryboardToDirectorStage(
  currentStage: DirectorStageState,
  storyboard: FilmStoryboard,
  options: CompileStoryboardPrevizOptions = {}
): CompiledStoryboardPrevizResult {
  const isZh = options.locale ? options.locale.toLowerCase().startsWith('zh') : true
  const baseY = typeof currentStage.gridOffsetY === 'number' ? currentStage.gridOffsetY : -0.8

  // 1 & 2. 筛选待预演镜头并提取该镜头涉及的角色、道具与场景名称
  const { targetShots, characterNames, propNames, locationNames } = collectScopedStoryboardEntities(
    storyboard,
    options,
    isZh
  )

  if (targetShots.length === 0) {
    return {
      stage: currentStage,
      shots: [],
      shotCount: 0,
      actorCount: 0,
      propCount: 0,
      totalDurationSec: 0
    }
  }

  // 3. 构建空间布局与组合素模方案（优先采用外部传入的 LLM 规划方案，否则执行启发式空间求解）
  const layoutPlan =
    options.layoutPlan ??
    buildHeuristicStoryboardLayout(
      storyboard,
      targetShots,
      characterNames,
      propNames,
      locationNames,
      isZh
    )

  const existingActors = currentStage.objects.filter(
    (obj) =>
      (obj.kind === 'character' || obj.kind === 'model') &&
      !obj.id.startsWith('ai-actor:') &&
      !obj.id.startsWith('light:preset:')
  )
  const usedObjectIds = new Set<string>()
  const actors: StageObjectState[] = []
  const actorByKey = new Map<string, StageObjectState>()
  const actorPostureById = new Map<string, string>()

  const totalActors = layoutPlan.actors.length
  for (let i = 0; i < totalActors; i++) {
    const spec = layoutPlan.actors[i]
    const name = spec.name
    const key = filmNameKey(name)
    const pos: StageVec3 = {
      x: Number(spec.position.x.toFixed(2)),
      y: Number((baseY + spec.position.y).toFixed(2)),
      z: Number(spec.position.z.toFixed(2))
    }
    const rotY = spec.rotationY

    const matchedExisting =
      existingActors.find((obj) => !usedObjectIds.has(obj.id) && filmNameKey(obj.name) === key) ??
      existingActors.find(
        (obj) => !usedObjectIds.has(obj.id) && obj.id === `${STORYBOARD_ACTOR_ID_PREFIX}${key}`
      )

    const hasCustomBonePose = Object.keys(spec.bonePose ?? {}).length > 0
    const fallbackPoseId = inferPosePresetForActor(i, totalActors)
    const finalBonePose = hasCustomBonePose ? spec.bonePose : clonePoseBones(fallbackPoseId)

    const actorObj: StageObjectState = matchedExisting
      ? {
          ...matchedExisting,
          name,
          visible: true,
          locked: false,
          nameVisible: true,
          position: pos,
          rotation: { x: 0, y: rotY, z: 0 },
          ...(matchedExisting.kind === 'character'
            ? {
                mannequinPreset: spec.mannequinPreset ?? 'humanoid',
                bonePose: finalBonePose
              }
            : {})
        }
      : {
          id: `${STORYBOARD_ACTOR_ID_PREFIX}${key || i + 1}`,
          name,
          kind: 'character',
          mannequinPreset: spec.mannequinPreset ?? 'humanoid',
          color: ACTOR_PALETTE[i % ACTOR_PALETTE.length],
          visible: true,
          locked: false,
          nameVisible: true,
          position: pos,
          rotation: { x: 0, y: rotY, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          bonePose: finalBonePose
        }

    usedObjectIds.add(actorObj.id)
    actors.push(actorObj)
    actorByKey.set(key, actorObj)
    if (spec.posture) {
      actorPostureById.set(actorObj.id, spec.posture)
    }
  }

  // 4. 将组合素模（含支撑桌椅、桌面显示器/文件堆、背景格子间等）展开为 StageObjectState 树
  const propObjects: StageObjectState[] = []
  for (const objSpec of layoutPlan.objects) {
    const built = buildStageObjectsFromWhiteModelSpec(objSpec, baseY)
    for (const item of built) {
      usedObjectIds.add(item.id)
      propObjects.push(item)
    }
  }

  // 不再保留上次残留的无关角色素体（如 Mannequin (Quadruped)）或旧分镜素模，确保场景干净对应当前分镜
  const keptUserObjects: StageObjectState[] = []

  // 5. 逐镜编译机位、运镜轨迹、切镜片段与角色骨骼动作片段
  const cameras: DirectorCameraState[] = []
  const cameraMoveTracks: DirectorAnimTrack[] = []
  const cutSegments: DirectorCameraCutSegment[] = []
  const actorClipMap = new Map<string, DirectorSkeletonClipSegment[]>()
  for (const actor of actors) {
    actorClipMap.set(actor.id, [])
  }

  let cursorSec = 0
  for (let idx = 0; idx < targetShots.length; idx++) {
    const shot = targetShots[idx]
    const dur = Math.max(1, Math.min(30, Number(shot.durationSec) || 4))
    const startSec = Number(cursorSec.toFixed(2))
    const endSec = Number((cursorSec + dur).toFixed(2))
    cursorSec = endSec

    // 解析本镜主焦点角色与对戏副角色
    const shotActors = (shot.characters ?? [])
      .map((name) => actorByKey.get(filmNameKey(canonicalCharacterName(name))))
      .filter((a): a is StageObjectState => !!a)
    const dialogueLines = Array.isArray(shot.dialogue) ? shot.dialogue : []
    const speakerName = dialogueLines[0]?.speaker
      ? canonicalCharacterName(dialogueLines[0].speaker)
      : ''
    const speakerActor = speakerName ? actorByKey.get(filmNameKey(speakerName)) : undefined
    const primaryActor = speakerActor ?? shotActors[0] ?? actors[idx % actors.length] ?? actors[0]
    const secondaryActor =
      shotActors.find((a) => a.id !== primaryActor.id) ??
      actors.find((a) => a.id !== primaryActor.id) ??
      primaryActor

    const lens = resolveShotLensSpec(shot.shotSize)
    const angleRaw = (shot.angle || '').toLowerCase()
    const moveRaw = (shot.cameraMove || '').toLowerCase()
    const isOrbital = /环绕|绕|orbit|arc/.test(moveRaw)
    const isGroupShot =
      !isOrbital &&
      ((shot.characters?.length ?? 0) >= 2 || actors.length >= 2) &&
      (lens.focalLengthMm <= 35 || /全景|远景|群像|主镜|ls|els|ws|mls/i.test(shot.shotSize))

    // 计算目标注视点（LookAt Target）：若角色处于坐姿（position.y < baseY），视线高度随角色坐姿下移
    const primaryFocusY = Number(
      Math.max(baseY + 0.85, primaryActor.position.y + lens.targetHeightOffset).toFixed(2)
    )
    const focusCenter: StageVec3 = isGroupShot
      ? {
          x: Number(
            (
              (shotActors.length ? shotActors : actors).reduce((s, a) => s + a.position.x, 0) /
              Math.max(1, (shotActors.length ? shotActors : actors).length)
            ).toFixed(2)
          ),
          y: primaryFocusY,
          z: 0
        }
      : {
          x: primaryActor.position.x,
          y: primaryFocusY,
          z: primaryActor.position.z
        }

    // 根据机位角度（平视 / 俯拍 / 仰拍 / 过肩 OTS / 主观 POV / 侧拍）计算相机位置
    let camPos: StageVec3
    let screenOffsetX = 0
    let screenOffsetY = lens.aimTargetPart === 'head' ? 0.04 : 0.02

    if (/过肩|越肩|正反打|ots|over[-\s]*the[-\s]*shoulder/.test(angleRaw) && actors.length >= 2) {
      // 过肩机位：架在副角色肩膀外后方，拍主角色面部的三分之一构图位
      const behindSign = secondaryActor.position.x <= primaryActor.position.x ? -1 : 1
      camPos = {
        x: Number((secondaryActor.position.x + behindSign * 0.42).toFixed(2)),
        y: Number((baseY + 1.68).toFixed(2)),
        z: 0.72
      }
      screenOffsetX = behindSign < 0 ? 0.16 : -0.16
    } else if (/主观|第一人称|pov|point\s*of\s*view/.test(angleRaw) && actors.length >= 2) {
      // 主观视角：从副角色眼睛位置看向主角色
      const dirSign = secondaryActor.position.x <= primaryActor.position.x ? 1 : -1
      camPos = {
        x: Number((secondaryActor.position.x + dirSign * 0.18).toFixed(2)),
        y: Number((baseY + 1.72).toFixed(2)),
        z: 0.15
      }
    } else {
      // 标准正面 / 微侧角度
      const sideBias = /侧|profile|side/.test(angleRaw)
        ? primaryActor.position.x <= 0
          ? 0.65
          : -0.65
        : primaryActor.position.x * 0.35
      let heightBias = 0
      if (/仰拍|低机位|low[-\s]*angle|低角度|hero/.test(angleRaw)) {
        heightBias = -0.42
        screenOffsetY = 0.06
      } else if (/俯拍|高机位|鸟瞰|顶视|high[-\s]*angle|高角度|overhead|bird/.test(angleRaw)) {
        heightBias = 0.78
        screenOffsetY = -0.04
      }
      camPos = {
        x: Number((focusCenter.x + sideBias).toFixed(2)),
        y: Number((focusCenter.y + heightBias).toFixed(2)),
        z: Number((focusCenter.z + lens.distance).toFixed(2))
      }
    }

    const isHandheld = /手持|呼吸|晃动|handheld|shaky/.test(moveRaw)
    const camId = `${STORYBOARD_CAMERA_ID_PREFIX}${shot.id}`
    const camLabelParts = [shot.id, shot.shotSize, shot.angle, shot.cameraMove]
      .map((s) => s?.trim())
      .filter(Boolean)
    const camName = camLabelParts.join(' · ') || (isZh ? `镜头 ${idx + 1}` : `Shot ${idx + 1}`)

    const cameraState: DirectorCameraState = {
      id: camId,
      name: camName,
      visible: true,
      locked: false,
      viewer: {
        position: { ...camPos },
        target: { ...focusCenter },
        rotation: directorViewerRotationFromLook(camPos, focusCenter),
        fov: focalLengthMmToFovDeg(lens.focalLengthMm),
        focalLengthMm: lens.focalLengthMm,
        aperture: lens.aperture,
        focusDistance: Number(
          Math.max(
            0.5,
            Math.hypot(focusCenter.x - camPos.x, focusCenter.y - camPos.y, focusCenter.z - camPos.z)
          ).toFixed(2)
        ),
        cinemachine: isGroupShot
          ? {
              bodyMode: 'groupFraming',
              aimMode: 'groupComposer',
              groupTargetIds: (shotActors.length >= 2 ? shotActors : actors).map((a) => a.id),
              groupFramingScale: 1.25,
              positionDamping: 0.35,
              aimDamping: 0.25,
              screenOffset: { x: 0, y: screenOffsetY },
              deadZoneWidth: 0.08,
              deadZoneHeight: 0.08,
              noisePreset: isHandheld ? 'handheld' : 'none'
            }
          : isOrbital
            ? {
                bodyMode: 'orbital',
                followTargetId: primaryActor.id,
                orbitRadius: lens.distance,
                orbitHeight: Number((camPos.y - baseY).toFixed(2)),
                orbitSpeedDegPerSec: 18,
                aimMode: 'composer',
                lookAtTargetId: primaryActor.id,
                aimTargetPart: lens.aimTargetPart,
                aimDamping: 0.2,
                screenOffset: { x: screenOffsetX, y: screenOffsetY },
                deadZoneWidth: 0.06,
                deadZoneHeight: 0.06,
                autoFocusPull: true,
                noisePreset: isHandheld ? 'handheld' : 'none'
              }
            : {
                bodyMode: 'none',
                aimMode: 'composer',
                lookAtTargetId: primaryActor.id,
                aimTargetPart: lens.aimTargetPart,
                aimDamping: 0.2,
                screenOffset: { x: screenOffsetX, y: screenOffsetY },
                deadZoneWidth: 0.06,
                deadZoneHeight: 0.06,
                autoFocusPull: true,
                noisePreset: isHandheld ? 'handheld' : 'none'
              }
      }
    }
    cameras.push(cameraState)

    // 运镜关键帧轨迹（推 / 拉 / 移 / 摇 / 升降 / 环绕）
    const hasMove = moveRaw && !/^固定$|^静止$|^static$|^locked$|^none$/i.test(moveRaw.trim())
    if (hasMove) {
      const endPos = { ...camPos }
      let endFov = cameraState.viewer.fov
      if (/推|推进|靠近|dolly\s*in|push\s*in|zoom\s*in/.test(moveRaw)) {
        const pushFactor = 0.68
        endPos.x = Number((focusCenter.x + (camPos.x - focusCenter.x) * pushFactor).toFixed(2))
        endPos.z = Number((focusCenter.z + (camPos.z - focusCenter.z) * pushFactor).toFixed(2))
      } else if (/拉|拉远|后退|dolly\s*out|pull\s*back|pull\s*out|zoom\s*out/.test(moveRaw)) {
        const pullFactor = 1.38
        endPos.x = Number((focusCenter.x + (camPos.x - focusCenter.x) * pullFactor).toFixed(2))
        endPos.z = Number((focusCenter.z + (camPos.z - focusCenter.z) * pullFactor).toFixed(2))
      } else if (/升|crane\s*up|pedestal\s*up|rise/.test(moveRaw)) {
        endPos.y = Number((camPos.y + 0.55).toFixed(2))
      } else if (/降|crane\s*down|pedestal\s*down/.test(moveRaw)) {
        endPos.y = Number((camPos.y - 0.45).toFixed(2))
      } else if (/环绕|绕|orbit|arc/.test(moveRaw)) {
        endPos.x = Number((camPos.x + 1.15).toFixed(2))
        endPos.z = Number(Math.max(0.6, camPos.z - 0.35).toFixed(2))
      } else if (/移|横移|跟|摇|pan|truck|track|follow/.test(moveRaw)) {
        endPos.x = Number((camPos.x + 0.65).toFixed(2))
      } else if (/变焦|希区柯克|vertigo/.test(moveRaw)) {
        endFov = focalLengthMmToFovDeg(Math.min(105, lens.focalLengthMm * 1.45))
      }

      if (
        endPos.x !== camPos.x ||
        endPos.y !== camPos.y ||
        endPos.z !== camPos.z ||
        endFov !== cameraState.viewer.fov
      ) {
        const startRot = directorViewerRotationFromLook(camPos, focusCenter)
        const endRot = directorViewerRotationFromLook(endPos, focusCenter)
        const keyframes: DirectorAnimKeyframe[] = [
          {
            id: `kf:sb:cam:${shot.id}:0`,
            time: startSec,
            position: { ...camPos },
            rotation: startRot,
            easing: 'easeInOut',
            ...(cameraState.viewer.fov ? { fov: cameraState.viewer.fov } : {})
          },
          {
            id: `kf:sb:cam:${shot.id}:1`,
            time: endSec,
            position: endPos,
            rotation: endRot,
            easing: 'easeInOut',
            ...(endFov ? { fov: endFov } : {})
          }
        ]
        cameraMoveTracks.push({
          id: `track:sb:cam:${shot.id}`,
          name: isZh ? `${shot.id} 运镜轨` : `${shot.id} Camera Move`,
          targetKind: 'camera',
          targetId: camId,
          start: startSec,
          end: endSec,
          path: {
            kind: 'line',
            points: [{ ...camPos }, endPos],
            closed: false
          },
          keyframes
        })
      }
    }

    // 机位切换轨片段（若上一镜 transition 含渐变/叠化/平滑，自动赋予 Cinemachine 平滑融合）
    const prevTransition = idx > 0 ? (targetShots[idx - 1].transition || '').toLowerCase() : ''
    const isSmoothBlend = /叠化|渐变|平滑|溶解|融合|dissolve|fade|smooth|blend/.test(prevTransition)
    cutSegments.push({
      id: `${STORYBOARD_CUT_ID_PREFIX}${shot.id}`,
      cameraId: camId,
      start: startSec,
      end: endSec,
      ...(isSmoothBlend ? { blendInSec: Math.min(0.8, dur * 0.3), blendCurve: 'easeInOut' } : {})
    })

    // 为每位演员添加本镜区间内的骨骼动作片段
    for (const actor of actors) {
      const clipName = inferActorClipForShot(
        shot,
        actor.name,
        actor.id === primaryActor.id,
        actorPostureById.get(actor.id)
      )
      const list = actorClipMap.get(actor.id) ?? []
      const prevSeg = list[list.length - 1]
      if (prevSeg && prevSeg.clip === clipName && Math.abs(prevSeg.end - startSec) < 0.05) {
        prevSeg.end = endSec
      } else {
        list.push({
          id: `sk:sb:${actor.id}:${shot.id}`,
          clip: clipName,
          start: startSec,
          end: endSec,
          speed: 1,
          loop: true,
          crossFadeSec: 0.25
        })
      }
      actorClipMap.set(actor.id, list)
    }
  }

  const totalDurationSec = Math.max(2, Number(cursorSec.toFixed(2)))
  const actorTracks: DirectorAnimTrack[] = actors.map((actor) => ({
    id: `track:sb:actor:${actor.id}`,
    name: isZh ? `${actor.name} 表演轨` : `${actor.name} Performance`,
    targetKind: 'object',
    targetId: actor.id,
    start: 0,
    end: totalDurationSec,
    path: null,
    keyframes: [
      {
        id: `kf:sb:actor:${actor.id}:0`,
        time: 0,
        position: { ...actor.position },
        rotation: { ...actor.rotation }
      }
    ],
    skeletonClips: actorClipMap.get(actor.id) ?? []
  }))

  const cutTrack: DirectorAnimTrack = {
    id: 'track:sb:cuts',
    name: isZh
      ? '分镜机位切换轨 (Cinemachine Brain)'
      : 'Storyboard Camera Cuts (Cinemachine Brain)',
    targetKind: 'camera',
    targetId: cameras[0]?.id ?? '__stage_camera__',
    start: 0,
    end: totalDurationSec,
    path: null,
    keyframes: [],
    cameraCut: true,
    cameraSegments: cutSegments
  }

  const lightingPreset = inferLightingFromStoryboard(storyboard, targetShots)
  const { lights: lightObjects, fogPatch } = buildLightingPresetObjects(
    lightingPreset,
    { x: 0, y: baseY + 0.9, z: 0 },
    1.8,
    null,
    options.locale
  )
  const aspect =
    storyboard.aspectRatio === '2.39:1'
      ? '21:9'
      : normalizeDirectorAspectRatio(storyboard.aspectRatio || currentStage.aspectRatio || '16:9')

  const nextStage: DirectorStageState = {
    ...currentStage,
    selectedObjectId: actors[0]?.id ?? null,
    cameras,
    activeCameraId: cameras[0]?.id ?? null,
    aspectRatio: aspect === 'auto' ? '16:9' : aspect,
    compositionGuide: 'thirds',
    lightingPreset,
    shadowCatcherEnabled: true,
    ...(fogPatch ? fogPatch : {}),
    objects: [...actors, ...propObjects, ...keptUserObjects, ...lightObjects],
    animation: {
      duration: totalDurationSec,
      loop: true,
      tracks: [cutTrack, ...cameraMoveTracks, ...actorTracks]
    }
  }

  return {
    stage: nextStage,
    shots: targetShots,
    shotCount: targetShots.length,
    actorCount: actors.length,
    propCount: layoutPlan.objects.length,
    totalDurationSec,
    usedLlm: layoutPlan.usedLlm
  }
}

const compiledStageSigByOwner = new Map<string, string>()

export function computeStoryboardPrevizSignature(
  storyboard: FilmStoryboard,
  options: CompileStoryboardPrevizOptions = {}
): string {
  const isZh = options.locale ? options.locale.toLowerCase().startsWith('zh') : true
  const { targetShots, characterNames, propNames, locationNames } = collectScopedStoryboardEntities(
    storyboard,
    options,
    isZh
  )
  return JSON.stringify({
    aspectRatio: storyboard.aspectRatio ?? '16:9',
    style: storyboard.style ?? '',
    sceneId: options.sceneId ?? null,
    shotId: options.shotId ?? null,
    characters: characterNames,
    props: propNames,
    locations: locationNames,
    shots: targetShots.map((s) => ({
      id: s.id,
      order: s.order ?? 0,
      sceneId: s.sceneId ?? '',
      durationSec: Math.max(1, Math.min(30, Number(s.durationSec) || 4)),
      shotSize: s.shotSize ?? '',
      angle: s.angle ?? '',
      cameraMove: s.cameraMove ?? '',
      location: s.location ?? '',
      characters: s.characters ?? [],
      props: s.props ?? [],
      action: s.action ?? '',
      transition: s.transition ?? '',
      dialogue: (s.dialogue ?? []).map((d) => `${d.speaker ?? ''}:${d.line ?? ''}`)
    }))
  })
}

export function markCompiledStoryboardStage(
  stage: DirectorStageState,
  storyboard: FilmStoryboard,
  options: CompileStoryboardPrevizOptions = {}
): void {
  const ownerKey = stage.ownerProcessingNodeId?.trim() || '__default__'
  compiledStageSigByOwner.set(ownerKey, computeStoryboardPrevizSignature(storyboard, options))
}

/**
 * 判断当前 3D 导演台舞台是否已经包含与目标分镜范围完全一致的预演结果。
 * 若命中缓存，可直接进入导演台而无需重新调用 LLM 或覆盖用户在导演台内的手动微调。
 */
export function canReuseCompiledStoryboardStage(
  currentStage: DirectorStageState,
  storyboard: FilmStoryboard,
  options: CompileStoryboardPrevizOptions = {}
): boolean {
  const isZh = options.locale ? options.locale.toLowerCase().startsWith('zh') : true
  const { targetShots, characterNames, propNames } = collectScopedStoryboardEntities(
    storyboard,
    options,
    isZh
  )
  if (targetShots.length === 0 || currentStage.objects.length === 0) return false

  const ownerKey = currentStage.ownerProcessingNodeId?.trim() || '__default__'
  const currentSig = computeStoryboardPrevizSignature(storyboard, options)
  const recordedSig = compiledStageSigByOwner.get(ownerKey)
  if (recordedSig && recordedSig !== currentSig) {
    return false
  }

  const sbCams = (currentStage.cameras ?? []).filter((c) =>
    c.id.startsWith(STORYBOARD_CAMERA_ID_PREFIX)
  )
  if (sbCams.length !== targetShots.length) return false

  const cutTrack = currentStage.animation?.tracks.find((tr) => tr.cameraCut)
  const cutSegments = cutTrack?.cameraSegments ?? []

  for (let idx = 0; idx < targetShots.length; idx++) {
    const shot = targetShots[idx]
    const cam = sbCams[idx]
    const expectedCamId = `${STORYBOARD_CAMERA_ID_PREFIX}${shot.id}`
    if (!cam || cam.id !== expectedCamId) return false
    const expectedLabel =
      [shot.id, shot.shotSize, shot.angle, shot.cameraMove]
        .map((s) => s?.trim())
        .filter(Boolean)
        .join(' · ') || (isZh ? `镜头 ${idx + 1}` : `Shot ${idx + 1}`)
    if (cam.name !== expectedLabel) return false

    const expectedDur = Math.max(1, Math.min(30, Number(shot.durationSec) || 4))
    const seg = cutSegments.find((s) => s.id === `${STORYBOARD_CUT_ID_PREFIX}${shot.id}`)
    if (!seg || Math.abs(seg.end - seg.start - expectedDur) > 0.05) return false
  }

  for (const charName of characterNames) {
    const key = filmNameKey(charName)
    const hasActor = currentStage.objects.some(
      (o) =>
        (o.kind === 'character' || o.kind === 'model') &&
        (filmNameKey(o.name) === key || o.id === `${STORYBOARD_ACTOR_ID_PREFIX}${key}`)
    )
    if (!hasActor) return false
  }

  for (const propName of propNames) {
    const key = filmNameKey(propName)
    if (!key) continue
    const hasProp = currentStage.objects.some(
      (o) => o.id === `${STORYBOARD_PROP_ID_PREFIX}${key}` || filmNameKey(o.name) === key
    )
    if (!hasProp) return false
  }

  compiledStageSigByOwner.set(ownerKey, currentSig)
  return true
}

/**
 * 异步版本：优先调用大语言模型（LLM）根据分镜画面描述自动规划角色姿态、空间站位以及定制缺失道具的多部件组合素模，
 * 若 LLM 不可用则自动降级为内置高还原度空间求解器。
 */
export async function compileStoryboardToDirectorStageWithLlm(
  currentStage: DirectorStageState,
  storyboard: FilmStoryboard,
  options: CompileStoryboardPrevizOptions = {}
): Promise<CompiledStoryboardPrevizResult> {
  const isZh = options.locale ? options.locale.toLowerCase().startsWith('zh') : true
  const { targetShots, characterNames, propNames, locationNames } = collectScopedStoryboardEntities(
    storyboard,
    options,
    isZh
  )
  if (targetShots.length === 0) {
    return compileStoryboardToDirectorStage(currentStage, storyboard, options)
  }

  const layoutPlan =
    options.layoutPlan ??
    (await planStoryboard3dLayoutWithLlm({
      storyboard,
      targetShots,
      characterNames,
      propNames,
      locationNames,
      locale: options.locale,
      generateText: options.generateText,
      model: options.model,
      providerInstanceId: options.providerInstanceId
    }))

  const compiled = compileStoryboardToDirectorStage(currentStage, storyboard, {
    ...options,
    layoutPlan
  })
  markCompiledStoryboardStage(compiled.stage, storyboard, options)
  return compiled
}
