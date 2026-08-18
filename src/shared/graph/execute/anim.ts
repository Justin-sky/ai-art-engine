import type { GraphDocument } from '../types'
import {
  graphValueHasPayload,
  softResolveBoundaryOutputValue,
  type ResolveHostInputSlotsOptions
} from '../hostInput'
import { isBoundaryOutputNode } from '../hostInterface'
import {
  resolveImageGenerateParamsForApi,
  imageGenerateParamsToNodePatch,
  resolveGenerateSeed
} from '../imageGenerateParams'
import {
  anim2dCellKeys,
  buildAnim2dGridInstruction,
  readAnim2dFromNode,
  resolveAnim2dPreset,
  resolveFrameAnimGenSystemPrompt,
  type Anim2dState
} from '../anim2d'
import type { GraphImageItem, GraphValue, NodeExecuteContext } from './types'
import { dedupeGalleryIds } from './gallery'
import {
  commitGeneratedImages,
  materializeGeneratedBatch,
  mergeGeneratedImages
} from './materialize'
import { collectIncomingImageItems } from './mediaInputs'

/**
 * 生成帧动画序列图：参考图 + 动作描述 → 生图 API 生成 rows×cols 分格序列图。
 * 序列图排版指令按当前行列数动态拼入提示词。
 */
export async function executeFrameAnimGenNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const state = readAnim2dFromNode(node.params)
  const preset = resolveAnim2dPreset(node.params.animPresetId)
  const instructionRaw = node.params.generateInstruction?.trim() || preset?.prompt || ''
  const system = resolveFrameAnimGenSystemPrompt(node.params.generateSystemPrompt, ctx.locale)
  const userPrompt = [
    instructionRaw,
    buildAnim2dGridInstruction(state.rows, state.cols, ctx.locale)
  ]
    .filter(Boolean)
    .join('\n\n')
  const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt

  if (!ctx.generateImage) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const sourceItems = await collectIncomingImageItems(ctx)
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
  if (!portUrls.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const genParams = resolveImageGenerateParamsForApi(node.params)
  const paramsPatch = imageGenerateParamsToNodePatch(genParams)
  node.params = { ...node.params, ...paramsPatch }
  ctx.patchNode?.({ params: paramsPatch })

  const result = await ctx.generateImage({
    prompt,
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    aspectRatio: genParams.aspectRatio,
    resolution: genParams.resolution,
    quality: genParams.quality,
    n: genParams.count,
    seed: resolveGenerateSeed(node.params, ctx.resolveProjectGenerateSeed?.()),
    inputReferences: portUrls,
    inputReferenceMeta: sourceItems.slice(0, portUrls.length).map((item) => ({
      source: 'port',
      ...(item.relativePath?.trim() ? { relativePath: item.relativePath.trim() } : {})
    }))
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
    batch.push({ id: `animGen:${node.id}:${stamp}:${index}`, dataUrl, createdAt })
  }
  if (!batch.length) {
    throw new Error('模型未返回图片')
  }

  const stampKey = `animGen:${node.id}:${stamp}`
  const materializedBatch = await materializeGeneratedBatch(ctx, batch, stampKey)
  if (!materializedBatch.length) {
    throw new Error('图片落盘失败')
  }
  const generatedImages = mergeGeneratedImages(ctx, materializedBatch, `${stampKey}:keep`)
  return commitGeneratedImages(ctx, generatedImages, materializedBatch[0]?.relativePath?.trim(), {
    animRows: state.rows,
    animCols: state.cols,
    animPresetId: node.params.animPresetId || ''
  })
}

/**
 * 2D帧动画：收集 dive 子图输出边界（序列图），按 rows×cols 切分为单帧输出，
 * 并把序列图信息写回节点参数供 inspector 播放预览。
 */
export async function executeAnim2dNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const assetId = node.params.animAssetId?.trim()
  // 普通播放节点：优先取 in 端口序列图；旧数据无输入时回退内图产物
  const incoming = await collectIncomingImageItems(ctx)
  let gridItem: (GraphImageItem & { assetId?: string }) | undefined = incoming[0]
  if (!gridItem && assetId) {
    gridItem = await softResolveAnim2dGridImage(ctx, assetId)
  }
  // 行列：有内图时沿用内图层帧生成行列，否则用本节点 Inspector 行列
  const innerState = assetId ? softResolveAnim2dInnerState(ctx, assetId) : undefined
  const state = innerState ?? readAnim2dFromNode(node.params)
  if (!gridItem) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  let sourceUrl = gridItem.dataUrl?.trim() || ''
  if (!sourceUrl && ctx.resolveImageUrls) {
    sourceUrl = (await ctx.resolveImageUrls([gridItem])).find(Boolean) ?? ''
  }
  if (!sourceUrl && ctx.resolveAssetImageUrl && gridItem.assetId) {
    sourceUrl = (await ctx.resolveAssetImageUrl(gridItem.assetId)) ?? ''
  }
  if (!sourceUrl) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }
  if (!ctx.composeImageGridCell) {
    throw new Error('帧序列切分能力未注入')
  }
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const batch: GraphImageItem[] = []
  for (const cell of anim2dCellKeys(state.rows, state.cols)) {
    if (ctx.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    const composed = await ctx.composeImageGridCell({
      sourceDataUrl: sourceUrl,
      state: { rows: state.rows, cols: state.cols, selected: [] },
      cellKey: cell,
      // 序列图常带格线/黑边：整数切格后再按格子尺寸内缩
      edgeInset: 'auto'
    })
    const cellDataUrl = composed.dataUrl?.trim()
    if (!cellDataUrl) {
      throw new Error(`帧 ${cell} 切分失败`)
    }
    batch.push({
      id: `anim2d:${node.id}:${stamp}:${cell}`,
      dataUrl: cellDataUrl,
      createdAt
    })
  }
  if (!batch.length) {
    throw new Error('帧序列切分失败')
  }

  const materializedBatch = await materializeGeneratedBatch(
    ctx,
    batch,
    `anim2d:${node.id}:${stamp}`
  )
  if (!materializedBatch.length) {
    throw new Error('图片落盘失败')
  }
  // 普通播放节点：每次 cook 只保留本次切分结果，清除上一次的数据，不累积历史
  const generatedImages = dedupeGalleryIds([], materializedBatch, `anim2d:${node.id}:${stamp}:keep`)
  const gridImageParams = {
    ...(gridItem.dataUrl?.trim() ? { dataUrl: gridItem.dataUrl.trim() } : {}),
    ...(gridItem.relativePath?.trim() ? { relativePath: gridItem.relativePath.trim() } : {})
  }
  return commitGeneratedImages(ctx, generatedImages, materializedBatch[0]?.relativePath?.trim(), {
    animRows: state.rows,
    animCols: state.cols,
    animGridImage: Object.keys(gridImageParams).length ? gridImageParams : undefined
  })
}

/** 从 dive 子图资产软解析序列图输出边界（边界输出未运行也可从上游取到） */
async function softResolveAnim2dGridImage(
  ctx: NodeExecuteContext,
  assetId: string
): Promise<(GraphImageItem & { assetId?: string }) | undefined> {
  const liveDoc = ctx.resolveLiveAssetGraph?.(assetId)
  const gen = ctx.resolveAssetGenParams?.(assetId)
  const raw = liveDoc ?? gen?.graphJson
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as GraphDocument).nodes)) {
    return undefined
  }
  const doc = raw as GraphDocument
  const softOptions: ResolveHostInputSlotsOptions = {
    resolveLiveAssetGraph: ctx.resolveLiveAssetGraph,
    resolveAssetGenParams: ctx.resolveAssetGenParams
  }
  for (const bnode of doc.nodes) {
    if (!isBoundaryOutputNode(bnode)) continue
    const value = softResolveBoundaryOutputValue(doc, bnode.id, softOptions)
    if (!graphValueHasPayload(value)) continue
    if (value.kind === 'image') {
      return {
        id: value.id || `animGrid:${assetId}`,
        dataUrl: value.dataUrl || '',
        relativePath: value.relativePath
      }
    }
    if (value.kind === 'images' && value.items.length) {
      const first = value.items[0]!
      return { ...first, id: first.id || `animGrid:${assetId}` }
    }
    if (value.kind === 'asset' && value.assetType === 'image') {
      const url = ctx.resolveAssetImageUrl
        ? await ctx.resolveAssetImageUrl(value.assetId)
        : undefined
      if (url) return { id: `animGrid:${assetId}`, dataUrl: url }
    }
  }
  return undefined
}

/** 从 dive 子图资产读取「生成帧动画序列图」节点的行列参数（单一数据源） */
function softResolveAnim2dInnerState(
  ctx: NodeExecuteContext,
  assetId: string
): Anim2dState | undefined {
  const liveDoc = ctx.resolveLiveAssetGraph?.(assetId)
  const gen = ctx.resolveAssetGenParams?.(assetId)
  const raw = liveDoc ?? gen?.graphJson
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as GraphDocument).nodes)) {
    return undefined
  }
  const doc = raw as GraphDocument
  const genNode = doc.nodes.find((n) => n.typeId === 'frame.animGen')
  if (!genNode) return undefined
  return readAnim2dFromNode(genNode.params)
}
