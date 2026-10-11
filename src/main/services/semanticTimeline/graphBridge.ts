/**
 * 画布语义节点 / MCP 共用的主进程编排：分析（含转写）、证据读取、文档保存、成片拼接。
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  findVocabularyInPacks,
  validateSemanticTimeline,
  type SemanticAnalyzeRequest,
  type SemanticAnalyzeResponse,
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
  loadSemanticTimeline,
  loadShotsEvidence,
  loadUtterances,
  saveSemanticTimeline
} from './SemanticTimelineService'
import { rebuildVideo } from './rebuildService'
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
    detectEntities: input.detectEntities,
    // 实体检测也走大模型：模型/实例由节点透传（缺省应用默认文本模型）
    entityModel: input.entityModel,
    entityProviderInstanceId: input.entityProviderInstanceId
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

/**
 * 按 id 读整份时间线文档（读不到返回 null，不抛）。
 *
 * 给引擎侧的兜底用：上游分析节点在"拿不到视频输入"时会产出只有 id 的空骨架，
 * 下游据此把磁盘上的真实文档读回来。
 */
export function semanticLoadTimelineForGraph(timelineId: string): SemanticTimeline | null {
  const id = timelineId?.trim()
  if (!id) return null
  try {
    return loadSemanticTimeline(projectService.getRoot(), id)
  } catch {
    return null
  }
}

export function semanticSaveTimelineForGraph(doc: SemanticTimeline): { ok: true } {
  const v = validateSemanticTimeline(doc)
  if (!v.ok) throw new Error(v.issues.map((i) => `${i.path} ${i.message}`).join('; '))
  saveSemanticTimeline(projectService.getRoot(), doc)
  return { ok: true }
}

function sanitizeLabel(label: string | undefined): string {
  return (label ?? '').replace(/[^\w.-]+/g, '_').slice(0, 40)
}

// ─── 语义重建（分析 → 编译 → 重建）：把生成的镜头片段接成成片 ─────────────────────

export interface SemanticRebuildForGraphInput {
  timelineId: string
  clips: Array<{ key: string; relativePath: string }>
  /** 输出文件名后缀（多版本/重跑时区分），已由调用方 sanitize */
  label?: string
  keepAudio?: boolean
  sourceRelativePath?: string
  burnSubtitles?: boolean
  width?: number
  height?: number
  fps?: number
}

export interface SemanticRebuildForGraphResult {
  ok: boolean
  outputRelativePath?: string
  manifestRelativePath: string
  clipCount: number
  burnedSubtitles: number
  keptAudio: boolean
  notes: string[]
  error?: string
}

/**
 * 语义重建的落盘与拼接。
 *
 * 与旧的"按编辑列表裁剪原片"那条路不同：素材是**模型新生成的片段**，
 * 所以这里统一重编码拼接（见 `rebuildService`），并按需混回原片音轨、烧录转写字幕。
 * 每次运行落在 `Semantic/<id>/rebuilds/<runId>/`，跑多少次都不覆盖历史。
 */
export async function semanticRebuildForGraph(
  input: SemanticRebuildForGraphInput
): Promise<SemanticRebuildForGraphResult> {
  const root = projectService.getRoot()
  const timelineId = String(input.timelineId || '').trim()
  if (!timelineId) throw new Error('rebuild requires timelineId')

  const clips = (input.clips ?? []).filter((clip) => !!clip?.relativePath?.trim())
  if (clips.length === 0) throw new Error('rebuild requires at least one clip')

  const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const suffix = sanitizeLabel(input.label)
  const fileName = suffix ? `output.${suffix}.mp4` : 'output.mp4'
  const workDirRelativePath = `Semantic/${timelineId}/rebuilds/${runId}`
  const outputRelativePath = `${workDirRelativePath}/${fileName}`

  // 字幕：用时间线的转写（与旧成片管线同一口径）
  const subtitles =
    input.burnSubtitles === false
      ? []
      : loadUtterances(root, timelineId).map((utt) => ({
          startSec: utt.range.start,
          endSec: utt.range.end,
          text: utt.text
        }))

  const result = await rebuildVideo({
    timelineId,
    projectRoot: root,
    clips,
    outputRelativePath,
    workDirRelativePath,
    keepAudio: input.keepAudio !== false,
    sourceRelativePath: input.sourceRelativePath,
    burnSubtitles: input.burnSubtitles !== false,
    subtitles,
    width: input.width,
    height: input.height,
    fps: input.fps
  })

  const manifestRelativePath = `${workDirRelativePath}/manifest.json`
  const manifest = {
    schema: 'aiart.semantic-rebuild@1',
    timelineId,
    runId,
    createdAt: new Date().toISOString(),
    outputRelativePath: result.ok ? outputRelativePath : undefined,
    clips,
    keepAudio: result.keptAudio,
    burnedSubtitles: result.burnedSubtitles,
    notes: result.notes,
    error: result.error
  }
  mkdirSync(join(root, ...workDirRelativePath.split('/')), { recursive: true })
  writeFileSync(
    join(root, ...manifestRelativePath.split('/')),
    JSON.stringify(manifest, null, 2),
    'utf8'
  )

  return {
    ok: result.ok,
    ...(result.ok ? { outputRelativePath } : {}),
    manifestRelativePath,
    clipCount: result.clipCount,
    burnedSubtitles: result.burnedSubtitles,
    keptAudio: result.keptAudio,
    notes: result.notes,
    ...(result.error ? { error: result.error } : {})
  }
}
