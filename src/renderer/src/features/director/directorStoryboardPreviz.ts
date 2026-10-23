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
  parseStoryboardSpatialRoles,
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

export { extractStoryboardShotIdFromDirectorId } from '@shared/domain'

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

interface ShotTimeCodedSegment {
  relStart: number
  relEnd: number
  text: string
}

/**
 * 解析分镜描述中的显式时间段（如 `0-1s：...；1-3s：...；3-5s：...`）。
 */
function parseShotTimeCodedSegments(shot: FilmShot, durSec: number): ShotTimeCodedSegment[] {
  const combined = [shot.action ?? '', shot.videoPrompt ?? ''].filter(Boolean).join('；')
  if (!combined) return []
  const headerRegex = /(\d+(?:\.\d+)?)\s*[-~至到]\s*(\d+(?:\.\d+)?)\s*(?:s|sec|秒)\s*[：:，,]?/gi
  const matches: Array<{ index: number; headerEnd: number; t0: number; t1: number }> = []
  let m: RegExpExecArray | null
  while ((m = headerRegex.exec(combined)) !== null) {
    const t0 = Math.max(0, Math.min(durSec, Number(m[1]) || 0))
    const t1 = Math.max(t0 + 0.2, Math.min(durSec, Number(m[2]) || durSec))
    matches.push({
      index: m.index,
      headerEnd: m.index + m[0].length,
      t0,
      t1
    })
  }
  if (matches.length === 0) return []
  const out: ShotTimeCodedSegment[] = []
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i]
    const nextStart = i + 1 < matches.length ? matches[i + 1].index : combined.length
    const text = combined
      .slice(cur.headerEnd, nextStart)
      .replace(/^[：:，,\s]+|[；;。\s]+$/g, '')
      .trim()
    if (text) {
      out.push({ relStart: cur.t0, relEnd: cur.t1, text })
    }
  }
  return out
}

/**
 * 将单个时间段内的描述子句按主语归属给各个角色（支持省略主语的子句继承前一句主语）。
 */
function mapSegmentClausesByActor(
  segText: string,
  actors: readonly StageObjectState[]
): Map<string, string[]> {
  const byActorId = new Map<string, string[]>()
  const clauses = segText
    .split(/[，,；;。]+/)
    .map((c) => c.trim())
    .filter(Boolean)

  let activeActor: StageObjectState | null = null
  for (const clause of clauses) {
    if (/^(?:机位|镜头|运镜|背景|画面|暖金色|冷色调|三人|两人|众人)/.test(clause)) {
      activeActor = null
      continue
    }
    let bestHit: { actor: StageObjectState; idx: number } | null = null
    for (const actor of actors) {
      const idx = clause.indexOf(actor.name)
      if (idx >= 0 && (bestHit === null || idx < bestHit.idx)) {
        bestHit = { actor, idx }
      }
    }
    if (bestHit && bestHit.idx <= 4) {
      activeActor = bestHit.actor
    }
    if (activeActor) {
      const list = byActorId.get(activeActor.id) ?? []
      list.push(clause)
      byActorId.set(activeActor.id, list)
    }
  }
  return byActorId
}

function pushActorKeyframeDedup(
  list: DirectorAnimKeyframe[],
  actorId: string,
  time: number,
  position: StageVec3,
  rotation: StageVec3
): void {
  const tFixed = Number(time.toFixed(2))
  const posFixed: StageVec3 = {
    x: Number(position.x.toFixed(2)),
    y: Number(position.y.toFixed(2)),
    z: Number(position.z.toFixed(2))
  }
  const rotFixed: StageVec3 = {
    x: Number(rotation.x.toFixed(2)),
    y: Number(rotation.y.toFixed(2)),
    z: Number(rotation.z.toFixed(2))
  }
  const prev = list[list.length - 1]
  if (prev && Math.abs(prev.time - tFixed) < 0.04) {
    prev.position = posFixed
    prev.rotation = rotFixed
    return
  }
  list.push({
    id: `kf:sb:actor:${actorId}:${list.length}`,
    time: tFixed,
    position: posFixed,
    rotation: rotFixed,
    easing: 'easeInOut'
  })
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
  const actorKeyframesMap = new Map<string, DirectorAnimKeyframe[]>()
  for (const actor of actors) {
    actorClipMap.set(actor.id, [])
    actorKeyframesMap.set(actor.id, [])
  }

  let cursorSec = 0
  for (let idx = 0; idx < targetShots.length; idx++) {
    const shot = targetShots[idx]
    const dur = Math.max(1, Math.min(30, Number(shot.durationSec) || 4))
    const startSec = Number(cursorSec.toFixed(2))
    const endSec = Number((cursorSec + dur).toFixed(2))
    cursorSec = endSec

    // 解析本镜空间角色关系（如「过肩（周敏肩前拍苏念）」、离画入画、逼近、右侧伴随等）
    const shotRoles = parseStoryboardSpatialRoles([shot], characterNames)
    const otsTargetActor = shotRoles.otsTargetActorName
      ? actorByKey.get(filmNameKey(shotRoles.otsTargetActorName))
      : undefined
    const otsShoulderActor = shotRoles.otsShoulderActorName
      ? actorByKey.get(filmNameKey(shotRoles.otsShoulderActorName))
      : undefined

    // 解析本镜主焦点角色与对戏副角色
    const shotActors = (shot.characters ?? [])
      .map((name) => actorByKey.get(filmNameKey(canonicalCharacterName(name))))
      .filter((a): a is StageObjectState => !!a)
    const dialogueLines = Array.isArray(shot.dialogue) ? shot.dialogue : []
    const speakerName = dialogueLines[0]?.speaker
      ? canonicalCharacterName(dialogueLines[0].speaker)
      : ''
    const speakerActor = speakerName ? actorByKey.get(filmNameKey(speakerName)) : undefined
    const primaryActor =
      otsTargetActor ?? speakerActor ?? shotActors[0] ?? actors[idx % actors.length] ?? actors[0]
    const secondaryActor =
      otsShoulderActor ??
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

    const isDepthStaggeredOts =
      /过肩|越肩|正反打|ots|over[-\s]*the[-\s]*shoulder/.test(angleRaw) &&
      actors.length >= 2 &&
      secondaryActor.position.z - primaryActor.position.z >= 0.35

    if (/过肩|越肩|正反打|ots|over[-\s]*the[-\s]*shoulder/.test(angleRaw) && actors.length >= 2) {
      // 过肩机位：若前景肩部角色与中景焦点角色已有前后纵深差，架在前景角色内侧肩后；否则按左右轴线越肩架设
      if (isDepthStaggeredOts) {
        const innerShift = secondaryActor.position.x <= primaryActor.position.x ? 0.16 : -0.16
        camPos = {
          x: Number((secondaryActor.position.x + innerShift).toFixed(2)),
          y: Number((baseY + 1.56).toFixed(2)),
          z: Number((secondaryActor.position.z + 0.97).toFixed(2))
        }
        screenOffsetX = secondaryActor.position.x <= primaryActor.position.x ? -0.06 : 0.06
        screenOffsetY = -0.02
      } else {
        const behindSign = secondaryActor.position.x <= primaryActor.position.x ? -1 : 1
        camPos = {
          x: Number((secondaryActor.position.x + behindSign * 0.42).toFixed(2)),
          y: Number((baseY + 1.68).toFixed(2)),
          z: 0.72
        }
        screenOffsetX = behindSign < 0 ? 0.16 : -0.16
      }
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

    // 多人纵深过肩或 ≥3 人同场时采用宽视场角（62° 垂直 FOV），确保前景肩背、中景焦点与后景多人即使在 9:16 竖屏安全框内也完整同框；同时保留 focalLengthMm 用于影视焦段语义描述
    const effectiveFov =
      isDepthStaggeredOts || (actors.length >= 3 && lens.focalLengthMm <= 50)
        ? Math.max(62, focalLengthMmToFovDeg(lens.focalLengthMm))
        : focalLengthMmToFovDeg(lens.focalLengthMm)

    const cameraState: DirectorCameraState = {
      id: camId,
      name: camName,
      visible: true,
      locked: false,
      viewer: {
        position: { ...camPos },
        target: { ...focusCenter },
        rotation: directorViewerRotationFromLook(camPos, focusCenter),
        fov: effectiveFov,
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
      if (/推|推进|靠近|收紧|dolly\s*in|push\s*in|zoom\s*in/.test(moveRaw)) {
        const pushFactor = 0.67
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

    // 解析分镜内时间码调度（如 0-1s / 1-3s / 3-5s / 5-7s / 7-8s）并生成演员走位关键帧与骨骼动作轨
    const timeSegs = parseShotTimeCodedSegments(shot, dur)
    const appendActorClip = (
      actorId: string,
      clipName: string,
      segStart: number,
      segEnd: number
    ): void => {
      const sFixed = Number(segStart.toFixed(2))
      const eFixed = Number(segEnd.toFixed(2))
      if (eFixed - sFixed < 0.05) return
      const list = actorClipMap.get(actorId) ?? []
      const prevSeg = list[list.length - 1]
      if (prevSeg && prevSeg.clip === clipName && Math.abs(prevSeg.end - sFixed) < 0.06) {
        prevSeg.end = eFixed
      } else {
        list.push({
          id: `sk:sb:${actorId}:${shot.id}:${list.length}`,
          clip: clipName,
          start: sFixed,
          end: eFixed,
          speed: 1,
          loop: true,
          crossFadeSec: 0.25
        })
      }
      actorClipMap.set(actorId, list)
    }

    const curActorPosMap = new Map<string, StageVec3>()
    const curActorRotMap = new Map<string, StageVec3>()
    for (const actor of actors) {
      const aKey = filmNameKey(actor.name)
      const hint = shotRoles.actorHints.get(aKey)
      const homePos = { ...actor.position }
      const homeRot = { ...actor.rotation }
      let initPos = { ...homePos }
      let initRot = { ...homeRot }

      if (hint?.entersFrom === 'left' || (hint?.startsOffFrame && hint?.entersFrom !== 'right')) {
        initPos = {
          x: -0.72,
          y: homePos.y,
          z: Number((homePos.z + 0.1).toFixed(2))
        }
        initRot = { x: 0, y: Number((Math.PI * 0.42).toFixed(2)), z: 0 }
      } else if (hint?.entersFrom === 'right') {
        initPos = {
          x: 0.72,
          y: homePos.y,
          z: Number((homePos.z + 0.1).toFixed(2))
        }
        initRot = { x: 0, y: Number((-Math.PI * 0.42).toFixed(2)), z: 0 }
      }

      curActorPosMap.set(actor.id, initPos)
      curActorRotMap.set(actor.id, initRot)
      const kfList = actorKeyframesMap.get(actor.id) ?? []
      pushActorKeyframeDedup(kfList, actor.id, startSec, initPos, initRot)
      actorKeyframesMap.set(actor.id, kfList)
    }

    if (timeSegs.length >= 2) {
      for (const seg of timeSegs) {
        const absStart = Number((startSec + seg.relStart).toFixed(2))
        const absEnd = Number((startSec + seg.relEnd).toFixed(2))
        const clausesByActor = mapSegmentClausesByActor(seg.text, actors)
        const isTriangleBeat = /压迫三角|形成.*三角|合围/.test(seg.text)

        for (const actor of actors) {
          const aKey = filmNameKey(actor.name)
          const hint = shotRoles.actorHints.get(aKey)
          const kfList = actorKeyframesMap.get(actor.id) ?? []
          const curPos = curActorPosMap.get(actor.id) ?? { ...actor.position }
          const curRot = curActorRotMap.get(actor.id) ?? { ...actor.rotation }
          const actorClauses = (clausesByActor.get(actor.id) ?? []).join('，')

          const isOffFrameHold = /未入画|画面外|场外|画外|待入画/.test(actorClauses)
          const isEntering =
            !isOffFrameHold &&
            /从(?:画面)?(?:左|右)侧入画|从(?:左|右)(?:边|侧)?(?:走入|进入|入画)|走入画面/.test(
              actorClauses
            )
          const isApproaching = /迎着镜头逼近|向镜头逼近|上前一步|往前一步|逼近|走近|踏前/.test(
            actorClauses
          )
          const isEmbracing = /搂紧|揽住|拥抱|靠拢/.test(actorClauses)
          const isSpeaking = /回应|逼问|台词|劝话|嘲讽|质问|说|道/.test(actorClauses)

          if (isEntering) {
            pushActorKeyframeDedup(kfList, actor.id, absStart, curPos, curRot)
            const nextPos = { ...actor.position }
            const nextRot = { ...actor.rotation }
            curActorPosMap.set(actor.id, nextPos)
            curActorRotMap.set(actor.id, nextRot)
            pushActorKeyframeDedup(kfList, actor.id, absEnd, nextPos, nextRot)
            if (isSpeaking && absEnd - absStart >= 1.2) {
              const midSec = Number((absStart + (absEnd - absStart) * 0.6).toFixed(2))
              appendActorClip(actor.id, 'Walk', absStart, midSec)
              appendActorClip(actor.id, 'Talk', midSec, absEnd)
            } else {
              appendActorClip(actor.id, 'Walk', absStart, absEnd)
            }
          } else if (isApproaching) {
            pushActorKeyframeDedup(kfList, actor.id, absStart, curPos, curRot)
            const dx = (primaryActor.position.x - curPos.x) * 0.25
            const dz = (primaryActor.position.z - curPos.z) * 0.28
            const nextPos: StageVec3 = {
              x: Number((curPos.x + dx).toFixed(2)),
              y: curPos.y,
              z: Number((curPos.z + dz).toFixed(2))
            }
            curActorPosMap.set(actor.id, nextPos)
            pushActorKeyframeDedup(kfList, actor.id, absEnd, nextPos, curRot)
            appendActorClip(actor.id, 'Walk', absStart, absEnd)
          } else if (isEmbracing) {
            pushActorKeyframeDedup(kfList, actor.id, absStart, curPos, curRot)
            const compActor = hint?.companionActorKey
              ? actorByKey.get(hint.companionActorKey)
              : undefined
            const compPos = compActor
              ? (curActorPosMap.get(compActor.id) ?? compActor.position)
              : null
            const nextPos: StageVec3 = compPos
              ? {
                  x: Number((compPos.x + (curPos.x >= compPos.x ? 0.22 : -0.22)).toFixed(2)),
                  y: curPos.y,
                  z: Number((compPos.z - 0.03).toFixed(2))
                }
              : {
                  x: Number((curPos.x - 0.16).toFixed(2)),
                  y: curPos.y,
                  z: Number((curPos.z + 0.05).toFixed(2))
                }
            curActorPosMap.set(actor.id, nextPos)
            pushActorKeyframeDedup(kfList, actor.id, absEnd, nextPos, curRot)
            appendActorClip(actor.id, isSpeaking ? 'Talk' : 'Wave', absStart, absEnd)
          } else if (isTriangleBeat && actor.id !== primaryActor.id) {
            pushActorKeyframeDedup(kfList, actor.id, absStart, curPos, curRot)
            const nextPos: StageVec3 = {
              x: Number((curPos.x + (primaryActor.position.x - curPos.x) * 0.08).toFixed(2)),
              y: curPos.y,
              z: Number((curPos.z + (primaryActor.position.z - curPos.z) * 0.08).toFixed(2))
            }
            curActorPosMap.set(actor.id, nextPos)
            pushActorKeyframeDedup(kfList, actor.id, absEnd, nextPos, curRot)
            appendActorClip(actor.id, isSpeaking ? 'Talk' : 'Idle', absStart, absEnd)
          } else {
            appendActorClip(actor.id, isSpeaking ? 'Talk' : 'Idle', absStart, absEnd)
          }
          actorKeyframesMap.set(actor.id, kfList)
        }
      }
      // 确保每位演员在本镜末尾有收尾关键帧
      for (const actor of actors) {
        const kfList = actorKeyframesMap.get(actor.id) ?? []
        const curPos = curActorPosMap.get(actor.id) ?? { ...actor.position }
        const curRot = curActorRotMap.get(actor.id) ?? { ...actor.rotation }
        if (kfList.length >= 2) {
          pushActorKeyframeDedup(kfList, actor.id, endSec, curPos, curRot)
        }
      }
    } else {
      // 无显式时间码分段时：为每位演员推断本镜骨骼片段，并为位移型动作生成起止关键帧
      for (const actor of actors) {
        const clipName = inferActorClipForShot(
          shot,
          actor.name,
          actor.id === primaryActor.id,
          actorPostureById.get(actor.id)
        )
        appendActorClip(actor.id, clipName, startSec, endSec)

        const aKey = filmNameKey(actor.name)
        const hint = shotRoles.actorHints.get(aKey)
        const kfList = actorKeyframesMap.get(actor.id) ?? []
        const curPos = curActorPosMap.get(actor.id) ?? { ...actor.position }
        const curRot = curActorRotMap.get(actor.id) ?? { ...actor.rotation }

        if (hint?.entersFrom || hint?.startsOffFrame) {
          pushActorKeyframeDedup(
            kfList,
            actor.id,
            endSec,
            { ...actor.position },
            { ...actor.rotation }
          )
        } else if (hint?.approachesCamera && actor.id !== primaryActor.id) {
          const nextPos: StageVec3 = {
            x: Number((curPos.x + (primaryActor.position.x - curPos.x) * 0.26).toFixed(2)),
            y: curPos.y,
            z: Number((curPos.z + (primaryActor.position.z - curPos.z) * 0.26).toFixed(2))
          }
          pushActorKeyframeDedup(kfList, actor.id, endSec, nextPos, curRot)
        } else if (clipName === 'Run' || clipName === 'Sprint' || clipName === 'Walk') {
          const distStep = clipName === 'Walk' ? 0.55 : 1.15
          const nextPos: StageVec3 = {
            x: Number((curPos.x + Math.sin(curRot.y) * distStep).toFixed(2)),
            y: curPos.y,
            z: Number((curPos.z + Math.cos(curRot.y) * distStep).toFixed(2))
          }
          pushActorKeyframeDedup(kfList, actor.id, endSec, nextPos, curRot)
        }
        actorKeyframesMap.set(actor.id, kfList)
      }
    }
  }

  const totalDurationSec = Math.max(2, Number(cursorSec.toFixed(2)))
  const actorTracks: DirectorAnimTrack[] = actors.map((actor) => {
    const rawKfs = actorKeyframesMap.get(actor.id) ?? []
    const keyframes: DirectorAnimKeyframe[] =
      rawKfs.length > 0
        ? rawKfs
        : [
            {
              id: `kf:sb:actor:${actor.id}:0`,
              time: 0,
              position: { ...actor.position },
              rotation: { ...actor.rotation }
            }
          ]
    const distinctPoints: StageVec3[] = []
    for (const kf of keyframes) {
      const prev = distinctPoints[distinctPoints.length - 1]
      if (
        !prev ||
        Math.hypot(kf.position.x - prev.x, kf.position.y - prev.y, kf.position.z - prev.z) > 0.04
      ) {
        distinctPoints.push({ ...kf.position })
      }
    }
    const hasSpatialMove = distinctPoints.length >= 2
    return {
      id: `track:sb:actor:${actor.id}`,
      name: isZh ? `${actor.name} 表演轨` : `${actor.name} Performance`,
      targetKind: 'object',
      targetId: actor.id,
      start: 0,
      end: totalDurationSec,
      path: hasSpatialMove
        ? {
            kind: distinctPoints.length > 2 ? 'pen' : 'line',
            points: distinctPoints,
            closed: false
          }
        : null,
      keyframes,
      skeletonClips: actorClipMap.get(actor.id) ?? []
    }
  })

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

    if (characterNames.length >= 3 && (cam.viewer.fov ?? 45) < 55) {
      return false
    }

    if (parseShotTimeCodedSegments(shot, expectedDur).length >= 2) {
      const hasAnimatedActorTrack = (currentStage.animation?.tracks ?? []).some(
        (tr) => tr.targetKind === 'object' && (tr.keyframes?.length ?? 0) >= 2
      )
      if (!hasAnimatedActorTrack) return false
    }
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
