import { buildGeneratedMediaFileKey, formatGeneratedMediaStamp } from '../../domain'
import { patchBoundaryOutputPreview } from './slots'
import type { GraphNodeParams, GraphOutputKind, GraphPortDataType } from '../types'
import { GraphPortType } from '../types'
import { catalogValue } from '../catalogValue'
import type {
  GraphOutputValue,
  GraphTextItem,
  GraphTextValue,
  GraphValue,
  NodeExecuteContext
} from './types'
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
  // 场输出等：落地已迁至上游 gen，清空旧 generatedTexts，避免预览叠 resultText 变多
  const paramsPatch = {
    resultText,
    ...(ctx.node.typeId === 'output.beat' ? { generatedTexts: [] as GraphTextItem[] } : {})
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

function sanitizeBeatOutputKeyPart(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^\w\u4e00-\u9fff.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
  return cleaned || fallback
}

/** 落盘文件名：{宿主}_{场标题}_{时间戳}[_{序号}] */
function resolveBeatUnitFileKey(
  ctx: NodeExecuteContext,
  item: GraphTextItem,
  index: number,
  stamp: string,
  total: number
): string {
  const fromTitle = item.title?.trim()
  const firstLine = item.text?.split(/\r?\n/, 1)[0]?.trim() ?? ''
  const numbered = firstLine.match(/^\d+\.\s*(.+)$/)
  const fromLine = (numbered?.[1] ?? firstLine).trim()
  const unitTitle = sanitizeBeatOutputKeyPart(
    fromTitle || fromLine || item.id?.trim() || '',
    `场${index + 1}`
  )
  return buildGeneratedMediaFileKey({
    hostAssetName: ctx.resolveHostAssetName?.(),
    nodeTitle: unitTitle,
    stamp,
    index: total > 1 ? index + 1 : null
  })
}

/**
 * 将场 texts 落地为剧本文件（txt），返回物化后的条目（有路径时清空 text）。
 */
export async function materializeBeatUnitTextItems(
  ctx: NodeExecuteContext,
  hydrated: GraphTextItem[]
): Promise<GraphTextItem[]> {
  const createdAt = new Date().toISOString()
  const stamp = formatGeneratedMediaStamp()
  const materialized: GraphTextItem[] = []

  for (let index = 0; index < hydrated.length; index++) {
    const item = hydrated[index]!
    const text = item.text?.trim() ?? ''
    const existingPath = item.relativePath?.trim()
    const id = item.id?.trim() || `nu-out:${stamp}:${index}`
    const fileKey = resolveBeatUnitFileKey(ctx, item, index, stamp, hydrated.length)
    const title = item.title?.trim() || fileKey

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
      console.warn('[graph] beat unit text save failed', err)
      materialized.push({
        id,
        title,
        text,
        createdAt: item.createdAt ?? createdAt
      })
    }
  }

  return materialized
}

/**
 * 场细化画布输出：透传上游 texts（资产主链已改为 table → output.beat）。
 */
export async function executeBeatOutputNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  return executeScreenplayOutputNode(ctx)
}

export async function executeOutputNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  // 「剧本/文本输出」：透传为 texts，不调大模型、不收集媒体 genRefs
  if (
    ctx.node.params.outputKind === 'text' ||
    ctx.node.typeId === 'output.text' ||
    ctx.node.typeId === 'output.beat' ||
    ctx.node.typeId === 'output.beatUnit'
  ) {
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
