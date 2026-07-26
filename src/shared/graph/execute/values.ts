import {
  appendStyleImagesReferencePrompt,
  buildShotGenerationPrompt,
  normalizeProjectStyleImages,
  portMentionIndex,
  resolveGenerateStyleImages,
  resolveStyleMentionReserveCount,
  type ProjectStyleImage,
  type ShotAudioRef,
  type ShotGenRef,
  type ShotGenRefRole,
  type AssetType
} from '../../domain'
import type { GraphDocument, GraphNode, GraphNodeParams, GraphOutputKind } from '../types'
import { GraphPortType } from '../types'
import { isAssetRefNode, isProcessingAssetNode } from '../nodeRole'
import {
  expandInstructionMentions,
  shouldKeepInstructionMentionToken,
  instructionHasMentions,
  selectByMentionIndexes,
  type InstructionMentionSource
} from '../instructionMentions'
import type { InstructionPresetKind } from '../instructionPresets'
import {
  resolveImageSystemPrompt,
  resolveOptimizeSystemPrompt,
  resolveScreenplaySystemPrompt,
  resolveShotSplitSystemPrompt,
  resolveWorldExtractSystemPrompt,
  resolveNarrativeSplitSystemPrompt,
  resolveNarrativeUnitGenSystemPrompt,
  resolveToPromptSystemPrompt,
  resolveUpscaleSystemPrompt,
  resolveExpandSystemPrompt,
  resolveRedrawSystemPrompt,
  resolveEraseSystemPrompt,
  resolveMatteSystemPrompt,
  resolveGridSplitSystemPrompt,
  resolveVideoSystemPrompt,
  resolveVoiceSystemPrompt
} from '../systemPromptSchemes'
import {
  buildLipSyncPrompt,
  resolveLipSyncSystemPrompt
} from '../lipSync'
import {
  buildImagePrompt,
  buildOptimizePrompt,
  buildScreenplayPrompt,
  buildShotSplitPrompt,
  buildWorldExtractPrompt,
  buildNarrativeSplitPrompt,
  buildNarrativeUnitGenPrompt,
  buildToPromptUserPrompt,
  buildVideoPrompt,
  buildVoicePrompt
} from '../userPromptSchemes'
import { resolveAssetTextFromGenParams } from '../assetText'
import {
  resolveImageGenerateParamsForApi,
  imageGenerateParamsToNodePatch,
  resolveMaxInputReferences
} from '../imageGenerateParams'
import {
  VIDEO_FIRST_FRAME_PORT_ID,
  VIDEO_LAST_FRAME_PORT_ID,
  isVideoFramePortId,
  resolveVideoGenerateParamsForApi,
  videoGenerateParamsToNodePatch,
  type VideoGenerateParamCapabilities
} from '../videoGenerateParams'
import { mergeImageUrlsWithStyleBudget, UNKNOWN_VIDEO_PORT_LIMITS } from '../portInputLimits'
import { resolveMotionImageItems } from '../motionShots'
import { readShotStoryboardFromNodeParams } from '../shotParams'
import {
  mergeShotSplitRowsPreservingReviewed,
  parseShotSplitJson,
  stringifyShotSplitRows
} from '../shotSplitParse'
import {
  mergeWorldCatalogPreservingReviewed,
  parseWorldElementCatalog,
  stringifyWorldElementCatalog
} from '../worldElementParse'
import {
  mergeNarrativeUnitRowsPreservingReviewed,
  parseNarrativeUnitJson,
  stringifyNarrativeUnitRows
} from '../narrativeUnitParse'
import { formatNarrativeUnitRefText, isLegacyNarrativeUnitGenInstruction } from '../narrativeUnitParams'
import {
  multiAngleCameraToNodePatch,
  readMultiAngleCameraFromNode
} from '../multiAngleCamera'
import {
  readLightingSetupFromNode,
  resolveLightingOutputPrompt
} from '../lightingSetup'
import {
  portraitTextureToNodePatch,
  readPortraitTextureFromNode
} from '../portraitTexture'
import { emotionPadToNodePatch, readEmotionPadFromNode } from '../emotionPad'
import {
  buildUpscalePrompt,
  readImageUpscaleFromNode,
  upscaleScaleToResolution
} from '../imageUpscale'
import {
  apiAspectRatioForExpand,
  buildExpandPrompt,
  readImageExpandFromNode
} from '../imageExpand'
import {
  apiAspectRatioForRedraw,
  buildRedrawUserPrompt,
  hasRedrawMask,
  readImageRedrawFromNode
} from '../imageRedraw'
import {
  apiAspectRatioForErase,
  buildEraseUserPrompt,
  hasEraseMask,
  readImageEraseFromNode
} from '../imageErase'
import {
  apiAspectRatioForMatte,
  buildMatteUserPrompt,
  hasMatteMask,
  readImageMatteFromNode
} from '../imageMatte'
import { readImageCropFromNode } from '../imageCrop'
import {
  buildGridCellUpscalePrompt,
  gridSplitScaleToResolution,
  readImageGridSplitFromNode,
  resolveGridSplitTargets
} from '../imageGridSplit'
import type {
  GraphAssetValue,
  GraphGenerationContribution,
  GraphImageItem,
  GraphOutputValue,
  GraphTextItem,
  GraphTextsValue,
  GraphTextValue,
  GraphVoiceItem,
  GraphVoicesValue,
  GraphValue,
  GraphVideoItem,
  GraphVideosValue,
  NodeExecuteContext
} from './types'

/** 将本批生成图落盘；有 saveRunMedia 时去掉 dataUrl，只保留 relativePath */
async function materializeGeneratedBatch(
  ctx: NodeExecuteContext,
  batch: GraphImageItem[],
  _keyPrefix: string
): Promise<GraphImageItem[]> {
  if (!batch.length) return batch
  if (!ctx.saveRunMedia) {
    return batch.map((item) => ({
      ...item,
      dataUrl: item.dataUrl || '',
      ...(item.relativePath ? { relativePath: item.relativePath } : {})
    }))
  }
  const nodeName = (ctx.node.title || ctx.node.typeId || 'generate').trim() || 'generate'
  const stamp = formatGeneratedMediaStamp()
  const next: GraphImageItem[] = []
  let lastError: unknown = null
  for (const [index, item] of batch.entries()) {
    if (item.relativePath?.trim()) {
      next.push({
        id: item.id,
        dataUrl: '',
        createdAt: item.createdAt,
        relativePath: item.relativePath.trim()
      })
      continue
    }
    const raw = item.dataUrl?.trim()
    if (!raw) continue
    const key =
      batch.length > 1 ? `${nodeName}_${stamp}_${index + 1}` : `${nodeName}_${stamp}`
    try {
      const relativePath = await ctx.saveRunMedia({
        dataUrl: raw,
        key,
        outputDir: ctx.node.params.mediaOutputDir?.trim() || undefined,
        node: ctx.node
      })
      next.push({
        id: item.id,
        dataUrl: '',
        createdAt: item.createdAt,
        relativePath
      })
    } catch (err) {
      lastError = err
      console.warn('[graph] materialize generated image failed', err)
      // 落盘失败时不把巨大 dataUrl 写回节点，直接跳过该项
    }
  }
  if (!next.length && lastError) {
    const detail = lastError instanceof Error ? lastError.message : String(lastError)
    throw new Error(detail.includes('图片落盘失败') ? detail : `图片落盘失败: ${detail}`)
  }
  return next
}

function formatGeneratedMediaStamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
}

function stripEmbeddedImageData(item: GraphImageItem): GraphImageItem {
  return {
    id: item.id,
    dataUrl: item.relativePath?.trim() ? '' : item.dataUrl || '',
    createdAt: item.createdAt,
    ...(item.relativePath?.trim() ? { relativePath: item.relativePath.trim() } : {})
  }
}

function mergeGeneratedImages(
  ctx: NodeExecuteContext,
  materializedBatch: GraphImageItem[],
  idFallbackPrefix: string
): GraphImageItem[] {
  const previous = (ctx.node.params.generatedImages ?? []).map(stripEmbeddedImageData)
  return [...previous, ...materializedBatch].map((item, index) => ({
    ...stripEmbeddedImageData(item),
    id: item.id?.trim() || `${idFallbackPrefix}:${index}`
  }))
}

function inferRole(type: AssetType): ShotGenRefRole {
  if (type === 'video') return 'motion'
  return 'character'
}

export function reindexContribution(
  genRefs: ShotGenRef[],
  audioRefs: ShotAudioRef[]
): GraphGenerationContribution {
  const visual = genRefs.map((ref, i) => ({ ...ref, refIndex: i + 1 }))
  const voiceOnly = audioRefs.filter((a) => a.kind === 'voice' && a.assetId)
  const others = audioRefs.filter((a) => a.kind !== 'voice' || !a.assetId)
  const base = visual.length
  const voices = voiceOnly.map((v, i) => ({ ...v, refIndex: base + i + 1 }))
  return { genRefs: visual, audioRefs: [...others, ...voices] }
}

export function contributionFromAssets(items: GraphAssetValue[]): GraphGenerationContribution {
  const genRefs: ShotGenRef[] = []
  const audioRefs: ShotAudioRef[] = []
  for (const item of items) {
    if (item.assetType === 'voice') {
      audioRefs.push({ kind: 'voice', assetId: item.assetId })
    } else {
      genRefs.push({
        role: inferRole(item.assetType),
        assetId: item.assetId,
        refIndex: 0,
        label: item.label,
        weight: item.weight ?? 0.85
      })
    }
  }
  return reindexContribution(genRefs, audioRefs)
}

function voiceItemToAsset(item: GraphVoiceItem): GraphAssetValue | null {
  const assetId = item.id?.trim()
  const relativePath = item.relativePath?.trim()
  if (!assetId && !relativePath) return null
  return {
    kind: 'asset',
    assetId: assetId || relativePath || '',
    assetType: 'voice',
    ...(relativePath ? { relativePath } : {})
  }
}

export function flattenAssetValues(values: GraphValue[]): GraphAssetValue[] {
  const out: GraphAssetValue[] = []
  for (const v of values) {
    if (v.kind === 'asset') out.push(v)
    else if (v.kind === 'voices') {
      for (const item of v.items) {
        const asset = voiceItemToAsset(item)
        if (asset) out.push(asset)
      }
    } else if (v.kind === 'output') {
      out.push(...v.items)
      for (const item of v.voices ?? []) {
        const asset = voiceItemToAsset(item)
        if (asset) out.push(asset)
      }
    }
  }
  return out
}

export function flattenTextValues(values: GraphValue[]): GraphTextValue[] {
  const out: GraphTextValue[] = []
  for (const v of values) {
    if (v.kind === 'text') out.push(v)
    else if (v.kind === 'texts') {
      for (const item of v.items) {
        if (typeof item.text === 'string') out.push({ kind: 'text', text: item.text })
      }
    } else if (v.kind === 'output') out.push(...v.notes)
  }
  return out
}

function pushTextItem(out: GraphTextItem[], item: GraphTextItem): void {
  const text = typeof item.text === 'string' ? item.text : ''
  const relativePath = item.relativePath?.trim()
  const title = item.title?.trim()
  if (!text.trim() && !relativePath) return
  out.push({
    ...(item.id ? { id: item.id } : {}),
    ...(title ? { title } : {}),
    text,
    ...(item.createdAt ? { createdAt: item.createdAt } : {}),
    ...(relativePath ? { relativePath } : {})
  })
}

/** 收集上游文本数组（texts / text / output.texts / output.notes） */
export function flattenTextsValues(values: GraphValue[]): GraphTextItem[] {
  const out: GraphTextItem[] = []
  for (const v of values) {
    if (v.kind === 'texts') {
      for (const item of v.items) pushTextItem(out, item)
    } else if (v.kind === 'text' && v.text.trim()) {
      out.push({ text: v.text })
    } else if (v.kind === 'output') {
      if (v.texts?.length) {
        for (const item of v.texts) pushTextItem(out, item)
      } else {
        for (const note of v.notes) {
          if (note.text.trim()) out.push({ text: note.text })
        }
      }
    }
  }
  return out
}

/** 对齐图片 stripEmbeddedImageData：有 relativePath 时清空正文，边上只传路径 */
function stripEmbeddedTextData(item: GraphTextItem): GraphTextItem {
  const relativePath = item.relativePath?.trim()
  const title = item.title?.trim()
  return {
    ...(item.id ? { id: item.id } : {}),
    ...(title ? { title } : {}),
    text: relativePath ? '' : item.text || '',
    ...(item.createdAt ? { createdAt: item.createdAt } : {}),
    ...(relativePath ? { relativePath } : {})
  }
}

/** 预览/汇总时按路径补全文；无 readRunText 或无路径则原样返回 */
export async function hydrateTextItems(
  items: GraphTextItem[],
  readRunText?: (relativePath: string) => Promise<string>
): Promise<GraphTextItem[]> {
  if (!items.length) return items
  return Promise.all(
    items.map(async (item) => {
      if (item.text?.trim()) return item
      const relativePath = item.relativePath?.trim()
      if (!relativePath || !readRunText) return item
      try {
        const text = (await readRunText(relativePath))?.trim() ?? ''
        return text ? { ...item, text } : item
      } catch {
        return item
      }
    })
  )
}

function mergeGeneratedTexts(
  ctx: NodeExecuteContext,
  batch: GraphTextItem[],
  idFallbackPrefix: string
): GraphTextItem[] {
  const previous = (ctx.node.params.generatedTexts ?? []).map(stripEmbeddedTextData)
  return [...previous, ...batch].map((item, index) => ({
    ...stripEmbeddedTextData(item),
    id: item.id?.trim() || `${idFallbackPrefix}:${index}`
  }))
}

/** 从生成正文首行解析「剧本名：…」/「Title: …」 */
function extractScreenplayTitleFromText(text: string): string | undefined {
  const firstLine =
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ''
  if (!firstLine) return undefined
  const matched = firstLine.match(/^(?:剧本名|标题|剧名|Title)\s*[:：]\s*(.+)$/i)
  const name = matched?.[1]?.trim()
  if (!name) return undefined
  if (/^(未命名|无题|untitled|tbd|n\/a)$/i.test(name)) return undefined
  return name
}

/** 剧本生成落盘名：剧本名_生成次数（优先正文剧本名） */
function resolveScreenplayGenerationFileKey(ctx: NodeExecuteContext, text?: string): string {
  const fromText = text ? extractScreenplayTitleFromText(text) : undefined
  const host = ctx.resolveHostAssetName?.()?.trim()
  const boundId = ctx.node.assetId?.trim()
  const bound = boundId ? ctx.resolveAssetName?.(boundId)?.trim() : undefined
  const title = ctx.node.title?.trim()
  const raw = fromText || host || bound || title || 'screenplay'
  const stem =
    raw
      .replace(/[^\w\u4e00-\u9fff.-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'screenplay'
  const count = (ctx.node.params.generatedTexts?.length ?? 0) + 1
  return `${stem}_${count}`
}

async function materializeGeneratedText(
  ctx: NodeExecuteContext,
  text: string,
  id: string,
  createdAt: string
): Promise<GraphTextItem> {
  const item: GraphTextItem = { id, text, createdAt }
  if (!ctx.saveRunText || !text.trim()) return item
  try {
    const relativePath = await ctx.saveRunText({
      content: text,
      key: resolveScreenplayGenerationFileKey(ctx, text),
      outputDir: ctx.node.params.mediaOutputDir?.trim() || undefined,
      node: ctx.node
    })
    // 对齐图片：落盘成功后清空正文，边上只传 relativePath
    return { id, text: '', createdAt, relativePath }
  } catch (err) {
    console.warn('[graph] materialize generated text failed', err)
    return item
  }
}

async function persistScreenplayGeneration(
  ctx: NodeExecuteContext,
  text: string
): Promise<GraphTextsValue> {
  const createdAt = new Date().toISOString()
  const stamp = formatGeneratedMediaStamp()
  const id = `gen-text:${stamp}`
  const materialized = await materializeGeneratedText(ctx, text, id, createdAt)
  const generatedTexts = mergeGeneratedTexts(ctx, [materialized], `${stamp}:keep`).map((item) => ({
    id: item.id?.trim() || id,
    text: item.text,
    createdAt: item.createdAt ?? createdAt,
    ...(item.relativePath ? { relativePath: item.relativePath } : {})
  }))
  ctx.node.params = {
    ...ctx.node.params,
    text,
    generatedTexts
  }
  ctx.patchNode?.({
    params: {
      text,
      generatedTexts
    }
  })
  // 与节点卡 / Inspector 一致：out 输出累计 generatedTexts，供剧本输出透传全部历史
  return {
    kind: 'texts',
    items: generatedTexts
  }
}

export function flattenImagesValues(values: GraphValue[]): GraphImageItem[] {
  const out: GraphImageItem[] = []
  for (const v of values) {
    if (v.kind === 'images') out.push(...v.items)
    else if (v.kind === 'image' && (v.dataUrl || v.relativePath)) {
      out.push({
        id: v.id,
        dataUrl: v.dataUrl,
        createdAt: v.createdAt,
        relativePath: v.relativePath
      })
    } else if (v.kind === 'output' && v.images?.length) out.push(...v.images)
  }
  return out
}

export function flattenVideosValues(values: GraphValue[]): GraphVideoItem[] {
  const out: GraphVideoItem[] = []
  for (const v of values) {
    if (v.kind === 'videos') out.push(...v.items)
    else if (v.kind === 'video' && (v.dataUrl || v.relativePath)) {
      out.push({
        id: v.id,
        dataUrl: v.dataUrl,
        createdAt: v.createdAt,
        relativePath: v.relativePath
      })
    } else if (v.kind === 'output' && v.videos?.length) out.push(...v.videos)
  }
  return out
}

/** 收集上游声音数组（voices / audio asset / output.voices） */
export function flattenVoicesValues(values: GraphValue[]): GraphVoiceItem[] {
  const out: GraphVoiceItem[] = []
  for (const v of values) {
    if (v.kind === 'voices') {
      for (const item of v.items) {
        if (!item.id?.trim() && !item.relativePath?.trim()) continue
        out.push({
          ...(item.id ? { id: item.id } : {}),
          ...(item.createdAt ? { createdAt: item.createdAt } : {}),
          ...(item.relativePath?.trim() ? { relativePath: item.relativePath.trim() } : {})
        })
      }
    } else if (v.kind === 'asset' && v.assetType === 'voice') {
      out.push({
        id: v.assetId,
        ...(v.relativePath?.trim() ? { relativePath: v.relativePath.trim() } : {})
      })
    } else if (v.kind === 'output') {
      if (v.voices?.length) {
        for (const item of v.voices) {
          if (!item.id?.trim() && !item.relativePath?.trim()) continue
          out.push({
            ...(item.id ? { id: item.id } : {}),
            ...(item.createdAt ? { createdAt: item.createdAt } : {}),
            ...(item.relativePath?.trim() ? { relativePath: item.relativePath.trim() } : {})
          })
        }
      } else {
        for (const item of v.items) {
          if (item.assetType !== 'voice') continue
          out.push({
            id: item.assetId,
            ...(item.relativePath?.trim() ? { relativePath: item.relativePath.trim() } : {})
          })
        }
      }
    }
  }
  return out
}

function stripEmbeddedVoiceData(item: GraphVoiceItem): GraphVoiceItem {
  return {
    ...(item.id ? { id: item.id } : {}),
    ...(item.createdAt ? { createdAt: item.createdAt } : {}),
    ...(item.relativePath?.trim() ? { relativePath: item.relativePath.trim() } : {})
  }
}

function mergeGeneratedVoices(
  ctx: NodeExecuteContext,
  batch: GraphVoiceItem[],
  idFallbackPrefix: string
): GraphVoiceItem[] {
  const previous = (ctx.node.params.generatedVoices ?? []).map(stripEmbeddedVoiceData)
  return [...previous, ...batch].map((item, index) => ({
    ...stripEmbeddedVoiceData(item),
    id: item.id?.trim() || `${idFallbackPrefix}:${index}`
  }))
}

function stripEmbeddedVideoData(item: GraphVideoItem): GraphVideoItem {
  return {
    ...(item.id ? { id: item.id } : {}),
    ...(item.createdAt ? { createdAt: item.createdAt } : {}),
    dataUrl: item.relativePath?.trim() ? '' : item.dataUrl || '',
    ...(item.relativePath?.trim() ? { relativePath: item.relativePath.trim() } : {})
  }
}

function mergeGeneratedVideos(
  ctx: NodeExecuteContext,
  batch: GraphVideoItem[],
  idFallbackPrefix: string
): GraphVideoItem[] {
  const previous = (ctx.node.params.generatedVideos ?? []).map(stripEmbeddedVideoData)
  return [...previous, ...batch].map((item, index) => ({
    ...stripEmbeddedVideoData(item),
    id: item.id?.trim() || `${idFallbackPrefix}:${index}`
  }))
}

/** 视频生成结果写入累计图库，out 与预览一致输出全部历史 */
function persistVideoGeneration(
  ctx: NodeExecuteContext,
  item: GraphVideoItem,
  notes?: string
): GraphVideosValue {
  const createdAt = item.createdAt ?? new Date().toISOString()
  const stamp = formatGeneratedMediaStamp()
  const id = item.id?.trim() || `gen-video:${stamp}`
  const materialized: GraphVideoItem = {
    id,
    createdAt,
    dataUrl: item.relativePath?.trim() ? '' : item.dataUrl || '',
    ...(item.relativePath?.trim() ? { relativePath: item.relativePath.trim() } : {})
  }
  const generatedVideos = mergeGeneratedVideos(ctx, [materialized], `${stamp}:keep`).map(
    (entry) => ({
      id: entry.id?.trim() || id,
      createdAt: entry.createdAt ?? createdAt,
      dataUrl: entry.dataUrl || '',
      ...(entry.relativePath ? { relativePath: entry.relativePath } : {})
    })
  )
  const previewRelativePath = materialized.relativePath?.trim() || undefined
  ctx.node.params = {
    ...ctx.node.params,
    generatedVideos,
    ...(notes !== undefined ? { notes } : {}),
    ...(previewRelativePath ? { previewRelativePath } : {})
  }
  ctx.patchNode?.({
    params: {
      generatedVideos,
      ...(notes !== undefined ? { notes } : {}),
      ...(previewRelativePath ? { previewRelativePath } : {})
    }
  })
  return { kind: 'videos', items: generatedVideos }
}

function persistVoiceGeneration(
  ctx: NodeExecuteContext,
  item: GraphVoiceItem
): GraphVoicesValue {
  const createdAt = item.createdAt ?? new Date().toISOString()
  const stamp = formatGeneratedMediaStamp()
  const id = item.id?.trim() || `gen-audio:${stamp}`
  const materialized: GraphVoiceItem = {
    id,
    createdAt,
    ...(item.relativePath?.trim() ? { relativePath: item.relativePath.trim() } : {})
  }
  const generatedVoices = mergeGeneratedVoices(ctx, [materialized], `${stamp}:keep`).map(
    (entry) => ({
      id: entry.id?.trim() || id,
      createdAt: entry.createdAt ?? createdAt,
      ...(entry.relativePath ? { relativePath: entry.relativePath } : {})
    })
  )
  const previewRelativePath = materialized.relativePath?.trim() || undefined
  ctx.node.params = {
    ...ctx.node.params,
    generatedVoices,
    ...(previewRelativePath ? { previewRelativePath } : {})
  }
  ctx.patchNode?.({
    params: {
      generatedVoices,
      ...(previewRelativePath ? { previewRelativePath } : {})
    }
  })
  // out 与预览一致：输出累计 generatedVoices
  return { kind: 'voices', items: generatedVoices }
}

export function pickVideoItem(
  items: GraphVideoItem[],
  selectedVideoId?: string | null
): GraphVideoItem | undefined {
  if (!items.length) return undefined
  if (selectedVideoId) {
    const byId = items.find((item, index) => videoItemKey(item, index) === selectedVideoId)
    if (byId) return byId
    const byRawId = items.find((item) => item.id === selectedVideoId)
    if (byRawId) return byRawId
  }
  return items[0]
}

export function videoItemKey(item: GraphVideoItem, index: number): string {
  return item.id?.trim() || item.relativePath?.trim() || item.dataUrl?.trim() || `video:${index}`
}

export function pickImageItem(
  items: GraphImageItem[],
  selectedImageId?: string | null
): GraphImageItem | undefined {
  if (!items.length) return undefined
  if (selectedImageId) {
    const byId = items.find((item) => (item.id ?? '') === selectedImageId)
    if (byId) return byId
    const indexMatch = /^index:(\d+)$/.exec(selectedImageId)
    if (indexMatch) {
      const index = Number(indexMatch[1])
      if (Number.isFinite(index) && items[index]) return items[index]
    }
  }
  return items[0]
}

export function imageItemKey(item: GraphImageItem, index: number): string {
  return item.id?.trim() || `index:${index}`
}

export function textItemKey(item: GraphTextItem, index: number): string {
  return item.id?.trim() || item.relativePath?.trim() || `text:${index}`
}

export function pickTextItem(
  items: GraphTextItem[],
  selectedTextId?: string | null
): GraphTextItem | undefined {
  if (!items.length) return undefined
  if (selectedTextId) {
    const byKey = items.find((item, index) => textItemKey(item, index) === selectedTextId)
    if (byKey) return byKey
    const byRawId = items.find((item) => item.id === selectedTextId)
    if (byRawId) return byRawId
  }
  return items[0]
}

/** 合并所有输入端口上的值（多输入口节点） */
export function collectIncomingValues(inputs: Record<string, GraphValue[]>): GraphValue[] {
  if (inputs.in?.length) return inputs.in
  return Object.values(inputs).flat()
}

/** 与 `@n` 同序的入边值；无 incomingByIndex 时回退到端口扁平顺序 */
export function resolveIncomingByIndex(
  ctx: NodeExecuteContext
): Array<{ index: number; value: GraphValue }> {
  if (ctx.incomingByIndex?.length) {
    return ctx.incomingByIndex
      .filter((entry): entry is { index: number; value: GraphValue } => Boolean(entry.value))
      .map((entry) => ({ index: entry.index, value: entry.value }))
  }
  return collectIncomingValues(ctx.inputs).map((value, i) => ({ index: i + 1, value }))
}

/**
 * 按指令筛选上游值：无 `@` 全量；有 `@` 仅命中编号。
 */
export function selectIncomingValuesForInstruction(
  ctx: NodeExecuteContext,
  instructionRaw: string
): GraphValue[] {
  return selectByMentionIndexes(instructionRaw, resolveIncomingByIndex(ctx))
}

/** 无 `@` 时拼接全部上游正文；有 `@` 时不自动拼接（只靠展开后的指令） */
function autoIncomingTextForInstruction(
  instructionRaw: string,
  values: GraphValue[]
): string {
  if (instructionHasMentions(instructionRaw)) return ''
  return flattenTextValues(values)
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join('\n\n')
}

export function executeAssetNode(
  ctx: NodeExecuteContext
): Record<string, GraphValue> | Promise<Record<string, GraphValue>> {
  const { node } = ctx

  if (isAssetRefNode(node)) {
    if (!node.assetId || !node.assetType) {
      throw new Error('GRAPH_UNBOUND_ASSET')
    }
    // 剧本/分镜引用端口为 text，须输出 text（与 motion→images 同理）
    if (node.assetType === 'screenplay' || node.assetType === 'script') {
      return executeTextAssetRefNode(ctx)
    }
    const value: GraphAssetValue = {
      kind: 'asset',
      assetId: node.assetId,
      assetType: node.assetType,
      label: node.params.label,
      weight: node.params.weight,
      volume: node.params.volume,
      muted: node.params.muted,
      notes: node.params.notes,
      title: node.title
    }
    return { out: value }
  }

  // 剧本生成由专用 executeScreenplayGenerateNode 负责；此处仅处理图/视频/声音等
  if (node.assetType === 'screenplay') {
    return executeScreenplayGenerateNode(ctx)
  }

  // 图片生成：输出图片数组（引用节点不走此处）
  if (node.assetType === 'image' || node.typeId === 'asset.image') {
    return executeImageGenerateNode(ctx)
  }

  // 视频生成：文本 / 图片 / 视频均可入；透传优先取上游视频
  if (node.assetType === 'video' || node.typeId === 'asset.video') {
    return executeVideoGenerateNode(ctx)
  }

  // 声音生成：文生语音；无 API 时透传上游声音或输出文本
  if (node.assetType === 'voice' || node.typeId === 'asset.voice') {
    return executeVoiceGenerateNode(ctx)
  }

  // 其它加工：按 @ 筛选上游；无连接时允许仅指令文本（输出 text 供下游 notes）
  const instructionRaw = node.params.generateInstruction?.trim() || ''
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const localNotes =
    expandInstructionMentions(instructionRaw, resolveMentionSources(ctx)) || undefined
  const incomingText = autoIncomingTextForInstruction(instructionRaw, selected)
  const items = flattenAssetValues(selected)
  if (!items.length) {
    const text = [localNotes, incomingText].filter(Boolean).join('\n').trim()
    if (!text) throw new Error('GRAPH_PROCESS_NO_INPUT')
    return { out: { kind: 'text', text } }
  }
  const enriched = items.map((item) => {
    const notes =
      [localNotes, item.notes, incomingText].filter(Boolean).join('\n') || undefined
    return {
      ...item,
      label: node.params.label ?? item.label,
      weight: node.params.weight ?? item.weight,
      volume: node.params.volume ?? item.volume,
      muted: node.params.muted ?? item.muted,
      notes,
      title: node.title ?? item.title
    }
  })
  return { out: enriched[0]! }
}

/** 声音生成：有 generateSpeech 时走声音设计/合成；否则透传上游声音为 voices 或输出文本 */
export async function executeVoiceGenerateNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const instructionRaw = node.params.generateInstruction?.trim() || ''
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const localNotes =
    expandInstructionMentions(instructionRaw, resolveMentionSources(ctx)) || undefined
  const incomingText = autoIncomingTextForInstruction(instructionRaw, selected)
  const sourceImages = await collectIncomingImageItems(ctx)

  if (!ctx.generateSpeech) {
    const voices = flattenVoicesValues(selected)
    if (voices.length) {
      const item = voices[0]!
      const notes = [localNotes, incomingText].filter(Boolean).join('\n') || undefined
      if (notes) ctx.patchNode?.({ params: { notes } })
      return {
        out: {
          kind: 'voices',
          items: [
            {
              ...(item.id ? { id: item.id } : {}),
              ...(item.createdAt ? { createdAt: item.createdAt } : {}),
              ...(item.relativePath ? { relativePath: item.relativePath } : {})
            }
          ]
        }
      }
    }
    const text = [localNotes, incomingText].filter(Boolean).join('\n').trim()
    if (!text && !sourceImages.length) throw new Error('GRAPH_PROCESS_NO_INPUT')
    return { out: { kind: 'text', text: text || '(image prompt)' } }
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const mentionSources = resolveMentionSources(ctx)
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  let userPrompt = buildVoicePrompt(instruction, ctx.locale)
  if (incomingText) {
    userPrompt = userPrompt.trim()
      ? `${userPrompt.trim()}\n\n${incomingText}`
      : incomingText
  }
  const system = resolveVoiceSystemPrompt(node.params.generateSystemPrompt, ctx.locale)
  const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt

  let images: string[] = []
  if (sourceImages.length) {
    if (ctx.resolveImageUrls) {
      images = (await ctx.resolveImageUrls(sourceImages)).filter(Boolean)
    } else {
      images = sourceImages
        .map((item) => item.dataUrl?.trim())
        .filter((url): url is string => Boolean(url))
    }
  }

  if (!prompt.trim() && !images.length) throw new Error('GRAPH_PROCESS_NO_INPUT')

  const speechVoice =
    typeof node.params.generateSpeechVoice === 'string'
      ? node.params.generateSpeechVoice.trim()
      : undefined

  const result = await ctx.generateSpeech({
    input: prompt,
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    voice: speechVoice || undefined,
    name: node.title?.trim() || undefined,
    images: images.length ? images : undefined,
    outputDir: node.params.mediaOutputDir?.trim() || undefined
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  if (!result.assetId || !result.relativePath) {
    throw new Error('语音合成未返回资产')
  }

  const notes = [localNotes, incomingText].filter(Boolean).join('\n') || undefined
  if (notes) {
    ctx.node.params = { ...ctx.node.params, notes }
    ctx.patchNode?.({ params: { notes } })
  }

  return {
    out: persistVoiceGeneration(ctx, {
      id: result.assetId,
      createdAt: new Date().toISOString(),
      relativePath: result.relativePath
    })
  }
}

/** 视频生成：无 API 时透传上游；有 API 时调用视频模型并输出资产 */
export async function executeVideoGenerateNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const instructionRaw = node.params.generateInstruction?.trim() || ''
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const localNotes =
    expandInstructionMentions(instructionRaw, resolveMentionSources(ctx)) || undefined
  const incomingText = autoIncomingTextForInstruction(instructionRaw, selected)

  if (!ctx.generateVideo) {
    return executeVideoGeneratePassthrough(ctx, {
      instructionRaw,
      selected,
      localNotes,
      incomingText
    })
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const mentionSources = resolveMentionSources(ctx)
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  let userPrompt = buildVideoPrompt(instruction, ctx.locale)
  if (incomingText) {
    userPrompt = userPrompt.trim()
      ? `${userPrompt.trim()}\n\n${incomingText}`
      : incomingText
  }
  const system = resolveVideoSystemPrompt(node.params.generateSystemPrompt, ctx.locale)
  const styleImages = resolveNodeStyleImages(ctx)
  // 风格图占 inputReferences 前 N 张，prompt 用「参考xx风格@n，参考强度…」指代（勿再 expand）
  userPrompt = appendStyleImagesReferencePrompt(userPrompt, styleImages, {
    locale: ctx.locale
  })
  const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt

  const portReferences = await collectVideoGenerateInputReferences(ctx, selected)
  const styleUrls = await resolveStyleReferenceUrls(ctx, styleImages)
  // 风格图优先占图片槽位，再拼端口参考（与图片口上限共享额度；@n 与此顺序一致）
  const inputReferences = [
    ...styleUrls.map((url) => ({ kind: 'image_url' as const, url })),
    ...portReferences
  ]
  const firstFrameImageUrl = await resolveVideoFramePortImageUrl(ctx, VIDEO_FIRST_FRAME_PORT_ID)
  const lastFrameImageUrl = await resolveVideoFramePortImageUrl(ctx, VIDEO_LAST_FRAME_PORT_ID)

  if (
    !inputReferences.length &&
    !firstFrameImageUrl &&
    !lastFrameImageUrl &&
    !instruction.trim() &&
    !userPrompt.trim()
  ) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  let capsParams: VideoGenerateParamCapabilities | null = null
  let portLimits = UNKNOWN_VIDEO_PORT_LIMITS
  if (ctx.resolveVideoGenerateCapabilities) {
    try {
      const bundle = await ctx.resolveVideoGenerateCapabilities({
        model: node.params.generateModel || undefined,
        providerInstanceId: node.params.generateProviderInstanceId || undefined
      })
      if (bundle) {
        capsParams = bundle.params
        portLimits = bundle.portLimits
      }
    } catch {
      /* 能力查询失败时沿用节点已保存参数 */
    }
  }

  const genParams = resolveVideoGenerateParamsForApi(node.params, capsParams)
  const paramsPatch = videoGenerateParamsToNodePatch(genParams)
  node.params = { ...node.params, ...paramsPatch }
  ctx.patchNode?.({ params: paramsPatch })

  const limitedRefs = limitVideoInputReferences(inputReferences, portLimits)
  const useFirstFrame =
    genParams.frameMode === 'first' || genParams.frameMode === 'first_last'
      ? firstFrameImageUrl
      : undefined
  const useLastFrame =
    genParams.frameMode === 'first_last' ? lastFrameImageUrl : undefined
  // 方舟等：尾帧不可与 reference_image 混用；首尾帧模式下去掉参考图
  const apiRefs =
    useLastFrame?.trim()
      ? limitedRefs.filter((ref) => ref.kind !== 'image_url')
      : limitedRefs

  const result = await ctx.generateVideo({
    prompt,
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    duration: genParams.duration,
    resolution: genParams.resolution,
    aspectRatio: genParams.aspectRatio,
    generateAudio: genParams.generateAudio,
    firstFrameImageUrl: useFirstFrame,
    lastFrameImageUrl: useLastFrame,
    inputReferences: apiRefs.length ? apiRefs : undefined,
    outputDir: node.params.mediaOutputDir?.trim() || undefined
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const notes =
    [localNotes, incomingText].filter(Boolean).join('\n') || undefined

  return {
    out: persistVideoGeneration(
      ctx,
      {
        id: result.assetId,
        relativePath: result.relativePath,
        createdAt: new Date().toISOString()
      },
      notes
    )
  }
}

/**
 * 对口型：角色图或参考视频 + 声音 → 多模态视频（Seedance 2 等）。
 * 有视频时优先「视频1 + 音频1」；否则「图片1 + 音频1」。不做首尾帧拼装。
 */
export async function executeLipSyncNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx

  const audioInputValues = [
    ...(ctx.inputs['in-voice'] ?? []),
    ...(ctx.inputs.in ?? [])
  ]
  const audioRefs = await collectVideoGenerateInputReferences(ctx, audioInputValues)
  const audioUrl = audioRefs.find((ref) => ref.kind === 'audio_url')?.url?.trim()
  if (!audioUrl) {
    throw new Error('GRAPH_LIPSYNC_NO_AUDIO')
  }

  const videoValues = ctx.inputs['in-video'] ?? []
  const videoRefs = await collectVideoGenerateInputReferences(ctx, videoValues)
  const videoUrl = videoRefs.find((ref) => ref.kind === 'video_url')?.url?.trim()

  let imageUrl: string | undefined
  if (!videoUrl) {
    const imageItems = await collectIncomingImageItems(ctx)
    if (ctx.resolveImageUrls && imageItems.length) {
      imageUrl = (await ctx.resolveImageUrls(imageItems.slice(0, 1))).find((u) => u.trim())?.trim()
    } else if (imageItems[0]?.dataUrl?.trim()) {
      imageUrl = imageItems[0].dataUrl.trim()
    }
    if (!imageUrl && ctx.resolveAssetImageUrl) {
      for (const value of [...(ctx.inputs['in-image'] ?? []), ...(ctx.inputs.in ?? [])]) {
        if (value.kind !== 'asset' || value.assetType !== 'image') continue
        const url = await ctx.resolveAssetImageUrl(value.assetId)
        if (url?.trim()) {
          imageUrl = url.trim()
          break
        }
      }
    }
  }

  if (!videoUrl && !imageUrl) {
    throw new Error('GRAPH_LIPSYNC_NO_VISUAL')
  }

  const visualKind = videoUrl ? 'video' : 'image'
  const instructionRaw = node.params.generateInstruction?.trim() || ''
  const textValues = ctx.inputs['in-text'] ?? []
  const incomingText = textValues
    .map((v) => (v.kind === 'text' ? v.text?.trim() : ''))
    .filter(Boolean)
    .join('\n')
  let userPrompt = buildLipSyncPrompt(instructionRaw, ctx.locale, visualKind)
  if (incomingText) {
    userPrompt = userPrompt.trim()
      ? `${userPrompt.trim()}\n\n${incomingText}`
      : incomingText
  }
  const system = resolveLipSyncSystemPrompt(node.params.generateSystemPrompt, ctx.locale)
  const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt

  if (!ctx.generateVideo) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  let capsParams: VideoGenerateParamCapabilities | null = null
  if (ctx.resolveVideoGenerateCapabilities) {
    try {
      const bundle = await ctx.resolveVideoGenerateCapabilities({
        model: node.params.generateModel || undefined,
        providerInstanceId: node.params.generateProviderInstanceId || undefined
      })
      if (bundle) capsParams = bundle.params
    } catch {
      /* 沿用节点已保存参数 */
    }
  }

  const genParams = resolveVideoGenerateParamsForApi(node.params, capsParams)
  // 对口型：强制参考音驱动；不做首尾帧
  const paramsPatch = videoGenerateParamsToNodePatch({
    ...genParams,
    frameMode: 'none',
    generateAudio: genParams.generateAudio ?? true
  })
  node.params = { ...node.params, ...paramsPatch }
  ctx.patchNode?.({ params: paramsPatch })

  const inputReferences: Array<{ kind: 'image_url' | 'video_url' | 'audio_url'; url: string }> =
    videoUrl
      ? [
          { kind: 'video_url', url: videoUrl },
          { kind: 'audio_url', url: audioUrl }
        ]
      : [
          { kind: 'image_url', url: imageUrl! },
          { kind: 'audio_url', url: audioUrl }
        ]

  const result = await ctx.generateVideo({
    prompt,
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    duration: genParams.duration,
    resolution: genParams.resolution,
    aspectRatio: genParams.aspectRatio,
    generateAudio: paramsPatch.generateAudio !== false,
    inputReferences,
    outputDir: node.params.mediaOutputDir?.trim() || undefined
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const notes =
    [instructionRaw, incomingText].filter(Boolean).join('\n') || undefined

  return {
    out: persistVideoGeneration(
      ctx,
      {
        id: result.assetId,
        relativePath: result.relativePath,
        createdAt: new Date().toISOString()
      },
      notes
    )
  }
}

function executeVideoGeneratePassthrough(
  ctx: NodeExecuteContext,
  args: {
    instructionRaw: string
    selected: GraphValue[]
    localNotes: string | undefined
    incomingText: string
  }
): Record<string, GraphValue> {
  const { selected, localNotes, incomingText } = args
  const videos = flattenAssetValues(selected).filter((item) => item.assetType === 'video')
  const voices = flattenAssetValues(selected).filter((item) => item.assetType === 'voice')
  const gallery = (ctx.node.params.generatedVideos ?? [])
    .filter((item) => item.relativePath?.trim() || item.dataUrl?.trim())
    .map((item) => ({
      id: item.id,
      dataUrl: item.dataUrl || '',
      createdAt: item.createdAt,
      ...(item.relativePath?.trim() ? { relativePath: item.relativePath.trim() } : {})
    }))
  if (!videos.length) {
    if (gallery.length) {
      return { out: { kind: 'videos', items: gallery } }
    }
    const text = [localNotes, incomingText].filter(Boolean).join('\n').trim()
    const voiceNotes = voices
      .map((item) => item.title?.trim() || item.label?.trim() || item.notes?.trim() || '')
      .filter(Boolean)
      .join('\n')
    const outText = text || voiceNotes
    if (!outText) throw new Error('GRAPH_PROCESS_NO_INPUT')
    ctx.patchNode?.({ params: { notes: outText } })
    return { out: { kind: 'text', text: outText } }
  }

  const notes =
    [localNotes, videos[0]!.notes, incomingText].filter(Boolean).join('\n') || undefined
  const merged = [
    ...gallery,
    ...videos.map((item) => ({
      id: item.assetId,
      dataUrl: '',
      ...(item.relativePath?.trim() ? { relativePath: item.relativePath.trim() } : {})
    }))
  ]
  ctx.patchNode?.({
    params: {
      notes,
      previewRelativePath: videos[0]?.relativePath?.trim() || undefined,
      generatedVideos: merged.map((item, index) => ({
        id: item.id?.trim() || `passthrough:${index}`,
        dataUrl: item.dataUrl || '',
        ...(item.relativePath ? { relativePath: item.relativePath } : {})
      }))
    }
  })
  return {
    out: {
      kind: 'videos',
      items: merged
    }
  }
}

type VideoRefKind = 'image_url' | 'video_url' | 'audio_url'

async function resolveVideoFramePortImageUrl(
  ctx: NodeExecuteContext,
  portId: string
): Promise<string | undefined> {
  const values = ctx.inputs[portId] ?? []
  if (!values.length) return undefined
  const refs = await collectVideoGenerateInputReferences(ctx, values)
  return refs.find((ref) => ref.kind === 'image_url')?.url
}

function resolveNodeStyleImages(ctx: NodeExecuteContext): ProjectStyleImage[] {
  const global = ctx.resolveProjectStyleImages?.() ?? []
  const images = resolveGenerateStyleImages(ctx.node.params, global)
  return ctx.enrichStyleImages ? ctx.enrichStyleImages(images) : images
}

async function resolveStyleReferenceUrls(
  ctx: NodeExecuteContext,
  images?: ProjectStyleImage[] | null
): Promise<string[]> {
  const normalized = normalizeProjectStyleImages(images)
  if (!normalized.length) return []
  if (ctx.resolveStyleImageUrls) {
    return (await ctx.resolveStyleImageUrls(normalized)).filter(Boolean)
  }
  return normalized
    .map((item) => item.dataUrl?.trim())
    .filter((url): url is string => Boolean(url?.startsWith('data:')))
}

async function collectVideoGenerateInputReferences(
  ctx: NodeExecuteContext,
  selected: GraphValue[]
): Promise<Array<{ kind: VideoRefKind; url: string }>> {
  const refs: Array<{ kind: VideoRefKind; url: string }> = []
  const seen = new Set<string>()

  const push = (kind: VideoRefKind, url: string): void => {
    const trimmed = url.trim()
    if (!trimmed) return
    const key = `${kind}:${trimmed.slice(0, 64)}:${trimmed.length}`
    if (seen.has(key)) return
    seen.add(key)
    refs.push({ kind, url: trimmed })
  }

  for (const value of selected) {
    if (value.kind === 'images') {
      for (const item of value.items) {
        if (ctx.resolveImageUrls) {
          const urls = await ctx.resolveImageUrls([item])
          for (const url of urls) push('image_url', url)
        } else if (item.dataUrl?.trim()) {
          push('image_url', item.dataUrl)
        }
      }
      continue
    }
    if (value.kind === 'image') {
      if (ctx.resolveImageUrls) {
        const urls = await ctx.resolveImageUrls([value])
        for (const url of urls) push('image_url', url)
      } else if (value.dataUrl?.trim()) {
        push('image_url', value.dataUrl)
      }
      continue
    }
    if (value.kind === 'video' || value.kind === 'videos') {
      const items =
        value.kind === 'videos'
          ? value.items
          : [
              {
                dataUrl: value.dataUrl,
                relativePath: value.relativePath
              }
            ]
      for (const item of items) {
        // 与 resolveAssetMediaDataUrl(video) 一致：优先工程相对路径，生成前再上传 TOS
        const relativePath = item.relativePath?.trim()
        if (relativePath) {
          push('video_url', relativePath.replace(/\\/g, '/'))
          continue
        }
        if (item.dataUrl?.trim()) push('video_url', item.dataUrl)
      }
      continue
    }
    if (value.kind === 'voices') {
      for (const item of value.items) {
        const relativePath = item.relativePath?.trim()
        if (relativePath) {
          push('audio_url', relativePath.replace(/\\/g, '/'))
          continue
        }
        const assetId = item.id?.trim()
        if (assetId && ctx.resolveAssetMediaUrl) {
          const url = await ctx.resolveAssetMediaUrl(assetId)
          if (url) push('audio_url', url)
        }
      }
      continue
    }
    if (value.kind === 'output' && value.voices?.length) {
      for (const item of value.voices) {
        const relativePath = item.relativePath?.trim()
        if (relativePath) {
          push('audio_url', relativePath.replace(/\\/g, '/'))
          continue
        }
        const assetId = item.id?.trim()
        if (assetId && ctx.resolveAssetMediaUrl) {
          const url = await ctx.resolveAssetMediaUrl(assetId)
          if (url) push('audio_url', url)
        }
      }
      continue
    }
    if (value.kind !== 'asset') continue
    const kind: VideoRefKind | null =
      value.assetType === 'image'
        ? 'image_url'
        : value.assetType === 'video'
          ? 'video_url'
          : value.assetType === 'voice'
            ? 'audio_url'
            : null
    if (!kind) continue
    let url: string | undefined
    if (ctx.resolveAssetMediaUrl) {
      url = await ctx.resolveAssetMediaUrl(value.assetId)
    } else if (kind === 'image_url' && ctx.resolveAssetImageUrl) {
      url = await ctx.resolveAssetImageUrl(value.assetId)
    }
    if (url) push(kind, url)
  }

  return refs
}

function limitVideoInputReferences(
  refs: Array<{ kind: VideoRefKind; url: string }>,
  limits: {
    maxImages: number | null
    maxVideos: number | null
    maxVoices: number | null
  }
): Array<{ kind: VideoRefKind; url: string }> {
  const take = (
    kind: VideoRefKind,
    max: number | null
  ): Array<{ kind: VideoRefKind; url: string }> => {
    const list = refs.filter((r) => r.kind === kind)
    if (max == null) return list
    return list.slice(0, Math.max(0, max))
  }
  return [
    ...take('image_url', limits.maxImages),
    ...take('video_url', limits.maxVideos),
    ...take('audio_url', limits.maxVoices)
  ]
}

async function collectImageItemsFromValue(
  value: GraphValue,
  ctx: NodeExecuteContext
): Promise<GraphImageItem[]> {
  const items: GraphImageItem[] = []
  const seen = new Set<string>()
  const pushItem = (item: GraphImageItem): void => {
    const key =
      item.id?.trim() ||
      item.relativePath?.trim() ||
      item.dataUrl?.trim() ||
      `idx:${items.length}`
    if (seen.has(key)) return
    const hasPayload =
      (typeof item.dataUrl === 'string' && item.dataUrl.length > 0) ||
      (typeof item.relativePath === 'string' && item.relativePath.length > 0)
    if (!hasPayload) return
    seen.add(key)
    items.push(item)
  }

  for (const item of flattenImagesValues([value])) {
    pushItem(item)
  }

  if (ctx.resolveAssetImageUrl) {
    for (const asset of flattenAssetValues([value])) {
      if (asset.assetType !== 'image') continue
      const url = await ctx.resolveAssetImageUrl(asset.assetId)
      if (!url) continue
      pushItem({ id: asset.assetId, dataUrl: url })
    }
  }

  return items
}

async function collectImageGenerateSourceItems(
  ctx: NodeExecuteContext,
  instructionRaw: string
): Promise<GraphImageItem[]> {
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const items: GraphImageItem[] = []
  const seen = new Set<string>()
  for (const value of selected) {
    for (const item of await collectImageItemsFromValue(value, ctx)) {
      const key =
        item.id?.trim() ||
        item.relativePath?.trim() ||
        item.dataUrl?.trim() ||
        `idx:${items.length}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
    }
  }
  return items
}

/** 收集节点入边图片（含 image / images，以及图片资产引用） */
async function collectIncomingImageItems(ctx: NodeExecuteContext): Promise<GraphImageItem[]> {
  const imageInputs = [
    ...(ctx.inputs.in ?? []),
    ...(ctx.inputs['in-image'] ?? [])
  ]
  const values = imageInputs.length ? imageInputs : collectIncomingValues(ctx.inputs)
  const items: GraphImageItem[] = []
  const seen = new Set<string>()
  for (const value of values) {
    for (const item of await collectImageItemsFromValue(value, ctx)) {
      const key =
        item.id?.trim() ||
        item.relativePath?.trim() ||
        item.dataUrl?.trim() ||
        `idx:${items.length}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
    }
  }
  return items
}

function patchImageGeneratePreview(
  ctx: NodeExecuteContext,
  items: GraphImageItem[]
): void {
  const preview = items[0]
  if (!preview) return
  ctx.patchNode?.({
    params: {
      previewDataUrl: preview.dataUrl?.trim() ? preview.dataUrl : undefined,
      previewRelativePath: preview.relativePath?.trim() ? preview.relativePath : undefined
    }
  })
}

/**
 * 图片生成：展开指令后调用图片生成 API，输出 images。
 * 未注入 generateImage 时退回上游图片透传。
 * 可接文本口（提示词）与图片口（参考图）；无 @ 时自动拼入上游正文。
 */
export async function executeImageGenerateNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const sourceItems = await collectImageGenerateSourceItems(ctx, instructionRaw)
  const incomingText = autoIncomingTextForInstruction(instructionRaw, selected)

  if (!ctx.generateImage) {
    if (!sourceItems.length) {
      // 无 API 且无参考图：有指令或上游文本则仍算可运行（纯文案节点预览）
      if (!instructionRaw.trim() && !incomingText.trim()) {
        throw new Error('GRAPH_PROCESS_NO_INPUT')
      }
      return { out: { kind: 'images', items: [] } }
    }
    patchImageGeneratePreview(ctx, sourceItems)
    return { out: { kind: 'images', items: sourceItems } }
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const mentionSources = resolveMentionSources(ctx)
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  let userPrompt = buildImagePrompt(instruction, ctx.locale)
  if (incomingText) {
    userPrompt = userPrompt.trim()
      ? `${userPrompt.trim()}\n\n${incomingText}`
      : incomingText
  }
  const system = resolveImageSystemPrompt(node.params.generateSystemPrompt, ctx.locale)
  const styleImages = resolveNodeStyleImages(ctx)
  // /images 无独立 system 字段，拼入 prompt
  // 风格图占 image[] 前 N 张：追加「参考xx风格@n，参考强度…」，与 API 多图指代一致
  userPrompt = appendStyleImagesReferencePrompt(userPrompt, styleImages, {
    locale: ctx.locale
  })
  const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt

  let portUrls: string[] = []
  if (sourceItems.length) {
    if (ctx.resolveImageUrls) {
      portUrls = (await ctx.resolveImageUrls(sourceItems)).filter(Boolean)
    } else {
      portUrls = sourceItems
        .map((item) => item.dataUrl?.trim())
        .filter((url): url is string => Boolean(url))
    }
  }
  const styleUrls = await resolveStyleReferenceUrls(ctx, styleImages)

  // 无参考图时允许纯文生图；既无参考也无有效指令/上游文本则失败
  if (!portUrls.length && !styleUrls.length && !instruction.trim() && !userPrompt.trim()) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const genParams = resolveImageGenerateParamsForApi(node.params)
  // 把实际使用的默认值写回节点，便于 UI / 下次执行一致
  const paramsPatch = imageGenerateParamsToNodePatch(genParams)
  node.params = { ...node.params, ...paramsPatch }
  ctx.patchNode?.({ params: paramsPatch })

  let maxInputReferences = resolveMaxInputReferences()
  if (ctx.resolveImageGenerateCapabilities) {
    try {
      const caps = await ctx.resolveImageGenerateCapabilities({
        model: node.params.generateModel || undefined,
        providerInstanceId: node.params.generateProviderInstanceId || undefined
      })
      maxInputReferences = resolveMaxInputReferences(caps)
    } catch {
      /* 能力查询失败时沿用默认上限 */
    }
  }
  // 风格图优先占位（@1..@N），与端口参考图共享上限并一并提交
  const inputReferences = mergeImageUrlsWithStyleBudget(
    portUrls,
    styleUrls,
    maxInputReferences
  )

  const result = await ctx.generateImage({
    prompt,
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    aspectRatio: genParams.aspectRatio,
    resolution: genParams.resolution,
    quality: genParams.quality,
    n: genParams.count,
    inputReferences: inputReferences.length ? inputReferences : undefined
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const batch: GraphImageItem[] = []
  for (const [index, url] of (result.images ?? []).entries()) {
    const dataUrl = typeof url === 'string' ? url.trim() : ''
    if (!dataUrl) continue
    batch.push({
      id: `gen:${node.id}:${stamp}:${index}`,
      dataUrl,
      createdAt
    })
  }

  if (!batch.length) {
    throw new Error('模型未返回图片')
  }

  const stampKey = `gen:${node.id}:${stamp}`
  const materializedBatch = await materializeGeneratedBatch(ctx, batch, stampKey)
  if (!materializedBatch.length) {
    throw new Error('图片落盘失败')
  }
  const generatedImages = mergeGeneratedImages(ctx, materializedBatch, `${stampKey}:keep`)

  const previewRel = materializedBatch[0]?.relativePath?.trim()
  node.params = { ...node.params, generatedImages }
  ctx.patchNode?.({
    params: {
      generatedImages,
      previewDataUrl: undefined,
      previewRelativePath: previewRel || ''
    }
  })
  // out 与预览一致：输出累计 generatedImages（含历史批次），而非仅本次新图
  return { out: { kind: 'images', items: generatedImages } }
}

export function normalizeLocalScreenplayText(raw: string | undefined): string {
  const localRaw = raw?.trim() ?? ''
  return localRaw === '…' || localRaw === '...' ? '' : localRaw
}

export type InstructionFinalPreviewKind =
  | 'screenplay'
  | 'image'
  | 'video'
  | 'voice'
  | 'optimize'
  | 'toPrompt'
  | 'shotSplit'
  | 'worldExtract'
  | 'narrativeSplit'
  | 'narrativeUnitGen'

/** 按节点 typeId / assetType / 编辑器 preset 解析预览种类 */
export function resolveInstructionFinalPreviewKind(
  node: Pick<GraphNode, 'typeId' | 'assetType'> | null | undefined,
  presetKind?: InstructionPresetKind | null
): InstructionFinalPreviewKind {
  const typeId = node?.typeId
  if (typeId === 'prompt.optimize' || presetKind === 'optimize') return 'optimize'
  if (typeId === 'image.toPrompt' || presetKind === 'toPrompt') return 'toPrompt'
  if (typeId === 'script.shotSplit' || presetKind === 'shotSplit') return 'shotSplit'
  if (typeId === 'world.extract' || presetKind === 'worldExtract') return 'worldExtract'
  if (
    typeId === 'narrative.split' ||
    typeId === 'screenplay.narrativeSplit' ||
    presetKind === 'narrativeSplit'
  ) {
    return 'narrativeSplit'
  }
  if (typeId === 'narrative.unitGen' || presetKind === 'narrativeUnitGen') {
    return 'narrativeUnitGen'
  }

  const assetType = node?.assetType
  if (typeId === 'asset.video' || assetType === 'video' || presetKind === 'video') return 'video'
  if (typeId === 'asset.voice' || assetType === 'voice' || presetKind === 'voice') return 'voice'
  if (typeId === 'asset.image' || assetType === 'image' || presetKind === 'image') return 'image'
  if (
    typeId === 'asset.screenplay' ||
    assetType === 'screenplay' ||
    presetKind === 'screenplay'
  ) {
    return 'screenplay'
  }
  return 'screenplay'
}

function resolveSystemPromptForPreviewKind(
  kind: InstructionFinalPreviewKind,
  raw: string | undefined,
  locale?: string
): string {
  switch (kind) {
    case 'image':
      return resolveImageSystemPrompt(raw, locale)
    case 'video':
      return resolveVideoSystemPrompt(raw, locale)
    case 'voice':
      return resolveVoiceSystemPrompt(raw, locale)
    case 'optimize':
      return resolveOptimizeSystemPrompt(raw, locale)
    case 'toPrompt':
      return resolveToPromptSystemPrompt(raw, locale)
    case 'shotSplit':
      return resolveShotSplitSystemPrompt(raw, locale)
    case 'worldExtract':
      return resolveWorldExtractSystemPrompt(raw, locale)
    case 'narrativeSplit':
      return resolveNarrativeSplitSystemPrompt(raw, locale)
    case 'narrativeUnitGen':
      return resolveNarrativeUnitGenSystemPrompt(raw, locale)
    case 'screenplay':
    default:
      return resolveScreenplaySystemPrompt(raw, locale)
  }
}

function buildUserPromptForPreviewKind(
  kind: InstructionFinalPreviewKind,
  instruction: string,
  locale?: string
): string {
  switch (kind) {
    case 'image':
      return buildImagePrompt(instruction, locale)
    case 'video':
      return buildVideoPrompt(instruction, locale)
    case 'voice':
      return buildVoicePrompt(instruction, locale)
    case 'optimize':
      return buildOptimizePrompt(instruction, locale)
    case 'toPrompt':
      return buildToPromptUserPrompt(instruction, locale)
    case 'shotSplit':
      return buildShotSplitPrompt(instruction, locale)
    case 'worldExtract':
      return buildWorldExtractPrompt(instruction, locale)
    case 'narrativeSplit':
      return buildNarrativeSplitPrompt(instruction, locale)
    case 'narrativeUnitGen':
      return buildNarrativeUnitGenPrompt(instruction, locale)
    case 'screenplay':
    default:
      return buildScreenplayPrompt(instruction, locale)
  }
}

function previewSectionLabels(locale?: string): { system: string; user: string } {
  if (locale === 'en-US' || (locale?.startsWith('en') ?? false)) {
    return { system: 'System prompt', user: 'User prompt' }
  }
  return { system: '系统提示词', user: '用户提示词' }
}

function previewKindAutoAppendsIncomingText(kind: InstructionFinalPreviewKind): boolean {
  return (
    kind === 'screenplay' ||
    kind === 'optimize' ||
    kind === 'shotSplit' ||
    kind === 'worldExtract' ||
    kind === 'narrativeSplit' ||
    kind === 'narrativeUnitGen' ||
    kind === 'image' ||
    kind === 'video' ||
    kind === 'voice'
  )
}

/** 按节点类型拼接最终提示词预览（展开 @ + 对应系统提示词；无 @ 时拼上游正文，与执行一致） */
export function buildInstructionFinalPromptPreview(input: {
  kind: InstructionFinalPreviewKind
  instructionRaw: string
  sources: InstructionMentionSource[]
  systemPrompt?: string
  includeSystem?: boolean
  locale?: string
  /** 图片/视频生成：风格参考（与执行侧一致，追加「参考xx风格@n，参考强度…」） */
  styleImages?: ProjectStyleImage[] | null
}): string {
  const instruction = expandInstructionMentions(input.instructionRaw.trim(), input.sources)
  let userPrompt = buildUserPromptForPreviewKind(input.kind, instruction, input.locale)
  // 与 execute*GenerateNode：先 build*Prompt(指令)，再无 @ 时追加上游正文
  if (
    previewKindAutoAppendsIncomingText(input.kind) &&
    !instructionHasMentions(input.instructionRaw)
  ) {
    const auto = input.sources
      .map((source) => source.text.trim())
      .filter(Boolean)
      .join('\n\n')
    if (auto) {
      userPrompt = userPrompt.trim() ? `${userPrompt.trim()}\n\n${auto}` : auto
    }
  }
  // 与 executeImage/VideoGenerateNode：风格图 @n 指代（在展开连线 @ 之后追加，保留 @n）
  if (input.kind === 'image' || input.kind === 'video') {
    userPrompt = appendStyleImagesReferencePrompt(userPrompt, input.styleImages, {
      locale: input.locale
    })
  }
  if (input.includeSystem === false) return userPrompt
  const system = resolveSystemPromptForPreviewKind(input.kind, input.systemPrompt, input.locale)
  const labels = previewSectionLabels(input.locale)
  return `【${labels.system}】\n${system}\n\n【${labels.user}】\n${userPrompt}`
}

/** @deprecated 使用 buildInstructionFinalPromptPreview({ kind: 'screenplay', ... }) */
export function buildScreenplayFinalPromptPreview(input: {
  instructionRaw: string
  sources: InstructionMentionSource[]
  systemPrompt?: string
  includeSystem?: boolean
  locale?: string
}): string {
  return buildInstructionFinalPromptPreview({ ...input, kind: 'screenplay' })
}

function graphValueToMentionSource(value: GraphValue, index: number): InstructionMentionSource {
  if (value.kind === 'text') {
    return { index, title: `@${index}`, text: value.text }
  }
  if (value.kind === 'texts') {
    return {
      index,
      title: `@${index}`,
      text: value.items
        .map((item) => item.text.trim())
        .filter(Boolean)
        .join('\n\n')
    }
  }
  if (value.kind === 'asset') {
    const keepMentionToken = shouldKeepInstructionMentionToken({
      assetType: value.assetType,
      typeId: `asset.${value.assetType}`
    })
    return {
      index,
      title: value.title || value.label || `@${index}`,
      text: keepMentionToken ? '' : [value.notes, value.label].filter(Boolean).join('\n'),
      keepMentionToken
    }
  }
  if (value.kind === 'output') {
    return {
      index,
      title: `@${index}`,
      text: value.notes
        .map((item) => item.text.trim())
        .filter(Boolean)
        .join('\n\n')
    }
  }
  if (
    value.kind === 'image' ||
    value.kind === 'images' ||
    value.kind === 'video' ||
    value.kind === 'videos'
  ) {
    return { index, title: `@${index}`, text: '', keepMentionToken: true }
  }
  return { index, title: `@${index}`, text: '' }
}

function fallbackMentionTextFromNode(node: GraphNode | undefined): string {
  if (!node) return ''
  return (
    node.params.text?.trim() ||
    node.params.resultText?.trim() ||
    node.params.notes?.trim() ||
    ''
  )
}

function fallbackNarrativeUnitRefText(
  node: GraphNode | undefined,
  resolveNarrativeUnit?: (unitId: string) => import('../narrativeUnitParse').NarrativeUnitRow | null
): string {
  if (!node || node.typeId !== 'narrative.unitRef' || !resolveNarrativeUnit) return ''
  const unitId = node.params.boundUnitId?.trim()
  if (!unitId) return ''
  const unit = resolveNarrativeUnit(unitId)
  return unit ? formatNarrativeUnitRefText(unit) : ''
}

/**
 * 按入边顺序构建 `@n` 引用源，编号与 UI chips 一致；
 * 端口值缺正文时回退到源节点 params（与预览 resolveNodeTextContent 对齐）。
 * `mentionIndexBase`：风格图占用的编号数，端口从 base+1 起编。
 */
export function buildMentionSourcesForNode(input: {
  graph: GraphDocument
  nodeId: string
  byId: Map<string, GraphNode>
  outputs: Map<string, Record<string, GraphValue>>
  mentionIndexBase?: number
  resolveNarrativeUnit?: (unitId: string) => import('../narrativeUnitParse').NarrativeUnitRow | null
}): InstructionMentionSource[] {
  const base = Math.max(0, Math.floor(input.mentionIndexBase ?? 0))
  const incoming = input.graph.edges.filter(
    (edge) => edge.target === input.nodeId && !isVideoFramePortId(edge.targetPort ?? 'in')
  )
  return incoming.map((edge, i) => {
    const index = portMentionIndex(i, base)
    const source = input.byId.get(edge.source)
    const sourcePort = edge.sourcePort ?? 'out'
    const value = input.outputs.get(edge.source)?.[sourcePort]
    const fromValue = value ? graphValueToMentionSource(value, index) : null
    const keepMentionToken =
      fromValue?.keepMentionToken === true || shouldKeepInstructionMentionToken(source)
    const title =
      fromValue?.title?.trim() ||
      source?.title?.trim() ||
      source?.params.label?.trim() ||
      `@${index}`
    const text = keepMentionToken
      ? ''
      : fromValue?.text?.trim() ||
        fallbackMentionTextFromNode(source) ||
        fallbackNarrativeUnitRefText(source, input.resolveNarrativeUnit)
    return { index, title, text, keepMentionToken }
  })
}

/** 图片/视频生成节点：风格图占用的 `@n` 前缀数量 */
export function resolveGenerateMentionIndexBase(
  node: GraphNode,
  globalStyleImages?: ProjectStyleImage[] | null
): number {
  if (!isProcessingAssetNode(node)) return 0
  if (node.typeId !== 'asset.image' && node.typeId !== 'asset.video') return 0
  return resolveStyleMentionReserveCount(node.params, globalStyleImages)
}

function resolveMentionSources(ctx: NodeExecuteContext): InstructionMentionSource[] {
  if (ctx.mentionSources?.length) return ctx.mentionSources
  const incoming = collectIncomingValues(ctx.inputs)
  return incoming.map((value, i) => graphValueToMentionSource(value, i + 1))
}

/**
 * 画布上拖入的剧本/分镜资产引用。
 * 剧本优先 resolveAssetText（导入文件 URL / 新建 graphJson）；分镜走 genParams。
 */
export async function executeTextAssetRefNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  if (!ctx.node.assetId || !ctx.node.assetType) {
    throw new Error('GRAPH_UNBOUND_ASSET')
  }
  if (ctx.node.assetType === 'screenplay') {
    let text = (await ctx.resolveAssetText?.(ctx.node.assetId))?.trim() ?? ''
    if (!text) {
      const genParams = ctx.resolveAssetGenParams?.(ctx.node.assetId)
      text = resolveAssetTextFromGenParams(genParams, ctx.node.params)
    }
    // 节点上缓存的正文（拖入时预填）作最后兜底
    if (!text) text = ctx.node.params.text?.trim() ?? ''
    return { out: { kind: 'text', text } }
  }
  const genParams = ctx.resolveAssetGenParams?.(ctx.node.assetId)
  const text = resolveAssetTextFromGenParams(genParams, ctx.node.params)
  return { out: { kind: 'text', text } }
}

/**
 * 剧本生成节点：调用大模型生成剧本，落盘到输出路径并追加 generatedTexts。
 * 未注入 generateText 时退回纯文本汇总（测试/无 API 环境），仍会落盘（若已注入 saveRunText）。
 */
export async function executeScreenplayGenerateNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  if (isAssetRefNode(node)) {
    return executeTextAssetRefNode(ctx)
  }

  const mentionSources = resolveMentionSources(ctx)
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const incomingText = autoIncomingTextForInstruction(instructionRaw, selected)

  if (!ctx.generateText) {
    const localText = normalizeLocalScreenplayText(node.params.text)
    const text = instruction.trim() || incomingText || localText
    if (!text.trim()) return { out: { kind: 'texts', items: [] } }
    return { out: await persistScreenplayGeneration(ctx, text) }
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  let prompt = buildScreenplayPrompt(instruction, ctx.locale)
  if (incomingText) {
    prompt = `${prompt.trim()}\n\n${incomingText}`
  }

  const result = await ctx.generateText({
    prompt,
    system: resolveScreenplaySystemPrompt(node.params.generateSystemPrompt, ctx.locale),
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined
  })
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const text = result.text.trim()
  if (!text) throw new Error('模型未返回剧本文本')

  return { out: await persistScreenplayGeneration(ctx, text) }
}

export function executeNoteNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const text = ctx.node.params.text?.trim() ?? ''
  return {
    out: { kind: 'text', text }
  }
}

export function executePlayScriptNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const text = ctx.node.params.text?.trim() ?? ''
  return {
    out: { kind: 'text', text }
  }
}

/**
 * 提示词优化：展开 @ 引用后调用文本模型改写。
 * 未注入 generateText 时退回指令 / 上游 / 本地文本汇总。
 */
export async function executePromptOptimizeNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const mentionSources = resolveMentionSources(ctx)
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const incomingText = autoIncomingTextForInstruction(instructionRaw, selected)
  const localText = node.params.text?.trim() ?? ''

  if (!ctx.generateText) {
    const text = instruction.trim() || incomingText || localText
    if (text && text !== localText) {
      node.params = { ...node.params, text }
      ctx.patchNode?.({ params: { text } })
    }
    return { out: { kind: 'text', text } }
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  let prompt = buildOptimizePrompt(instruction, ctx.locale)
  // 指令未用 @ 引用上游时，把上游正文接到指令后（适配「剧本内容：」类预设）
  if (incomingText) {
    prompt = `${prompt.trim()}\n\n${incomingText}`
  }

  const result = await ctx.generateText({
    prompt,
    system: resolveOptimizeSystemPrompt(node.params.generateSystemPrompt, ctx.locale),
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined
  })
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const text = result.text.trim()
  if (!text) throw new Error('模型未返回优化结果')

  node.params = { ...node.params, text }
  ctx.patchNode?.({ params: { text } })
  return { out: { kind: 'text', text } }
}

/** 分镜参数：从节点 params 组装提示词文本输出 */
export function executeShotParamsNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const storyboard = readShotStoryboardFromNodeParams(ctx.node.params)
  const refs = ctx.resolveShotStoryboard?.(ctx.node.params.boundShotId)
  const text = buildShotGenerationPrompt(storyboard, {
    stylePreset: refs?.stylePreset
  })
  return { out: { kind: 'text', text } }
}

/** 叙事单元细化生成：文本模型 + 指令框；规则在系统提示词 */
export async function executeNarrativeUnitGenNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const mentionSources = resolveMentionSources(ctx)
  let instructionRaw = node.params.generateInstruction?.trim() ?? ''
  // 旧版把规则写在指令窗口：视为未配置，改走系统提示词默认
  if (isLegacyNarrativeUnitGenInstruction(instructionRaw)) {
    instructionRaw = ''
  }
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  let incomingText = autoIncomingTextForInstruction(instructionRaw, selected)
  // 与其它生成节点一致：无 @ 时默认拼上游；端口值缺失时回退 mentionSources（如叙事参考）
  if (!incomingText && !instructionHasMentions(instructionRaw)) {
    incomingText = mentionSources
      .map((source) => source.text.trim())
      .filter(Boolean)
      .join('\n\n')
  }
  const localText = node.params.text?.trim() ?? ''

  if (!ctx.generateText) {
    const text = instruction.trim() || incomingText || localText
    if (text && text !== localText) {
      node.params = { ...node.params, text }
      ctx.patchNode?.({ params: { text } })
    }
    return { out: { kind: 'text', text } }
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  let prompt = buildNarrativeUnitGenPrompt(instruction, ctx.locale)
  if (incomingText) {
    prompt = `${prompt.trim()}\n\n${incomingText}`
  }

  const result = await ctx.generateText({
    prompt,
    system: resolveNarrativeUnitGenSystemPrompt(node.params.generateSystemPrompt, ctx.locale),
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined
  })
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const text = result.text.trim()
  if (!text) throw new Error('模型未返回叙事细化结果')

  node.params = { ...node.params, text }
  ctx.patchNode?.({ params: { text } })
  return { out: { kind: 'text', text } }
}

/** 叙事单元参考：输出绑定单元的目录字段文本 */
export function executeNarrativeUnitRefNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const unitId = ctx.node.params.boundUnitId?.trim()
  if (!unitId) return {}
  const unit = ctx.resolveNarrativeUnit?.(unitId)
  if (!unit) return {}
  const text = formatNarrativeUnitRefText(unit)
  return text ? { out: { kind: 'text', text } } : {}
}

/**
 * 分镜表格：有上游文本则透传并导入分镜列表（拆分 → 表格）；
 * 否则输出当前分镜列表 JSON（表格 → 拆分，再次拆分）。
 * 导入只在节点执行时发生，打开表格窗口不会导入。
 */
export async function executeShotTableNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const first = Object.values(ctx.inputs).flat()[0]
  if (first && first.kind === 'text' && first.text.trim()) {
    const text = first.text.trim()
    ctx.node.params = { ...ctx.node.params, text }
    ctx.patchNode?.({ params: { text } })
    await ctx.importShotSplitTableJson?.(text)
    return { out: { kind: 'text', text } }
  }

  const fromShots = ctx.resolveShotSplitTableJson?.()?.trim()
  if (fromShots) {
    ctx.node.params = { ...ctx.node.params, text: fromShots }
    ctx.patchNode?.({ params: { text: fromShots } })
    return { out: { kind: 'text', text: fromShots } }
  }

  const local = ctx.node.params.text?.trim() ?? ''
  return local ? { out: { kind: 'text', text: local } } : {}
}

async function importShotSplitFromTextInput(
  ctx: NodeExecuteContext,
  input: GraphValue | undefined
): Promise<void> {
  if (!input || input.kind !== 'text' || !input.text.trim()) return
  const text = input.text.trim()
  ctx.node.params = { ...ctx.node.params, text }
  ctx.patchNode?.({ params: { text } })
  await ctx.importShotSplitTableJson?.(text)
}

/**
 * 生成分镜图：有上游拆分/表格 JSON 时写入分镜列表；
 * 再从各镜画面图的图片输出节点收集已有结果，写回 genRefs，输出真实 images（不级联跑 visual）。
 */
export async function executeShotImageGenNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const first = ctx.inputs.in?.[0] ?? Object.values(ctx.inputs).flat()[0]
  await importShotSplitFromTextInput(ctx, first)

  const collected = await ctx.collectScriptShotImages?.(ctx.signal)
  const items = collected?.images ?? []
  if (collected?.aggregateJson?.trim()) {
    ctx.node.params = { ...ctx.node.params, text: collected.aggregateJson.trim() }
    ctx.patchNode?.({ params: { text: collected.aggregateJson.trim() } })
  }
  if (items.length) {
    const cameraShots = items.map((item, index) => ({
      id: item.id ?? `shot-image:${index}`,
      dataUrl: item.dataUrl,
      createdAt: item.createdAt ?? new Date().toISOString(),
      relativePath: item.relativePath
    }))
    ctx.node.params = {
      ...ctx.node.params,
      cameraShots,
      previewRelativePath: items[0]?.relativePath,
      previewDataUrl: items[0]?.dataUrl
    }
    ctx.patchNode?.({
      params: {
        cameraShots,
        previewRelativePath: ctx.node.params.previewRelativePath,
        previewDataUrl: ctx.node.params.previewDataUrl
      }
    })
  }
  return { out: { kind: 'images', items } }
}

/**
 * 生成分镜视频：文本口导入分镜列表；图片口接收分镜图预览；
 * 再从各镜视频图的视频输出节点收集已有结果，写回 genRefs，输出真实 videos（不级联跑 shotWorkflow）。
 * 导入只在节点执行时发生，打开编辑窗口不会导入。
 */
export async function executeShotVideoGenNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const textIn = ctx.inputs['in-text']?.[0] ?? ctx.inputs.in?.[0]
  await importShotSplitFromTextInput(ctx, textIn)
  const imageItems = flattenImagesValues(ctx.inputs['in-image'] ?? [])
  if (imageItems.length) {
    ctx.node.params = {
      ...ctx.node.params,
      cameraShots: imageItems.map((item, index) => ({
        id: item.id ?? `shot-image:${index}`,
        dataUrl: item.dataUrl,
        createdAt: item.createdAt ?? new Date().toISOString(),
        relativePath: item.relativePath
      })),
      previewRelativePath: imageItems[0]?.relativePath,
      previewDataUrl: imageItems[0]?.dataUrl
    }
    ctx.patchNode?.({
      params: {
        cameraShots: ctx.node.params.cameraShots,
        previewRelativePath: ctx.node.params.previewRelativePath,
        previewDataUrl: ctx.node.params.previewDataUrl
      }
    })
  }

  const collected = await ctx.collectScriptShotVideos?.(ctx.signal)
  const items = collected?.videos ?? []
  if (items.length) {
    const previewRelativePath = items[0]?.relativePath?.trim() || ctx.node.params.previewRelativePath
    ctx.node.params = {
      ...ctx.node.params,
      ...(previewRelativePath ? { previewRelativePath } : {})
    }
    if (previewRelativePath) {
      ctx.patchNode?.({ params: { previewRelativePath } })
    }
  }
  return { out: { kind: 'videos', items } }
}

/** @deprecated 使用 {@link executeShotVideoGenNode} */
export async function executeShotEditorNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  return executeShotVideoGenNode(ctx)
}

/**
 * 世界元素表格：有上游文本则透传并导入目录（提取 → 表格）；
 * 否则输出当前目录 JSON（表格 → 提取再次加工）。
 * 导入只在节点执行时发生，打开表格窗口不会导入。
 */
export async function executeWorldTableNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const first = Object.values(ctx.inputs).flat()[0]
  if (first && first.kind === 'text' && first.text.trim()) {
    const text = first.text.trim()
    ctx.node.params = { ...ctx.node.params, text }
    ctx.patchNode?.({ params: { text } })
    await ctx.importWorldCatalogJson?.(text)
    return { out: { kind: 'text', text } }
  }

  const fromCatalog = ctx.resolveWorldCatalogJson?.()?.trim()
  if (fromCatalog) {
    ctx.node.params = { ...ctx.node.params, text: fromCatalog }
    ctx.patchNode?.({ params: { text: fromCatalog } })
    return { out: { kind: 'text', text: fromCatalog } }
  }

  const local = ctx.node.params.text?.trim() ?? ''
  return local ? { out: { kind: 'text', text: local } } : {}
}

/**
 * 世界元素生成：有上游提取/表格 JSON 时同步到元素子图；
 * 再从四类 elementWorkflow 子图收集已有图片，输出真实 images（不级联跑子图生成）。
 * 导入只在节点执行时发生，打开编辑窗口不会导入。
 */
export async function executeWorldGenNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const first = Object.values(ctx.inputs).flat()[0]
  if (first && first.kind === 'text' && first.text.trim()) {
    const text = first.text.trim()
    ctx.node.params = { ...ctx.node.params, text }
    ctx.patchNode?.({ params: { text } })
    await ctx.importWorldCatalogJson?.(text)
  }

  const collected = await ctx.collectWorldElementImages?.(ctx.signal)
  const items = collected?.images ?? []
  if (items.length) {
    const cameraShots = items.map((item, index) => ({
      id: item.id ?? `world-image:${index}`,
      dataUrl: item.dataUrl,
      createdAt: item.createdAt ?? new Date().toISOString(),
      relativePath: item.relativePath
    }))
    ctx.node.params = {
      ...ctx.node.params,
      cameraShots,
      previewRelativePath: items[0]?.relativePath,
      previewDataUrl: items[0]?.dataUrl
    }
    ctx.patchNode?.({
      params: {
        cameraShots,
        previewRelativePath: ctx.node.params.previewRelativePath,
        previewDataUrl: ctx.node.params.previewDataUrl
      }
    })
  }
  return { out: { kind: 'images', items } }
}

/**
 * 叙事单元表格：有上游文本则透传并导入目录；
 * 否则输出当前目录 JSON（表格 → 拆解再次加工）。
 */
export async function executeNarrativeTableNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const first = Object.values(ctx.inputs).flat()[0]
  if (first && first.kind === 'text' && first.text.trim()) {
    const text = first.text.trim()
    ctx.node.params = { ...ctx.node.params, text }
    ctx.patchNode?.({ params: { text } })
    await ctx.importNarrativeCatalogJson?.(text)
    return { out: { kind: 'text', text } }
  }

  const fromCatalog = ctx.resolveNarrativeCatalogJson?.()?.trim()
  if (fromCatalog) {
    ctx.node.params = { ...ctx.node.params, text: fromCatalog }
    ctx.patchNode?.({ params: { text: fromCatalog } })
    return { out: { kind: 'text', text: fromCatalog } }
  }

  const local = ctx.node.params.text?.trim() ?? ''
  return local ? { out: { kind: 'text', text: local } } : {}
}

/**
 * 叙事单元生成：有上游目录 JSON 时同步到单元子图；
 * 再从各单元 narrativeUnit 子图收集「叙事输出」已有文本（不级联跑子图生成）。
 * 导入只在节点执行时发生，打开细化窗口不会导入。
 */
export async function executeNarrativeGenNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const first = Object.values(ctx.inputs).flat()[0]
  if (first && first.kind === 'text' && first.text.trim()) {
    const text = first.text.trim()
    // 先导入目录再 patch，减少与单元图落盘的竞态
    await ctx.importNarrativeCatalogJson?.(text)
    ctx.node.params = { ...ctx.node.params, text }
    ctx.patchNode?.({ params: { text } })
  }

  const collected = await ctx.collectNarrativeUnitTexts?.(ctx.signal)
  return {
    out: {
      kind: 'texts',
      items: collected?.items ?? []
    }
  }
}

/**
 * 分镜拆分：将上游剧本文本按生成指令拆成有序分镜列表。
 * 未注入 generateText 时退回指令 / 上游 / 本地文本汇总。
 * 上游若含上次拆分 JSON（如表格 → 拆分），合并时强制保留「已审核」行。
 */
export async function executeShotSplitNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const mentionSources = resolveMentionSources(ctx)
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const incomingText = autoIncomingTextForInstruction(instructionRaw, selected)
  const localText = node.params.text?.trim() ?? ''
  const previousRows = parseShotSplitJson(incomingText)

  if (!ctx.generateText) {
    const text = instruction.trim() || incomingText || localText
    if (text && text !== localText) {
      node.params = { ...node.params, text }
      ctx.patchNode?.({ params: { text } })
    }
    return { out: { kind: 'text', text } }
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  let prompt = buildShotSplitPrompt(instruction, ctx.locale)
  if (incomingText) {
    prompt = `${prompt.trim()}\n\n${incomingText}`
  }

  const result = await ctx.generateText({
    prompt,
    system: resolveShotSplitSystemPrompt(node.params.generateSystemPrompt, ctx.locale),
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined
  })
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  let text = result.text.trim()
  if (!text) throw new Error('模型未返回分镜拆分结果')

  const nextRows = parseShotSplitJson(text)
  const merged = mergeShotSplitRowsPreservingReviewed(previousRows, nextRows)
  if (merged?.length) {
    text = stringifyShotSplitRows(merged)
  }

  node.params = { ...node.params, text }
  ctx.patchNode?.({ params: { text } })
  return { out: { kind: 'text', text } }
}

/**
 * 世界元素提取：将上游文本拆成角色/场景/道具/武器 JSON 目录。
 * 未注入 generateText 时退回指令 / 上游 / 本地文本汇总。
 * 上游若含上次目录 JSON（如表格 → 提取），合并时强制保留「已审核」项。
 */
export async function executeWorldExtractNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const mentionSources = resolveMentionSources(ctx)
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const incomingText = autoIncomingTextForInstruction(instructionRaw, selected)
  const localText = node.params.text?.trim() ?? ''
  const previousCatalog = parseWorldElementCatalog(incomingText) ?? parseWorldElementCatalog(localText)

  if (!ctx.generateText) {
    const text = instruction.trim() || incomingText || localText
    if (text && text !== localText) {
      node.params = { ...node.params, text }
      ctx.patchNode?.({ params: { text } })
    }
    return { out: { kind: 'text', text } }
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  let prompt = buildWorldExtractPrompt(instruction, ctx.locale)
  if (incomingText) {
    prompt = `${prompt.trim()}\n\n${incomingText}`
  }

  const result = await ctx.generateText({
    prompt,
    system: resolveWorldExtractSystemPrompt(node.params.generateSystemPrompt, ctx.locale),
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined
  })
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  let text = result.text.trim()
  if (!text) throw new Error('模型未返回世界元素提取结果')

  const nextCatalog = parseWorldElementCatalog(text)
  const merged = mergeWorldCatalogPreservingReviewed(previousCatalog, nextCatalog)
  if (merged) {
    text = stringifyWorldElementCatalog(merged)
  }

  node.params = { ...node.params, text }
  ctx.patchNode?.({ params: { text } })
  return { out: { kind: 'text', text } }
}

/**
 * 叙事单元拆解：将上游剧本文本（text）拆成有序叙事单元 JSON。
 * 通常经由 screenplay.select 从 texts 中选出单条后再接入。
 * 未注入 generateText 时退回指令 / 上游 / 本地文本汇总。
 * 本地若含上次拆解 JSON，合并时强制保留「已审核」行。
 */
/** 收集叙事拆解可用的上游剧本文本（含 texts.relativePath 落盘正文） */
async function resolveNarrativeSplitSourceText(
  ctx: NodeExecuteContext,
  instructionRaw: string
): Promise<string> {
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  let text = autoIncomingTextForInstruction(instructionRaw, selected).trim()
  if (text) return text

  // 上游仅有落盘路径、或软快照曾给出空 text 时，按路径 / 资产再读一遍
  for (const value of selected) {
    if (value.kind === 'text' && value.text.trim()) return value.text.trim()
    if (value.kind === 'texts') {
      for (const item of value.items) {
        const body = item.text?.trim() ?? ''
        if (body) return body
        const rel = item.relativePath?.trim()
        if (rel && ctx.readRunText) {
          const fromFile = (await ctx.readRunText(rel))?.trim() ?? ''
          if (fromFile) return fromFile
        }
      }
    }
    if (value.kind === 'asset' && value.assetType === 'screenplay' && value.assetId) {
      const fromAsset = (await ctx.resolveAssetText?.(value.assetId))?.trim() ?? ''
      if (fromAsset) return fromAsset
      const genParams = ctx.resolveAssetGenParams?.(value.assetId)
      const fromGraph = resolveAssetTextFromGenParams(genParams, null).trim()
      if (fromGraph) return fromGraph
    }
  }
  return ''
}

export async function executeNarrativeSplitNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const mentionSources = resolveMentionSources(ctx)
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const incomingText = await resolveNarrativeSplitSourceText(ctx, instructionRaw)
  const localText = node.params.text?.trim() ?? ''
  const previousRows =
    parseNarrativeUnitJson(incomingText) ?? parseNarrativeUnitJson(localText)

  if (!ctx.generateText) {
    // 无模型时优先透传上游剧本，避免空指令盖掉输入
    const text = incomingText || instruction.trim() || localText
    if (text && text !== localText) {
      node.params = { ...node.params, text }
      ctx.patchNode?.({ params: { text } })
    }
    return { out: { kind: 'text', text } }
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  // 无上游正文时：若指令里用了 @ 引用且已展开出内容，仍可继续；否则报无输入
  const hasMentionSource =
    instructionHasMentions(instructionRaw) && !!instruction.trim()
  if (!incomingText.trim() && !hasMentionSource) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  let prompt = buildNarrativeSplitPrompt(instruction, ctx.locale)
  if (incomingText.trim()) {
    prompt = `${prompt.trim()}\n\n${incomingText}`
  }

  const result = await ctx.generateText({
    prompt,
    system: resolveNarrativeSplitSystemPrompt(node.params.generateSystemPrompt, ctx.locale),
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined
  })
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  let text = result.text.trim()
  if (!text) throw new Error('模型未返回叙事单元拆解结果')

  const nextRows = parseNarrativeUnitJson(text)
  const merged = mergeNarrativeUnitRowsPreservingReviewed(previousRows, nextRows)
  if (merged?.length) {
    text = stringifyNarrativeUnitRows(merged)
  }

  node.params = { ...node.params, text }
  ctx.patchNode?.({ params: { text } })
  return { out: { kind: 'text', text } }
}

async function collectImageUrlsForPrompt(
  ctx: NodeExecuteContext,
  instructionRaw: string
): Promise<string[]> {
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const items = flattenImagesValues(selected).filter(
    (item) =>
      (typeof item.dataUrl === 'string' && item.dataUrl.length > 0) ||
      (typeof item.relativePath === 'string' && item.relativePath.length > 0)
  )
  const urls: string[] = []
  if (items.length && ctx.resolveImageUrls) {
    urls.push(...(await ctx.resolveImageUrls(items)))
  } else {
    for (const item of items) {
      const dataUrl = item.dataUrl?.trim()
      if (dataUrl) urls.push(dataUrl)
    }
  }
  if (ctx.resolveAssetImageUrl) {
    for (const asset of flattenAssetValues(selected)) {
      if (asset.assetType !== 'image') continue
      const url = await ctx.resolveAssetImageUrl(asset.assetId)
      if (url) urls.push(url)
    }
  }
  // 去重，最多传 4 张以免请求过大
  return [...new Set(urls.filter(Boolean))].slice(0, 4)
}

/**
 * 图片反推提示词：展开指令后调用视觉文本模型。
 * 未注入 generateText 时退回本地文本 / 上游资产说明。
 */
export async function executeImageToPromptNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const mentionSources = resolveMentionSources(ctx)
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const localText = node.params.text?.trim() ?? ''
  const hints = flattenAssetValues(selected)
    .map((asset) => [asset.title, asset.label, asset.notes].filter(Boolean).join(' · '))
    .filter(Boolean)
    .join('\n')

  if (!ctx.generateText) {
    const text = instruction.trim() || localText || hints
    if (text && text !== localText) {
      node.params = { ...node.params, text }
      ctx.patchNode?.({ params: { text } })
    }
    return { out: { kind: 'text', text } }
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const images = await collectImageUrlsForPrompt(ctx, instructionRaw)
  if (!images.length) {
    // 反推必须有图；有指令但无图时仍提示需要图片输入（非「未连接」泛化）
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const prompt = buildToPromptUserPrompt(instruction, ctx.locale)
  const result = await ctx.generateText({
    prompt,
    system: resolveToPromptSystemPrompt(node.params.generateSystemPrompt, ctx.locale),
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    images
  })
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const text = result.text.trim()
  if (!text) throw new Error('模型未返回提示词')

  node.params = { ...node.params, text }
  ctx.patchNode?.({ params: { text } })
  return { out: { kind: 'text', text } }
}

export function executeCamera3dNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const shots = ctx.node.params.cameraShots ?? []
  const items: GraphImageItem[] = shots
    .filter(
      (shot) =>
        (typeof shot.dataUrl === 'string' && shot.dataUrl.length > 0) ||
        (typeof shot.relativePath === 'string' && shot.relativePath.length > 0)
    )
    .map((shot) => ({
      id: shot.id,
      dataUrl: shot.dataUrl || '',
      createdAt: shot.createdAt,
      ...(shot.relativePath ? { relativePath: shot.relativePath } : {})
    }))
  // 无站位截图时回退单张预览图
  if (!items.length && ctx.node.params.previewDataUrl) {
    items.push({ dataUrl: ctx.node.params.previewDataUrl })
  } else if (!items.length && ctx.node.params.previewRelativePath) {
    items.push({ dataUrl: '', relativePath: ctx.node.params.previewRelativePath })
  }
  return {
    out: { kind: 'images', items }
  }
}

/** 画布上拖入的导演台资产引用：从资产 stage/graph 读取站位图，输出 images */
export function executeMotionAssetRefNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const genParams = ctx.node.assetId
    ? ctx.resolveAssetGenParams?.(ctx.node.assetId)
    : undefined
  const items = resolveMotionImageItems(genParams, ctx.node.params, ctx.node.id)
  if (items.length) {
    const cameraShots = items.map((image, index) => ({
      id: image.id ?? `shot:${index}`,
      dataUrl: image.dataUrl,
      createdAt: image.createdAt ?? new Date().toISOString()
    }))
    ctx.patchNode?.({
      params: {
        cameraShots,
        previewDataUrl: cameraShots[0]?.dataUrl
      }
    })
  }
  return {
    out: { kind: 'images', items }
  }
}

/** 选取图片：从图片数组中选出一张，输出为单张 image */
export function executeSelectImageNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const items = flattenImagesValues(collectIncomingValues(ctx.inputs)).filter(
    (item) =>
      (typeof item.dataUrl === 'string' && item.dataUrl.length > 0) ||
      (typeof item.relativePath === 'string' && item.relativePath.length > 0)
  )
  const picked = pickImageItem(items, ctx.node.params.selectedImageId)
  const selectedImageId = picked
    ? imageItemKey(picked, Math.max(0, items.indexOf(picked)))
    : undefined
  const previewDataUrl = picked?.dataUrl?.trim() ? picked.dataUrl : undefined
  const previewRelativePath = picked?.relativePath?.trim() ? picked.relativePath : undefined
  ctx.node.params = {
    ...ctx.node.params,
    ...(selectedImageId ? { selectedImageId } : {}),
    previewDataUrl,
    previewRelativePath
  }
  ctx.patchNode?.({
    params: {
      selectedImageId,
      previewDataUrl,
      previewRelativePath
    }
  })
  if (!picked) {
    return { out: { kind: 'image', dataUrl: '' } }
  }
  return {
    out: {
      kind: 'image',
      id: selectedImageId,
      dataUrl: picked.dataUrl || '',
      createdAt: picked.createdAt,
      ...(picked.relativePath ? { relativePath: picked.relativePath } : {})
    }
  }
}

/**
 * 选取剧本：从 texts 数组中选出一条，输出为单个 text（落盘项会读全文）。
 */
export async function executeSelectScreenplayNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const items = flattenTextsValues(collectIncomingValues(ctx.inputs)).filter(
    (item) => item.text?.trim() || item.relativePath?.trim()
  )
  const picked = pickTextItem(items, ctx.node.params.selectedTextId)
  const selectedTextId = picked
    ? textItemKey(picked, Math.max(0, items.indexOf(picked)))
    : undefined
  const hydrated = picked
    ? (await hydrateTextItems([picked], ctx.readRunText))[0]
    : undefined
  const text = hydrated?.text?.trim() ?? ''
  const previewRelativePath = hydrated?.relativePath?.trim() || undefined
  ctx.node.params = {
    ...ctx.node.params,
    ...(selectedTextId ? { selectedTextId } : {}),
    text,
    ...(previewRelativePath ? { previewRelativePath } : { previewRelativePath: undefined })
  }
  ctx.patchNode?.({
    params: {
      selectedTextId,
      text,
      previewRelativePath
    }
  })
  return { out: { kind: 'text', text } }
}

/** 选取视频：从视频数组中选出一条，输出为单个 video */
export function executeSelectVideoNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const items = flattenVideosValues(collectIncomingValues(ctx.inputs)).filter(
    (item) =>
      (typeof item.dataUrl === 'string' && item.dataUrl.length > 0) ||
      (typeof item.relativePath === 'string' && item.relativePath.length > 0)
  )
  const picked = pickVideoItem(items, ctx.node.params.selectedVideoId)
  const selectedVideoId = picked
    ? videoItemKey(picked, Math.max(0, items.indexOf(picked)))
    : undefined
  const previewDataUrl = picked?.dataUrl?.trim() ? picked.dataUrl : undefined
  const previewRelativePath = picked?.relativePath?.trim() ? picked.relativePath : undefined
  ctx.node.params = {
    ...ctx.node.params,
    ...(selectedVideoId ? { selectedVideoId } : {}),
    previewDataUrl,
    previewRelativePath
  }
  ctx.patchNode?.({
    params: {
      selectedVideoId,
      previewDataUrl,
      previewRelativePath
    }
  })
  if (!picked) {
    return { out: { kind: 'video' } }
  }
  return {
    out: {
      kind: 'video',
      id: selectedVideoId,
      ...(picked.dataUrl ? { dataUrl: picked.dataUrl } : {}),
      createdAt: picked.createdAt,
      ...(picked.relativePath ? { relativePath: picked.relativePath } : {})
    }
  }
}

/**
 * 多角度编辑：参考图仅用于编辑器预览，不输出图片；
 * 始终按机位输出提示词；promptEnabled 时再拼接面板/上游文本。
 */
export function executeMultiAngleNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const imageInputs = [
    ...(ctx.inputs.in ?? []),
    ...(ctx.inputs['in-image'] ?? [])
  ]
  const items = flattenImagesValues(
    imageInputs.length ? imageInputs : collectIncomingValues(ctx.inputs)
  ).filter(
    (item) =>
      (typeof item.dataUrl === 'string' && item.dataUrl.length > 0) ||
      (typeof item.relativePath === 'string' && item.relativePath.length > 0)
  )
  const picked = items[0]
  const camera = readMultiAngleCameraFromNode(ctx.node.params)
  const panelPrompt = ctx.node.params.text?.trim() || ''
  const patch = multiAngleCameraToNodePatch(camera, panelPrompt)
  const previewDataUrl = picked?.dataUrl?.trim() ? picked.dataUrl : undefined
  const previewRelativePath = picked?.relativePath?.trim() ? picked.relativePath : undefined
  ctx.node.params = {
    ...ctx.node.params,
    ...patch,
    previewDataUrl,
    previewRelativePath
  }
  ctx.patchNode?.({
    params: {
      ...patch,
      previewDataUrl,
      previewRelativePath
    }
  })

  return {
    out: { kind: 'text', text: patch.multiAnglePrompt }
  }
}

/**
 * 打光效果：参考图仅用于编辑器预览；输出最终打光提示词。
 */
export function executeLightingNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const imageInputs = [
    ...(ctx.inputs.in ?? []),
    ...(ctx.inputs['in-image'] ?? [])
  ]
  const items = flattenImagesValues(
    imageInputs.length ? imageInputs : collectIncomingValues(ctx.inputs)
  ).filter(
    (item) =>
      (typeof item.dataUrl === 'string' && item.dataUrl.length > 0) ||
      (typeof item.relativePath === 'string' && item.relativePath.length > 0)
  )
  const picked = items[0]
  const setup = readLightingSetupFromNode(ctx.node.params)
  const lightingPrompt = resolveLightingOutputPrompt(setup)
  const patch = {
    lightingSetup: setup,
    lightingPrompt
  }
  const previewDataUrl = picked?.dataUrl?.trim() ? picked.dataUrl : undefined
  const previewRelativePath = picked?.relativePath?.trim() ? picked.relativePath : undefined
  ctx.node.params = {
    ...ctx.node.params,
    ...patch,
    previewDataUrl,
    previewRelativePath
  }
  ctx.patchNode?.({
    params: {
      ...patch,
      previewDataUrl,
      previewRelativePath
    }
  })

  return {
    out: { kind: 'text', text: lightingPrompt }
  }
}

/**
 * 人像质感调节：参考图仅预览；输出质感提示词。
 */
export function executePortraitTextureNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const imageInputs = [
    ...(ctx.inputs.in ?? []),
    ...(ctx.inputs['in-image'] ?? [])
  ]
  const items = flattenImagesValues(
    imageInputs.length ? imageInputs : collectIncomingValues(ctx.inputs)
  ).filter(
    (item) =>
      (typeof item.dataUrl === 'string' && item.dataUrl.length > 0) ||
      (typeof item.relativePath === 'string' && item.relativePath.length > 0)
  )
  const picked = items[0]
  const patch = portraitTextureToNodePatch(readPortraitTextureFromNode(ctx.node.params))
  const previewDataUrl = picked?.dataUrl?.trim() ? picked.dataUrl : undefined
  const previewRelativePath = picked?.relativePath?.trim() ? picked.relativePath : undefined
  ctx.node.params = {
    ...ctx.node.params,
    ...patch,
    previewDataUrl,
    previewRelativePath
  }
  ctx.patchNode?.({
    params: {
      ...patch,
      previewDataUrl,
      previewRelativePath
    }
  })

  return {
    out: { kind: 'text', text: patch.portraitTexturePrompt }
  }
}

/**
 * 情绪调节：参考图仅预览；输出情绪定位提示词。
 */
export function executeEmotionNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const imageInputs = [
    ...(ctx.inputs.in ?? []),
    ...(ctx.inputs['in-image'] ?? [])
  ]
  const items = flattenImagesValues(
    imageInputs.length ? imageInputs : collectIncomingValues(ctx.inputs)
  ).filter(
    (item) =>
      (typeof item.dataUrl === 'string' && item.dataUrl.length > 0) ||
      (typeof item.relativePath === 'string' && item.relativePath.length > 0)
  )
  const picked = items[0]
  const patch = emotionPadToNodePatch(readEmotionPadFromNode(ctx.node.params))
  const previewDataUrl = picked?.dataUrl?.trim() ? picked.dataUrl : undefined
  const previewRelativePath = picked?.relativePath?.trim() ? picked.relativePath : undefined
  ctx.node.params = {
    ...ctx.node.params,
    ...patch,
    previewDataUrl,
    previewRelativePath
  }
  ctx.patchNode?.({
    params: {
      ...patch,
      previewDataUrl,
      previewRelativePath
    }
  })

  return {
    out: { kind: 'text', text: patch.emotionPrompt }
  }
}

/**
 * 高清放大：以上游图为参考，调用图片模型做超分。
 */
export async function executeUpscaleNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const sourceItems = await collectIncomingImageItems(ctx)
  if (!sourceItems.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const upscale = readImageUpscaleFromNode(ctx.node.params)
  const userPrompt = buildUpscalePrompt(upscale)
  const system = resolveUpscaleSystemPrompt(ctx.node.params.generateSystemPrompt, ctx.locale)
  // /images 无独立 system 字段，拼入 prompt
  const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt
  const resolution = upscaleScaleToResolution(upscale.scale)

  if (!ctx.generateImage) {
    // 无 API 时透传输入，便于离线预览链路
    const picked = sourceItems[0]!
    ctx.node.params = {
      ...ctx.node.params,
      imageUpscale: upscale,
      previewDataUrl: picked.dataUrl?.trim() ? picked.dataUrl : undefined,
      previewRelativePath: picked.relativePath?.trim() ? picked.relativePath : undefined
    }
    ctx.patchNode?.({
      params: {
        imageUpscale: upscale,
        previewDataUrl: picked.dataUrl?.trim() ? picked.dataUrl : undefined,
        previewRelativePath: picked.relativePath?.trim() ? picked.relativePath : undefined
      }
    })
    return { out: { kind: 'images', items: [picked] } }
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  let inputReferences: string[] = []
  if (ctx.resolveImageUrls) {
    inputReferences = (await ctx.resolveImageUrls(sourceItems.slice(0, 1))).filter(Boolean)
  } else {
    const dataUrl = sourceItems[0]?.dataUrl?.trim()
    if (dataUrl) inputReferences = [dataUrl]
  }
  // 资产引用路径下 collect 已写入 dataUrl；若仍为空再尝试 asset 解析兜底
  if (!inputReferences.length && ctx.resolveAssetImageUrl) {
    for (const value of [
      ...(ctx.inputs.in ?? []),
      ...(ctx.inputs['in-image'] ?? []),
      ...collectIncomingValues(ctx.inputs)
    ]) {
      if (value.kind !== 'asset' || value.assetType !== 'image') continue
      const url = await ctx.resolveAssetImageUrl(value.assetId)
      if (url) {
        inputReferences = [url]
        break
      }
    }
  }
  if (!inputReferences.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const result = await ctx.generateImage({
    prompt,
    model: ctx.node.params.generateModel || undefined,
    providerInstanceId: ctx.node.params.generateProviderInstanceId || undefined,
    resolution,
    quality: 'high',
    n: 1,
    inputReferences
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const batch: GraphImageItem[] = []
  for (const [index, url] of (result.images ?? []).entries()) {
    const dataUrl = typeof url === 'string' ? url.trim() : ''
    if (!dataUrl) continue
    batch.push({
      id: `upscale:${ctx.node.id}:${stamp}:${index}`,
      dataUrl,
      createdAt
    })
  }
  if (!batch.length) {
    throw new Error('模型未返回放大图片')
  }

  const stampKey = `upscale:${ctx.node.id}:${stamp}`
  const materializedBatch = await materializeGeneratedBatch(ctx, batch, stampKey)
  if (!materializedBatch.length) {
    throw new Error('图片落盘失败')
  }
  const generatedImages = mergeGeneratedImages(ctx, materializedBatch, `${stampKey}:keep`)

  ctx.node.params = {
    ...ctx.node.params,
    imageUpscale: upscale,
    generatedImages
  }
  ctx.patchNode?.({
    params: {
      imageUpscale: upscale,
      generatedImages,
      previewDataUrl: undefined,
      previewRelativePath: materializedBatch[0]?.relativePath?.trim() || ''
    }
  })
  // out 与预览一致：输出累计 generatedImages（含历史批次），而非仅本次新图
  return { out: { kind: 'images', items: generatedImages } }
}

/**
 * 扩图：按锚点合成扩展画布后，调用图片模型 outpaint。
 */
export async function executeExpandNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const sourceItems = await collectIncomingImageItems(ctx)
  if (!sourceItems.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const expand = readImageExpandFromNode(ctx.node.params)
  const userPrompt = buildExpandPrompt(expand)
  const system = resolveExpandSystemPrompt(ctx.node.params.generateSystemPrompt, ctx.locale)
  const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt

  if (!ctx.generateImage) {
    const picked = sourceItems[0]!
    ctx.node.params = {
      ...ctx.node.params,
      imageExpand: expand,
      previewDataUrl: picked.dataUrl?.trim() ? picked.dataUrl : undefined,
      previewRelativePath: picked.relativePath?.trim() ? picked.relativePath : undefined
    }
    ctx.patchNode?.({
      params: {
        imageExpand: expand,
        previewDataUrl: picked.dataUrl?.trim() ? picked.dataUrl : undefined,
        previewRelativePath: picked.relativePath?.trim() ? picked.relativePath : undefined
      }
    })
    return { out: { kind: 'images', items: [picked] } }
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  let sourceUrls: string[] = []
  if (ctx.resolveImageUrls) {
    sourceUrls = (await ctx.resolveImageUrls(sourceItems.slice(0, 1))).filter(Boolean)
  } else {
    const dataUrl = sourceItems[0]?.dataUrl?.trim()
    if (dataUrl) sourceUrls = [dataUrl]
  }
  if (!sourceUrls.length && ctx.resolveAssetImageUrl) {
    for (const value of [
      ...(ctx.inputs.in ?? []),
      ...(ctx.inputs['in-image'] ?? []),
      ...collectIncomingValues(ctx.inputs)
    ]) {
      if (value.kind !== 'asset' || value.assetType !== 'image') continue
      const url = await ctx.resolveAssetImageUrl(value.assetId)
      if (url) {
        sourceUrls = [url]
        break
      }
    }
  }
  if (!sourceUrls.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  let inputReferences = sourceUrls.slice(0, 1)
  let aspectRatio = apiAspectRatioForExpand(expand)
  if (ctx.composeImageExpandCanvas) {
    try {
      const composed = await ctx.composeImageExpandCanvas({
        sourceDataUrl: sourceUrls[0]!,
        state: expand
      })
      if (composed.dataUrl) {
        inputReferences = [composed.dataUrl]
        if (composed.aspectRatio) aspectRatio = composed.aspectRatio
      }
    } catch {
      /* 合成失败时退回原图参考 */
    }
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const result = await ctx.generateImage({
    prompt,
    model: ctx.node.params.generateModel || undefined,
    providerInstanceId: ctx.node.params.generateProviderInstanceId || undefined,
    aspectRatio,
    resolution: expand.resolution,
    quality: 'high',
    n: expand.count,
    inputReferences
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const batch: GraphImageItem[] = []
  for (const [index, url] of (result.images ?? []).entries()) {
    const dataUrl = typeof url === 'string' ? url.trim() : ''
    if (!dataUrl) continue
    batch.push({
      id: `expand:${ctx.node.id}:${stamp}:${index}`,
      dataUrl,
      createdAt
    })
  }
  if (!batch.length) {
    throw new Error('模型未返回扩图结果')
  }

  const stampKey = `expand:${ctx.node.id}:${stamp}`
  const materializedBatch = await materializeGeneratedBatch(ctx, batch, stampKey)
  if (!materializedBatch.length) {
    throw new Error('图片落盘失败')
  }
  const generatedImages = mergeGeneratedImages(ctx, materializedBatch, `${stampKey}:keep`)

  ctx.node.params = {
    ...ctx.node.params,
    imageExpand: expand,
    generatedImages
  }
  ctx.patchNode?.({
    params: {
      imageExpand: expand,
      generatedImages,
      previewDataUrl: undefined,
      previewRelativePath: materializedBatch[0]?.relativePath?.trim() || ''
    }
  })
  // out 与预览一致：输出累计 generatedImages（含历史批次），而非仅本次新图
  return { out: { kind: 'images', items: generatedImages } }
}

/**
 * 重绘：按蒙版挖空后调用图片模型 inpaint。
 */
export async function executeRedrawNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const sourceItems = await collectIncomingImageItems(ctx)
  if (!sourceItems.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const redraw = readImageRedrawFromNode(ctx.node.params)
  const userPrompt = buildRedrawUserPrompt(redraw)
  const system = resolveRedrawSystemPrompt(ctx.node.params.generateSystemPrompt, ctx.locale)
  const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt

  if (!ctx.generateImage) {
    const picked = sourceItems[0]!
    ctx.node.params = {
      ...ctx.node.params,
      imageRedraw: redraw,
      previewDataUrl: picked.dataUrl?.trim() ? picked.dataUrl : undefined,
      previewRelativePath: picked.relativePath?.trim() ? picked.relativePath : undefined
    }
    ctx.patchNode?.({
      params: {
        imageRedraw: redraw,
        previewDataUrl: picked.dataUrl?.trim() ? picked.dataUrl : undefined,
        previewRelativePath: picked.relativePath?.trim() ? picked.relativePath : undefined
      }
    })
    return { out: { kind: 'images', items: [picked] } }
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  let sourceUrls: string[] = []
  if (ctx.resolveImageUrls) {
    sourceUrls = (await ctx.resolveImageUrls(sourceItems.slice(0, 1))).filter(Boolean)
  } else {
    const dataUrl = sourceItems[0]?.dataUrl?.trim()
    if (dataUrl) sourceUrls = [dataUrl]
  }
  if (!sourceUrls.length && ctx.resolveAssetImageUrl) {
    for (const value of [
      ...(ctx.inputs.in ?? []),
      ...(ctx.inputs['in-image'] ?? []),
      ...collectIncomingValues(ctx.inputs)
    ]) {
      if (value.kind !== 'asset' || value.assetType !== 'image') continue
      const url = await ctx.resolveAssetImageUrl(value.assetId)
      if (url) {
        sourceUrls = [url]
        break
      }
    }
  }
  if (!sourceUrls.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  if (!hasRedrawMask(redraw)) {
    throw new Error('GRAPH_REDRAW_NO_MASK')
  }

  let inputReferences = sourceUrls.slice(0, 1)
  let aspectRatio = apiAspectRatioForRedraw(redraw)
  if (ctx.composeImageRedrawCanvas) {
    try {
      const composed = await ctx.composeImageRedrawCanvas({
        sourceDataUrl: sourceUrls[0]!,
        state: redraw
      })
      if (composed.dataUrl) {
        inputReferences = [composed.dataUrl]
        if (composed.maskDataUrl) inputReferences.push(composed.maskDataUrl)
        if (composed.aspectRatio) aspectRatio = composed.aspectRatio
      }
    } catch {
      /* 合成失败时退回原图 + 原始 mask */
      if (redraw.maskDataUrl) inputReferences = [sourceUrls[0]!, redraw.maskDataUrl]
    }
  } else if (redraw.maskDataUrl) {
    inputReferences = [sourceUrls[0]!, redraw.maskDataUrl]
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const result = await ctx.generateImage({
    prompt,
    model: ctx.node.params.generateModel || undefined,
    providerInstanceId: ctx.node.params.generateProviderInstanceId || undefined,
    aspectRatio,
    resolution: redraw.resolution,
    quality: 'high',
    n: redraw.count,
    inputReferences
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const batch: GraphImageItem[] = []
  for (const [index, url] of (result.images ?? []).entries()) {
    const dataUrl = typeof url === 'string' ? url.trim() : ''
    if (!dataUrl) continue
    batch.push({
      id: `redraw:${ctx.node.id}:${stamp}:${index}`,
      dataUrl,
      createdAt
    })
  }
  if (!batch.length) {
    throw new Error('模型未返回重绘结果')
  }

  const stampKey = `redraw:${ctx.node.id}:${stamp}`
  const materializedBatch = await materializeGeneratedBatch(ctx, batch, stampKey)
  if (!materializedBatch.length) {
    throw new Error('图片落盘失败')
  }
  const generatedImages = mergeGeneratedImages(ctx, materializedBatch, `${stampKey}:keep`)

  ctx.node.params = {
    ...ctx.node.params,
    imageRedraw: redraw,
    generatedImages
  }
  ctx.patchNode?.({
    params: {
      imageRedraw: redraw,
      generatedImages,
      previewDataUrl: undefined,
      previewRelativePath: materializedBatch[0]?.relativePath?.trim() || ''
    }
  })
  // out 与预览一致：输出累计 generatedImages（含历史批次），而非仅本次新图
  return { out: { kind: 'images', items: generatedImages } }
}

/**
 * 擦除：蒙版挖空后调用图片模型做 object removal。
 */
export async function executeEraseNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const sourceItems = await collectIncomingImageItems(ctx)
  if (!sourceItems.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const erase = readImageEraseFromNode(ctx.node.params)
  const userPrompt = buildEraseUserPrompt(erase)
  const system = resolveEraseSystemPrompt(ctx.node.params.generateSystemPrompt, ctx.locale)
  const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt

  if (!ctx.generateImage) {
    const picked = sourceItems[0]!
    ctx.node.params = {
      ...ctx.node.params,
      imageErase: erase,
      previewDataUrl: picked.dataUrl?.trim() ? picked.dataUrl : undefined,
      previewRelativePath: picked.relativePath?.trim() ? picked.relativePath : undefined
    }
    ctx.patchNode?.({
      params: {
        imageErase: erase,
        previewDataUrl: picked.dataUrl?.trim() ? picked.dataUrl : undefined,
        previewRelativePath: picked.relativePath?.trim() ? picked.relativePath : undefined
      }
    })
    return { out: { kind: 'images', items: [picked] } }
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  let sourceUrls: string[] = []
  if (ctx.resolveImageUrls) {
    sourceUrls = (await ctx.resolveImageUrls(sourceItems.slice(0, 1))).filter(Boolean)
  } else {
    const dataUrl = sourceItems[0]?.dataUrl?.trim()
    if (dataUrl) sourceUrls = [dataUrl]
  }
  if (!sourceUrls.length && ctx.resolveAssetImageUrl) {
    for (const value of [
      ...(ctx.inputs.in ?? []),
      ...(ctx.inputs['in-image'] ?? []),
      ...collectIncomingValues(ctx.inputs)
    ]) {
      if (value.kind !== 'asset' || value.assetType !== 'image') continue
      const url = await ctx.resolveAssetImageUrl(value.assetId)
      if (url) {
        sourceUrls = [url]
        break
      }
    }
  }
  if (!sourceUrls.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  if (!hasEraseMask(erase)) {
    throw new Error('GRAPH_REDRAW_NO_MASK')
  }

  let inputReferences = sourceUrls.slice(0, 1)
  let aspectRatio = apiAspectRatioForErase(erase)
  if (ctx.composeImageRedrawCanvas) {
    try {
      const composed = await ctx.composeImageRedrawCanvas({
        sourceDataUrl: sourceUrls[0]!,
        state: erase
      })
      if (composed.dataUrl) {
        inputReferences = [composed.dataUrl]
        if (composed.maskDataUrl) inputReferences.push(composed.maskDataUrl)
        if (composed.aspectRatio) aspectRatio = composed.aspectRatio
      }
    } catch {
      if (erase.maskDataUrl) inputReferences = [sourceUrls[0]!, erase.maskDataUrl]
    }
  } else if (erase.maskDataUrl) {
    inputReferences = [sourceUrls[0]!, erase.maskDataUrl]
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const result = await ctx.generateImage({
    prompt,
    model: ctx.node.params.generateModel || undefined,
    providerInstanceId: ctx.node.params.generateProviderInstanceId || undefined,
    aspectRatio,
    resolution: erase.resolution,
    quality: 'high',
    n: erase.count,
    inputReferences
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const batch: GraphImageItem[] = []
  for (const [index, url] of (result.images ?? []).entries()) {
    const dataUrl = typeof url === 'string' ? url.trim() : ''
    if (!dataUrl) continue
    batch.push({
      id: `erase:${ctx.node.id}:${stamp}:${index}`,
      dataUrl,
      createdAt
    })
  }
  if (!batch.length) {
    throw new Error('模型未返回擦除结果')
  }

  const stampKey = `erase:${ctx.node.id}:${stamp}`
  const materializedBatch = await materializeGeneratedBatch(ctx, batch, stampKey)
  if (!materializedBatch.length) {
    throw new Error('图片落盘失败')
  }
  const generatedImages = mergeGeneratedImages(ctx, materializedBatch, `${stampKey}:keep`)

  ctx.node.params = {
    ...ctx.node.params,
    imageErase: erase,
    generatedImages
  }
  ctx.patchNode?.({
    params: {
      imageErase: erase,
      generatedImages,
      previewDataUrl: undefined,
      previewRelativePath: materializedBatch[0]?.relativePath?.trim() || ''
    }
  })
  // out 与预览一致：输出累计 generatedImages（含历史批次），而非仅本次新图
  return { out: { kind: 'images', items: generatedImages } }
}

/**
 * 抠图：无蒙版自动去背景；有蒙版时白区保留、黑区透明。
 */
export async function executeMatteNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const sourceItems = await collectIncomingImageItems(ctx)
  if (!sourceItems.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const matte = readImageMatteFromNode(ctx.node.params)
  const userPrompt = buildMatteUserPrompt(matte)
  const system = resolveMatteSystemPrompt(ctx.node.params.generateSystemPrompt, ctx.locale)
  const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt

  if (!ctx.generateImage) {
    const picked = sourceItems[0]!
    ctx.node.params = {
      ...ctx.node.params,
      imageMatte: matte,
      previewDataUrl: picked.dataUrl?.trim() ? picked.dataUrl : undefined,
      previewRelativePath: picked.relativePath?.trim() ? picked.relativePath : undefined
    }
    ctx.patchNode?.({
      params: {
        imageMatte: matte,
        previewDataUrl: picked.dataUrl?.trim() ? picked.dataUrl : undefined,
        previewRelativePath: picked.relativePath?.trim() ? picked.relativePath : undefined
      }
    })
    return { out: { kind: 'images', items: [picked] } }
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  let sourceUrls: string[] = []
  if (ctx.resolveImageUrls) {
    sourceUrls = (await ctx.resolveImageUrls(sourceItems.slice(0, 1))).filter(Boolean)
  } else {
    const dataUrl = sourceItems[0]?.dataUrl?.trim()
    if (dataUrl) sourceUrls = [dataUrl]
  }
  if (!sourceUrls.length && ctx.resolveAssetImageUrl) {
    for (const value of [
      ...(ctx.inputs.in ?? []),
      ...(ctx.inputs['in-image'] ?? []),
      ...collectIncomingValues(ctx.inputs)
    ]) {
      if (value.kind !== 'asset' || value.assetType !== 'image') continue
      const url = await ctx.resolveAssetImageUrl(value.assetId)
      if (url) {
        sourceUrls = [url]
        break
      }
    }
  }
  if (!sourceUrls.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  let inputReferences = sourceUrls.slice(0, 1)
  let aspectRatio = apiAspectRatioForMatte(matte)
  if (hasMatteMask(matte) && ctx.composeImageRedrawCanvas) {
    try {
      const composed = await ctx.composeImageRedrawCanvas({
        sourceDataUrl: sourceUrls[0]!,
        state: matte,
        punch: 'black'
      })
      if (composed.dataUrl) {
        inputReferences = [composed.dataUrl]
        if (composed.maskDataUrl) inputReferences.push(composed.maskDataUrl)
        if (composed.aspectRatio) aspectRatio = composed.aspectRatio
      }
    } catch {
      if (matte.maskDataUrl) inputReferences = [sourceUrls[0]!, matte.maskDataUrl]
    }
  } else if (hasMatteMask(matte) && matte.maskDataUrl) {
    inputReferences = [sourceUrls[0]!, matte.maskDataUrl]
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const result = await ctx.generateImage({
    prompt,
    model: ctx.node.params.generateModel || undefined,
    providerInstanceId: ctx.node.params.generateProviderInstanceId || undefined,
    aspectRatio,
    resolution: matte.resolution,
    quality: 'high',
    n: matte.count,
    inputReferences
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const batch: GraphImageItem[] = []
  for (const [index, url] of (result.images ?? []).entries()) {
    const dataUrl = typeof url === 'string' ? url.trim() : ''
    if (!dataUrl) continue
    batch.push({
      id: `matte:${ctx.node.id}:${stamp}:${index}`,
      dataUrl,
      createdAt
    })
  }
  if (!batch.length) {
    throw new Error('模型未返回抠图结果')
  }

  const stampKey = `matte:${ctx.node.id}:${stamp}`
  const materializedBatch = await materializeGeneratedBatch(ctx, batch, stampKey)
  if (!materializedBatch.length) {
    throw new Error('图片落盘失败')
  }
  const generatedImages = mergeGeneratedImages(ctx, materializedBatch, `${stampKey}:keep`)

  ctx.node.params = {
    ...ctx.node.params,
    imageMatte: matte,
    generatedImages
  }
  ctx.patchNode?.({
    params: {
      imageMatte: matte,
      generatedImages,
      previewDataUrl: undefined,
      previewRelativePath: materializedBatch[0]?.relativePath?.trim() || ''
    }
  })
  // out 与预览一致：输出累计 generatedImages（含历史批次），而非仅本次新图
  return { out: { kind: 'images', items: generatedImages } }
}

/**
 * 裁剪：本地按归一化框裁出图片（不调模型）。
 */
export async function executeCropNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const sourceItems = await collectIncomingImageItems(ctx)
  if (!sourceItems.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const crop = readImageCropFromNode(ctx.node.params)

  let sourceUrls: string[] = []
  if (ctx.resolveImageUrls) {
    sourceUrls = (await ctx.resolveImageUrls(sourceItems.slice(0, 1))).filter(Boolean)
  } else {
    const dataUrl = sourceItems[0]?.dataUrl?.trim()
    if (dataUrl) sourceUrls = [dataUrl]
  }
  if (!sourceUrls.length && ctx.resolveAssetImageUrl) {
    for (const value of [
      ...(ctx.inputs.in ?? []),
      ...(ctx.inputs['in-image'] ?? []),
      ...collectIncomingValues(ctx.inputs)
    ]) {
      if (value.kind !== 'asset' || value.assetType !== 'image') continue
      const url = await ctx.resolveAssetImageUrl(value.assetId)
      if (url) {
        sourceUrls = [url]
        break
      }
    }
  }
  if (!sourceUrls.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  if (!ctx.composeImageCropCanvas) {
    // 无合成注入时透传，便于离线
    const picked = sourceItems[0]!
    ctx.node.params = { ...ctx.node.params, imageCrop: crop }
    ctx.patchNode?.({ params: { imageCrop: crop } })
    return { out: { kind: 'images', items: [picked] } }
  }

  const composed = await ctx.composeImageCropCanvas({
    sourceDataUrl: sourceUrls[0]!,
    state: crop
  })
  if (!composed.dataUrl) {
    throw new Error('裁剪失败')
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const item: GraphImageItem = {
    id: `crop:${ctx.node.id}:${stamp}`,
    dataUrl: composed.dataUrl,
    createdAt
  }
  const materializedBatch = await materializeGeneratedBatch(ctx, [item], `crop:${ctx.node.id}:${stamp}`)
  if (!materializedBatch.length) {
    throw new Error('图片落盘失败')
  }
  const generatedImages = mergeGeneratedImages(ctx, materializedBatch, `crop:${ctx.node.id}:${stamp}:keep`)

  ctx.node.params = {
    ...ctx.node.params,
    imageCrop: crop,
    generatedImages
  }
  ctx.patchNode?.({
    params: {
      imageCrop: crop,
      generatedImages,
      previewDataUrl: undefined,
      previewRelativePath: materializedBatch[0]?.relativePath?.trim() || ''
    }
  })
  // out 与预览一致：输出累计 generatedImages（含历史批次），而非仅本次新图
  return { out: { kind: 'images', items: generatedImages } }
}

/**
 * 宫格切分：裁出选中（或全部）宫格，再逐格高清放大。
 */
export async function executeGridSplitNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const sourceItems = await collectIncomingImageItems(ctx)
  if (!sourceItems.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const grid = readImageGridSplitFromNode(ctx.node.params)
  const targets = resolveGridSplitTargets(grid)
  if (!targets.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  let sourceUrls: string[] = []
  if (ctx.resolveImageUrls) {
    sourceUrls = (await ctx.resolveImageUrls(sourceItems.slice(0, 1))).filter(Boolean)
  } else {
    const dataUrl = sourceItems[0]?.dataUrl?.trim()
    if (dataUrl) sourceUrls = [dataUrl]
  }
  if (!sourceUrls.length && ctx.resolveAssetImageUrl) {
    for (const value of [
      ...(ctx.inputs.in ?? []),
      ...(ctx.inputs['in-image'] ?? []),
      ...collectIncomingValues(ctx.inputs)
    ]) {
      if (value.kind !== 'asset' || value.assetType !== 'image') continue
      const url = await ctx.resolveAssetImageUrl(value.assetId)
      if (url) {
        sourceUrls = [url]
        break
      }
    }
  }
  if (!sourceUrls.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const system = resolveGridSplitSystemPrompt(ctx.node.params.generateSystemPrompt, ctx.locale)
  const resolution = gridSplitScaleToResolution(grid.scale)
  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const batch: GraphImageItem[] = []

  for (const [index, cell] of targets.entries()) {
    if (ctx.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    let cellDataUrl = sourceUrls[0]!
    if (ctx.composeImageGridCell) {
      try {
        const composed = await ctx.composeImageGridCell({
          sourceDataUrl: sourceUrls[0]!,
          state: grid,
          cellKey: cell
        })
        if (composed.dataUrl) cellDataUrl = composed.dataUrl
      } catch {
        /* 裁切失败则退回整图参考 */
      }
    }

    const userPrompt = buildGridCellUpscalePrompt(cell, grid.scale)
    const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt

    if (!ctx.generateImage) {
      batch.push({
        id: `gridSplit:${ctx.node.id}:${stamp}:${cell}`,
        dataUrl: cellDataUrl,
        createdAt
      })
      continue
    }

    const result = await ctx.generateImage({
      prompt,
      model: ctx.node.params.generateModel || undefined,
      providerInstanceId: ctx.node.params.generateProviderInstanceId || undefined,
      resolution,
      quality: 'high',
      n: 1,
      inputReferences: [cellDataUrl]
    })
    const url = result.images?.[0]
    const dataUrl = typeof url === 'string' ? url.trim() : ''
    if (!dataUrl) continue
    batch.push({
      id: `gridSplit:${ctx.node.id}:${stamp}:${cell}:${index}`,
      dataUrl,
      createdAt
    })
  }

  if (!batch.length) {
    throw new Error('模型未返回宫格放大结果')
  }

  const materializedBatch = await materializeGeneratedBatch(
    ctx,
    batch,
    `grid:${ctx.node.id}:${stamp}`
  )
  if (!materializedBatch.length) {
    throw new Error('图片落盘失败')
  }
  const generatedImages = mergeGeneratedImages(
    ctx,
    materializedBatch,
    `grid:${ctx.node.id}:${stamp}:keep`
  )

  ctx.node.params = {
    ...ctx.node.params,
    imageGridSplit: grid,
    generatedImages
  }
  ctx.patchNode?.({
    params: {
      imageGridSplit: grid,
      generatedImages,
      previewDataUrl: undefined,
      previewRelativePath: materializedBatch[0]?.relativePath?.trim() || ''
    }
  })
  // out 与预览一致：输出累计 generatedImages（含历史批次），而非仅本次新图
  return { out: { kind: 'images', items: generatedImages } }
}

/**
 * 「剧本输出」：不调用大模型，透传 texts（有路径时只传 relativePath，对齐图片）。
 */
export async function executeScreenplayOutputNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const incoming = collectIncomingValues(ctx.inputs)
  const textItems = flattenTextsValues(incoming)
  const hydrated = await hydrateTextItems(textItems, ctx.readRunText)
  const notes: GraphTextValue[] = hydrated
    .map((item) => item.text.trim())
    .filter(Boolean)
    .map((text) => ({ kind: 'text' as const, text }))
  const resultText = notes.map((item) => item.text).join('\n\n')
  const outputKind: GraphOutputKind = ctx.node.params.outputKind ?? 'text'
  ctx.node.params = { ...ctx.node.params, resultText }
  ctx.patchNode?.({ params: { resultText } })
  const value: GraphOutputValue = {
    kind: 'output',
    outputKind,
    items: [],
    notes,
    // 边上/落盘：路径优先，清空已物化正文
    texts: textItems.map(stripEmbeddedTextData),
    params: { ...ctx.node.params, outputKind }
  }
  return { out: value }
}

function sanitizeNarrativeOutputKeyPart(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^\w\u4e00-\u9fff.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
  return cleaned || fallback
}

/** 落盘文件名：优先条目 title，其次全文首行「序号. 标题」 */
function resolveNarrativeUnitFileKey(item: GraphTextItem, index: number): string {
  const fromTitle = item.title?.trim()
  if (fromTitle) {
    return sanitizeNarrativeOutputKeyPart(fromTitle, `叙事单元${index + 1}`)
  }
  const firstLine = item.text?.split(/\r?\n/, 1)[0]?.trim() ?? ''
  const numbered = firstLine.match(/^\d+\.\s*(.+)$/)
  const fromLine = (numbered?.[1] ?? firstLine).trim()
  if (fromLine) {
    return sanitizeNarrativeOutputKeyPart(fromLine, `叙事单元${index + 1}`)
  }
  return sanitizeNarrativeOutputKeyPart(item.id?.trim() || '', `叙事单元${index + 1}`)
}

/**
 * 「叙事单元输出」：将上游 texts 每一项落地为剧本（txt + screenplay 资产），写回 generatedTexts。
 */
export async function executeNarrativeOutputNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const incoming = collectIncomingValues(ctx.inputs)
  const textItems = flattenTextsValues(incoming)
  const hydrated = await hydrateTextItems(textItems, ctx.readRunText)
  if (!hydrated.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const createdAt = new Date().toISOString()
  const stamp = formatGeneratedMediaStamp()
  const materialized: GraphTextItem[] = []

  for (let index = 0; index < hydrated.length; index++) {
    const item = hydrated[index]!
    const text = item.text?.trim() ?? ''
    const existingPath = item.relativePath?.trim()
    const id = item.id?.trim() || `nu-out:${stamp}:${index}`
    const fileKey = resolveNarrativeUnitFileKey(item, index)
    const title = item.title?.trim() || fileKey

    // 已有旁挂路径且无需重写：保留路径（正文可已 hydrate）
    if (existingPath && !ctx.saveRunText) {
      materialized.push({
        id,
        title,
        text: '',
        createdAt: item.createdAt ?? createdAt,
        relativePath: existingPath
      })
      continue
    }

    if (!text && existingPath) {
      materialized.push({
        id,
        title,
        text: '',
        createdAt: item.createdAt ?? createdAt,
        relativePath: existingPath
      })
      continue
    }

    if (!text) continue

    if (!ctx.saveRunText) {
      materialized.push({
        id,
        title,
        text,
        createdAt: item.createdAt ?? createdAt
      })
      continue
    }

    try {
      const relativePath = await ctx.saveRunText({
        content: text,
        key: fileKey,
        outputDir: ctx.node.params.mediaOutputDir?.trim() || undefined,
        node: ctx.node
      })
      materialized.push({
        id,
        title,
        text: '',
        createdAt: item.createdAt ?? createdAt,
        relativePath
      })
    } catch (err) {
      console.warn('[graph] narrative output save failed', err)
      materialized.push({
        id,
        title,
        text,
        createdAt: item.createdAt ?? createdAt
      })
    }
  }

  if (!materialized.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const previewRelativePath = materialized.find((item) => item.relativePath?.trim())
    ?.relativePath
  const resultText = (
    await hydrateTextItems(materialized, ctx.readRunText)
  )
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join('\n\n')

  const outputKind: GraphOutputKind = 'text'
  const paramsPatch = {
    outputKind,
    generatedTexts: materialized.map(stripEmbeddedTextData),
    previewRelativePath: previewRelativePath?.trim() || '',
    resultText
  }
  ctx.node.params = { ...ctx.node.params, ...paramsPatch }
  ctx.patchNode?.({ params: paramsPatch })

  const value: GraphOutputValue = {
    kind: 'output',
    outputKind,
    items: [],
    notes: resultText
      ? resultText.split(/\n\n+/).map((text) => ({ kind: 'text' as const, text }))
      : [],
    texts: materialized.map(stripEmbeddedTextData),
    params: { ...ctx.node.params, outputKind }
  }
  return { out: value }
}

export async function executeOutputNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  if (ctx.node.typeId === 'output.narrative') {
    return executeNarrativeOutputNode(ctx)
  }
  // 「剧本/文本输出」：透传为 texts，不调大模型、不收集媒体 genRefs
  if (ctx.node.params.outputKind === 'text' || ctx.node.typeId === 'output.text') {
    return executeScreenplayOutputNode(ctx)
  }

  const incoming = collectIncomingValues(ctx.inputs)
  const items = flattenAssetValues(incoming)
  const notes = flattenTextValues(incoming)
  const images = flattenImagesValues(incoming)
  const videos = flattenVideosValues(incoming)
  const voices = flattenVoicesValues(incoming)
  const outputKind: GraphOutputKind = ctx.node.params.outputKind ?? 'video'
  const params: GraphNodeParams = { ...ctx.node.params, outputKind }
  // 图片数组输入（导演台 / 图片输出）：写回预览，便于节点卡与下游读取
  const acceptImages =
    ctx.node.params.inputDataType === GraphPortType.image || outputKind === 'image'
  const acceptVideos =
    ctx.node.params.inputDataType === GraphPortType.video || outputKind === 'video'
  const acceptVoices =
    ctx.node.params.inputDataType === GraphPortType.voice || outputKind === 'voice'
  if (images.length && acceptImages) {
    const cameraShots = images.map((image, index) => ({
      id: image.id ?? `shot:${index}`,
      dataUrl: image.dataUrl,
      createdAt: image.createdAt ?? new Date().toISOString(),
      ...(image.relativePath ? { relativePath: image.relativePath } : {})
    }))
    const previewDataUrl = cameraShots[0]?.dataUrl?.trim()
      ? cameraShots[0].dataUrl
      : undefined
    const previewRelativePath = cameraShots[0]?.relativePath?.trim()
      ? cameraShots[0].relativePath
      : undefined
    ctx.patchNode?.({
      params: {
        cameraShots,
        previewDataUrl,
        previewRelativePath
      }
    })
    params.cameraShots = cameraShots
    params.previewDataUrl = previewDataUrl
    params.previewRelativePath = previewRelativePath
  } else if (videos.length && acceptVideos) {
    const previewRelativePath = videos[0]?.relativePath?.trim() || undefined
    if (previewRelativePath) {
      ctx.patchNode?.({ params: { previewRelativePath } })
      params.previewRelativePath = previewRelativePath
    }
  } else if (voices.length && acceptVoices) {
    const previewRelativePath = voices[0]?.relativePath?.trim() || undefined
    if (previewRelativePath) {
      ctx.patchNode?.({ params: { previewRelativePath } })
      params.previewRelativePath = previewRelativePath
    }
  } else if (outputKind === 'video' || outputKind === 'voice') {
    // 视频 / 声音输出：从上游资产写回预览路径（与图片输出对称）
    const preferred =
      items.find((item) => item.assetType === outputKind) ?? items[0]
    const previewRelativePath = preferred?.relativePath?.trim() || undefined
    if (previewRelativePath) {
      ctx.patchNode?.({ params: { previewRelativePath } })
      params.previewRelativePath = previewRelativePath
    }
  }
  const value: GraphOutputValue = {
    kind: 'output',
    outputKind,
    items,
    notes,
    params,
    ...(images.length ? { images } : {}),
    ...(videos.length ? { videos } : {}),
    ...(voices.length ? { voices } : {})
  }
  return { out: value }
}

/** 无 execute 时的兜底：透传第一个输入或空 */
export function executePassthrough(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const first = Object.values(ctx.inputs).flat()[0]
  if (first) return { out: first }
  return {}
}

export function isGraphAssetValue(v: GraphValue): v is GraphAssetValue {
  return v.kind === 'asset'
}

export function nodeToAssetValue(node: GraphNode): GraphAssetValue | null {
  if (!node.assetId || !node.assetType) return null
  return {
    kind: 'asset',
    assetId: node.assetId,
    assetType: node.assetType,
    label: node.params.label,
    weight: node.params.weight,
    volume: node.params.volume,
    muted: node.params.muted,
    notes: node.params.notes,
    title: node.title
  }
}
