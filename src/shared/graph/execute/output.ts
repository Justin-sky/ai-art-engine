import { patchBoundaryOutputPreview } from './slots'
import type { GraphNodeParams, GraphOutputKind, GraphPortDataType } from '../types'
import { GraphPortType } from '../types'
import { catalogValue } from '../catalogValue'
import type { GraphOutputValue, GraphTextValue, GraphValue, NodeExecuteContext } from './types'
import {
  flattenAssetValues,
  flattenImagesValues,
  flattenTextValues,
  flattenTextsValues,
  flattenVideosValues,
  flattenVoicesValues,
  stripEmbeddedTextData
} from './gallery'
import { collectIncomingValues } from './incoming'
import { hydrateTextItems } from './helpers'

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
  const paramsPatch = {
    resultText
  }
  ctx.node.params = { ...ctx.node.params, ...paramsPatch }
  ctx.patchNode?.({ params: paramsPatch })
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

export async function executeOutputNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
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
    const previewDataUrl = cameraShots[0]?.dataUrl?.trim() ? cameraShots[0].dataUrl : undefined
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
    const preferred = items.find((item) => item.assetType === outputKind) ?? items[0]
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

/**
 * 束结：按锁定类型聚合多条入边为复数（或 catalog）输出。
 * 下游指令 / cook 另经 expandIncomingThroughBundles 展开真实上游。
 */
export function executeBundleNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const incoming = ctx.inputs.in ?? Object.values(ctx.inputs).flat()
  const dataType =
    ctx.node.params.bundleDataType ??
    (incoming[0] ? graphValueKindToPortType(incoming[0].kind) : GraphPortType.image)

  if (incoming.length) {
    if (dataType === GraphPortType.image || dataType === GraphPortType.images) {
      const items = flattenImagesValues(incoming)
      const value: GraphValue = { kind: 'images', items }
      if (items.length) patchBoundaryOutputPreview(ctx, value)
      return { out: value }
    }
    if (dataType === GraphPortType.video || dataType === GraphPortType.videos) {
      const items = flattenVideosValues(incoming)
      const value: GraphValue = { kind: 'videos', items }
      if (items.length) patchBoundaryOutputPreview(ctx, value)
      return { out: value }
    }
    if (dataType === GraphPortType.voice || dataType === GraphPortType.voices) {
      const items = flattenVoicesValues(incoming)
      const value: GraphValue = { kind: 'voices', items }
      return { out: value }
    }
    if (dataType === GraphPortType.text || dataType === GraphPortType.texts) {
      const items = flattenTextsValues(incoming)
      const value: GraphValue = { kind: 'texts', items }
      return { out: value }
    }
    const first = incoming[0]
    if (first) {
      patchBoundaryOutputPreview(ctx, first)
      return { out: first }
    }
  }

  if (
    dataType === GraphPortType.beat ||
    dataType === GraphPortType.worldEntities ||
    dataType === GraphPortType.world
  ) {
    return { out: catalogValue(dataType, '') }
  }
  if (dataType === GraphPortType.image || dataType === GraphPortType.images) {
    return { out: { kind: 'images', items: [] } }
  }
  if (dataType === GraphPortType.video || dataType === GraphPortType.videos) {
    return { out: { kind: 'videos', items: [] } }
  }
  if (dataType === GraphPortType.voice || dataType === GraphPortType.voices) {
    return { out: { kind: 'voices', items: [] } }
  }
  if (dataType === GraphPortType.texts || dataType === GraphPortType.text) {
    return { out: { kind: 'texts', items: [] } }
  }
  return { out: { kind: 'text', text: '' } }
}

function graphValueKindToPortType(kind: GraphValue['kind']): GraphPortDataType {
  switch (kind) {
    case 'image':
    case 'images':
      return GraphPortType.image
    case 'video':
    case 'videos':
      return GraphPortType.video
    case 'voice':
    case 'voices':
      return GraphPortType.voice
    case 'text':
    case 'texts':
      return GraphPortType.text
    case 'beat':
      return GraphPortType.beat
    case 'world':
      return GraphPortType.world
    case 'worldEntities':
      return GraphPortType.worldEntities
    default:
      return GraphPortType.image
  }
}
