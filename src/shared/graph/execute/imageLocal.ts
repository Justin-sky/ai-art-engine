/**
 * 本地图像处理节点执行器（节点图版「一键抠图 / 智能构图」）。
 *
 * 与 imageEdit.ts 的 crop/gridSplit 一致：本文件只负责
 * 收集上游图片 → 请求渲染层合成 → 物化落盘 → 写回图库；
 * 真正推理（YOLO）与像素合成由宿主注入的
 * `composeImageCutoutCanvas` / `composeImageComposeCanvas` 提供。
 */
import type { GraphImageItem, GraphValue, NodeExecuteContext } from './types'
import { collectIncomingValues } from './incoming'
import {
  commitGeneratedImages,
  materializeGeneratedBatch,
  mergeGeneratedImages
} from './materialize'
import { collectIncomingImageItems } from './mediaInputs'
import { fail } from '@shared/errors/appError'
import { SHARED_ERRORS } from '../../errors/catalog'
import { readImageCutoutFromNode } from '../imageCutout'
import { readImageComposeFromNode } from '../imageCompose'

/** 解析可合成的首张上游图 url；无 resolveImageUrls 时退回 dataUrl / 资产引用 */
async function resolveFirstSourceUrl(
  ctx: NodeExecuteContext,
  sourceItems: GraphImageItem[]
): Promise<string> {
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
  return sourceUrls[0]!
}

async function ensureAlive(ctx: NodeExecuteContext): Promise<void> {
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
}

/**
 * 本地抠图：YOLO 实例分割 → 透明通道 PNG。
 * 运行即对上游图片做一次推理；personOnly 时只保留 person 实例。
 */
export async function executeCutoutNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const sourceItems = await collectIncomingImageItems(ctx)
  if (!sourceItems.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const state = readImageCutoutFromNode(ctx.node.params)
  const sourceUrl = await resolveFirstSourceUrl(ctx, sourceItems)
  await ensureAlive(ctx)

  if (!ctx.composeImageCutoutCanvas) {
    // 无合成注入时透传，便于离线
    const picked = sourceItems[0]!
    ctx.node.params = { ...ctx.node.params, imageCutout: state }
    ctx.patchNode?.({ params: { imageCutout: state } })
    return commitGeneratedImages(
      ctx,
      [{ ...picked, id: picked.id?.trim() || 'passthrough:0' }],
      picked.relativePath?.trim()
    )
  }

  const composed = await ctx.composeImageCutoutCanvas({
    sourceDataUrl: sourceUrl,
    state
  })
  if (!composed.dataUrl) {
    throw fail(SHARED_ERRORS.imageCropEmpty)
  }
  await ensureAlive(ctx)

  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const item: GraphImageItem = {
    id: `cutout:${ctx.node.id}:${stamp}`,
    dataUrl: composed.dataUrl,
    createdAt
  }
  const materializedBatch = await materializeGeneratedBatch(
    ctx,
    [item],
    `cutout:${ctx.node.id}:${stamp}`
  )
  if (!materializedBatch.length) {
    throw fail(SHARED_ERRORS.persistImageFailed, { detail: '' })
  }
  const generatedImages = mergeGeneratedImages(
    ctx,
    materializedBatch,
    `cutout:${ctx.node.id}:${stamp}:keep`
  )
  return commitGeneratedImages(ctx, generatedImages, materializedBatch[0]?.relativePath?.trim(), {
    imageCutout: state
  })
}

/**
 * 本地智能构图：检测人物主体 → 按目标画幅 + 留白策略裁剪。
 * 命中缓存主体框（源图尺寸与阈值一致）时不再重复推理。
 */
export async function executeComposeNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const sourceItems = await collectIncomingImageItems(ctx)
  if (!sourceItems.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const state = readImageComposeFromNode(ctx.node.params)
  const sourceUrl = await resolveFirstSourceUrl(ctx, sourceItems)
  await ensureAlive(ctx)

  if (!ctx.composeImageComposeCanvas) {
    // 无合成注入时透传，便于离线
    const picked = sourceItems[0]!
    ctx.node.params = { ...ctx.node.params, imageCompose: state }
    ctx.patchNode?.({ params: { imageCompose: state } })
    return commitGeneratedImages(
      ctx,
      [{ ...picked, id: picked.id?.trim() || 'passthrough:0' }],
      picked.relativePath?.trim()
    )
  }

  const composed = await ctx.composeImageComposeCanvas({
    sourceDataUrl: sourceUrl,
    state
  })
  if (!composed.dataUrl) {
    throw fail(SHARED_ERRORS.imageCropEmpty)
  }
  await ensureAlive(ctx)

  // 写回本次命中的主体框，让「只改画幅/策略重跑」不再重复检测
  const nextState = composed.state
    ? { ...state, ...composed.state }
    : state

  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const item: GraphImageItem = {
    id: `compose:${ctx.node.id}:${stamp}`,
    dataUrl: composed.dataUrl,
    createdAt
  }
  const materializedBatch = await materializeGeneratedBatch(
    ctx,
    [item],
    `compose:${ctx.node.id}:${stamp}`
  )
  if (!materializedBatch.length) {
    throw fail(SHARED_ERRORS.persistImageFailed, { detail: '' })
  }
  const generatedImages = mergeGeneratedImages(
    ctx,
    materializedBatch,
    `compose:${ctx.node.id}:${stamp}:keep`
  )
  return commitGeneratedImages(
    ctx,
    generatedImages,
    materializedBatch[0]?.relativePath?.trim(),
    { imageCompose: nextState }
  )
}
