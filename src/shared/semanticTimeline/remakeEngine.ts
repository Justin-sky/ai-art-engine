/**
 * 四轴分流复刻执行规划器（`remakeEngine.ts`）—— 纯函数，主进程、渲染进程、MCP 与测试共用。
 *
 * 直接基于 `SemanticTimeline` 规划三种复刻策略（无中间编译节点）：
 * - `edit`（局部改片）：与 `baseline` 比对脏集合，仅重生成修改过的镜头/单元与重配修改过的台词，其余 100% 原片直通；
 * - `fidelity`（1:1 分流复刻）：按 `rea-video` 路由执行——`G1..Gk` 跨镜单元合批调一次视频模型并按比例回切各镜、`K1..Kk` 走本地 FFmpeg 零成本推拉/静帧、真实录屏与影视原片自动直通保护；
 * - `adapt`（换品仿拍）：在分流复刻基础上叠加参考图锁定（`@图片1..k`）、主体局部替换与全局改编指令。
 */
import { collectShotReplacements, type ShotReplacement } from './entityReplace'
import { diffAgainstBaseline, type SemanticDiff } from './migrate'
import { hsvBhattacharyyaDistance } from './reaClassify'
import { finalizeSemanticBreakdown } from './reaPlan'
import type { BreakdownLang, GenerationUnit, RemakeExecutorKind } from './reaTypes'
import { keyframeProjectPath } from './storage'
import type { SemanticShot, SemanticTimeline } from './types'

export type RemakeStrategy = 'edit' | 'fidelity' | 'adapt'

export interface OverlayNormalizedBox {
  x: number
  y: number
  w: number
  h: number
  kind?: string
}

export interface DubLine {
  id: string
  sourceStartSec: number
  sourceEndSec: number
  text: string
  sourceText: string
  speaker?: string
  voice?: string
  referenceAudio?: string
}

export interface PlanSubtitle {
  sourceStartSec: number
  sourceEndSec: number
  text: string
}

export interface RemakeShotSlice {
  shotId: string
  offsetSec: number
  durationSec: number
  offsetRatio: number
  durationRatio: number
  sourceStartSec?: number
  sourceEndSec?: number
}

export interface RemakeUnitTask {
  /** 单元键：跨镜单元为 `G1..Gk`，单镜任务为 `shotId` */
  key: string
  unitId?: string
  executor: RemakeExecutorKind
  shotSlices: RemakeShotSlice[]
  durationSec: number
  sourceRange?: { start: number; end: number }
  imagePrompt: string
  videoPrompt: string
  negativePrompt?: string
  conditioningMode: 'first_last_frame' | 'image_to_video' | 'reference_video'
  referenceTags: string[]
  firstFrameRelativePath?: string
  lastFrameRelativePath?: string
  /** 首帧上检测到的烧录包装/花字/字幕归一化框（送入图生视频前可先擦除为去字净板） */
  overlayBoxes?: OverlayNormalizedBox[]
  /** 同场景紧邻前序生成单元键（需要跨单元尾帧接力时指向前序 `unit.key`） */
  chainFromUnitKey?: string
  replacements?: ShotReplacement[]
  changeReasons?: string[]
}

export interface LocalRebuildClip {
  key: string
  unitId?: string
  mode: 'ken_burns' | 'static_hold'
  durationSec: number
  firstFrameRelativePath: string
  imagePrompt?: string
  zoomPerSec: number
  panPxPerSec: number
  panDirDeg: number
  overlayBoxes?: OverlayNormalizedBox[]
  replacements?: ShotReplacement[]
}

export interface RebuildSegment {
  key: string
  kind: 'source' | 'generate'
  /** 对应 `clips` 清单里的键（如 `G1` 或 `shot.001.0`）；缺省等于 `key` */
  clipKey?: string
  clipOffsetRatio?: number
  clipDurationRatio?: number
  durationSec: number
  sourceStartSec?: number
  sourceEndSec?: number
}

export interface RemakeExecutionPlan {
  strategy: RemakeStrategy
  /** 需要调用 AI 视频生成模型的单元任务（= 实际视频 API 调用次数） */
  units: RemakeUnitTask[]
  /** 零成本本地 FFmpeg 推拉/静帧任务（0 视频模型调用） */
  localClips: LocalRebuildClip[]
  /** 按成片时间顺序排列的拼接段 */
  segments: RebuildSegment[]
  /** 需要重新配音的台词 */
  dubs: DubLine[]
  /** 成片烧录字幕 */
  subtitles: PlanSubtitle[]
  /** 原片直通镜头数 */
  passthroughShots: number
  /** 因保护真实录屏/原片素材而自动保留直通的镜头数 */
  protectedRealMaterial: number
  /** 超出 `maxUnits` 上限而回退直通的镜头数 */
  skippedByLimit: number
  /** 由 AI 视频模型覆盖的总镜头数（跨镜单元内可含多镜） */
  generatedShots: number
}

export interface PlanRemakeExecutionOptions {
  strategy?: RemakeStrategy
  /** 全局补充/改编指令（追加到 imagePrompt 与 videoPrompt） */
  instruction?: string
  /** 最多调用几次视频生成单元（缺省不限） */
  maxUnits?: number
  /** 仅重跑指定镜头 ID（对比视图「单镜重跑」或局部指定重跑） */
  onlyShotIds?: string[]
  /** 所选视频模型是否支持单次跨镜多镜头叙事（false 时自动将多镜 G 单元拆解为逐镜任务） */
  allowMultiShot?: boolean
  /** 所选视频模型单次可生成的最大秒数上限（超长 G 单元自动按时长拆分为子单元并尾帧接力） */
  maxUnitDurationSec?: number
  /** 覆盖配音音色 */
  dubVoice?: string
  lang?: BreakdownLang
}

const NEGATIVE_PROMPT: Record<BreakdownLang, string> = {
  zh: '画面模糊、变形、多手多指、文字水印、过曝', // cjk-ok
  en: 'blurry, distorted, extra fingers, watermark, overexposed'
}

function arr<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : []
}

function r3(n: number): number {
  return Number((Number.isFinite(n) ? n : 0).toFixed(3))
}

function shotDur(shot: SemanticShot): number {
  return Math.max(0.05, (shot.range?.end ?? 0) - (shot.range?.start ?? 0))
}

function bandFallbackBox(band: 'top' | 'middle' | 'bottom'): OverlayNormalizedBox {
  if (band === 'top') return { x: 0.08, y: 0.05, w: 0.84, h: 0.14 }
  if (band === 'middle') return { x: 0.08, y: 0.4, w: 0.84, h: 0.18 }
  return { x: 0.08, y: 0.76, w: 0.84, h: 0.16 }
}

function boxIou(a: OverlayNormalizedBox, b: OverlayNormalizedBox): number {
  const ix0 = Math.max(a.x, b.x)
  const iy0 = Math.max(a.y, b.y)
  const ix1 = Math.min(a.x + a.w, b.x + b.w)
  const iy1 = Math.min(a.y + a.h, b.y + b.h)
  if (ix1 <= ix0 || iy1 <= iy0) return 0
  const inter = (ix1 - ix0) * (iy1 - iy0)
  const union = a.w * a.h + b.w * b.h - inter
  return union > 0 ? inter / union : 0
}

/**
 * 提取镜头首帧上需要擦除的剪辑包装区域（字幕、花字、标题、角标贴纸），严格排除场景内原生文字（`scene_text`）
 * 以及代码渲染/录屏镜头（文字本身即底画）。
 */
export function collectShotPackagingOverlayBoxes(
  doc: SemanticTimeline,
  shot: SemanticShot
): OverlayNormalizedBox[] {
  if (
    shot.base?.label === 'code_render' ||
    shot.base?.label === 'screen_capture' ||
    shot.replication?.executor === 'code_render' ||
    shot.replication?.executor === 'screen_record'
  ) {
    return []
  }

  const raw: OverlayNormalizedBox[] = []
  const pushBox = (b: OverlayNormalizedBox | undefined): void => {
    if (!b || !(b.w > 0.01 && b.h > 0.01)) return
    const norm: OverlayNormalizedBox = {
      x: Math.max(0, Math.min(0.98, Number(b.x.toFixed(3)))),
      y: Math.max(0, Math.min(0.98, Number(b.y.toFixed(3)))),
      w: Math.max(0.02, Math.min(1, Number(b.w.toFixed(3)))),
      h: Math.max(0.02, Math.min(1, Number(b.h.toFixed(3)))),
      ...(b.kind ? { kind: b.kind } : {})
    }
    if (norm.x + norm.w > 1) norm.w = Number((1 - norm.x).toFixed(3))
    if (norm.y + norm.h > 1) norm.h = Number((1 - norm.y).toFixed(3))
    if (raw.some((existing) => boxIou(existing, norm) >= 0.55)) return
    raw.push(norm)
  }

  for (const layer of shot.layers ?? []) {
    if (layer.kind === 'scene_text' || layer.kind === 'pip') continue
    if (layer.box && layer.box.w > 0 && layer.box.h > 0) {
      pushBox({ ...layer.box, kind: layer.kind })
    } else if (
      layer.kind === 'subtitle' ||
      layer.kind === 'huazi' ||
      layer.kind === 'title' ||
      layer.kind === 'label' ||
      layer.kind === 'counter'
    ) {
      const band =
        layer.position ??
        (layer.kind === 'title' ? 'top' : layer.kind === 'subtitle' ? 'bottom' : 'middle')
      pushBox({ ...bandFallbackBox(band), kind: layer.kind })
    }
  }

  for (const fb of shot.forensics?.frozenOverlayBoxes ?? []) {
    pushBox({ x: fb.x, y: fb.y, w: fb.w, h: fb.h, kind: 'frozen' })
  }

  const shotTextIds = new Set(shot.textLayerIds ?? [])
  for (const ocr of doc.textLayers ?? []) {
    if (!ocr.box || !(ocr.box.w > 0 && ocr.box.h > 0)) continue
    const belongs =
      ocr.shotId === shot.id ||
      shotTextIds.has(ocr.id) ||
      (!ocr.shotId && ocr.range.start < shot.range.end && ocr.range.end > shot.range.start)
    if (belongs) pushBox(ocr.box)
  }

  return raw
}

function appendInstruction(
  base: string,
  instruction: string | undefined,
  lang: BreakdownLang
): string {
  const cleanBase = (base ?? '').trim()
  const extra = (instruction ?? '').trim()
  if (!extra) return cleanBase
  if (!cleanBase) return extra
  if (cleanBase.includes(extra)) return cleanBase
  const sep = lang === 'en' ? '. ' : '。'
  return `${cleanBase}${sep}${extra}`
}

function buildDubLines(
  timeline: SemanticTimeline,
  diff: SemanticDiff,
  dubVoiceOverride?: string
): DubLine[] {
  const speakers = new Map(arr(timeline.speakers).map((s) => [s.id, s]))
  const vocals = timeline.evidence?.stems?.vocals?.trim() || undefined
  return arr(timeline.dialogue)
    .filter((d) => diff.dirtyDialogue.has(d.id) && d.text?.trim())
    .map((d) => {
      const profile = d.speaker ? speakers.get(d.speaker) : undefined
      const voice = dubVoiceOverride?.trim() || profile?.voice
      return {
        id: d.id,
        sourceStartSec: d.range.start,
        sourceEndSec: d.range.end,
        text: d.text.trim(),
        sourceText: d.sourceText,
        ...(d.speaker ? { speaker: d.speaker } : {}),
        ...(voice ? { voice } : {}),
        ...(profile?.referenceAudio || vocals
          ? { referenceAudio: profile?.referenceAudio || vocals }
          : {})
      }
    })
}

function buildSingleShotUnitTask(input: {
  doc: SemanticTimeline
  shot: SemanticShot
  instruction?: string
  reasons?: string[]
  lang: BreakdownLang
}): RemakeUnitTask {
  const { doc, shot, instruction, reasons, lang } = input
  const dur = r3(shotDur(shot))
  const firstRel = shot.keyframes?.first ?? shot.keyframes?.middle
  const lastRel = shot.keyframes?.last
  const replacements = collectShotReplacements(doc, shot)
  const rawImgPrompt = shot.replication?.imagePrompt || shot.visual?.description || ''
  const rawVidPrompt =
    shot.promptOverride?.trim() ||
    shot.replication?.videoPrompt ||
    shot.visual?.description ||
    shot.id
  const imagePrompt = appendInstruction(rawImgPrompt, instruction, lang)
  const videoPrompt = appendInstruction(rawVidPrompt, instruction, lang)
  const refTags = [...new Set(`${imagePrompt} ${videoPrompt}`.match(/@图片\d+/g) ?? [])] // cjk-ok
  const hasSource =
    Number.isFinite(shot.sourceSegment?.start) &&
    Number.isFinite(shot.sourceSegment?.end) &&
    shot.sourceSegment.end > shot.sourceSegment.start
  const overlayBoxes = collectShotPackagingOverlayBoxes(doc, shot)
  const executor: RemakeExecutorKind =
    shot.replication?.executor ?? (shot.base?.label === 'avatar' ? 'avatar_tts' : 'video_gen')

  return {
    key: shot.id,
    ...(shot.replication?.unitId ? { unitId: shot.replication.unitId } : {}),
    executor,
    shotSlices: [
      {
        shotId: shot.id,
        offsetSec: 0,
        durationSec: dur,
        offsetRatio: 0,
        durationRatio: 1,
        ...(hasSource
          ? {
              sourceStartSec: shot.sourceSegment.start,
              sourceEndSec: shot.sourceSegment.end
            }
          : {})
      }
    ],
    durationSec: dur,
    ...(hasSource
      ? { sourceRange: { start: shot.sourceSegment.start, end: shot.sourceSegment.end } }
      : {}),
    imagePrompt,
    videoPrompt,
    negativePrompt: NEGATIVE_PROMPT[lang],
    conditioningMode:
      shot.replication?.mode === 'first_last_frame'
        ? 'first_last_frame'
        : shot.replication?.mode === 'reference_video'
          ? 'reference_video'
          : 'image_to_video',
    referenceTags: refTags,
    ...(firstRel ? { firstFrameRelativePath: keyframeProjectPath(doc.id, firstRel) } : {}),
    ...(lastRel ? { lastFrameRelativePath: keyframeProjectPath(doc.id, lastRel) } : {}),
    ...(overlayBoxes.length ? { overlayBoxes } : {}),
    ...(replacements.length ? { replacements } : {}),
    ...(reasons?.length ? { changeReasons: reasons } : {})
  }
}

function splitShotsByMaxDuration(shots: SemanticShot[], maxDurSec: number): SemanticShot[][] {
  if (!(maxDurSec > 0) || shots.length <= 1) return [shots]
  const chunks: SemanticShot[][] = []
  let cur: SemanticShot[] = []
  let curDur = 0
  for (const s of shots) {
    const d = shotDur(s)
    if (cur.length > 0 && curDur + d > maxDurSec + 0.05) {
      chunks.push(cur)
      cur = [s]
      curDur = d
    } else {
      cur.push(s)
      curDur += d
    }
  }
  if (cur.length > 0) chunks.push(cur)
  return chunks
}

function buildMultiShotUnitTask(input: {
  doc: SemanticTimeline
  unit: GenerationUnit
  unitKeyOverride?: string
  unitShots: SemanticShot[]
  instruction?: string
  reasons?: string[]
  lang: BreakdownLang
}): RemakeUnitTask {
  const { doc, unit, unitKeyOverride, unitShots, instruction, reasons, lang } = input
  const totalDur = Math.max(0.1, r3(unitShots.reduce((acc, s) => acc + shotDur(s), 0)))
  let cursor = 0
  const shotSlices: RemakeShotSlice[] = unitShots.map((s) => {
    const dur = r3(shotDur(s))
    const offset = cursor
    cursor = r3(cursor + dur)
    const hasSource =
      Number.isFinite(s.sourceSegment?.start) &&
      Number.isFinite(s.sourceSegment?.end) &&
      s.sourceSegment.end > s.sourceSegment.start
    return {
      shotId: s.id,
      offsetSec: offset,
      durationSec: dur,
      offsetRatio: Number((offset / totalDur).toFixed(4)),
      durationRatio: Number((dur / totalDur).toFixed(4)),
      ...(hasSource
        ? {
            sourceStartSec: s.sourceSegment.start,
            sourceEndSec: s.sourceSegment.end
          }
        : {})
    }
  })

  const firstShot = unitShots[0]!
  const lastShot = unitShots[unitShots.length - 1]!
  const firstRel = firstShot.keyframes?.first ?? firstShot.keyframes?.middle
  const lastRel = lastShot.keyframes?.last
  const overlayBoxes = collectShotPackagingOverlayBoxes(doc, firstShot)
  const hasSourceRange =
    Number.isFinite(firstShot.sourceSegment?.start) &&
    Number.isFinite(lastShot.sourceSegment?.end) &&
    lastShot.sourceSegment.end > firstShot.sourceSegment.start
  // Collect replacements across shots in this unit (deduplicated by entityId, preferring firstShot's mask)
  const repMap = new Map<string, ShotReplacement>()
  for (const s of unitShots) {
    for (const r of collectShotReplacements(doc, s)) {
      if (!repMap.has(r.entityId)) repMap.set(r.entityId, r)
    }
  }
  const replacements = [...repMap.values()]

  // When a multi-shot G unit is split into sub-chunks by maxUnitDurationSec, build prompt from the chunk's shots unless user overrode the unit prompt
  const isSubChunk = Boolean(unitKeyOverride && unitKeyOverride !== unit.id)
  const chunkShotSet = new Set(unitShots.map((s) => s.id))
  const subPrompts = isSubChunk
    ? unit.perShotPrompts.filter((p) => chunkShotSet.has(p.shotId))
    : unit.perShotPrompts
  const baseImagePrompt =
    isSubChunk && !unit.userEditedPrompt
      ? firstShot.replication?.imagePrompt || unit.imagePrompt
      : unit.imagePrompt
  const baseVideoPrompt =
    isSubChunk && !unit.userEditedPrompt && subPrompts.length > 0
      ? [
          unit.sceneHeader ? `【统一场景设定】${unit.sceneHeader}` : '', // cjk-ok
          ...subPrompts.map((p) => p.videoPrompt)
        ]
          .filter(Boolean)
          .join('；')
      : unit.videoPrompt

  const imagePrompt = appendInstruction(baseImagePrompt, instruction, lang)
  const videoPrompt = appendInstruction(baseVideoPrompt, instruction, lang)
  const refTags = [
    ...new Set([
      ...unit.referenceTags,
      ...(`${imagePrompt} ${videoPrompt}`.match(/@图片\d+/g) ?? []) // cjk-ok
    ])
  ]

  return {
    key: unitKeyOverride || unit.id,
    unitId: unit.id,
    executor: 'video_gen',
    shotSlices,
    durationSec: totalDur,
    ...(hasSourceRange
      ? {
          sourceRange: {
            start: firstShot.sourceSegment.start,
            end: lastShot.sourceSegment.end
          }
        }
      : {}),
    imagePrompt,
    videoPrompt,
    negativePrompt: NEGATIVE_PROMPT[lang],
    conditioningMode: unit.conditioningMode,
    referenceTags: refTags,
    ...(firstRel ? { firstFrameRelativePath: keyframeProjectPath(doc.id, firstRel) } : {}),
    ...(lastRel ? { lastFrameRelativePath: keyframeProjectPath(doc.id, lastRel) } : {}),
    ...(overlayBoxes.length ? { overlayBoxes } : {}),
    ...(replacements.length ? { replacements } : {}),
    ...(reasons?.length ? { changeReasons: reasons } : {})
  }
}

/**
 * 规划视频重制执行方案（纯函数：UI 可在点击运行前实时预估 AI 单元调用次数、本地零成本镜数与直通镜数）。
 */
export function planRemakeExecution(
  rawDoc: SemanticTimeline | null | undefined,
  options: PlanRemakeExecutionOptions = {}
): RemakeExecutionPlan {
  const lang: BreakdownLang = options.lang ?? 'zh'
  const strategy: RemakeStrategy =
    options.strategy === 'fidelity' || options.strategy === 'adapt' ? options.strategy : 'edit'
  if (!rawDoc) {
    return {
      strategy,
      units: [],
      localClips: [],
      segments: [],
      dubs: [],
      subtitles: [],
      passthroughShots: 0,
      protectedRealMaterial: 0,
      skippedByLimit: 0,
      generatedShots: 0
    }
  }

  const doc = rawDoc.breakdown ? rawDoc : finalizeSemanticBreakdown(rawDoc, { lang })
  const activeShots = arr(doc.shots).filter((s) => !s.removed)
  const diff = diffAgainstBaseline(doc)
  const dubs = buildDubLines(doc, diff, options.dubVoice)
  const subtitles: PlanSubtitle[] = arr(doc.dialogue)
    .filter((d) => d.text?.trim())
    .map((d) => ({
      sourceStartSec: d.range.start,
      sourceEndSec: d.range.end,
      text: d.text.trim()
    }))

  const maxUnits =
    options.maxUnits != null && Number(options.maxUnits) > 0
      ? Math.max(1, Math.floor(Number(options.maxUnits)))
      : Number.POSITIVE_INFINITY
  const onlySet = options.onlyShotIds?.length ? new Set(options.onlyShotIds) : null

  const unitDefById = new Map<string, GenerationUnit>()
  for (const u of doc.breakdown?.productionPlan.units ?? []) {
    unitDefById.set(u.id, u)
  }

  const units: RemakeUnitTask[] = []
  const localClips: LocalRebuildClip[] = []
  const segments: RebuildSegment[] = []
  let passthroughShots = 0
  let protectedRealMaterial = 0
  let skippedByLimit = 0

  // Pre-decide which G-units can run as a complete batched multi-shot unit
  const scheduledUnitById = new Map<string, RemakeUnitTask>()
  const sliceByShotId = new Map<string, { unitKey: string; slice: RemakeShotSlice }>()
  const skippedByLimitShots = new Set<string>()

  const activeById = new Map(activeShots.map((s) => [s.id, s]))

  const allowMultiShot = options.allowMultiShot !== false
  const maxUnitDurationSec =
    options.maxUnitDurationSec != null && Number(options.maxUnitDurationSec) > 0
      ? Number(options.maxUnitDurationSec)
      : 0

  if (!onlySet) {
    for (const unit of doc.breakdown?.productionPlan.units ?? []) {
      const unitShots = unit.shotIds
        .map((id) => activeById.get(id))
        .filter((s): s is SemanticShot => Boolean(s))
      if (unitShots.length === 0) continue

      // When target video model does not support multi-shot generation, let multi-shot units fall through to single-shot tasks
      if (!allowMultiShot && unitShots.length > 1) continue

      if (strategy === 'edit') {
        // In edit mode, batch as G_k only when ALL shots in G_k are dirty (e.g. unit.prompt edit or shared entity replacement)
        const allDirty = unitShots.every((s) => diff.dirtyShots.has(s.id))
        if (!allDirty) continue
      }

      const subChunks =
        maxUnitDurationSec > 0 && unitShots.length > 1
          ? splitShotsByMaxDuration(unitShots, maxUnitDurationSec)
          : [unitShots]

      for (let cIdx = 0; cIdx < subChunks.length; cIdx += 1) {
        const chunkShots = subChunks[cIdx]!
        if (units.length >= maxUnits) {
          for (const s of chunkShots) skippedByLimitShots.add(s.id)
          continue
        }

        const chunkKey = subChunks.length > 1 ? `${unit.id}.${cIdx + 1}` : unit.id
        const reasons = [...new Set(chunkShots.flatMap((s) => diff.dirtyShots.get(s.id) ?? []))]
        const task = buildMultiShotUnitTask({
          doc,
          unit,
          unitKeyOverride: chunkKey,
          unitShots: chunkShots,
          instruction: options.instruction,
          reasons,
          lang
        })
        units.push(task)
        if (cIdx === 0) scheduledUnitById.set(unit.id, task)
        for (const sl of task.shotSlices) {
          sliceByShotId.set(sl.shotId, { unitKey: task.key, slice: sl })
        }
      }
    }
  }

  for (const shot of activeShots) {
    const dur = r3(shotDur(shot))
    const hasSource =
      Number.isFinite(shot.sourceSegment?.start) &&
      Number.isFinite(shot.sourceSegment?.end) &&
      shot.sourceSegment.end > shot.sourceSegment.start
    const source = hasSource
      ? { sourceStartSec: shot.sourceSegment.start, sourceEndSec: shot.sourceSegment.end }
      : {}

    // 1. Already covered by a batched G1..Gk unit
    const batched = sliceByShotId.get(shot.id)
    if (batched) {
      segments.push({
        key: shot.id,
        kind: 'generate',
        clipKey: batched.unitKey,
        clipOffsetRatio: batched.slice.offsetRatio,
        clipDurationRatio: batched.slice.durationRatio,
        durationSec: dur,
        ...source
      })
      continue
    }

    if (skippedByLimitShots.has(shot.id)) {
      skippedByLimit += 1
      if (hasSource) {
        passthroughShots += 1
        segments.push({ key: shot.id, kind: 'source', durationSec: dur, ...source })
      }
      continue
    }

    const rawReasons = diff.dirtyShots.get(shot.id)
    const avatarDialogueEdited =
      strategy === 'edit' &&
      shot.replication?.executor === 'avatar_tts' &&
      dubs.some(
        (d) => d.sourceStartSec < shot.range.end - 0.05 && d.sourceEndSec > shot.range.start + 0.05
      )
    const reasons =
      avatarDialogueEdited && !rawReasons?.includes('dialogue_lipsync')
        ? [...(rawReasons ?? []), 'dialogue_lipsync']
        : rawReasons
    const explicitlyDirty = Boolean(reasons?.length)

    // 2. Single-shot rerun filter (`onlyShotIds`)
    if (onlySet && !onlySet.has(shot.id)) {
      if (hasSource) {
        passthroughShots += 1
        segments.push({ key: shot.id, kind: 'source', durationSec: dur, ...source })
      }
      continue
    }

    const wantsGenerate = onlySet
      ? onlySet.has(shot.id)
      : strategy === 'edit'
        ? explicitlyDirty
        : true

    if (!wantsGenerate) {
      if (hasSource) {
        passthroughShots += 1
        segments.push({ key: shot.id, kind: 'source', durationSec: dur, ...source })
      }
      continue
    }

    // 3. Protect real screen recordings, code-rendered UI/motion graphics & film clips in fidelity/adapt mode unless explicitly edited or targeted
    if (
      !onlySet &&
      strategy !== 'edit' &&
      !explicitlyDirty &&
      hasSource &&
      (shot.replication?.executor === 'screen_record' ||
        shot.replication?.executor === 'passthrough' ||
        shot.replication?.executor === 'code_render' ||
        shot.base?.label === 'film_footage')
    ) {
      passthroughShots += 1
      protectedRealMaterial += 1
      segments.push({ key: shot.id, kind: 'source', durationSec: dur, ...source })
      continue
    }

    // 4. Zero-cost local FFmpeg Ken Burns / static hold (`K1..Kk`)
    const firstRel = shot.keyframes?.first ?? shot.keyframes?.middle
    const hasPromptOverride = Boolean(
      shot.promptOverride?.trim() || reasons?.includes('prompt') || reasons?.includes('unit_prompt')
    )
    if (shot.replication?.executor === 'local_ffmpeg' && firstRel && !hasPromptOverride) {
      const firstFrameRelativePath = keyframeProjectPath(doc.id, firstRel)
      if (firstFrameRelativePath) {
        const replacements = collectShotReplacements(doc, shot)
        const overlayBoxes = collectShotPackagingOverlayBoxes(doc, shot)
        localClips.push({
          key: shot.id,
          ...(shot.replication.unitId ? { unitId: shot.replication.unitId } : {}),
          mode: shot.replication.mode === 'ken_burns' ? 'ken_burns' : 'static_hold',
          durationSec: dur,
          firstFrameRelativePath,
          imagePrompt: appendInstruction(
            shot.replication.imagePrompt || shot.visual?.description || '',
            options.instruction,
            lang
          ),
          zoomPerSec: shot.forensics?.zoomPerSec ?? 0,
          panPxPerSec: shot.forensics?.panPxPerSec ?? 0,
          panDirDeg: shot.forensics?.panDirDeg ?? 0,
          ...(overlayBoxes.length ? { overlayBoxes } : {}),
          ...(replacements.length ? { replacements } : {})
        })
        segments.push({
          key: shot.id,
          kind: 'generate',
          clipKey: shot.id,
          durationSec: dur,
          ...source
        })
        continue
      }
    }

    // 5. Single-shot AI video generation task (dirty individual shot, reshoot fallback, code_render fallback, avatar)
    if (units.length < maxUnits) {
      const task = buildSingleShotUnitTask({
        doc,
        shot,
        instruction: options.instruction,
        reasons,
        lang
      })
      units.push(task)
      segments.push({
        key: shot.id,
        kind: 'generate',
        clipKey: task.key,
        durationSec: dur,
        ...source
      })
      continue
    }

    skippedByLimit += 1
    if (hasSource) {
      passthroughShots += 1
      segments.push({ key: shot.id, kind: 'source', durationSec: dur, ...source })
    }
  }

  // Sort `units` into timeline appearance order and link contiguous same-scene units via `chainFromUnitKey`
  const shotIndexById = new Map(activeShots.map((s, idx) => [s.id, idx]))
  units.sort((a, b) => {
    const ia = shotIndexById.get(a.shotSlices[0]?.shotId ?? '') ?? 0
    const ib = shotIndexById.get(b.shotSlices[0]?.shotId ?? '') ?? 0
    return ia - ib
  })
  for (let idx = 1; idx < units.length; idx += 1) {
    const prev = units[idx - 1]!
    const cur = units[idx]!
    if (cur.executor === 'avatar_tts') continue
    const prevLastId = prev.shotSlices[prev.shotSlices.length - 1]?.shotId
    const curFirstId = cur.shotSlices[0]?.shotId
    const prevLastShot = prevLastId ? activeById.get(prevLastId) : undefined
    const curFirstShot = curFirstId ? activeById.get(curFirstId) : undefined
    if (!prevLastShot || !curFirstShot) continue
    const timeContiguous = Math.abs(curFirstShot.range.start - prevLastShot.range.end) <= 0.12
    if (!timeContiguous) continue
    const sameSplitUnit = Boolean(cur.unitId && prev.unitId && cur.unitId === prev.unitId)
    const sameVisualScene =
      Boolean(prevLastShot.forensics?.hsvHist?.length && curFirstShot.forensics?.hsvHist?.length) &&
      hsvBhattacharyyaDistance(
        prevLastShot.forensics!.hsvHist!,
        curFirstShot.forensics!.hsvHist!
      ) <= 0.35
    if (sameSplitUnit || sameVisualScene) {
      cur.chainFromUnitKey = prev.key
    }
  }

  const generatedShots = units.reduce((acc, u) => acc + u.shotSlices.length, 0)

  return {
    strategy,
    units,
    localClips,
    segments,
    dubs,
    subtitles,
    passthroughShots,
    protectedRealMaterial,
    skippedByLimit,
    generatedShots
  }
}

/** 提取每个镜头当前生效的视频复刻提示词（供 Dive 工作台与对比视图直接展示）。 */
export function resolveShotDisplayPrompts(
  doc: SemanticTimeline | null | undefined
): Record<string, string> {
  if (!doc) return {}
  const resolved = doc.breakdown ? doc : finalizeSemanticBreakdown(doc)
  const unitPromptById = new Map<string, string>()
  for (const u of resolved.breakdown?.productionPlan.units ?? []) {
    unitPromptById.set(u.id, u.videoPrompt)
  }
  const out: Record<string, string> = {}
  for (const shot of arr(resolved.shots)) {
    if (shot.promptOverride?.trim()) {
      out[shot.id] = shot.promptOverride.trim()
      continue
    }
    const uid = shot.replication?.unitId
    const unitOverride = uid ? resolved.breakdown?.unitPromptOverrides?.[uid]?.videoPrompt : ''
    if (unitOverride?.trim()) {
      out[shot.id] = unitOverride.trim()
      continue
    }
    out[shot.id] =
      shot.replication?.videoPrompt?.trim() ||
      (uid ? unitPromptById.get(uid) : '') ||
      shot.visual?.description?.trim() ||
      ''
  }
  return out
}
