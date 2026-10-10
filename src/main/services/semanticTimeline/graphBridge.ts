/**
 * 画布语义节点 / MCP 共用的主进程编排：分析（含转写）、证据读取、文档保存、按编辑构建成片。
 */
import { existsSync } from 'fs'
import { join } from 'path'
import {
  applyStructuralEdits,
  buildEntityShotIndex,
  findVocabularyInPacks,
  freezeBuildDefinition,
  planInvalidation,
  timelineVersionHash,
  validateSemanticTimeline,
  type SemanticAnalyzeRequest,
  type SemanticAnalyzeResponse,
  type SemanticBuildRequest,
  type SemanticBuildResponse,
  type SemanticEdit,
  type SemanticEvidenceResponse,
  type SemanticPack,
  type SemanticTimeline,
  type ShotEvidence,
  type TranscribeLikeSegment
} from '@shared/semanticTimeline'
import { normalizeProjectRelativePath } from '@shared/mcpAssetWrite'
import type { AssetInfo } from '@shared/domain'
import { projectService } from '../projectService'
import { modelProviderFacade } from '../modelProviders'
import { installedWorkflowsDir } from '../workflowMarketService'
import { broadcastToAllWindows } from '../../broadcast'
import { IpcChannels } from '@shared/ipc'
import {
  analyzeSemanticTimeline,
  buildSemanticPreview,
  loadOcrRegions,
  loadSemanticTimeline,
  loadShotsEvidence,
  loadUtterances,
  resolveTimelineDir,
  saveBuildManifest,
  saveSemanticTimeline
} from './SemanticTimelineService'
import { executeBuild } from './buildExecutor'
import { listAllSemanticPacks } from './packLoader'

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function findAsset(assetId: string | undefined): AssetInfo | undefined {
  if (!assetId) return undefined
  return projectService.listAssets().find((a) => a.id === assetId)
}

function assetVideoRelativePath(asset: AssetInfo | undefined): string {
  return asset ? (normalizeProjectRelativePath(asset.relativePath ?? '') ?? '') : ''
}

function normalizeRel(path: string | undefined): string {
  return normalizeProjectRelativePath(path ?? '') ?? ''
}

function toAbs(root: string, rel: string): string {
  return join(root, ...rel.split('/'))
}

/** 关键帧路径相对 Semantic/<id>/ → 工程相对路径 */
function keyframeIndex(timelineId: string, shots: ShotEvidence[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const s of shots) {
    const rel = s.keyframes?.middle ?? s.keyframes?.first
    if (rel) out[s.id] = `Semantic/${timelineId}/${rel}`
  }
  return out
}

export function listSemanticPacksForGraph(): SemanticPack[] {
  try {
    return listAllSemanticPacks(installedWorkflowsDir())
  } catch {
    return listAllSemanticPacks()
  }
}

export async function semanticAnalyzeForGraph(
  input: SemanticAnalyzeRequest
): Promise<SemanticAnalyzeResponse> {
  const root = projectService.getRoot()
  const asset = findAsset(input.sourceAssetId)
  if (input.sourceAssetId && !asset) throw new Error(`asset not found: ${input.sourceAssetId}`)
  if (asset && asset.type !== 'video') throw new Error('source asset must be a video')
  const rel = assetVideoRelativePath(asset) || normalizeRel(input.videoRelativePath)
  if (!rel) throw new Error('video relativePath empty')
  const videoAbs = toAbs(root, rel)
  if (!existsSync(videoAbs)) throw new Error(`video file missing: ${rel}`)

  const notes: string[] = []
  let transcriptSegments: TranscribeLikeSegment[] | undefined
  let transcriptGranularity: 'word' | 'sentence' | undefined
  if (input.transcribe !== false) {
    try {
      const tr = await modelProviderFacade.transcribeAudio({
        relativePath: rel,
        wordTimestamps: true,
        // 节点可以指定用哪家/哪个转写模型；不给则由 facade 选首个支持转写的已配置实例
        providerInstanceId: input.transcribeProviderInstanceId,
        model: input.transcribeModel
      })
      transcriptSegments = tr.segments as TranscribeLikeSegment[]
      transcriptGranularity = tr.granularity ?? 'sentence'
    } catch (e) {
      notes.push(`transcribe failed: ${errorText(e)}`)
    }
  }

  const vocabularyId = input.vocabulary || 'commerce.v1'
  const vocabularyDef = findVocabularyInPacks(listSemanticPacksForGraph(), vocabularyId)
  // 无资产的视频文件按路径生成稳定 id，重复分析覆盖同一目录
  const sourceId = asset?.id ?? `path:${rel}`
  const result = await analyzeSemanticTimeline(root, sourceId, videoAbs, {
    vocabulary: vocabularyId,
    vocabularyDef,
    videoRelativePath: rel,
    transcriptSegments,
    transcriptGranularity,
    separateAudio: input.separateAudio,
    detectEntities: input.detectEntities
  })
  notes.push(...result.notes)

  if (asset) {
    try {
      const preview = buildSemanticPreview(result.timeline, result.shots, result.utterances)
      const updated = projectService.updateAsset({
        ...asset,
        semanticTimelineId: result.timeline.id,
        genParams: { ...(asset.genParams ?? {}), semanticPreview: preview }
      })
      broadcastToAllWindows(IpcChannels.ASSET_UPDATED, updated)
    } catch (e) {
      notes.push(`asset preview write failed: ${errorText(e)}`)
    }
  }

  return {
    timeline: result.timeline,
    shots: result.shots,
    utterances: result.utterances,
    keyframes: keyframeIndex(result.timeline.id, result.shots),
    sourceRelativePath: rel,
    method: result.method,
    notes
  }
}

function sourceRelativeForTimeline(doc: SemanticTimeline, override?: string): string {
  const explicit = normalizeRel(override)
  if (explicit) return explicit
  const assetId = doc.source.assetId
  if (assetId.startsWith('path:')) return normalizeRel(assetId.slice(5))
  return assetVideoRelativePath(findAsset(assetId))
}

export function semanticLoadEvidenceForGraph(timelineId: string): SemanticEvidenceResponse {
  const root = projectService.getRoot()
  const shots = loadShotsEvidence(root, timelineId)
  const doc = loadSemanticTimeline(root, timelineId)
  return {
    shots,
    utterances: loadUtterances(root, timelineId),
    keyframes: keyframeIndex(timelineId, shots),
    sourceRelativePath: doc ? sourceRelativeForTimeline(doc) || undefined : undefined
  }
}

export function semanticSaveTimelineForGraph(doc: SemanticTimeline): { ok: true } {
  const v = validateSemanticTimeline(doc)
  if (!v.ok) throw new Error(v.issues.map((i) => `${i.path} ${i.message}`).join('; '))
  saveSemanticTimeline(projectService.getRoot(), doc)
  return { ok: true }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])])
    )
  }
  return value
}

function editSignature(edit: SemanticEdit): string {
  const { id: _id, createdAt: _createdAt, origin: _origin, ...rest } = edit
  return JSON.stringify(canonical(rest))
}

function sanitizeLabel(label: string | undefined): string {
  return (label ?? '').replace(/[^\w.-]+/g, '_').slice(0, 40)
}

/**
 * 编辑 → 失效计划 → 冻结 → 执行。编辑追加进文档（按 id 去重）后落盘，保证 timeline.json 可追溯。
 */
export async function semanticBuildForGraph(
  input: SemanticBuildRequest
): Promise<SemanticBuildResponse> {
  const root = projectService.getRoot()
  const base = input.timeline
  const v = validateSemanticTimeline(base)
  if (!v.ok) throw new Error(`invalid timeline: ${v.issues.map((i) => i.message).join('; ')}`)
  const rel = sourceRelativeForTimeline(base, input.sourceRelativePath)
  if (!rel) throw new Error('source video not resolvable (set sourceRelativePath)')
  const videoAbs = toAbs(root, rel)
  if (!existsSync(videoAbs)) throw new Error(`source video missing: ${rel}`)

  const shots = loadShotsEvidence(root, base.id)
  if (shots.length === 0) throw new Error('no shot evidence; run semantic analyze first')

  // 内容相同的编辑复用已有记录：重复运行不膨胀 timeline.json，且构建目录（按 editIds 定）可复用
  const bySignature = new Map(base.edits.map((e) => [editSignature(e), e]))
  const edits = input.edits.map((e) => bySignature.get(editSignature(e)) ?? e)
  const known = new Set(base.edits.map((e) => e.id))
  const added = edits.filter((e) => !known.has(e.id))
  const doc: SemanticTimeline =
    added.length > 0
      ? { ...base, edits: [...base.edits, ...added], updatedAt: new Date().toISOString() }
      : base
  saveSemanticTimeline(root, doc)

  const entityShotIndex = buildEntityShotIndex(doc)
  const plan = planInvalidation({ timeline: doc, shots, edits, entityShotIndex })
  const definition = freezeBuildDefinition(doc, edits, plan, timelineVersionHash(doc))

  const notes: string[] = []
  const replaceMediaAbs = new Map<string, string>()
  for (const edit of edits) {
    if (edit.kind !== 'replaceEntity') continue
    const asset = findAsset(edit.newAssetId)
    const assetRel = assetVideoRelativePath(asset)
    if (assetRel && existsSync(toAbs(root, assetRel))) {
      replaceMediaAbs.set(edit.newAssetId, toAbs(root, assetRel))
    } else {
      notes.push(`replaceEntity: asset ${edit.newAssetId} has no media file`)
    }
  }

  const timelineDir = resolveTimelineDir(root, doc.id)
  const entityMaskDirs = new Map<string, string>()
  const entityBoxes = new Map<string, Map<string, { x: number; y: number; w: number; h: number }>>()
  for (const ent of doc.entities) {
    const boxes = new Map<string, { x: number; y: number; w: number; h: number }>()
    for (const app of ent.appearances) {
      if (app.box) boxes.set(app.shotId, app.box)
      if (app.masks && !entityMaskDirs.has(ent.id)) {
        entityMaskDirs.set(ent.id, join(timelineDir, ...app.masks.split('/')))
      }
    }
    if (boxes.size > 0) entityBoxes.set(ent.id, boxes)
  }

  const suffix = sanitizeLabel(input.label)
  const workDir = join(timelineDir, 'builds', definition.id)
  const fileName = suffix ? `output.${suffix}.mp4` : 'output.mp4'
  const outputRel = `Semantic/${doc.id}/builds/${definition.id}/${fileName}`
  const manifest = await executeBuild({
    sourceVideoAbs: videoAbs,
    shots,
    outputShots: applyStructuralEdits(doc, shots, edits),
    definition,
    workDirAbs: workDir,
    outputAbs: join(workDir, fileName),
    outputRelativePath: outputRel,
    edits,
    runEdits: true,
    entityShotIndex,
    entityMaskDirs,
    entityBoxes,
    replaceMediaAbs,
    ocrRegions: loadOcrRegions(root, doc.id),
    frameWidth: doc.source.width,
    frameHeight: doc.source.height
  })
  saveBuildManifest(root, doc.id, manifest)
  notes.push(...(manifest.notes ?? []))
  return {
    plan,
    definition,
    manifest,
    outputRelativePath: manifest.status === 'done' ? outputRel : undefined,
    notes
  }
}
