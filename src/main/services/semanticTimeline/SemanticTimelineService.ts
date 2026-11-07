/**
 * Semantic Timeline 持久化与分析编排入口。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import {
  SEMANTIC_TIMELINE_SCHEMA,
  createEmptySemanticTimeline,
  evidenceDir,
  keyframesDir,
  segmentsToUtterances,
  timelineJsonPath,
  validateSemanticTimeline,
  ensureSemanticStructure,
  finalizeSemanticBreakdown,
  migrateSemanticTimeline,
  rebaselineSemanticTimeline,
  carryOverSemanticEdits,
  renderBreakdownReportMd,
  timelineId,
  type ContainerProvenance,
  type OcrRegion,
  type MediaFacts,
  type SemanticTimeline,
  type ShotEvidence,
  type ShotEvidenceFile,
  type UtteranceEvidenceFile,
  type EntityEvidenceFile,
  type OcrEvidenceFile,
  type TranscribeLikeSegment,
  type UtteranceEvidence,
  SHOTS_FILE,
  UTTERANCES_FILE,
  ENTITIES_FILE,
  OCR_FILE,
  evidenceFilePath
} from '@shared/semanticTimeline'
import { probeMediaFacts } from './mediaFacts'
import { detectShots, extractShotKeyframes } from './shotDetect'
import { buildAudioStems, extractMixedAudio } from './audioStem'
import { detectEntitiesViaVisionModel } from './entityDetectVlm'
import { heuristicOcrFromUtterances } from './ocrRegions'
import { separateAudioStems } from '../audioSeparationService'
import { probeContainerProvenance } from './forensics/probeProvenance'
import {
  decodeSampledRgbTrack,
  extractAllShotForensics,
  refineShotsWithVisualTrack,
  renderShotTriptychStrips,
  renderStoryboardContactSheet
} from './forensics/visualForensics'
import { analyzeMixedWavFile, refineAudioAnalysisWithStems } from './forensics/audioForensics'

export function resolveTimelineJson(projectRoot: string, timelineId: string): string {
  return join(projectRoot, ...timelineJsonPath(timelineId).split('/'))
}

export function loadSemanticTimeline(
  projectRoot: string,
  timelineId: string
): SemanticTimeline | null {
  const path = resolveTimelineJson(projectRoot, timelineId)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as SemanticTimeline
    if (!raw || typeof raw !== 'object') return null
    // v1 → v2 自动迁移：用磁盘上的证据内联镜头树 / 台词 / 文字层，并补基线
    const doc = migrateSemanticTimeline(raw, {
      shots: loadShotsEvidence(projectRoot, timelineId),
      utterances: loadUtterances(projectRoot, timelineId),
      ocr: loadOcr(projectRoot, timelineId)
    })
    const v = validateSemanticTimeline(doc)
    if (!v.ok) return null
    return doc
  } catch {
    return null
  }
}

export function loadOcr(projectRoot: string, timelineId: string): OcrRegion[] {
  return readEvidenceJson<OcrEvidenceFile>(projectRoot, timelineId, OCR_FILE)?.regions ?? []
}

export function saveSemanticTimeline(projectRoot: string, doc: SemanticTimeline): void {
  const v = validateSemanticTimeline(doc)
  if (!v.ok) {
    throw new Error(`invalid semantic timeline: ${v.issues.map((i) => i.message).join('; ')}`)
  }
  const path = resolveTimelineJson(projectRoot, doc.id)
  mkdirSync(dirname(path), { recursive: true })
  mkdirSync(join(projectRoot, ...evidenceDir(doc.id).split('/')), { recursive: true })
  writeFileSync(path, JSON.stringify(doc, null, 2), 'utf8')
  if (doc.breakdown) {
    try {
      const reportAbs = join(dirname(path), 'report.md')
      writeFileSync(reportAbs, renderBreakdownReportMd(doc, 'zh'), 'utf8')
    } catch {
      /* markdown report failure never blocks timeline persistence */
    }
  }
}

function writeEvidenceJson(projectRoot: string, relPath: string, data: unknown): void {
  const abs = join(projectRoot, ...relPath.split('/'))
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, JSON.stringify(data, null, 2), 'utf8')
}

export function saveShotsEvidence(
  projectRoot: string,
  timelineId: string,
  shots: ShotEvidence[]
): void {
  const file: ShotEvidenceFile = { schema: SEMANTIC_TIMELINE_SCHEMA, shots }
  writeEvidenceJson(projectRoot, evidenceFilePath(timelineId, SHOTS_FILE), file)
}

export function loadShotsEvidence(projectRoot: string, timelineId: string): ShotEvidence[] {
  const abs = join(projectRoot, ...evidenceFilePath(timelineId, SHOTS_FILE).split('/'))
  if (!existsSync(abs)) return []
  try {
    const file = JSON.parse(readFileSync(abs, 'utf8')) as ShotEvidenceFile
    return file.shots ?? []
  } catch {
    return []
  }
}

function readEvidenceJson<T>(
  projectRoot: string,
  timelineId: string,
  file: Parameters<typeof evidenceFilePath>[1]
): T | null {
  const abs = join(projectRoot, ...evidenceFilePath(timelineId, file).split('/'))
  if (!existsSync(abs)) return null
  try {
    return JSON.parse(readFileSync(abs, 'utf8')) as T
  } catch {
    return null
  }
}

export function loadUtterances(projectRoot: string, timelineId: string): UtteranceEvidence[] {
  return (
    readEvidenceJson<UtteranceEvidenceFile>(projectRoot, timelineId, UTTERANCES_FILE)?.utterances ??
    []
  )
}

export function saveUtterances(
  projectRoot: string,
  timelineId: string,
  file: UtteranceEvidenceFile
): void {
  writeEvidenceJson(projectRoot, evidenceFilePath(timelineId, UTTERANCES_FILE), file)
}

export function saveEntities(
  projectRoot: string,
  timelineId: string,
  file: EntityEvidenceFile
): void {
  writeEvidenceJson(projectRoot, evidenceFilePath(timelineId, ENTITIES_FILE), file)
}

export function saveOcr(projectRoot: string, timelineId: string, file: OcrEvidenceFile): void {
  writeEvidenceJson(projectRoot, evidenceFilePath(timelineId, OCR_FILE), file)
}

export interface AnalyzeShotsOnlyResult {
  timeline: SemanticTimeline
  shots: ShotEvidence[]
  facts: MediaFacts
  method: 'scene' | 'fallback-single'
  provenance?: ContainerProvenance
  storyboardRel?: string
}

/**
 * 阶段 0/1 入口：探测媒体事实 + 容器溯源 + 切镜（含渐隐/叠化精修）+ 像素运动取证 + 关键帧，落盘骨架文档。
 */
export async function analyzeShotsOnly(
  projectRoot: string,
  sourceAssetId: string,
  videoAbs: string
): Promise<AnalyzeShotsOnlyResult> {
  const facts = await probeMediaFacts(videoAbs)
  let doc = createEmptySemanticTimeline(sourceAssetId, facts)
  const [detected, provenance, rgbTrack] = await Promise.all([
    detectShots(videoAbs, facts),
    probeContainerProvenance(videoAbs),
    decodeSampledRgbTrack(videoAbs, facts)
  ])
  const refinedShots = rgbTrack
    ? extractAllShotForensics(refineShotsWithVisualTrack(detected.shots, rgbTrack, facts), rgbTrack)
    : detected.shots
  const semanticDirAbs = join(projectRoot, 'Semantic', doc.id)
  const kfDir = join(projectRoot, ...keyframesDir(doc.id).split('/'))
  const extractedShots = await extractShotKeyframes(videoAbs, refinedShots, kfDir)
  const shots = renderShotTriptychStrips(semanticDirAbs, extractedShots, {
    width: facts.width,
    height: facts.height
  })
  saveShotsEvidence(projectRoot, doc.id, shots)
  const storyboardRel = renderStoryboardContactSheet(semanticDirAbs, shots, {
    width: facts.width,
    height: facts.height
  })
  doc = {
    ...doc,
    evidence: {
      ...doc.evidence,
      mediaFacts: facts,
      hashes: { ...doc.evidence.hashes, shots: String(shots.length) }
    },
    updatedAt: new Date().toISOString()
  }
  doc = ensureSemanticStructure(doc, { shots })
  doc = finalizeSemanticBreakdown(doc, {
    provenance,
    storyboardRelativePath: storyboardRel ? `Semantic/${doc.id}/${storyboardRel}` : undefined,
    reportRelativePath: `Semantic/${doc.id}/report.md`
  })
  doc = rebaselineSemanticTimeline(doc)
  saveSemanticTimeline(projectRoot, doc)
  return {
    timeline: doc,
    shots,
    facts,
    method: shots.length > 1 ? 'scene' : detected.method,
    provenance,
    storyboardRel
  }
}

export interface AnalyzeSemanticOptions {
  /** 相对工程根的视频路径（人声分离用） */
  videoRelativePath?: string
  /** 转写分段；缺省则跳过话语转写 */
  transcriptSegments?: TranscribeLikeSegment[]
  transcriptGranularity?: 'word' | 'sentence'
  /** 是否尝试人声分离（默认 true） */
  separateAudio?: boolean
  /** 是否跑实体检测（默认 true；用多模态大模型看关键帧，不再用本地 YOLO） */
  detectEntities?: boolean
  /** 实体检测用哪个模型 / 实例（缺省用应用默认文本模型） */
  entityModel?: string
  entityProviderInstanceId?: string
}

export interface AnalyzeSemanticResult extends AnalyzeShotsOnlyResult {
  utterances: UtteranceEvidence[]
  notes: string[]
}

/**
 * 阶段 1 完整分析：切镜 + 音轨/人声 + 转写落盘 + 实体 + OCR 启发式 + 四轴拆解。
 */
export async function analyzeSemanticTimeline(
  projectRoot: string,
  sourceAssetId: string,
  videoAbs: string,
  options: AnalyzeSemanticOptions = {}
): Promise<AnalyzeSemanticResult> {
  const notes: string[] = []
  // 重新分析前先读上一版（下一步就会被骨架覆盖）：用户修改要带到新文档上
  const previous = loadSemanticTimeline(projectRoot, timelineId(sourceAssetId))
  const base = await analyzeShotsOnly(projectRoot, sourceAssetId, videoAbs)
  let doc = base.timeline
  const { shots, facts } = base
  const fps = facts.fps

  // 音频：抽混合轨 + 可选人声分离
  const stemsDir = join(projectRoot, 'Semantic', doc.id, 'evidence', 'stems')
  mkdirSync(stemsDir, { recursive: true })
  const mixedAbs = join(stemsDir, 'mixed.wav')
  const mixedOk = await extractMixedAudio(videoAbs, mixedAbs)
  let vocalsRel: string | null = null
  let accompanimentRel: string | null = null
  if (options.separateAudio !== false && options.videoRelativePath) {
    try {
      const sep = await separateAudioStems({
        projectRoot,
        relativePath: options.videoRelativePath
      })
      vocalsRel = sep.vocalRelativePath
      accompanimentRel = sep.instrumentalRelativePath
    } catch (e) {
      notes.push(`audio separate failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  } else if (options.separateAudio !== false && !options.videoRelativePath) {
    notes.push('audio separate skipped: videoRelativePath not provided')
  }
  const stems = buildAudioStems({
    mixedRel: mixedOk ? `evidence/stems/mixed.wav` : undefined,
    vocalsRel,
    accompanimentRel
  })
  if (!stems.separated) notes.push(stems.note ?? 'stems not separated')

  // 转写 → utterances
  let utterances: UtteranceEvidence[] = []
  if (options.transcriptSegments?.length) {
    utterances = segmentsToUtterances(
      options.transcriptSegments,
      fps,
      options.transcriptGranularity ?? 'sentence'
    )
    // 按**产出的 utterances** 判定是否真的只有句级：提供商声明（transcriptGranularity）只是兜底 ——
    // 有的家会返回词级数据却不声明 granularity，只认声明就会误报「词级时间戳不可用」。
    if (utterances.length > 0 && utterances.every((u) => u.granularity !== 'word')) {
      notes.push('transcript granularity=sentence (provider returned no word timestamps)')
    }
  }
  saveUtterances(projectRoot, doc.id, {
    schema: SEMANTIC_TIMELINE_SCHEMA,
    utterances
  })

  // 实体：多模态大模型看关键帧（取代本地 YOLO —— 语义实体与跨镜头身份归并 YOLO 做不到）
  let entities = doc.entities
  if (options.detectEntities !== false) {
    try {
      const det = await detectEntitiesViaVisionModel({
        projectRoot,
        timelineId: doc.id,
        shots,
        model: options.entityModel,
        providerInstanceId: options.entityProviderInstanceId
      })
      notes.push(...det.notes)
      /**
       * **无论检出多少都采纳并落盘**。
       *
       * 以前只在 `length > 0` 时写：结果为 0 时 `evidence/entities.json` 会留下**上一次的旧数据**，
       * 于是磁盘上看着有 16 个实体、时间线文档里却是 0（界面上角色/实体轨道空着）——
       * 排查时极易被这份陈旧文件带偏（实测踩到）。
       */
      entities = det.entities
      saveEntities(projectRoot, doc.id, {
        schema: SEMANTIC_TIMELINE_SCHEMA,
        entities
      })
      if (det.entities.length === 0) {
        notes.push(
          'entity detect: vision model returned 0 entities (check the model / keyframes / vision capability)'
        )
      }
    } catch (e) {
      notes.push(`entity detect: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // OCR 启发式（VLM 结果可由上层覆盖写盘）
  const ocrRegions = heuristicOcrFromUtterances(utterances, shots, fps)
  saveOcr(projectRoot, doc.id, { schema: SEMANTIC_TIMELINE_SCHEMA, regions: ocrRegions })

  doc = {
    ...doc,
    entities,
    evidence: {
      ...doc.evidence,
      mediaFacts: facts,
      stems,
      hashes: {
        ...doc.evidence.hashes,
        shots: String(shots.length),
        utterances: String(utterances.length),
        entities: String(entities.length),
        ocr: String(ocrRegions.length)
      }
    },
    updatedAt: new Date().toISOString()
  }
  // v2：内联结构化镜头树 / 台词 / 文字层，合入四轴取证与多轨音频分析，并以分析结果为基线
  const cutTimes = shots.slice(1).map((s) => s.range.start)
  const rawAudioAnalysis = mixedOk ? analyzeMixedWavFile(mixedAbs, cutTimes, utterances) : undefined
  const audioAnalysis = rawAudioAnalysis
    ? refineAudioAnalysisWithStems(rawAudioAnalysis, {
        vocalsWavAbs: vocalsRel ? join(projectRoot, ...vocalsRel.split('/')) : undefined,
        accompanimentWavAbs: accompanimentRel
          ? join(projectRoot, ...accompanimentRel.split('/'))
          : undefined,
        cutTimesSec: cutTimes,
        utterances
      })
    : undefined
  doc = ensureSemanticStructure(
    { ...doc, shots: [], dialogue: [], textLayers: [], edits: [], baseline: undefined },
    { shots, utterances, ocr: ocrRegions }
  )
  // 若确定性取证检出了冻结包装区域（字幕条 / 顶栏标题 / 花字框），预先挂载到 shot.layers 供去字净板与 ASS 还原使用
  if (doc.shots?.some((s) => s.forensics?.frozenOverlayBoxes?.length)) {
    const dialogueById = new Map((doc.dialogue ?? []).map((d) => [d.id, d]))
    doc = {
      ...doc,
      shots: doc.shots.map((s) => {
        const boxes = s.forensics?.frozenOverlayBoxes
        if (!boxes?.length || s.layers?.length) return s
        const firstLine = s.dialogueIds
          .map((id) => dialogueById.get(id))
          .find((d) => d?.text?.trim())
        return {
          ...s,
          layers: boxes.map((fb, idx) => ({
            id: `lyr.${s.id}.det.${idx + 1}`,
            kind:
              fb.band === 'bottom'
                ? ('subtitle' as const)
                : fb.band === 'top'
                  ? ('title' as const)
                  : ('huazi' as const),
            ...(fb.band === 'bottom' && firstLine?.text?.trim()
              ? { text: firstLine.text.trim() }
              : {}),
            start: s.range.start,
            end: s.range.end,
            position: fb.band,
            box: { x: fb.x, y: fb.y, w: fb.w, h: fb.h }
          }))
        }
      })
    }
  }
  doc = finalizeSemanticBreakdown(doc, {
    provenance: base.provenance,
    audioAnalysis,
    storyboardRelativePath: base.storyboardRel
      ? `Semantic/${doc.id}/${base.storyboardRel}`
      : undefined,
    reportRelativePath: `Semantic/${doc.id}/report.md`,
    synthesizeFallbackEntities: options.detectEntities !== false
  })
  if (doc.entities.length !== entities.length) {
    saveEntities(projectRoot, doc.id, {
      schema: SEMANTIC_TIMELINE_SCHEMA,
      entities: doc.entities
    })
    doc = {
      ...doc,
      evidence: {
        ...doc.evidence,
        hashes: {
          ...doc.evidence.hashes,
          entities: String(doc.entities.length)
        }
      }
    }
  }
  doc = rebaselineSemanticTimeline(doc)
  const carried = carryOverSemanticEdits(previous, doc)
  if (carried !== doc) {
    notes.push(`kept ${carried.edits?.length ?? 0} user edit(s) from the previous analysis`)
    doc = carried.breakdown ? finalizeSemanticBreakdown(carried) : carried
  }
  saveSemanticTimeline(projectRoot, doc)
  return { ...base, timeline: doc, utterances, notes }
}

/** 供资产预览色带：写入 genParams.semanticPreview 的纯数据 */
export function buildSemanticPreview(
  doc: SemanticTimeline,
  shots: ShotEvidence[],
  utterances: UtteranceEvidence[]
): {
  beats: Array<{ id: string; start: number; end: number; label: string }>
  shots: Array<{ id: string; start: number; end: number; label: string }>
  utterances: Array<{ id: string; start: number; end: number; label: string }>
} {
  const segments = doc.breakdown?.wholeVideo?.segments ?? []
  return {
    beats: segments.map((seg, i) => ({
      id: `seg.${i + 1}`,
      start: seg.start,
      end: seg.end,
      label: seg.beat || `P${i + 1}`
    })),
    shots: shots.map((s, i) => ({
      id: s.id,
      start: s.range.start,
      end: s.range.end,
      label: `S${i + 1}`
    })),
    utterances: utterances.map((u) => ({
      id: u.id,
      start: u.range.start,
      end: u.range.end,
      label: u.text.slice(0, 24)
    }))
  }
}
