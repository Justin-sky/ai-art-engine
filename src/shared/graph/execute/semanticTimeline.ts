/**
 * Semantic Timeline 两节点直连执行器：`semantic.analyze`（视频拆解） → `semantic.rebuild`（视频重制）。
 *
 * 真实管线（容器溯源 / 切镜精修 / 像素与多轨音频取证 / 实体检测 / 成片拼接）在主进程，经 ctx 能力注入；
 * 能力缺失（单测 / 无工程）时退回确定性骨架并给出明确日志。
 */
import type { GraphImageItem, GraphValue, GraphVideoItem, NodeExecuteContext } from './types'
import {
  resolveVideoGenerateParamsForApi,
  supportedDurationsFromError,
  type VideoGenerateParamCapabilities
} from '../videoGenerateParams'
import { isSeedanceVideoModel, type VideoGeneratePortLimits } from '../portInputLimits'
import { buildLipSyncPrompt, resolveLipSyncSystemPrompt } from '../lipSync'
import { normalizeImageRedraw } from '../imageRedraw'
import {
  MASK_OVERLAP_WARN_RATIO,
  SOFT_MAX_REPLACEMENTS_PER_SHOT,
  applyBatchVariantToTimeline,
  buildEntityRedrawPrompt,
  buildReaShotBatchPrompt,
  buildReaWholeVideoPrompt,
  carryOverSemanticEdits,
  collectTimelinePackagingOverlays,
  convertDraftLayersToShotLayers,
  createEmptySemanticTimeline,
  diffAgainstBaseline,
  ensureSemanticStructure,
  finalizeSemanticBreakdown,
  makeTimeRange,
  migrateSemanticTimeline,
  overlappingReplacements,
  parseBatchVariantSpecs,
  parseReaShotVlmBatch,
  parseReaWholeVideoResponse,
  planRemakeExecution,
  rebaselineSemanticTimeline,
  referenceLegend,
  replacementVideoNote,
  shortHash,
  singleShot,
  stableStringify,
  validateSemanticTimeline,
  type EntityReplacementRef,
  type OcrRegion,
  type OverlayNormalizedBox,
  type ReaShotVlmDraft,
  type RemakeStrategy,
  type RemakeUnitTask,
  type SemanticBatchVariantRunItem,
  type SemanticRebuildDub,
  type SemanticRebuildLocalMotionClip,
  type SemanticRebuildSegment,
  type SemanticShot,
  type SemanticTimeline,
  type ShotEvidence,
  type ShotReplacement,
  type UtteranceEvidence
} from '../../semanticTimeline'
import { semanticTimelineValue } from './semanticTimelineValue'

/** 单批送入多模态模型的镜头数，以及整片最多描述的镜头上限 */
const SHOT_DESCRIBE_BATCH_SIZE = 6
const MAX_DESCRIBE_SHOTS = 48
/** 单次运行最大 AI 生成单元数（防超长视频误触连续调用） */
const MAX_REBUILD_UNITS = 24

type GenerateVideoRequest = Parameters<NonNullable<NodeExecuteContext['generateVideo']>>[0]
type GenerateVideoResult = Awaited<ReturnType<NonNullable<NodeExecuteContext['generateVideo']>>>

function isEn(ctx: NodeExecuteContext): boolean {
  return (ctx.locale ?? '').toLowerCase().startsWith('en')
}

function say(
  ctx: NodeExecuteContext,
  zh: string,
  en: string,
  level?: 'info' | 'warn' | 'error'
): void {
  ctx.log?.(isEn(ctx) ? en : zh, level)
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function parseJsonParam<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw.trim()) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function parseOnlyShotIds(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  const trimmed = raw.trim()
  if (trimmed.startsWith('[')) {
    const arr = parseJsonParam<unknown[]>(trimmed, [])
    return arr.map((x) => String(x || '').trim()).filter(Boolean)
  }
  return trimmed
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// ─── Upstream media helpers ─────────────────────────────────────────────────

interface UpstreamVideo {
  assetId?: string
  relativePath?: string
}

function fromVideoItem(item: GraphVideoItem | undefined, ctx: NodeExecuteContext): UpstreamVideo {
  if (!item) return {}
  const rel = item.relativePath?.trim()
  const id = item.id?.trim()
  const isAsset = !!id && (ctx.hasAsset?.(id) ?? false)
  return { assetId: isAsset ? id : undefined, relativePath: rel || undefined }
}

/** in-video 端口（兼容单测直传 `in`）：单视频 / 视频数组 / 资产 / 输出节点 */
function resolveUpstreamVideo(ctx: NodeExecuteContext): UpstreamVideo {
  for (const value of [...(ctx.inputs['in-video'] ?? []), ...(ctx.inputs.in ?? [])]) {
    if (value.kind === 'video') return fromVideoItem(value, ctx)
    if (value.kind === 'videos') return fromVideoItem(value.items[0], ctx)
    if (value.kind === 'asset' && value.assetType === 'video') {
      return { assetId: value.assetId, relativePath: value.relativePath }
    }
    if (value.kind === 'output') {
      const asset = value.items.find((i) => i.assetType === 'video')
      if (asset) return { assetId: asset.assetId, relativePath: asset.relativePath }
      if (value.videos?.length) return fromVideoItem(value.videos[0], ctx)
    }
  }
  return {}
}

async function resolveImageItemUrl(
  ctx: NodeExecuteContext,
  item: Pick<GraphImageItem, 'id' | 'dataUrl' | 'relativePath'>
): Promise<string | undefined> {
  if (item.dataUrl?.trim()) return item.dataUrl.trim()
  if (item.id && ctx.resolveAssetImageUrl) {
    const byId = await ctx.resolveAssetImageUrl(item.id).catch(() => undefined)
    if (byId) return byId
  }
  if (item.relativePath) {
    const byData = await ctx.readProjectImageDataUrl?.(item.relativePath).catch(() => undefined)
    if (byData) return byData
    const byMedia = await ctx.resolveProjectMediaUrl?.(item.relativePath).catch(() => undefined)
    if (byMedia) return byMedia
  }
  return undefined
}

/** in-images 端口：按连线顺序解析参考图 URL（对应 `@图片1..k`） */
async function resolveUpstreamReferenceImageUrls(ctx: NodeExecuteContext): Promise<string[]> {
  const urls: string[] = []
  for (const value of ctx.inputs['in-images'] ?? []) {
    if (value.kind === 'image') {
      const u = await resolveImageItemUrl(ctx, value)
      if (u) urls.push(u)
      continue
    }
    if (value.kind === 'images') {
      for (const item of value.items) {
        const u = await resolveImageItemUrl(ctx, item)
        if (u) urls.push(u)
      }
      continue
    }
    if (value.kind === 'asset' && value.assetType === 'image') {
      const u = await resolveImageItemUrl(ctx, {
        id: value.assetId,
        dataUrl: '',
        relativePath: value.relativePath
      })
      if (u) urls.push(u)
      continue
    }
    if (value.kind === 'output') {
      for (const img of value.images ?? []) {
        const u = await resolveImageItemUrl(ctx, img)
        if (u) urls.push(u)
      }
    }
  }
  return urls
}

// ─── 4-axis VLM enrichment ──────────────────────────────────────────────────

interface EnrichInput {
  doc: SemanticTimeline
  shots: ShotEvidence[]
  utterances: UtteranceEvidence[]
  keyframes: Record<string, string>
}

/**
 * 四轴多模态深度鉴别：逐批关键帧取证（11 类概率 + 包装花字层分离 + 真实素材鉴别）→ 全片叙事钩子与旁白归因。
 * 任何批次失败均保留确定性物理取证结果，不阻断拆解落盘。
 */
async function enrichTimelineWithLlm(
  ctx: NodeExecuteContext,
  input: EnrichInput
): Promise<SemanticTimeline> {
  const { doc, shots, utterances, keyframes } = input
  if (!ctx.generateText) return doc

  const fps = doc.source.fps
  const shotById = new Map(shots.map((s) => [s.id, s]))
  const lang: 'zh' | 'en' = isEn(ctx) ? 'en' : 'zh'
  const baseDoc = doc.breakdown ? doc : finalizeSemanticBreakdown(doc, { lang })
  const docShotById = new Map((baseDoc.shots ?? []).map((s) => [s.id, s]))

  const describeShots = shots.filter((s) => keyframes[s.id]).slice(0, MAX_DESCRIBE_SHOTS)
  const images: string[] = []
  const imageShots: ShotEvidence[] = []
  if (ctx.resolveProjectMediaUrl) {
    for (const s of describeShots) {
      const url = await ctx.resolveProjectMediaUrl(keyframes[s.id]!).catch(() => undefined)
      if (url) {
        images.push(url)
        imageShots.push(s)
      }
    }
  }

  const reaDrafts = new Map<string, ReaShotVlmDraft>()
  const failures: string[] = []

  if (images.length > 0 && baseDoc.breakdown) {
    say(
      ctx,
      `四轴多模态鉴别：${images.length} 个关键帧`, // cjk-ok
      `4-axis VLM forensics: ${images.length} keyframes`
    )
    for (let start = 0; start < imageShots.length; start += SHOT_DESCRIBE_BATCH_SIZE) {
      const batchShots = imageShots.slice(start, start + SHOT_DESCRIBE_BATCH_SIZE)
      const batchImages = images.slice(start, start + SHOT_DESCRIBE_BATCH_SIZE)
      const promptObj = buildReaShotBatchPrompt({
        shots: batchShots.map(
          (ev): SemanticShot =>
            docShotById.get(ev.id) ?? {
              id: ev.id,
              range: ev.range,
              sourceSegment: { start: ev.range.start, end: ev.range.end },
              keyframes: ev.keyframes,
              forensics: ev.forensics,
              camera: {},
              visual: {},
              subjects: [],
              dialogueIds: [],
              textLayerIds: [],
              origin: 'analysis'
            }
        ),
        provenance: baseDoc.breakdown.provenance,
        lang
      })
      try {
        const res = await ctx.generateText({
          prompt: promptObj.prompt,
          system: promptObj.system,
          images: batchImages,
          model: ctx.node.params?.generateModel || undefined,
          providerInstanceId: ctx.node.params?.generateProviderInstanceId || undefined
        })
        for (const rd of parseReaShotVlmBatch(res.text)) {
          if (shotById.has(rd.shotId)) reaDrafts.set(rd.shotId, rd)
        }
      } catch (e) {
        const reason = errorText(e)
        failures.push(reason)
        say(
          ctx,
          `多模态批次鉴别失败：${reason}`, // cjk-ok
          `VLM forensic batch failed: ${reason}`,
          'warn'
        )
      }
    }
  }

  if (failures.length > 0 && reaDrafts.size === 0) {
    say(
      ctx,
      `多模态鉴别未产出结果，保留本地物理取证判定（原因：${failures[0]}）`, // cjk-ok
      `VLM forensics produced no drafts; keeping deterministic forensics (${failures[0]})`,
      'warn'
    )
  }

  let wholeVideoDraft: ReturnType<typeof parseReaWholeVideoResponse> = null
  if (baseDoc.breakdown && (reaDrafts.size > 0 || utterances.length > 0)) {
    try {
      const wholePrompt = buildReaWholeVideoPrompt({
        durationSec: baseDoc.source.duration,
        shotSummaries: (baseDoc.shots ?? []).map((s) => {
          const desc =
            s.visual?.description || reaDrafts.get(s.id)?.visualDescription || s.base?.label || ''
          return `${s.id} (${s.range.start.toFixed(1)}-${s.range.end.toFixed(1)}s): ${desc}`
        }),
        transcriptLines: utterances.map(
          (u) => `[${u.range.start.toFixed(1)}-${u.range.end.toFixed(1)}s] ${u.text}`
        ),
        lang
      })
      const sampleImgs =
        images.length <= 6
          ? images
          : [images[0]!, images[Math.floor(images.length / 2)]!, images[images.length - 1]!]
      const res = await ctx.generateText({
        prompt: wholePrompt.prompt,
        system: wholePrompt.system,
        images: sampleImgs.length ? sampleImgs : undefined,
        model: ctx.node.params?.generateModel || undefined,
        providerInstanceId: ctx.node.params?.generateProviderInstanceId || undefined
      })
      wholeVideoDraft = parseReaWholeVideoResponse(res.text)
    } catch {
      /* whole-video synthesis is optional */
    }
  }

  let nextShots = baseDoc.shots?.length
    ? applyReaShotDrafts(baseDoc.shots, reaDrafts)
    : baseDoc.shots
  let nextTextLayers = baseDoc.textLayers ? [...baseDoc.textLayers] : undefined
  if (nextShots && reaDrafts.size > 0) {
    const addedRegions: OcrRegion[] = []
    nextShots = nextShots.map((shot) => {
      const rd = reaDrafts.get(shot.id)
      if (!rd?.layers?.length) return shot
      const layers = convertDraftLayersToShotLayers(
        shot.id,
        shot.range,
        rd.layers,
        shot.forensics?.frozenOverlayBoxes
      )
      if (!layers.length) return shot
      const newLayerIds: string[] = []
      for (const layer of layers) {
        if (!layer.text?.trim() || layer.kind === 'scene_text') continue
        const regId = `ocr.${layer.id}`
        newLayerIds.push(regId)
        addedRegions.push({
          id: regId,
          range: makeTimeRange(shot.range.start, shot.range.end, fps),
          text: layer.text.trim(),
          kind:
            layer.kind === 'subtitle' || layer.kind === 'huazi' || layer.kind === 'title'
              ? 'caption'
              : 'other',
          box:
            layer.box ??
            (layer.position === 'top'
              ? { x: 0.1, y: 0.08, w: 0.8, h: 0.1 }
              : layer.position === 'middle'
                ? { x: 0.1, y: 0.42, w: 0.8, h: 0.14 }
                : { x: 0.1, y: 0.78, w: 0.8, h: 0.1 }),
          shotId: shot.id,
          confidence: 0.88
        })
      }
      return {
        ...shot,
        layers,
        textLayerIds: [...new Set([...(shot.textLayerIds ?? []), ...newLayerIds])]
      }
    })
    if (addedRegions.length > 0) {
      nextTextLayers = [...(nextTextLayers ?? []), ...addedRegions]
    }
  }

  const enrichedDoc: SemanticTimeline = {
    ...baseDoc,
    ...(nextShots ? { shots: nextShots } : {}),
    ...(nextTextLayers ? { textLayers: nextTextLayers } : {}),
    updatedAt: new Date().toISOString()
  }

  return finalizeSemanticBreakdown(enrichedDoc, {
    ...(wholeVideoDraft ? { wholeVideo: wholeVideoDraft } : {}),
    vlmStatus: {
      used: reaDrafts.size > 0 || Boolean(wholeVideoDraft),
      shotModel: String(ctx.node.params?.generateModel || 'default'),
      wholeVideoUsed: Boolean(wholeVideoDraft),
      describedShots: reaDrafts.size,
      failedShots: failures.length,
      ...(failures.length ? { note: failures[0]! } : {})
    },
    lang
  })
}

function applyReaShotDrafts(
  shots: SemanticShot[],
  reaDrafts: Map<string, ReaShotVlmDraft>
): SemanticShot[] {
  if (reaDrafts.size === 0) return shots
  const pick = (cur: string | undefined, next: string | undefined): string | undefined =>
    cur?.trim() ? cur : next?.trim() || undefined
  return shots.map((shot) => {
    const rd = reaDrafts.get(shot.id)
    if (!rd) return shot

    let nextBase = shot.base
    if (rd.probs || rd.baseLabel || rd.aiEdits?.length) {
      const vlmProbs = rd.probs ?? (rd.baseLabel ? { [rd.baseLabel]: 0.82 } : undefined)
      nextBase = {
        label: shot.base?.label ?? rd.baseLabel ?? 'live_action',
        probs: shot.base?.probs ?? (vlmProbs as Record<string, number>) ?? {},
        confidence: shot.base?.confidence ?? 0.72,
        decidedBy: shot.base?.reviewOverrideLabel ? 'review_override' : 'vlm_fused',
        ...(shot.base?.reviewOverrideLabel
          ? { reviewOverrideLabel: shot.base.reviewOverrideLabel }
          : {}),
        ...(vlmProbs ? { vlmProbs } : {}),
        ...(rd.evidence?.length ? { vlmEvidence: rd.evidence } : {}),
        ...(rd.aiEdits?.length ? { aiEdits: rd.aiEdits } : {}),
        evidence: shot.base?.evidence ?? []
      }
    }

    let nextMaterial = shot.material
    if (rd.realMaterials?.length) {
      const hasReal = rd.realMaterials.some((m) => m.realMaterial === true)
      nextMaterial = {
        origin: hasReal ? 'recorded' : (shot.material?.origin ?? 'generated'),
        items: rd.realMaterials.map((m) => ({
          kind:
            m.kind === 'product' ||
            m.kind === 'screen_recording' ||
            m.kind === 'real_person' ||
            m.kind === 'real_footage' ||
            m.kind === 'logo_brand' ||
            m.kind === 'document_photo'
              ? m.kind
              : 'other',
          description: m.description,
          realMaterial: m.realMaterial
        })),
        references: shot.material?.references ?? []
      }
    }

    if (shot.locked || shot.origin === 'user') {
      return {
        ...shot,
        ...(nextBase ? { base: nextBase } : {}),
        ...(nextMaterial ? { material: nextMaterial } : {})
      }
    }

    const camera = {
      ...shot.camera,
      ...(pick(shot.camera?.shotSize, rd.shotSize)
        ? { shotSize: pick(shot.camera?.shotSize, rd.shotSize) }
        : {}),
      ...(pick(shot.camera?.angle, rd.angle) ? { angle: pick(shot.camera?.angle, rd.angle) } : {}),
      ...(pick(shot.camera?.motion, rd.cameraMotion)
        ? { motion: pick(shot.camera?.motion, rd.cameraMotion) }
        : {})
    }
    const subjects = [...(shot.subjects ?? [])]
    if (rd.subject?.trim()) {
      const first = subjects[0]
      if (first) {
        subjects[0] = {
          ...first,
          ...(first.action?.trim() || !rd.action?.trim() ? {} : { action: rd.action.trim() }),
          ...(first.emotion?.trim() || !rd.emotion?.trim() ? {} : { emotion: rd.emotion.trim() })
        }
      } else {
        subjects.push({
          name: rd.subject.trim(),
          ...(rd.action?.trim() ? { action: rd.action.trim() } : {}),
          ...(rd.emotion?.trim() ? { emotion: rd.emotion.trim() } : {})
        })
      }
    }
    const description =
      rd.visualDescription?.trim() || [rd.subject, rd.action].filter((s) => s?.trim()).join(' ')
    const visual = {
      ...shot.visual,
      ...(shot.visual?.description?.trim() || !description ? {} : { description })
    }
    return {
      ...shot,
      camera,
      visual,
      subjects,
      ...(nextBase ? { base: nextBase } : {}),
      ...(nextMaterial ? { material: nextMaterial } : {})
    }
  })
}

// ─── semantic.analyze ───────────────────────────────────────────────────────

function heuristicTimeline(
  ctx: NodeExecuteContext,
  hasSourceInput = false
): {
  doc: SemanticTimeline
  shots: ShotEvidence[]
  utterances: UtteranceEvidence[]
} {
  const p = ctx.node.params ?? {}
  const fps = Number(p.semanticFps) || 30
  const hasExplicitDuration = Number(p.semanticDuration) > 0
  const duration = hasExplicitDuration ? Number(p.semanticDuration) : 60
  const extra = p as { width?: number; height?: number }
  const doc = createEmptySemanticTimeline(String(p.sourceAssetId || 'video'), {
    durationSec: duration,
    fps,
    width: Number(extra.width) || 1080,
    height: Number(extra.height) || 1920,
    hasAudio: true
  })
  const shots = parseJsonParam<ShotEvidence[]>(p.shotsJson, []).filter((s) => s?.id && s.range)
  const utterances = parseJsonParam<UtteranceEvidence[]>(p.utterancesJson, []).filter(
    (u) => u?.id && u.range
  )
  const shouldSynthesizeSingleShot = hasSourceInput || utterances.length > 0
  const finalShots =
    shots.length > 0 ? shots : shouldSynthesizeSingleShot ? singleShot(duration, fps) : []
  return {
    doc: {
      ...doc,
      updatedAt: new Date().toISOString()
    },
    shots: finalShots,
    utterances
  }
}

export async function executeSemanticAnalyzeNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const p = ctx.node.params ?? {}
  const useLlm = p.semanticLlm !== false
  const upstream = resolveUpstreamVideo(ctx)
  const assetId = upstream.assetId || String(p.sourceAssetId || '').trim() || undefined
  const relativePath = upstream.relativePath

  if (ctx.analyzeSemanticVideo && (assetId || relativePath)) {
    say(
      ctx,
      '视频拆解：容器溯源 / 切镜 / 关键帧 / 转写 / 人声分离 / 实体识别…', // cjk-ok
      'Video breakdown: provenance / shots / keyframes / transcript / stems / entities…'
    )
    const res = await ctx.analyzeSemanticVideo({
      sourceAssetId: assetId,
      videoRelativePath: relativePath,
      transcribe: p.semanticTranscribe !== false,
      transcribeProviderInstanceId:
        String(p.transcribeProviderInstanceId || '').trim() || undefined,
      transcribeModel: String(p.transcribeModel || '').trim() || undefined,
      separateAudio: p.semanticSeparateAudio !== false,
      detectEntities: p.semanticDetectEntities !== false,
      entityModel: String(p.generateModel || '').trim() || undefined,
      entityProviderInstanceId: String(p.generateProviderInstanceId || '').trim() || undefined
    })
    for (const note of res.notes) ctx.log?.(note, 'warn')
    const unitCount = res.timeline.breakdown?.productionPlan.units.length ?? 0
    say(
      ctx,
      `镜头 ${res.shots.length}（${res.method}）· 生成单元 ${unitCount} · 话语 ${res.utterances.length} · 实体 ${res.timeline.entities.length}`, // cjk-ok
      `${res.shots.length} shots (${res.method}) · ${unitCount} gen units · ${res.utterances.length} utterances · ${res.timeline.entities.length} entities`
    )
    let doc = res.timeline
    if (useLlm && ctx.generateText) {
      doc = await enrichTimelineWithLlm(ctx, {
        doc,
        shots: res.shots,
        utterances: res.utterances,
        keyframes: res.keyframes
      })
      doc = carryOverSemanticEdits(res.timeline, doc)
      doc = rebaselineSemanticTimeline(
        ensureSemanticStructure(doc, { shots: res.shots, utterances: res.utterances })
      )
      doc = finalizeSemanticBreakdown(doc, {
        lang: isEn(ctx) ? 'en' : 'zh',
        synthesizeFallbackEntities: p.semanticDetectEntities !== false
      })
      if (ctx.saveSemanticTimeline) {
        try {
          await ctx.saveSemanticTimeline(doc)
        } catch (e) {
          say(
            ctx,
            `保存语义时间线失败：${errorText(e)}`, // cjk-ok
            `Failed to save timeline: ${errorText(e)}`,
            'warn'
          )
        }
      }
    }
    ctx.patchNode?.({
      params: {
        semanticTimelineId: doc.id,
        sourceRelativePath: res.sourceRelativePath,
        ...(upstream.assetId ? { sourceAssetId: upstream.assetId } : {})
      }
    })
    return { out: semanticTimelineValue(doc) }
  }

  say(
    ctx,
    assetId || relativePath
      ? '当前执行环境没有语义分析能力，已按参数生成确定性拆解骨架' // cjk-ok
      : '没有解析到视频输入（上游视频口为空 / 该视频资产不可用），本次只产出空的时间线骨架', // cjk-ok
    'Semantic analysis is unavailable here; produced a deterministic breakdown skeleton from params',
    'warn'
  )
  const base = heuristicTimeline(ctx, Boolean(assetId || relativePath))
  const structuredDoc = base.shots.length
    ? finalizeSemanticBreakdown(
        ensureSemanticStructure(base.doc, { shots: base.shots, utterances: base.utterances }),
        { lang: isEn(ctx) ? 'en' : 'zh' }
      )
    : base.doc
  const doc =
    useLlm && ctx.generateText
      ? await enrichTimelineWithLlm(ctx, {
          doc: structuredDoc,
          shots: base.shots,
          utterances: base.utterances,
          keyframes: {}
        })
      : structuredDoc
  return { out: semanticTimelineValue(rebaselineSemanticTimeline(doc)) }
}

// ─── Timeline consumer helpers ──────────────────────────────────────────────

function readTimelineJson(ctx: NodeExecuteContext): string {
  const upstream = ctx.inputs.in?.[0]
  if (upstream && upstream.kind === 'semanticTimeline') return upstream.text
  if (upstream && upstream.kind === 'text' && upstream.text.trim()) return upstream.text.trim()
  return String(ctx.node.params?.timelineJson || '').trim()
}

function isNewerTimeline(disk: SemanticTimeline, upstream: SemanticTimeline): boolean {
  const diskEdits = disk.edits?.length ?? 0
  const upEdits = upstream.edits?.length ?? 0
  if (diskEdits !== upEdits) return diskEdits > upEdits
  const a = Date.parse(disk.updatedAt ?? '')
  const b = Date.parse(upstream.updatedAt ?? '')
  return Number.isFinite(a) && Number.isFinite(b) && a > b
}

function readTimelineStrict(ctx: NodeExecuteContext): SemanticTimeline | null {
  const upstream = ctx.inputs.in?.[0]
  if (upstream && upstream.kind === 'semanticTimeline') {
    const doc = upstream.doc
    if (!doc || typeof doc !== 'object' || !doc.source || !Array.isArray(doc.entities)) {
      throw new Error(
        isEn(ctx) ? 'Upstream is not a semantic timeline document' : '上游不是语义时间线文档' // cjk-ok
      )
    }
    const migrated = migrateSemanticTimeline(doc)
    const check = validateSemanticTimeline(migrated)
    if (!check.ok) {
      ctx.log?.(
        (isEn(ctx) ? 'Semantic timeline schema warnings: ' : '语义时间线 schema 告警：') + // cjk-ok
          check.issues.map((i) => `${i.path} ${i.message}`).join('; '),
        'warn'
      )
    }
    return migrated
  }
  const raw = readTimelineJson(ctx)
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(isEn(ctx) ? 'Timeline input is not valid JSON' : '时间线输入不是合法 JSON') // cjk-ok
  }
  const doc = parsed as SemanticTimeline
  if (!doc || typeof doc !== 'object' || !doc.source || !Array.isArray(doc.entities)) {
    throw new Error(
      isEn(ctx) ? 'Input is not a semantic timeline document' : '输入不是语义时间线文档' // cjk-ok
    )
  }
  return migrateSemanticTimeline(doc)
}

async function readTimeline(ctx: NodeExecuteContext): Promise<SemanticTimeline | null> {
  const doc = readTimelineStrict(ctx)
  if (!doc) {
    const paramId = String(ctx.node.params?.semanticTimelineId || '').trim()
    if (paramId.startsWith('stl.') && ctx.loadSemanticTimeline) {
      const fromParamId = await ctx.loadSemanticTimeline(paramId).catch(() => null)
      if (fromParamId) return migrateSemanticTimeline(fromParamId)
    }
    return null
  }
  if (!ctx.loadSemanticTimeline) return doc
  const id = typeof doc.id === 'string' ? doc.id.trim() : ''
  if (!id.startsWith('stl.')) return doc

  if ((doc.shots?.length ?? 0) > 0) {
    try {
      const loaded = await ctx.loadSemanticTimeline(id)
      if (loaded && isNewerTimeline(loaded, doc)) {
        say(
          ctx,
          `使用磁盘上更新过的时间线（${loaded.edits?.length ?? 0} 处修改）`, // cjk-ok
          `Using the updated timeline on disk (${loaded.edits?.length ?? 0} edit(s))`
        )
        return migrateSemanticTimeline(loaded)
      }
    } catch {
      /* fallback to upstream */
    }
    return doc
  }

  try {
    const loaded = await ctx.loadSemanticTimeline(id)
    if (loaded && (loaded.shots?.length ?? 0) > 0) {
      say(
        ctx,
        `上游时间线是空骨架（${id}），已按 id 从磁盘恢复 ${loaded.shots?.length ?? 0} 个镜头`, // cjk-ok
        `Upstream timeline was an empty skeleton (${id}); restored ${loaded.shots?.length ?? 0} shots from disk`,
        'warn'
      )
      return migrateSemanticTimeline(loaded)
    }
  } catch (e) {
    ctx.log?.(`按 id 读取时间线失败：${errorText(e)}`, 'warn') // cjk-ok
  }
  return doc
}

interface ShotContext {
  shots: ShotEvidence[]
  utterances: UtteranceEvidence[]
  sourceRelativePath?: string
  real: boolean
}

async function loadShotContext(
  ctx: NodeExecuteContext,
  timeline: SemanticTimeline
): Promise<ShotContext> {
  if (ctx.loadSemanticEvidence && timeline.id) {
    try {
      const ev = await ctx.loadSemanticEvidence(timeline.id)
      if (ev.shots.length > 0) {
        return {
          shots: ev.shots,
          utterances: ev.utterances,
          sourceRelativePath: ev.sourceRelativePath,
          real: true
        }
      }
    } catch (e) {
      say(
        ctx,
        `读取镜头证据失败：${errorText(e)}`, // cjk-ok
        `Failed to load shot evidence: ${errorText(e)}`,
        'warn'
      )
    }
  }
  const fromParam = parseJsonParam<ShotEvidence[]>(ctx.node.params?.shotsJson, []).filter(
    (s) => s?.id && s.range
  )
  return {
    shots:
      fromParam.length > 0 ? fromParam : singleShot(timeline.source.duration, timeline.source.fps),
    utterances: [],
    real: fromParam.length > 0
  }
}

function sourceRelativeFromAssetId(assetId: string | undefined): string {
  if (!assetId) return ''
  return assetId.startsWith('path:') ? assetId.slice(5).trim() : ''
}

// ─── 视频重制（semantic.rebuild） ─────────────────────────────────────────────

async function generateClipVideo(
  ctx: NodeExecuteContext,
  request: Omit<GenerateVideoRequest, 'duration'>,
  duration: number
): Promise<GenerateVideoResult> {
  try {
    return await ctx.generateVideo!({ ...request, duration })
  } catch (e) {
    const supported = supportedDurationsFromError(errorText(e))
    const retry = supported.length ? pickGenerateDuration(duration, supported) : undefined
    if (retry == null || retry === duration) throw e
    say(
      ctx,
      `${request.name ?? '单元'}：模型不接受 ${duration}s，改用 ${retry}s 重试一次`, // cjk-ok
      `${request.name ?? 'unit'}: ${duration}s rejected by the model, retrying with ${retry}s`,
      'warn'
    )
    return await ctx.generateVideo!({ ...request, duration: retry })
  }
}

function pickGenerateDuration(shotSec: number, durations: number[] | undefined): number {
  const want = Math.max(1, Math.ceil(shotSec - 1e-6))
  const options = (durations ?? []).filter((d) => Number.isFinite(d) && d > 0).sort((a, b) => a - b)
  if (options.length === 0) return want
  return options.find((d) => d >= shotSec - 1e-6) ?? options[options.length - 1]!
}

interface FirstFrameEditResult {
  firstFrameRelativePath?: string
  redraws: number
  replacedNames: string[]
  failure?: string
}

async function readReferenceUrl(
  ctx: NodeExecuteContext,
  ref: EntityReplacementRef
): Promise<string | undefined> {
  if (ref.assetId) return ctx.resolveAssetImageUrl?.(ref.assetId).catch(() => undefined)
  if (ref.relativePath)
    return ctx.readProjectImageDataUrl?.(ref.relativePath).catch(() => undefined)
  return undefined
}

async function editFirstFrameForReplacements(
  ctx: NodeExecuteContext,
  input: {
    timelineId: string
    clipKey: string
    replacements: ShotReplacement[]
    imageModel?: string
    imageProviderInstanceId?: string
  }
): Promise<FirstFrameEditResult> {
  const masked = input.replacements.filter((r) => r.mask)
  const empty: FirstFrameEditResult = { redraws: 0, replacedNames: [] }
  if (masked.length === 0) return empty
  if (
    !ctx.generateImage ||
    !ctx.composeImageRedrawCanvas ||
    !ctx.composeEntityMask ||
    !ctx.readProjectImageDataUrl ||
    !ctx.saveRunMedia
  ) {
    return { ...empty, failure: 'no image redraw capability here' }
  }
  const keyframe = masked[0]!.mask!.keyframeRelativePath
  let current = await ctx.readProjectImageDataUrl(keyframe).catch(() => undefined)
  if (!current) return { ...empty, failure: `cannot read keyframe ${keyframe}` }
  if (masked.some((r) => r.mask!.keyframeRelativePath !== keyframe)) {
    say(
      ctx,
      `${input.clipKey}：各实体的目标点选在不同关键帧上，统一以 ${keyframe} 为底图`, // cjk-ok
      `${input.clipKey}: targets were picked on different keyframes; using ${keyframe}`,
      'warn'
    )
  }

  const protect: string[] = []
  let lastRel: string | undefined
  const replacedNames: string[] = []
  for (const [i, r] of masked.entries()) {
    if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      const rawMask = await ctx.readProjectImageDataUrl(r.mask!.maskRelativePath)
      if (!rawMask) throw new Error(`cannot read mask ${r.mask!.maskRelativePath}`)
      const effective = await ctx.composeEntityMask({
        maskDataUrl: rawMask,
        protectMaskDataUrls: [...protect]
      })
      if (effective.coverage <= 0) {
        say(
          ctx,
          `${input.clipKey}：${r.entityName} 的目标区域被前面已替换的实体完全覆盖，跳过`, // cjk-ok
          `${input.clipKey}: ${r.entityName} is fully covered by earlier replacements; skipped`,
          'warn'
        )
        continue
      }
      if (effective.protectedRatio > MASK_OVERLAP_WARN_RATIO) {
        say(
          ctx,
          `${input.clipKey}：${r.entityName} 与前面的实体重叠 ${Math.round(effective.protectedRatio * 100)}%，重叠处保留前一个的结果`, // cjk-ok
          `${input.clipKey}: ${r.entityName} overlaps earlier replacements by ${Math.round(effective.protectedRatio * 100)}%; overlap keeps the earlier result`,
          'warn'
        )
      }
      const composed = await ctx.composeImageRedrawCanvas({
        sourceDataUrl: current,
        state: normalizeImageRedraw({ maskDataUrl: effective.dataUrl, aspectId: 'original' })
      })
      const refUrls: string[] = []
      for (const ref of r.references) {
        const url = await readReferenceUrl(ctx, ref)
        if (url) refUrls.push(url)
      }
      const res = await ctx.generateImage({
        prompt: buildEntityRedrawPrompt({
          entityName: r.entityName,
          instruction: r.instruction,
          referenceCount: refUrls.length
        }),
        model: input.imageModel,
        providerInstanceId: input.imageProviderInstanceId,
        quality: 'high',
        n: 1,
        inputReferences: [composed.dataUrl, composed.maskDataUrl ?? effective.dataUrl, ...refUrls]
      })
      const image = res.images[0]
      if (!image) throw new Error('image model returned no image')
      lastRel = await ctx.saveRunMedia({
        dataUrl: image,
        key: `replace-${input.clipKey}-${i + 1}`,
        outputDir: `Semantic/${input.timelineId}/replace`,
        node: ctx.node
      })
      const next = await ctx.readProjectImageDataUrl(lastRel)
      if (!next) throw new Error(`cannot read redrawn frame ${lastRel}`)
      current = next
      protect.push(rawMask)
      replacedNames.push(r.entityName)
      say(
        ctx,
        `${input.clipKey}：首帧替换 ${r.entityName}（${i + 1}/${masked.length}）`, // cjk-ok
        `${input.clipKey}: replaced ${r.entityName} in the first frame (${i + 1}/${masked.length})`
      )
    } catch (e) {
      return {
        redraws: replacedNames.length,
        replacedNames,
        failure: `${r.entityName}: ${errorText(e)}`
      }
    }
  }
  return lastRel
    ? { firstFrameRelativePath: lastRel, redraws: replacedNames.length, replacedNames }
    : empty
}

/** 按 `@图片1..k` 标签挑出当前单元引用的参考图；未写具体标签时在换品仿拍/锚点模式下带全部上游参考图 */
function pickUpstreamRefsForUnit(
  upstreamRefUrls: string[],
  referenceTags: string[],
  includeAllFallback: boolean
): string[] {
  if (upstreamRefUrls.length === 0) return []
  const picked: string[] = []
  for (const tag of referenceTags) {
    const m = /^@图片(\d+)$/.exec(tag.trim()) // cjk-ok
    if (!m) continue
    const idx = Number(m[1]) - 1
    const url = upstreamRefUrls[idx]
    if (url && !picked.includes(url)) picked.push(url)
  }
  if (picked.length > 0) return picked
  return includeAllFallback ? [...upstreamRefUrls] : []
}

function strategyLabelZh(strategy: RemakeStrategy): string {
  if (strategy === 'fidelity') return '1:1 分流复刻' // cjk-ok
  if (strategy === 'adapt') return '换品仿拍' // cjk-ok
  return '局部改片' // cjk-ok
}

function writeRebuildReport(
  ctx: NodeExecuteContext,
  report: Record<string, unknown>,
  options: {
    outputRelativePath?: string
    compareRelativePath?: string
    clearOnlyShotIds?: boolean
    unitCacheJson?: string
  } = {}
): void {
  ctx.patchNode?.({
    params: {
      rebuildLastReport: JSON.stringify(report, null, 2),
      ...(options.outputRelativePath
        ? {
            rebuildLastOutput: options.outputRelativePath,
            previewRelativePath: options.outputRelativePath
          }
        : {}),
      ...(options.compareRelativePath ? { rebuildLastCompare: options.compareRelativePath } : {}),
      ...(options.clearOnlyShotIds ? { rebuildOnlyShotIds: '' } : {}),
      ...(options.unitCacheJson !== undefined
        ? { rebuildUnitCacheJson: options.unitCacheJson }
        : {})
    }
  })
}

function buildOverlayCleanPrompt(boxes: OverlayNormalizedBox[], lang: 'zh' | 'en'): string {
  const regionDesc = boxes
    .slice(0, 6)
    .map(
      (b) =>
        `(${Math.round(b.x * 100)}%,${Math.round(b.y * 100)}%,${Math.round(b.w * 100)}%x${Math.round(b.h * 100)}%)`
    )
    .join(', ')
  if (lang === 'en') {
    return `Clean-plate frame restoration: remove ONLY burned-in subtitles, pop-art text banners, labels, counters, and stickers in regions [${regionDesc}], naturally inpainting the occluded background and subject. Keep camera framing, lighting, scene layout, and subject identity 100% identical to image 1. Output a clean frame with no text or watermarks.`
  }
  return `首帧去字清底修复：仅擦除参考图1中归一化区域 [${regionDesc}] 内的烧录字幕、花字条幅、角标与贴纸，自然补全被遮挡的背景与人物服饰纹理；严格保持原镜头的景别构图、机位透视、光影与主体身份完全不变，输出无任何文字与水印的干净底图。` // cjk-ok
}

async function cleanFirstFrameIfNeeded(
  ctx: NodeExecuteContext,
  input: {
    enabled: boolean
    timelineId: string
    clipKey: string
    firstFrameRel: string | undefined
    overlayBoxes: OverlayNormalizedBox[] | undefined
    imageModel?: string
    imageProviderInstanceId?: string
    lang: 'zh' | 'en'
    cache: Map<string, string>
    cleanedOut: Map<string, string>
    notes: string[]
  }
): Promise<string | undefined> {
  const { enabled, firstFrameRel, overlayBoxes } = input
  if (!enabled || !firstFrameRel || !overlayBoxes?.length) return firstFrameRel
  if (!ctx.generateImage || !ctx.readProjectImageDataUrl || !ctx.saveRunMedia) return firstFrameRel

  const cacheKey = `${firstFrameRel}|${stableStringify(overlayBoxes)}`
  const hit = input.cache.get(cacheKey)
  if (hit) {
    input.cleanedOut.set(input.clipKey, hit)
    return hit
  }

  try {
    const srcDataUrl = await ctx.readProjectImageDataUrl(firstFrameRel)
    if (!srcDataUrl) return firstFrameRel
    const res = await ctx.generateImage({
      prompt: buildOverlayCleanPrompt(overlayBoxes, input.lang),
      model: input.imageModel,
      providerInstanceId: input.imageProviderInstanceId,
      quality: 'high',
      n: 1,
      inputReferences: [srcDataUrl]
    })
    const outImg = res.images[0]
    if (!outImg) return firstFrameRel
    const savedRel = await ctx.saveRunMedia({
      dataUrl: outImg,
      key: `clean-${input.clipKey}`,
      outputDir: `Semantic/${input.timelineId}/clean`,
      node: ctx.node
    })
    input.cache.set(cacheKey, savedRel)
    input.cleanedOut.set(input.clipKey, savedRel)
    say(
      ctx,
      `${input.clipKey}：已擦除首帧烧录花字/字幕（${overlayBoxes.length} 处）`, // cjk-ok
      `${input.clipKey}: stripped ${overlayBoxes.length} burned-in overlay box(es) from first frame`
    )
    return savedRel
  } catch (e) {
    input.notes.push(`${input.clipKey} 首帧去字清底失败，保留原关键帧：${errorText(e)}`) // cjk-ok
    return firstFrameRel
  }
}

function groupUnitsIntoDependencyWaves(units: RemakeUnitTask[]): RemakeUnitTask[][] {
  if (units.length <= 1) return units.length ? [units] : []
  const unitKeys = new Set(units.map((u) => u.key))
  const placed = new Set<string>()
  const waves: RemakeUnitTask[][] = []
  let remaining = [...units]
  while (remaining.length > 0) {
    const wave: RemakeUnitTask[] = []
    const nextRemaining: RemakeUnitTask[] = []
    for (const u of remaining) {
      const dep = u.chainFromUnitKey
      if (!dep || !unitKeys.has(dep) || placed.has(dep)) {
        wave.push(u)
      } else {
        nextRemaining.push(u)
      }
    }
    if (wave.length === 0) {
      wave.push(nextRemaining.shift()!)
    }
    for (const u of wave) placed.add(u.key)
    waves.push(wave)
    remaining = nextRemaining
  }
  return waves
}

function normalizeTimelineMediaRel(timelineId: string, rel: string | undefined | null): string {
  const trimmed = (rel ?? '').trim().replace(/\\/g, '/')
  if (!trimmed) return ''
  if (trimmed.startsWith('Semantic/')) return trimmed
  if (trimmed.startsWith('evidence/')) return `Semantic/${timelineId}/${trimmed}`
  return trimmed
}

/**
 * 视频重制：直接消费 `SemanticTimeline` 四轴拆解与复刻规划文档 + 可选多连参考图（`in-images`），
 * 按 `G1..Gk` 生成单元批量调 AI 视频并按比例切片对齐，`K1..Kk` 走本地 FFmpeg 零成本渲染，
 * 保护真实录屏/电影片段直通，并自动同步导出原片与复刻并排对比 `compare.mp4`。
 */
export async function executeSemanticRebuildNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const p = ctx.node.params ?? {}
  const lang: 'zh' | 'en' = isEn(ctx) ? 'en' : 'zh'
  let timeline = await readTimeline(ctx)
  if (!timeline) {
    say(
      ctx,
      '没有收到语义时间线 —— 上游请接「视频拆解」', // cjk-ok
      'No semantic timeline on the input — connect the Video breakdown node upstream',
      'warn'
    )
    return {}
  }

  const shotCtx = await loadShotContext(ctx, timeline)
  if (shotCtx.real && (!timeline.shots || timeline.shots.length === 0)) {
    timeline = ensureSemanticStructure(timeline, {
      shots: shotCtx.shots,
      utterances: shotCtx.utterances
    })
  }
  if (!timeline.breakdown) {
    timeline = finalizeSemanticBreakdown(timeline, { lang })
  }

  if ((timeline.shots?.length ?? 0) === 0) {
    say(
      ctx,
      '上游语义时间线没有镜头结构 —— 请先运行上游「视频拆解」节点', // cjk-ok
      'The upstream semantic timeline has no shots — run the upstream Video breakdown node first',
      'warn'
    )
  }

  const sourceRelativePath =
    String(p.sourceRelativePath || '').trim() ||
    shotCtx.sourceRelativePath ||
    sourceRelativeFromAssetId(timeline.source.assetId)
  const strategy: RemakeStrategy =
    p.remakeStrategy === 'fidelity' || p.remakeStrategy === 'adapt' ? p.remakeStrategy : 'edit'
  const generateAnchors = p.rebuildGenerateAnchors === true
  const cleanOverlaysEnabled = p.rebuildCleanOverlays !== false
  const useUnitCache = p.rebuildUseCache !== false
  const onlyShotIds = parseOnlyShotIds(p.rebuildOnlyShotIds)
  const maxUnits = Number(p.rebuildMaxShots) || MAX_REBUILD_UNITS
  const instruction = String(p.generateInstruction || '').trim()
  const dubEnabled = p.rebuildDub !== false
  const dubVoiceParam = String(p.dubVoice || '').trim() || undefined
  const execute = p.semanticExecute !== false

  const model = String(p.generateModel || '').trim() || undefined
  const providerInstanceId = String(p.generateProviderInstanceId || '').trim() || undefined
  const fixedDuration = Number(p.rebuildDurationSec) || 0
  let caps: VideoGenerateParamCapabilities | null = null
  let portLimits: VideoGeneratePortLimits | null = null
  if (execute && ctx.resolveVideoGenerateCapabilities) {
    try {
      const resolvedCaps = await ctx.resolveVideoGenerateCapabilities({
        model,
        providerInstanceId
      })
      caps = resolvedCaps?.params ?? null
      portLimits = resolvedCaps?.portLimits ?? null
    } catch {
      caps = null
      portLimits = null
    }
  }
  const maxCapDur =
    fixedDuration > 0
      ? fixedDuration
      : caps?.durations?.length
        ? Math.max(...caps.durations.filter((d) => Number.isFinite(d) && d > 0))
        : 0
  const explicitMultiShot = (p as { rebuildAllowMultiShot?: boolean }).rebuildAllowMultiShot
  const allowMultiShot = explicitMultiShot !== false && (maxCapDur === 0 || maxCapDur >= 6)

  const diff = timeline.shots?.length ? diffAgainstBaseline(timeline) : undefined
  const planned = planRemakeExecution(timeline, {
    strategy,
    instruction,
    maxUnits,
    ...(onlyShotIds.length ? { onlyShotIds } : {}),
    dubVoice: dubVoiceParam,
    allowMultiShot,
    ...(maxCapDur > 0 ? { maxUnitDurationSec: maxCapDur } : {}),
    lang
  })
  const dubs = dubEnabled ? planned.dubs : []
  const localPlanned = planned.localClips
  const notes: string[] = []

  if (planned.skippedByLimit > 0) {
    notes.push(
      planned.passthroughShots > 0
        ? `超过单次单元上限（${maxUnits}），已跳过 ${planned.skippedByLimit} 镜的生成（改用原片段）` // cjk-ok
        : `超过单次单元上限（${maxUnits}），已跳过 ${planned.skippedByLimit} 镜` // cjk-ok
    )
  }

  const modelLabel = String(p.generateModel || '').trim()
  say(
    ctx,
    `视频重制（${onlyShotIds.length ? `单镜重跑 ${onlyShotIds.join(',')}` : strategyLabelZh(strategy)}）：AI 单元 ${planned.units.length} 个（覆盖 ${planned.generatedShots} 镜）${localPlanned.length ? ` · 本地零成本动效 ${localPlanned.length} 镜` : ''} · 直通原片 ${planned.passthroughShots} 镜 · 配音 ${dubs.length} 句 · 模型 ${modelLabel || '默认'}`, // cjk-ok
    `Video remake (${onlyShotIds.length ? `rerun ${onlyShotIds.join(',')}` : strategy}): ${planned.units.length} AI unit(s) (${planned.generatedShots} shot(s))${localPlanned.length ? ` · ${localPlanned.length} zero-cost local motion` : ''} · ${planned.passthroughShots} passthrough · ${dubs.length} re-dubbed`
  )
  for (const note of notes) say(ctx, note, note, 'warn')
  const loggedNotes = notes.length

  const activeShotsCount = (timeline.shots ?? []).filter((s) => !s.removed).length
  const baseReport = {
    timelineId: timeline.id,
    strategy,
    generateAnchors,
    ...(onlyShotIds.length ? { onlyShotIds } : {}),
    shots: activeShotsCount,
    units: planned.units.map((u) => ({
      id: u.unitId,
      key: u.key,
      shots: u.shotSlices.map((s) => s.shotId),
      durationSec: u.durationSec,
      conditioningMode: u.conditioningMode,
      ...(u.executor ? { executor: u.executor } : {}),
      ...(u.chainFromUnitKey ? { chainFromUnitKey: u.chainFromUnitKey } : {})
    })),
    generate: planned.units.map((u) => u.key),
    generatedShots: planned.generatedShots,
    ...(localPlanned.length
      ? {
          localMotion: localPlanned.map((c) => c.key),
          localRendered: localPlanned.map((c) => c.key)
        }
      : {}),
    ...(planned.protectedRealMaterial
      ? { protectedRealMaterial: planned.protectedRealMaterial }
      : {}),
    passthrough: planned.segments.filter((s) => s.kind === 'source').map((s) => s.key),
    removed: diff ? [...diff.removedShots] : [],
    dubs: dubs.map((d) => ({ id: d.id, text: d.text, sourceText: d.sourceText })),
    skippedByLimit: planned.skippedByLimit,
    notes
  }

  if (!execute || planned.segments.length === 0) {
    if (planned.segments.length === 0) {
      say(ctx, '没有可拼接的镜头，未出片', 'Nothing to rebuild', 'warn') // cjk-ok
    }
    writeRebuildReport(
      ctx,
      { ...baseReport, execute: false },
      { clearOnlyShotIds: onlyShotIds.length > 0 }
    )
    return {}
  }
  if (planned.units.length > 0 && !ctx.generateVideo) {
    throw new Error(
      isEn(ctx)
        ? 'This environment has no video generation capability'
        : '当前执行环境没有视频生成能力' // cjk-ok
    )
  }
  if (!ctx.rebuildSemanticVideo) {
    throw new Error(
      isEn(ctx)
        ? 'This environment cannot assemble the rebuilt video'
        : '当前执行环境没有成片拼接能力' // cjk-ok
    )
  }

  const clamped = resolveVideoGenerateParamsForApi(
    {
      generateResolution:
        String(p.generateResolution || p.rebuildResolution || '').trim() || undefined,
      generateAspectRatio:
        String(p.generateAspectRatio || p.rebuildAspectRatio || '').trim() || undefined,
      ...(typeof p.generateSeed === 'number' ? { generateSeed: p.generateSeed } : {}),
      ...(typeof p.generateSeedUseGlobal === 'boolean'
        ? { generateSeedUseGlobal: p.generateSeedUseGlobal }
        : {})
    },
    caps
  )
  const frameSupport = caps?.supportedFrameImages ?? []
  const firstFrameAllowed = frameSupport.length === 0 || frameSupport.includes('first_frame')
  const lastFrameAllowed = frameSupport.includes('last_frame')
  if (!firstFrameAllowed && planned.units.some((u) => u.firstFrameRelativePath)) {
    say(
      ctx,
      '所选视频模型不支持首帧，改为文生视频（构图可能与原片不一致）', // cjk-ok
      'The selected video model has no first-frame input; using text-to-video',
      'warn'
    )
  }

  const supportsAudioRef = isSeedanceVideoModel(model) || (portLimits?.maxVoices ?? 0) > 0
  const supportsVideoRef = isSeedanceVideoModel(model) || (portLimits?.maxVideos ?? 0) > 0
  const imageModel = String(p.replaceImageModel || '').trim() || undefined
  const imageProviderInstanceId = String(p.replaceImageProviderInstanceId || '').trim() || undefined
  const upstreamRefUrls = await resolveUpstreamReferenceImageUrls(ctx)

  // ── 先执行 TTS 配音合成：使数字人 `avatar_tts` 单元可直接用新台词音频驱动口型生成 ──
  const dubbed: SemanticRebuildDub[] = []
  if (dubs.length > 0) {
    if (!ctx.generateSpeech) {
      notes.push('当前环境没有语音合成能力，改过的台词只更新字幕') // cjk-ok
    } else {
      const clone = p.rebuildDubClone !== false
      for (const line of dubs) {
        if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        const voice = line.voice || dubVoiceParam
        try {
          const res = await ctx.generateSpeech({
            input: line.text,
            model: String(p.dubModel || '').trim() || undefined,
            providerInstanceId: String(p.dubProviderInstanceId || '').trim() || undefined,
            ...(voice ? { voice } : {}),
            ...(!voice && clone && line.referenceAudio
              ? { referenceAudio: line.referenceAudio }
              : {}),
            name: `dub-${line.id}`
          })
          if (!res.relativePath) throw new Error('no audio file')
          dubbed.push({
            id: line.id,
            relativePath: res.relativePath,
            sourceStartSec: line.sourceStartSec,
            sourceEndSec: line.sourceEndSec
          })
          say(ctx, `配音 ${line.id}：${line.text}`, `Dubbed ${line.id}: ${line.text}`) // cjk-ok
        } catch (e) {
          const reason = errorText(e)
          notes.push(`${line.id} 配音失败，保留原声：${reason}`) // cjk-ok
        }
      }
    }
  }

  for (const unit of planned.units) {
    const reps = unit.replacements ?? []
    if (!reps.length) continue
    const masked = reps.filter((r) => r.mask).length
    say(
      ctx,
      `${unit.key}：替换 ${reps.map((r) => r.entityName).join('、')} · ${masked} 次首帧重绘 + 1 次视频生成`, // cjk-ok
      `${unit.key}: replacing ${reps.map((r) => r.entityName).join(', ')} · ${masked} first-frame redraw(s) + 1 video generation`
    )
    if (reps.length > SOFT_MAX_REPLACEMENTS_PER_SHOT) {
      notes.push(
        `${unit.key} 同时替换 ${reps.length} 个实体，超过 ${SOFT_MAX_REPLACEMENTS_PER_SHOT} 个时效果可能不稳定，建议拆镜或分次处理` // cjk-ok
      )
    }
    for (const pair of overlappingReplacements(reps)) {
      notes.push(
        `${unit.key}：${pair.a} 与 ${pair.b} 的目标区域重叠约 ${Math.round(pair.ratio * 100)}%，重叠处以先处理的实体为准` // cjk-ok
      )
    }
    const unmasked = reps.filter((r) => !r.mask).map((r) => r.entityName)
    if (masked > 0 && unmasked.length) {
      notes.push(
        `${unit.key}：${unmasked.join('、')} 在这一单元没有点选目标，本单元不会掩码重绘它们` // cjk-ok
      )
    }
  }

  const priorUnitCache = parseJsonParam<Record<string, string>>(p.rebuildUnitCacheJson, {})
  const nextUnitCache: Record<string, string> = onlyShotIds.length > 0 ? { ...priorUnitCache } : {}
  const cacheHits: string[] = []
  const cleanFrameCache = new Map<string, string>()
  const cleanedFrames = new Map<string, string>()
  const replaceReport: Record<string, { redraws: number; mode: string; failure?: string }> = {}
  const generated = new Map<string, string>()
  const anchorGenerated = new Map<string, string>()
  const failures: Array<{ key: string; reason: string }> = []
  const unitByKey = new Map(planned.units.map((u) => [u.key, u]))

  const rawConcurrency = Number((p as { rebuildConcurrency?: number }).rebuildConcurrency)
  const concurrency =
    Number.isFinite(rawConcurrency) && rawConcurrency >= 1
      ? Math.min(4, Math.floor(rawConcurrency))
      : ctx.resolveVideoGenerateCapabilities
        ? 2
        : 1

  const waves = groupUnitsIntoDependencyWaves(planned.units)

  for (const wave of waves) {
    if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const preparedTasks: Array<{
      unit: RemakeUnitTask
      fingerprint: string
      duration: number
      request: Omit<GenerateVideoRequest, 'duration'>
    }> = []

    for (const unit of wave) {
      if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const replacements = unit.replacements ?? []
      let prompt = unit.videoPrompt
      const duration = fixedDuration || pickGenerateDuration(unit.durationSec, caps?.durations)

      const unitStart = unit.sourceRange?.start ?? 0
      const unitEnd = unit.sourceRange?.end ?? unitStart + unit.durationSec
      const overlappingDub =
        unit.executor === 'avatar_tts'
          ? dubbed.find(
              (d) => d.sourceStartSec < unitEnd - 0.05 && d.sourceEndSec > unitStart + 0.05
            )
          : undefined
      const fallbackVocalsRel =
        unit.executor === 'avatar_tts' &&
        !overlappingDub &&
        strategy !== 'edit' &&
        unitStart <= 0.25 &&
        timeline.evidence?.stems?.vocals
          ? normalizeTimelineMediaRel(timeline.id, timeline.evidence.stems.vocals)
          : ''
      const localizedAudioRel = overlappingDub?.relativePath ?? (fallbackVocalsRel || undefined)

      // 先计算确定性单元指纹：未改动且缓存启用时零 API 调用复用上次落盘产物
      const fingerprint = shortHash(
        stableStringify({
          key: unit.key,
          prompt: unit.videoPrompt,
          imgPrompt: unit.imagePrompt,
          dur: duration,
          res: clamped.resolution ?? '',
          ar: clamped.aspectRatio ?? '',
          seed: clamped.seed ?? '',
          mode: unit.conditioningMode,
          exec: unit.executor ?? '',
          chain: unit.chainFromUnitKey ?? '',
          model: model ?? '',
          imgModel: imageModel ?? '',
          first: unit.firstFrameRelativePath ?? '',
          last: unit.lastFrameRelativePath ?? '',
          overlays: cleanOverlaysEnabled ? (unit.overlayBoxes ?? []) : [],
          anchors: generateAnchors,
          strategy,
          upRefs: upstreamRefUrls,
          reps: replacements,
          audio: supportsAudioRef ? (localizedAudioRel ?? '') : '',
          vidRef:
            supportsVideoRef && unit.conditioningMode === 'reference_video'
              ? sourceRelativePath
              : ''
        }),
        16
      )

      if (useUnitCache && onlyShotIds.length === 0 && priorUnitCache[fingerprint]) {
        const cachedRel = priorUnitCache[fingerprint]!
        generated.set(unit.key, cachedRel)
        nextUnitCache[fingerprint] = cachedRel
        cacheHits.push(unit.key)
        say(
          ctx,
          `复用缓存 ${unit.key} → ${cachedRel}`, // cjk-ok
          `Reused cached ${unit.key} → ${cachedRel}`
        )
        continue
      }

      // ① 掩码实体局部替换：逐实体重绘首帧 → 图生视频
      let edited: FirstFrameEditResult = { redraws: 0, replacedNames: [] }
      if (replacements.some((r) => r.mask)) {
        if (!firstFrameAllowed) {
          edited.failure = 'video model has no first-frame input'
        } else {
          edited = await editFirstFrameForReplacements(ctx, {
            timelineId: timeline.id,
            clipKey: unit.key,
            replacements,
            imageModel,
            imageProviderInstanceId
          })
        }
        if (edited.failure) {
          notes.push(
            `${unit.key} 首帧局部替换失败，改用参考图生视频（构图可能与原片不一致）：${edited.failure}` // cjk-ok
          )
        }
      }

      // ② 收集实体替换参考图 + 上游 `in-images` 参考图（`@图片1..k`）
      const referenceUrls: string[] = []
      if (!edited.firstFrameRelativePath) {
        const groups: Array<{ name: string; count: number }> = []
        for (const r of replacements) {
          let count = 0
          for (const ref of r.references) {
            const url = await readReferenceUrl(ctx, ref)
            if (url) {
              referenceUrls.push(url)
              count += 1
            } else {
              notes.push(`${unit.key} 的 ${r.entityName} 参考图读不到，已忽略`) // cjk-ok
            }
          }
          groups.push({ name: r.entityName, count })
        }
        const upstreamUnitRefs = pickUpstreamRefsForUnit(
          upstreamRefUrls,
          unit.referenceTags,
          strategy === 'adapt' || generateAnchors
        )
        for (const u of upstreamUnitRefs) {
          if (!referenceUrls.includes(u)) referenceUrls.push(u)
        }
        const legend = referenceLegend(groups, lang)
        if (legend) prompt = `${prompt}${lang === 'zh' ? '。' : '. '}${legend}`
      } else {
        const note = replacementVideoNote(edited.replacedNames, lang)
        if (note) prompt = `${prompt}${lang === 'zh' ? '。' : '. '}${note}`
      }

      const willSynthesizeAnchor = Boolean(
        !edited.firstFrameRelativePath &&
        firstFrameAllowed &&
        ctx.generateImage &&
        ctx.saveRunMedia &&
        unit.imagePrompt?.trim() &&
        (generateAnchors || (strategy === 'adapt' && referenceUrls.length > 0))
      )

      // ②.5 首帧烧录字幕/花字清底（避免脏字幕进 I2V 被画面糊化，后续由 ASS 字幕重新高清压制）
      let cleanedBaseFirstRel = unit.firstFrameRelativePath
      if (!edited.firstFrameRelativePath && !willSynthesizeAnchor && firstFrameAllowed) {
        cleanedBaseFirstRel = await cleanFirstFrameIfNeeded(ctx, {
          enabled: cleanOverlaysEnabled,
          timelineId: timeline.id,
          clipKey: unit.key,
          firstFrameRel: unit.firstFrameRelativePath,
          overlayBoxes: unit.overlayBoxes,
          imageModel,
          imageProviderInstanceId,
          lang,
          cache: cleanFrameCache,
          cleanedOut: cleanedFrames,
          notes
        })
      }

      // ③ 构图锁死首帧锚点合成（`adapt` 模式把原镜头首帧作参考图1锁死机位景别，参考图2..N 注入替换商品/主体身份）
      let synthesizedAnchorRel: string | undefined
      if (willSynthesizeAnchor && ctx.generateImage && ctx.saveRunMedia) {
        try {
          const baseFrameDataUrl =
            unit.firstFrameRelativePath && referenceUrls.length > 0 && ctx.readProjectImageDataUrl
              ? await ctx
                  .readProjectImageDataUrl(unit.firstFrameRelativePath)
                  .catch(() => undefined)
              : undefined
          const anchorPrompt = baseFrameDataUrl
            ? lang === 'en'
              ? `${unit.imagePrompt}. Composition lock: use image 1 strictly for framing, shot size, camera perspective, and scene layout (ignore any burned-in text/overlays or old product in image 1), and replace the subject/product identity with image 2${referenceUrls.length > 1 ? `..${referenceUrls.length + 1}` : ''}; output a clean frame with no text or watermarks.`
              : `${unit.imagePrompt}。构图与机位锁定：参考图1仅作为镜头构图、景别、透视机位与场景布局基准（忽略参考图1中的烧录字幕/花字与旧商品主体），将主体/商品替换为参考图2${referenceUrls.length > 1 ? `..${referenceUrls.length + 1}` : ''}中的外观身份，输出无文字无水印的干净首帧。` // cjk-ok
            : unit.imagePrompt
          const anchorInputRefs = baseFrameDataUrl
            ? [baseFrameDataUrl, ...referenceUrls]
            : referenceUrls
          const imgRes = await ctx.generateImage({
            prompt: anchorPrompt,
            model: imageModel,
            providerInstanceId: imageProviderInstanceId,
            quality: 'high',
            n: 1,
            ...(anchorInputRefs.length ? { inputReferences: anchorInputRefs } : {})
          })
          const firstImg = imgRes.images[0]
          if (firstImg) {
            synthesizedAnchorRel = await ctx.saveRunMedia({
              dataUrl: firstImg,
              key: `anchor-${unit.key}`,
              outputDir: `Semantic/${timeline.id}/anchors`,
              node: ctx.node
            })
            anchorGenerated.set(unit.key, synthesizedAnchorRel)
            say(
              ctx,
              `${unit.key}：已生成${baseFrameDataUrl ? '构图锁定' : ''}首帧锚点图`, // cjk-ok
              `${unit.key}: generated ${baseFrameDataUrl ? 'composition-locked ' : ''}anchor first frame`
            )
          }
        } catch (e) {
          notes.push(`${unit.key} 首帧锚点图生成失败，回退直接生成视频：${errorText(e)}`) // cjk-ok
        }
      }

      let firstFrameImageUrl: string | undefined
      let lastFrameImageUrl: string | undefined
      let chainedTailFrame = false
      const chosenFirstFrameRel =
        edited.firstFrameRelativePath ?? synthesizedAnchorRel ?? cleanedBaseFirstRel
      const videoRefUrls =
        edited.firstFrameRelativePath || synthesizedAnchorRel ? [] : referenceUrls

      // ③.5 跨单元尾帧接力（拆分长单元 `G1.1 -> G1.2`、缺首帧连续镜、或 `adapt` 连续同场镜）
      if (
        unit.chainFromUnitKey &&
        firstFrameAllowed &&
        !edited.firstFrameRelativePath &&
        !synthesizedAnchorRel &&
        ctx.resolveVideoFrameImageUrls
      ) {
        const prevRel = generated.get(unit.chainFromUnitKey)
        const prevUnit = unitByKey.get(unit.chainFromUnitKey)
        const sameSplitUnit = Boolean(unit.unitId && prevUnit?.unitId === unit.unitId)
        if (prevRel && (!chosenFirstFrameRel || sameSplitUnit || strategy === 'adapt')) {
          const sampled = await ctx
            .resolveVideoFrameImageUrls([{ relativePath: prevRel }], 4)
            .catch(() => [])
          const tailFrame = sampled[sampled.length - 1]
          if (tailFrame) {
            firstFrameImageUrl = tailFrame
            chainedTailFrame = true
          }
        }
      }

      const allowFirstAlongsideRefs =
        strategy === 'adapt' &&
        videoRefUrls.length > 0 &&
        (portLimits?.maxImages == null || portLimits.maxImages >= videoRefUrls.length + 1)

      if (
        !firstFrameImageUrl &&
        (videoRefUrls.length === 0 || allowFirstAlongsideRefs) &&
        firstFrameAllowed &&
        chosenFirstFrameRel &&
        ctx.resolveProjectMediaUrl
      ) {
        firstFrameImageUrl = await ctx
          .resolveProjectMediaUrl(chosenFirstFrameRel)
          .catch(() => undefined)
      }
      if (
        videoRefUrls.length === 0 &&
        !edited.firstFrameRelativePath &&
        !synthesizedAnchorRel &&
        !chainedTailFrame &&
        replacements.length === 0 &&
        unit.conditioningMode === 'first_last_frame' &&
        lastFrameAllowed &&
        firstFrameImageUrl &&
        unit.lastFrameRelativePath &&
        ctx.resolveProjectMediaUrl
      ) {
        lastFrameImageUrl = await ctx
          .resolveProjectMediaUrl(unit.lastFrameRelativePath)
          .catch(() => undefined)
      }

      if (replacements.length) {
        replaceReport[unit.key] = {
          redraws: edited.redraws,
          mode: edited.firstFrameRelativePath
            ? 'first-frame-edit'
            : synthesizedAnchorRel
              ? 'anchor-generate'
              : 'reference',
          ...(edited.failure ? { failure: edited.failure } : {})
        }
      }

      // ④ `avatar_tts` 口型音频驱动 或 `reference_video` 动作视频引导
      let useLipSync = false
      let lipSyncRefs: Array<{ kind: 'image_url' | 'audio_url'; url: string }> | undefined
      if (
        unit.executor === 'avatar_tts' &&
        supportsAudioRef &&
        localizedAudioRel &&
        ctx.resolveProjectMediaUrl
      ) {
        const audioUrl = await ctx.resolveProjectMediaUrl(localizedAudioRel).catch(() => undefined)
        const visualUrl =
          firstFrameImageUrl ||
          videoRefUrls[0] ||
          (chosenFirstFrameRel
            ? await ctx.resolveProjectMediaUrl(chosenFirstFrameRel).catch(() => undefined)
            : undefined)
        if (audioUrl && visualUrl) {
          useLipSync = true
          const userPrompt = buildLipSyncPrompt(prompt, ctx.locale, 'image')
          const sysPrompt = resolveLipSyncSystemPrompt(undefined, ctx.locale)
          prompt = sysPrompt.trim() ? `${sysPrompt.trim()}\n\n${userPrompt}` : userPrompt
          lipSyncRefs = [
            { kind: 'image_url', url: visualUrl },
            { kind: 'audio_url', url: audioUrl }
          ]
        }
      }

      let refVideoUrl: string | undefined
      if (
        !useLipSync &&
        unit.conditioningMode === 'reference_video' &&
        supportsVideoRef &&
        sourceRelativePath &&
        ctx.resolveProjectMediaUrl
      ) {
        refVideoUrl = await ctx.resolveProjectMediaUrl(sourceRelativePath).catch(() => undefined)
      }

      const combinedRefs: Array<{
        kind: 'image_url' | 'video_url' | 'audio_url'
        url: string
      }> =
        useLipSync && lipSyncRefs
          ? lipSyncRefs
          : [
              ...videoRefUrls.map((url) => ({ kind: 'image_url' as const, url })),
              ...(refVideoUrl ? [{ kind: 'video_url' as const, url: refVideoUrl }] : [])
            ]

      const shotCountNote =
        unit.shotSlices.length > 1
          ? lang === 'zh'
            ? ` · 合并 ${unit.shotSlices.length} 镜` // cjk-ok
            : ` · ${unit.shotSlices.length} shots batched`
          : ''
      const modeZh = useLipSync
        ? '（口型驱动生视频）' // cjk-ok
        : edited.firstFrameRelativePath
          ? '（首帧替换 + 图生视频）' // cjk-ok
          : synthesizedAnchorRel
            ? '（锚点生图 + 图生视频）' // cjk-ok
            : refVideoUrl
              ? '（参考视频动作引导）' // cjk-ok
              : videoRefUrls.length
                ? '（参考图生视频）' // cjk-ok
                : chainedTailFrame
                  ? '（尾帧接力图生视频）' // cjk-ok
                  : firstFrameImageUrl && lastFrameImageUrl
                    ? '（首尾帧图生视频）' // cjk-ok
                    : firstFrameImageUrl
                      ? '（图生视频）' // cjk-ok
                      : '（文生视频）' // cjk-ok
      const modeEn = useLipSync
        ? ' (lip-sync audio+image)'
        : edited.firstFrameRelativePath
          ? ' (first-frame replace + I2V)'
          : synthesizedAnchorRel
            ? ' (anchor image + I2V)'
            : refVideoUrl
              ? ' (reference-video motion)'
              : videoRefUrls.length
                ? ' (reference-to-video)'
                : chainedTailFrame
                  ? ' (tail-frame continuity I2V)'
                  : firstFrameImageUrl && lastFrameImageUrl
                    ? ' (first+last frame I2V)'
                    : firstFrameImageUrl
                      ? ' (image-to-video)'
                      : ' (text-to-video)'
      say(
        ctx,
        `生成 ${unit.key}${modeZh}${shotCountNote} · ${duration}s`, // cjk-ok
        `Generating ${unit.key}${modeEn}${shotCountNote} · ${duration}s`
      )

      preparedTasks.push({
        unit,
        fingerprint,
        duration,
        request: {
          prompt,
          model,
          providerInstanceId,
          ...(clamped.resolution ? { resolution: clamped.resolution } : {}),
          ...(clamped.aspectRatio ? { aspectRatio: clamped.aspectRatio } : {}),
          ...(typeof clamped.seed === 'number' ? { seed: clamped.seed } : {}),
          generateAudio: useLipSync,
          ...(!useLipSync && firstFrameImageUrl ? { firstFrameImageUrl } : {}),
          ...(!useLipSync && lastFrameImageUrl ? { lastFrameImageUrl } : {}),
          ...(combinedRefs.length ? { inputReferences: combinedRefs } : {}),
          name: `rebuild-${unit.key}`,
          graphBinding: { nodeId: ctx.node.id }
        }
      })
    }

    // 同一拓扑层内按有界并发派发视频生成，并按原顺序归档结果保证报告确定性
    const outcomes = new Array<{ ok: true; relativePath: string } | { ok: false; reason: string }>(
      preparedTasks.length
    )
    let cursor = 0
    const workerCount = Math.min(concurrency, preparedTasks.length)
    const workers = Array.from({ length: workerCount }, async () => {
      while (cursor < preparedTasks.length) {
        const idx = cursor
        cursor += 1
        const item = preparedTasks[idx]!
        if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        try {
          const res = await generateClipVideo(ctx, item.request, item.duration)
          outcomes[idx] = { ok: true, relativePath: res.relativePath }
        } catch (e) {
          outcomes[idx] = { ok: false, reason: errorText(e) }
        }
      }
    })
    await Promise.all(workers)

    for (let idx = 0; idx < preparedTasks.length; idx += 1) {
      const item = preparedTasks[idx]!
      const out = outcomes[idx]!
      if (out.ok) {
        generated.set(item.unit.key, out.relativePath)
        nextUnitCache[item.fingerprint] = out.relativePath
      } else {
        failures.push({ key: item.unit.key, reason: out.reason })
        say(
          ctx,
          `${item.unit.key} 生成失败：${out.reason}`, // cjk-ok
          `${item.unit.key} failed: ${out.reason}`,
          'warn'
        )
      }
    }
  }

  // ── 本地零成本镜头（`K1..Kk` Ken Burns / 静帧停留）：可选锚点重绘或去字清底后由主进程 FFmpeg 渲染 ──
  const localMotionClips: SemanticRebuildLocalMotionClip[] = []
  for (const lc of localPlanned) {
    if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    let anchorRel = lc.firstFrameRelativePath
    const reps = lc.replacements ?? []
    let maskedEdited = false
    if (reps.some((r) => r.mask)) {
      const edited = await editFirstFrameForReplacements(ctx, {
        timelineId: timeline.id,
        clipKey: lc.key,
        replacements: reps,
        imageModel,
        imageProviderInstanceId
      })
      if (edited.firstFrameRelativePath) {
        anchorRel = edited.firstFrameRelativePath
        maskedEdited = true
      } else if (edited.failure) {
        notes.push(`${lc.key} 静态锚点帧替换失败，使用原锚点帧：${edited.failure}`) // cjk-ok
      }
    }
    if (!maskedEdited && lc.overlayBoxes?.length) {
      anchorRel =
        (await cleanFirstFrameIfNeeded(ctx, {
          enabled: cleanOverlaysEnabled,
          timelineId: timeline.id,
          clipKey: lc.key,
          firstFrameRel: anchorRel,
          overlayBoxes: lc.overlayBoxes,
          imageModel,
          imageProviderInstanceId,
          lang,
          cache: cleanFrameCache,
          cleanedOut: cleanedFrames,
          notes
        })) ?? anchorRel
    }
    localMotionClips.push({
      key: lc.key,
      anchorImageRelativePath: anchorRel,
      durationSec: lc.durationSec,
      mode: lc.mode,
      zoomPerSec: lc.zoomPerSec,
      panPxPerSec: lc.panPxPerSec,
      panDirDeg: lc.panDirDeg
    })
  }
  const localMotionKeys = new Set(localMotionClips.map((c) => c.key))

  // 将生成的 `G1..Gk` 视频路径绑定到对应镜头段（保留 `clipOffsetRatio` / `clipDurationRatio` 供 FFmpeg 按比例切片）
  const segments: SemanticRebuildSegment[] = []
  for (const seg of planned.segments) {
    if (seg.kind === 'generate') {
      const lookupKey = seg.clipKey ?? seg.key
      const rel = generated.get(lookupKey)
      if (rel) {
        segments.push({ ...seg, relativePath: rel })
        continue
      }
      if (localMotionKeys.has(seg.key)) {
        segments.push(seg)
        continue
      }
      if (seg.sourceStartSec != null && seg.sourceEndSec != null) {
        segments.push({ ...seg, kind: 'source' })
        notes.push(`${seg.key}（${lookupKey}）生成失败，已用原片段代替`) // cjk-ok
      }
      continue
    }
    segments.push(seg)
  }

  if (
    segments.length === 0 ||
    (planned.units.length > 0 && generated.size === 0 && localMotionClips.length === 0)
  ) {
    writeRebuildReport(
      ctx,
      { ...baseReport, execute: true, failures, replacements: replaceReport },
      { clearOnlyShotIds: onlyShotIds.length > 0 }
    )
    throw new Error(
      isEn(ctx)
        ? `all clip generations failed (first: ${failures[0]?.reason ?? 'unknown'})`
        : `所有镜头单元均生成失败（首个原因：${failures[0]?.reason ?? '未知'}）` // cjk-ok
    )
  }

  const width = timeline.evidence?.mediaFacts?.width ?? timeline.source.width
  const height = timeline.evidence?.mediaFacts?.height ?? timeline.source.height
  const fps = timeline.source.fps
  const passthroughKeys = new Set(segments.filter((s) => s.kind === 'source').map((s) => s.key))
  const packagingOverlays =
    p.rebuildBurnSubtitles === false
      ? []
      : collectTimelinePackagingOverlays(timeline, { excludeShotIds: passthroughKeys })

  const rebuilt = await ctx.rebuildSemanticVideo({
    timelineId: timeline.id,
    clips: segments
      .filter((s) => s.kind === 'generate' && s.relativePath)
      .map((s) => ({ key: s.key, relativePath: s.relativePath! })),
    segments,
    ...(localMotionClips.length ? { localMotionClips } : {}),
    ...(p.rebuildRenderCompare === true ||
    (p.rebuildRenderCompare !== false && localMotionClips.length > 0)
      ? { renderCompare: true }
      : {}),
    ...(dubbed.length ? { dubs: dubbed } : {}),
    ...(planned.subtitles.length
      ? {
          subtitles: planned.subtitles.map((subtitle) => ({
            sourceStartSec: subtitle.sourceStartSec,
            sourceEndSec: subtitle.sourceEndSec,
            text: subtitle.text
          }))
        }
      : {}),
    ...(packagingOverlays.length ? { packagingOverlays } : {}),
    keepAudio: p.rebuildKeepAudio !== false,
    sourceRelativePath,
    burnSubtitles: p.rebuildBurnSubtitles !== false,
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(fps ? { fps } : {})
  })

  for (const note of [...notes.slice(loggedNotes), ...(rebuilt.notes ?? [])]) {
    say(ctx, note, note, 'warn')
  }

  if (!rebuilt.ok || !rebuilt.outputRelativePath) {
    writeRebuildReport(
      ctx,
      {
        ...baseReport,
        execute: true,
        failures,
        replacements: replaceReport,
        error: rebuilt.error
      },
      { clearOnlyShotIds: onlyShotIds.length > 0 }
    )
    throw new Error(rebuilt.error || (isEn(ctx) ? 'rebuild failed' : '重建拼接失败')) // cjk-ok
  }

  say(
    ctx,
    `重制完成：${rebuilt.outputRelativePath}（${rebuilt.clipCount} 段生成${cacheHits.length ? ` · 缓存命中 ${cacheHits.length} 段` : ''}${rebuilt.passthroughCount ? ` · ${rebuilt.passthroughCount} 段原片` : ''}${rebuilt.dubCount ? ` · 配音 ${rebuilt.dubCount} 句` : ''}${rebuilt.keptAudio ? ' · 保留原音轨' : ''}${rebuilt.burnedSubtitles ? ` · 字幕 ${rebuilt.burnedSubtitles} 条` : ''}）`, // cjk-ok
    `Rebuilt ${rebuilt.outputRelativePath} (${rebuilt.clipCount} generated${cacheHits.length ? `, ${cacheHits.length} cached` : ''}, ${rebuilt.passthroughCount ?? 0} passthrough${rebuilt.keptAudio ? ' + original audio' : ''})`
  )

  // ── 1-to-N 批量变体矩阵执行（若配置了 rebuildVariantsJson） ─────────────────────
  const variantSpecs = parseBatchVariantSpecs(p.rebuildVariantsJson)
  const variantResults: SemanticBatchVariantRunItem[] = []
  if (variantSpecs.length > 0) {
    say(
      ctx,
      `开始执行批量变体矩阵：共 ${variantSpecs.length} 组变体`, // cjk-ok
      `Running batch variant matrix: ${variantSpecs.length} variant(s)`
    )
    for (const [vIdx, vSpec] of variantSpecs.entries()) {
      if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const { timeline: vTimeline, promotesToAdapt } = applyBatchVariantToTimeline(timeline, vSpec)
      const vStrategy: RemakeStrategy = strategy === 'edit' && promotesToAdapt ? 'adapt' : strategy
      const vInstruction = [instruction, vSpec.instruction?.trim()].filter(Boolean).join(' ')
      const vPlanned = planRemakeExecution(vTimeline, {
        strategy: vStrategy,
        instruction: vInstruction,
        maxUnits,
        dubVoice: vSpec.dubVoice || dubVoiceParam,
        allowMultiShot,
        ...(maxCapDur > 0 ? { maxUnitDurationSec: maxCapDur } : {}),
        lang
      })
      const vDubs = dubEnabled ? vPlanned.dubs : []
      const vGenerated = new Map<string, string>()

      for (const vUnit of vPlanned.units) {
        if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        const baseUnit = planned.units.find((bu) => bu.key === vUnit.key)
        if (
          baseUnit &&
          baseUnit.videoPrompt === vUnit.videoPrompt &&
          !vSpec.entityReferenceOverrides &&
          generated.has(vUnit.key)
        ) {
          vGenerated.set(vUnit.key, generated.get(vUnit.key)!)
          continue
        }
        const vDuration = fixedDuration || pickGenerateDuration(vUnit.durationSec, caps?.durations)
        try {
          const res = await generateClipVideo(
            ctx,
            {
              prompt: vUnit.videoPrompt,
              model,
              providerInstanceId,
              ...(clamped.resolution ? { resolution: clamped.resolution } : {}),
              ...(clamped.aspectRatio ? { aspectRatio: clamped.aspectRatio } : {}),
              ...(typeof clamped.seed === 'number' ? { seed: clamped.seed } : {}),
              generateAudio: false,
              name: `rebuild-${vSpec.id}-${vUnit.key}`,
              graphBinding: { nodeId: ctx.node.id }
            },
            vDuration
          )
          vGenerated.set(vUnit.key, res.relativePath)
        } catch (e) {
          say(
            ctx,
            `变体 ${vSpec.id} 单元 ${vUnit.key} 生成失败：${errorText(e)}`, // cjk-ok
            `Variant ${vSpec.id} unit ${vUnit.key} failed: ${errorText(e)}`,
            'warn'
          )
        }
      }

      const vSegments: SemanticRebuildSegment[] = []
      for (const seg of vPlanned.segments) {
        if (seg.kind === 'generate') {
          const lookupKey = seg.clipKey ?? seg.key
          const rel = vGenerated.get(lookupKey) ?? generated.get(lookupKey)
          if (rel) {
            vSegments.push({ ...seg, relativePath: rel })
            continue
          }
          if (localMotionKeys.has(seg.key)) {
            vSegments.push(seg)
            continue
          }
          if (seg.sourceStartSec != null && seg.sourceEndSec != null) {
            vSegments.push({ ...seg, kind: 'source' })
          }
          continue
        }
        vSegments.push(seg)
      }
      if (vSegments.length === 0) continue

      const vDubbed: SemanticRebuildDub[] = []
      if (vDubs.length > 0 && ctx.generateSpeech) {
        const clone = p.rebuildDubClone !== false
        for (const line of vDubs) {
          if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
          const voice = line.voice || vSpec.dubVoice || dubVoiceParam
          try {
            const res = await ctx.generateSpeech({
              input: line.text,
              model: String(p.dubModel || '').trim() || undefined,
              providerInstanceId: String(p.dubProviderInstanceId || '').trim() || undefined,
              ...(voice ? { voice } : {}),
              ...(!voice && clone && line.referenceAudio
                ? { referenceAudio: line.referenceAudio }
                : {}),
              name: `dub-${vSpec.id}-${line.id}`
            })
            if (res.relativePath) {
              vDubbed.push({
                id: line.id,
                relativePath: res.relativePath,
                sourceStartSec: line.sourceStartSec,
                sourceEndSec: line.sourceEndSec
              })
            }
          } catch {
            /* keep original voice */
          }
        }
      }

      const vPassthroughKeys = new Set(
        vSegments.filter((s) => s.kind === 'source').map((s) => s.key)
      )
      const vPackagingOverlays =
        p.rebuildBurnSubtitles === false
          ? []
          : collectTimelinePackagingOverlays(vTimeline, { excludeShotIds: vPassthroughKeys })

      const vRebuilt = await ctx.rebuildSemanticVideo({
        timelineId: `${timeline.id}-${vSpec.id}`,
        clips: vSegments
          .filter((s) => s.kind === 'generate' && s.relativePath)
          .map((s) => ({ key: s.key, relativePath: s.relativePath! })),
        segments: vSegments,
        ...(localMotionClips.length ? { localMotionClips } : {}),
        ...(vDubbed.length ? { dubs: vDubbed } : {}),
        ...(vPlanned.subtitles.length
          ? {
              subtitles: vPlanned.subtitles.map((s) => ({
                sourceStartSec: s.sourceStartSec,
                sourceEndSec: s.sourceEndSec,
                text: s.text
              }))
            }
          : {}),
        ...(vPackagingOverlays.length ? { packagingOverlays: vPackagingOverlays } : {}),
        keepAudio: p.rebuildKeepAudio !== false,
        sourceRelativePath,
        burnSubtitles: p.rebuildBurnSubtitles !== false,
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
        ...(fps ? { fps } : {})
      })

      if (vRebuilt.ok && vRebuilt.outputRelativePath) {
        variantResults.push({
          id: vSpec.id,
          title: vSpec.title || vSpec.id,
          outputRelativePath: vRebuilt.outputRelativePath,
          generatedShots: vGenerated.size,
          passthroughShots: vRebuilt.passthroughCount ?? 0,
          dubbedLines: vDubbed.length
        })
        say(
          ctx,
          `变体 [${vIdx + 1}/${variantSpecs.length}] ${vSpec.title || vSpec.id} 完成：${vRebuilt.outputRelativePath}`, // cjk-ok
          `Variant [${vIdx + 1}/${variantSpecs.length}] ${vSpec.title || vSpec.id} done: ${vRebuilt.outputRelativePath}`
        )
      }
    }
  }

  writeRebuildReport(
    ctx,
    {
      ...baseReport,
      execute: true,
      generated: [...generated.keys()],
      ...(cacheHits.length ? { cacheHits } : {}),
      ...(cleanedFrames.size ? { cleanedFrames: Object.fromEntries(cleanedFrames) } : {}),
      ...(anchorGenerated.size ? { anchors: Object.fromEntries(anchorGenerated) } : {}),
      ...(localMotionClips.length ? { localRendered: localMotionClips.map((c) => c.key) } : {}),
      ...(rebuilt.compareRelativePath ? { compareRelativePath: rebuilt.compareRelativePath } : {}),
      failures,
      replacements: replaceReport,
      dubbed: dubbed.map((d) => d.id),
      rebuild: rebuilt,
      ...(variantResults.length ? { variants: variantResults } : {})
    },
    {
      outputRelativePath: rebuilt.outputRelativePath,
      compareRelativePath: rebuilt.compareRelativePath,
      clearOnlyShotIds: onlyShotIds.length > 0,
      ...(useUnitCache && Object.keys(nextUnitCache).length > 0
        ? { unitCacheJson: JSON.stringify(nextUnitCache) }
        : {})
    }
  )

  return {
    'out-video': {
      kind: 'video',
      id: `rebuild.${timeline.id}`,
      relativePath: rebuilt.outputRelativePath,
      createdAt: new Date().toISOString()
    }
  }
}
