import type {
  GraphImageItem,
  GraphTextItem,
  GraphValue,
  GraphVideoItem,
  GraphVoiceItem,
  NodeExecuteContext
} from './types'
import { GraphPortType } from '../types'
import { GRAPH_OUT_ALL_PORT_ID } from '../ports'
import { catalogValue } from '../catalogValue'
import { buildGeneratedMediaFileKey, formatGeneratedMediaStamp } from '../../domain'
import { fail } from '@shared/errors/appError'
import { SHARED_ERRORS } from '../../errors/catalog'
import {
  dedupeGalleryIds,
  dualImageGalleryOutputs,
  dualTextGalleryOutputs,
  dualVideoGalleryOutputs,
  dualVoiceGalleryOutputs,
  newestImageSelectedId,
  newestTextSelectedId,
  newestVideoSelectedId,
  newestVoiceSelectedId,
  pickTextItem,
  stripEmbeddedImageData,
  stripEmbeddedTextData,
  stripEmbeddedVideoData,
  stripEmbeddedVoiceData
} from './gallery'

export async function materializeGeneratedBatch(
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
    const key = buildGeneratedMediaFileKey({
      hostAssetName: ctx.resolveHostAssetName?.(),
      nodeTitle: ctx.node.title || ctx.node.typeId || 'generate',
      stamp,
      index: batch.length > 1 ? index + 1 : null
    })
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
    }
  }
  if (!next.length && lastError) {
    const detail = lastError instanceof Error ? lastError.message : String(lastError)
    // 已是落盘失败包装（可能来自嵌套调用 / 其他语言环境）则原样透传，避免双重前缀
    const isPersistError =
      detail.includes('图片落盘失败') || detail.includes('Failed to save image to disk')  // cjk-ok 双语错误数据（zh/en，由 errors/catalog 统一格式化）
    throw isPersistError ? new Error(detail) : fail(SHARED_ERRORS.persistImageFailed, { detail })
  }
  return next
}

export function mergeGeneratedImages(
  ctx: NodeExecuteContext,
  materializedBatch: GraphImageItem[],
  idFallbackPrefix: string
): GraphImageItem[] {
  const previous = (ctx.node.params.generatedImages ?? []).map(stripEmbeddedImageData)
  return dedupeGalleryIds(previous, materializedBatch.map(stripEmbeddedImageData), idFallbackPrefix)
}

export function mergeGeneratedTexts(
  ctx: NodeExecuteContext,
  batch: GraphTextItem[],
  idFallbackPrefix: string
): GraphTextItem[] {
  const previous = (ctx.node.params.generatedTexts ?? []).map(stripEmbeddedTextData)
  return dedupeGalleryIds(previous, batch.map(stripEmbeddedTextData), idFallbackPrefix)
}

/** 从生成正文首行解析「剧本名：…」/「Title: …」 */
export function extractScreenplayTitleFromText(text: string): string | undefined {
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

/** 剧本生成落盘名：{宿主/剧本名}_{节点名}_{时间戳} */
export function resolveScreenplayGenerationFileKey(
  ctx: NodeExecuteContext,
  text?: string
): string {
  const fromText = text ? extractScreenplayTitleFromText(text) : undefined
  const host = ctx.resolveHostAssetName?.()?.trim()
  const boundId = ctx.node.assetId?.trim()
  const bound = boundId ? ctx.resolveAssetName?.(boundId)?.trim() : undefined
  return buildGeneratedMediaFileKey({
    hostAssetName: fromText || host || bound || 'screenplay',
    nodeTitle: ctx.node.title || ctx.node.typeId || 'screenplay',
    stamp: formatGeneratedMediaStamp()
  })
}

export async function materializeGeneratedText(
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
    return { id, text: '', createdAt, relativePath }
  } catch (err) {
    console.warn('[graph] materialize generated text failed', err)
    return item
  }
}

export async function persistScreenplayGeneration(
  ctx: NodeExecuteContext,
  text: string
): Promise<Record<string, GraphValue>> {
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
  const selectedTextId = newestTextSelectedId(generatedTexts)
  ctx.node.params = {
    ...ctx.node.params,
    text,
    generatedTexts,
    selectedTextId
  }
  ctx.patchNode?.({
    params: {
      text,
      generatedTexts,
      selectedTextId
    }
  })
  return dualTextGalleryOutputs(generatedTexts, selectedTextId)
}

/** 无模型回退：正文写入累计图库（不落盘），返回 out / out-all */
export function commitInMemoryTextGallery(
  ctx: NodeExecuteContext,
  text: string
): Record<string, GraphValue> {
  const createdAt = new Date().toISOString()
  const stamp = formatGeneratedMediaStamp()
  const id = `gen-text:${stamp}`
  const generatedTexts = mergeGeneratedTexts(ctx, [{ id, text, createdAt }], `${stamp}:keep`)
  const selectedTextId = newestTextSelectedId(generatedTexts)
  const params = { text, generatedTexts, selectedTextId }
  ctx.node.params = { ...ctx.node.params, ...params }
  ctx.patchNode?.({ params })
  return dualTextGalleryOutputs(generatedTexts, selectedTextId)
}

export function mergeGeneratedVoices(
  ctx: NodeExecuteContext,
  batch: GraphVoiceItem[],
  idFallbackPrefix: string
): GraphVoiceItem[] {
  const previous = (ctx.node.params.generatedVoices ?? []).map(stripEmbeddedVoiceData)
  return dedupeGalleryIds(previous, batch.map(stripEmbeddedVoiceData), idFallbackPrefix)
}

export function mergeGeneratedVideos(
  ctx: NodeExecuteContext,
  batch: GraphVideoItem[],
  idFallbackPrefix: string
): GraphVideoItem[] {
  const previous = (ctx.node.params.generatedVideos ?? []).map(stripEmbeddedVideoData)
  return dedupeGalleryIds(previous, batch.map(stripEmbeddedVideoData), idFallbackPrefix)
}

/** 视频生成结果写入累计图库；强制选中最新；`out` 选中单条，`out-all` 全部历史 */
export function persistVideoGeneration(
  ctx: NodeExecuteContext,
  item: GraphVideoItem,
  notes?: string
): Record<string, GraphValue> {
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
  const selectedVideoId = newestVideoSelectedId(generatedVideos)
  const previewRelativePath = materialized.relativePath?.trim() || undefined
  ctx.node.params = {
    ...ctx.node.params,
    generatedVideos,
    selectedVideoId,
    ...(notes !== undefined ? { notes } : {}),
    ...(previewRelativePath ? { previewRelativePath } : {})
  }
  ctx.patchNode?.({
    params: {
      generatedVideos,
      selectedVideoId,
      ...(notes !== undefined ? { notes } : {}),
      ...(previewRelativePath ? { previewRelativePath } : {})
    }
  })
  return dualVideoGalleryOutputs(generatedVideos, selectedVideoId)
}

export function persistVoiceGeneration(
  ctx: NodeExecuteContext,
  item: GraphVoiceItem
): Record<string, GraphValue> {
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
  const selectedVoiceId = newestVoiceSelectedId(generatedVoices)
  const previewRelativePath = materialized.relativePath?.trim() || undefined
  ctx.node.params = {
    ...ctx.node.params,
    generatedVoices,
    selectedVoiceId,
    ...(previewRelativePath ? { previewRelativePath } : {})
  }
  ctx.patchNode?.({
    params: {
      generatedVoices,
      selectedVoiceId,
      ...(previewRelativePath ? { previewRelativePath } : {})
    }
  })
  return dualVoiceGalleryOutputs(generatedVoices, selectedVoiceId)
}

/** 世界元素提取图库：`out` 为选中目录（world），`out-all` 为历史 texts */
export function dualWorldCatalogOutputs(
  items: GraphTextItem[],
  selectedTextId: string
): Record<string, GraphValue> {
  const picked = pickTextItem(items, selectedTextId)
  const text = picked?.text ?? ''
  return {
    out: catalogValue(GraphPortType.world, text, picked?.relativePath),
    [GRAPH_OUT_ALL_PORT_ID]: { kind: 'texts', items }
  }
}

/** 场拆解图库：`out` 为选中目录（beat），`out-all` 为历史 texts */
export function dualBeatCatalogOutputs(
  items: GraphTextItem[],
  selectedTextId: string
): Record<string, GraphValue> {
  const picked = pickTextItem(items, selectedTextId)
  const text = picked?.text ?? ''
  return {
    out: catalogValue(GraphPortType.beat, text, picked?.relativePath),
    [GRAPH_OUT_ALL_PORT_ID]: { kind: 'texts', items }
  }
}

/**
 * 目录拆解/提取图库合并：必须保留 JSON 正文。
 * 不可走 mergeGeneratedTexts（落盘后会 strip 掉 text，导致预览/out/锁定全空）。
 */
export function mergeCatalogGeneratedTexts(
  ctx: NodeExecuteContext,
  batch: GraphTextItem[],
  idFallbackPrefix: string
): GraphTextItem[] {
  const previous = (ctx.node.params.generatedTexts ?? []).map((item) => ({
    id: item.id,
    text: item.text ?? '',
    createdAt: item.createdAt,
    ...(item.title?.trim() ? { title: item.title.trim() } : {}),
    ...(item.relativePath?.trim() ? { relativePath: item.relativePath.trim() } : {})
  }))
  return [...previous, ...batch].map((item, index) => ({
    id: item.id?.trim() || `${idFallbackPrefix}:${index}`,
    text: item.text ?? '',
    ...(item.createdAt ? { createdAt: item.createdAt } : {}),
    ...(item.title?.trim() ? { title: item.title.trim() } : {}),
    ...(item.relativePath?.trim() ? { relativePath: item.relativePath.trim() } : {})
  }))
}

export async function persistCatalogTextGeneration(
  ctx: NodeExecuteContext,
  text: string,
  options: {
    idPrefix: string
    fileKeyPrefix: string
    dualOutputs: (
      items: GraphTextItem[],
      selectedTextId: string
    ) => Record<string, GraphValue>
  }
): Promise<Record<string, GraphValue>> {
  const createdAt = new Date().toISOString()
  const stamp = formatGeneratedMediaStamp()
  const id = `${options.idPrefix}:${stamp}`
  let item: GraphTextItem = { id, text, createdAt }
  if (ctx.saveRunText && text.trim()) {
    try {
      const relativePath = await ctx.saveRunText({
        content: text,
        key: buildGeneratedMediaFileKey({
          hostAssetName: ctx.resolveHostAssetName?.(),
          nodeTitle: options.fileKeyPrefix || ctx.node.title || ctx.node.typeId || 'text',
          stamp: formatGeneratedMediaStamp()
        }),
        outputDir: ctx.node.params.mediaOutputDir?.trim() || undefined,
        node: ctx.node
      })
      if (relativePath?.trim()) item = { ...item, relativePath: relativePath.trim() }
    } catch (err) {
      console.warn(`[graph] materialize ${options.idPrefix} text failed`, err)
    }
  }
  const generatedTexts = mergeCatalogGeneratedTexts(ctx, [item], `${stamp}:keep`)
  const selectedTextId = newestTextSelectedId(generatedTexts)
  ctx.node.params = {
    ...ctx.node.params,
    text,
    generatedTexts,
    selectedTextId
  }
  ctx.patchNode?.({
    params: {
      text,
      generatedTexts,
      selectedTextId
    }
  })
  return options.dualOutputs(generatedTexts, selectedTextId)
}

export async function persistWorldExtractGeneration(
  ctx: NodeExecuteContext,
  text: string
): Promise<Record<string, GraphValue>> {
  return persistCatalogTextGeneration(ctx, text, {
    idPrefix: 'world-extract',
    fileKeyPrefix: 'world_extract',
    dualOutputs: dualWorldCatalogOutputs
  })
}

export async function persistBeatSplitGeneration(
  ctx: NodeExecuteContext,
  text: string
): Promise<Record<string, GraphValue>> {
  return persistCatalogTextGeneration(ctx, text, {
    idPrefix: 'beat-split',
    fileKeyPrefix: 'beat_split',
    dualOutputs: dualBeatCatalogOutputs
  })
}

export function commitGeneratedImages(
  ctx: NodeExecuteContext,
  generatedImages: GraphImageItem[],
  previewRelativePath?: string,
  extraParams?: Record<string, unknown>
): Record<string, GraphValue> {
  const selectedImageId = newestImageSelectedId(generatedImages)
  const params = {
    generatedImages,
    selectedImageId,
    previewDataUrl: undefined as string | undefined,
    previewRelativePath: previewRelativePath || '',
    ...extraParams
  }
  ctx.node.params = {
    ...ctx.node.params,
    ...params
  }
  ctx.patchNode?.({ params })
  return dualImageGalleryOutputs(generatedImages, selectedImageId)
}
