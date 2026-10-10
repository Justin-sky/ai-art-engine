/**
 * Semantic Timeline 持久化与分析编排入口。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import {
  SEMANTIC_TIMELINE_SCHEMA,
  assignBeatsHeuristic,
  createEmptySemanticTimeline,
  evidenceDir,
  heuristicEventsFromUtterances,
  inferIntentsFromEvents,
  keyframesDir,
  rebuildTracks,
  segmentsToUtterances,
  semanticAssetDir,
  timelineJsonPath,
  validateSemanticTimeline,
  type BeatVocabulary,
  type MediaFacts,
  type SemanticTimeline,
  type ShotEvidence,
  type ShotEvidenceFile,
  type UtteranceEvidenceFile,
  type EntityEvidenceFile,
  type OcrEvidenceFile,
  type BuildManifest,
  type TranscribeLikeSegment,
  type UtteranceEvidence,
  manifestPath,
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

export function projectSemanticRoot(projectRoot: string): string {
  return join(projectRoot, 'Semantic')
}

export function resolveTimelineDir(projectRoot: string, timelineId: string): string {
  return join(projectRoot, ...semanticAssetDir(timelineId).split('/'))
}

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
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    const v = validateSemanticTimeline(raw)
    if (!v.ok) return null
    return raw as SemanticTimeline
  } catch {
    return null
  }
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

export function loadOcrRegions(
  projectRoot: string,
  timelineId: string
): OcrEvidenceFile['regions'] {
  return readEvidenceJson<OcrEvidenceFile>(projectRoot, timelineId, OCR_FILE)?.regions ?? []
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

export function saveBuildManifest(
  projectRoot: string,
  timelineId: string,
  manifest: BuildManifest
): void {
  const rel = manifestPath(timelineId, manifest.id)
  writeEvidenceJson(projectRoot, rel, manifest)
}

export interface AnalyzeShotsOnlyResult {
  timeline: SemanticTimeline
  shots: ShotEvidence[]
  facts: MediaFacts
  method: 'scene' | 'fallback-single'
}

/**
 * 阶段 0/1 入口：探测媒体事实 + 切镜 + 关键帧，落盘骨架文档。
 */
export async function analyzeShotsOnly(
  projectRoot: string,
  sourceAssetId: string,
  videoAbs: string,
  vocabulary = 'commerce.v1'
): Promise<AnalyzeShotsOnlyResult> {
  const facts = await probeMediaFacts(videoAbs)
  let doc = createEmptySemanticTimeline(sourceAssetId, facts, vocabulary)
  const detected = await detectShots(videoAbs, facts)
  const kfDir = join(projectRoot, ...keyframesDir(doc.id).split('/'))
  const shots = await extractShotKeyframes(videoAbs, detected.shots, kfDir)
  saveShotsEvidence(projectRoot, doc.id, shots)
  doc = rebuildTracks({
    ...doc,
    evidence: {
      ...doc.evidence,
      mediaFacts: facts,
      hashes: { ...doc.evidence.hashes, shots: String(shots.length) }
    },
    updatedAt: new Date().toISOString()
  })
  saveSemanticTimeline(projectRoot, doc)
  return { timeline: doc, shots, facts, method: detected.method }
}

export interface AnalyzeSemanticOptions {
  vocabulary?: string
  /** 市场包词表（id 不在内置词表时由调用方解析后传入） */
  vocabularyDef?: BeatVocabulary
  /** 相对工程根的视频路径（人声分离用） */
  videoRelativePath?: string
  /** 转写分段；缺省则跳过话语/启发式事件 */
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
 * 阶段 1 完整分析：切镜 + 音轨/人声 + 转写落盘 + 实体 + OCR 启发式 + 事件/节拍/意图。
 */
export async function analyzeSemanticTimeline(
  projectRoot: string,
  sourceAssetId: string,
  videoAbs: string,
  options: AnalyzeSemanticOptions = {}
): Promise<AnalyzeSemanticResult> {
  const vocabulary = options.vocabulary ?? 'commerce.v1'
  const notes: string[] = []
  const base = await analyzeShotsOnly(projectRoot, sourceAssetId, videoAbs, vocabulary)
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
    if (options.transcriptGranularity === 'sentence') {
      notes.push('transcript granularity=sentence (word timestamps unavailable)')
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
      if (det.entities.length > 0) {
        entities = det.entities
        saveEntities(projectRoot, doc.id, {
          schema: SEMANTIC_TIMELINE_SCHEMA,
          entities
        })
      }
    } catch (e) {
      notes.push(`entity detect: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // OCR 启发式（VLM 结果可由上层覆盖写盘）
  const ocrRegions = heuristicOcrFromUtterances(utterances, shots, fps)
  saveOcr(projectRoot, doc.id, { schema: SEMANTIC_TIMELINE_SCHEMA, regions: ocrRegions })

  // 理解：启发式事件 / 节拍 / 意图（GraphSkill 解析结果可后续合并）
  const events = heuristicEventsFromUtterances(utterances, shots, fps)
  const beats = assignBeatsHeuristic(
    events,
    facts.durationSec,
    fps,
    options.vocabularyDef ?? vocabulary
  )
  const intents = inferIntentsFromEvents(events)

  doc = rebuildTracks({
    ...doc,
    entities,
    events,
    beats,
    intents,
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
  })
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
  return {
    beats: doc.beats.map((b) => ({
      id: b.id,
      start: b.timeRange.start,
      end: b.timeRange.end,
      label: b.type
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
