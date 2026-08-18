import { expandInstructionMentions } from '../instructionMentions'
import {
  resolveUpscaleSystemPrompt,
  resolveExpandSystemPrompt,
  resolveRedrawSystemPrompt,
  resolveEraseSystemPrompt,
  resolveMatteSystemPrompt,
  resolveMultiAngleSystemPrompt,
  resolveLightingSystemPrompt,
  resolvePortraitTextureSystemPrompt,
  resolveEmotionSystemPrompt
} from '../systemPromptSchemes'
import { multiAngleCameraToNodePatch, readMultiAngleCameraFromNode } from '../multiAngleCamera'
import { readLightingSetupFromNode, resolveLightingOutputPrompt } from '../lightingSetup'
import { portraitQualityToNodePatch, readPortraitQualityFromNode } from '../portraitQuality'
import { emotionPadToNodePatch, readEmotionPadFromNode } from '../emotionPad'
import {
  readImageUpscaleFromNode,
  resolveUpscaleInstruction,
  upscaleScaleToResolution
} from '../imageUpscale'
import { apiAspectRatioForExpand, buildExpandPrompt, readImageExpandFromNode } from '../imageExpand'
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
import { readImageGridSplitFromNode, resolveGridSplitTargets } from '../imageGridSplit'
import type { GraphImageItem, GraphValue, NodeExecuteContext } from './types'
import { collectIncomingValues } from './incoming'
import {
  commitGeneratedImages,
  materializeGeneratedBatch,
  mergeGeneratedImages
} from './materialize'
import { resolveMentionSources } from './context'
import { collectIncomingImageItems } from './mediaInputs'

/**
 * 多角度 / 打光 / 人像质感 / 情绪：以上游图为参考，用编辑器拼出的提示词调用图片 API，输出图库。
 */
async function executePromptImageEditNode(
  ctx: NodeExecuteContext,
  options: {
    stampPrefix: string
    userPrompt: string
    systemPrompt: string
    extraParams: Record<string, unknown>
    emptyResultError: string
  }
): Promise<Record<string, GraphValue>> {
  const sourceItems = await collectIncomingImageItems(ctx)
  if (!sourceItems.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const userPrompt = options.userPrompt.trim()
  if (!userPrompt) {
    throw new Error('GRAPH_PROCESS_EMPTY_PROMPT')
  }
  // /images 无独立 system 字段，拼入 prompt
  const system = options.systemPrompt.trim()
  const prompt = system ? `${system}\n\n${userPrompt}` : userPrompt

  if (!ctx.generateImage) {
    const picked = sourceItems[0]!
    return commitGeneratedImages(
      ctx,
      [{ ...picked, id: picked.id?.trim() || 'passthrough:0' }],
      picked.relativePath?.trim(),
      options.extraParams
    )
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
      id: `${options.stampPrefix}:${ctx.node.id}:${stamp}:${index}`,
      dataUrl,
      createdAt
    })
  }
  if (!batch.length) {
    throw new Error(options.emptyResultError)
  }

  const stampKey = `${options.stampPrefix}:${ctx.node.id}:${stamp}`
  const materializedBatch = await materializeGeneratedBatch(ctx, batch, stampKey)
  if (!materializedBatch.length) {
    throw new Error('图片落盘失败')
  }
  const generatedImages = mergeGeneratedImages(ctx, materializedBatch, `${stampKey}:keep`)
  return commitGeneratedImages(
    ctx,
    generatedImages,
    materializedBatch[0]?.relativePath?.trim(),
    options.extraParams
  )
}

/**
 * 多角度编辑：参考图 + 机位提示词调用图片模型，输出结果图库。
 */
export async function executeMultiAngleNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const camera = readMultiAngleCameraFromNode(ctx.node.params)
  const panelPrompt = ctx.node.params.text?.trim() || ''
  const patch = multiAngleCameraToNodePatch(camera, panelPrompt)
  return executePromptImageEditNode(ctx, {
    stampPrefix: 'multiAngle',
    userPrompt: patch.multiAnglePrompt,
    systemPrompt: resolveMultiAngleSystemPrompt(ctx.node.params.generateSystemPrompt, ctx.locale),
    extraParams: patch,
    emptyResultError: '模型未返回多角度图片'
  })
}

/**
 * 打光效果：参考图 + 打光提示词调用图片模型，输出结果图库。
 */
export async function executeLightingNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const setup = readLightingSetupFromNode(ctx.node.params)
  const lightingPrompt = resolveLightingOutputPrompt(setup)
  const patch = {
    lightingSetup: setup,
    lightingPrompt
  }
  return executePromptImageEditNode(ctx, {
    stampPrefix: 'lighting',
    userPrompt: lightingPrompt,
    systemPrompt: resolveLightingSystemPrompt(ctx.node.params.generateSystemPrompt, ctx.locale),
    extraParams: patch,
    emptyResultError: '模型未返回打光图片'
  })
}

/**
 * 人像质感调节：参考图 + 质感提示词调用图片模型，输出结果图库。
 */
export async function executePortraitTextureNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const patch = portraitQualityToNodePatch(readPortraitQualityFromNode(ctx.node.params))
  const negative = patch.portraitQualityNegative.trim()
  const userPrompt = negative
    ? `${patch.portraitQualityPrompt}。负面提示：${negative}`
    : patch.portraitQualityPrompt
  return executePromptImageEditNode(ctx, {
    stampPrefix: 'portraitTexture',
    userPrompt,
    systemPrompt: resolvePortraitTextureSystemPrompt(
      ctx.node.params.generateSystemPrompt,
      ctx.locale
    ),
    extraParams: patch,
    emptyResultError: '模型未返回人像质感图片'
  })
}

/**
 * 情绪调节：参考图 + 情绪提示词调用图片模型，输出结果图库。
 */
export async function executeEmotionNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const patch = emotionPadToNodePatch(readEmotionPadFromNode(ctx.node.params))
  return executePromptImageEditNode(ctx, {
    stampPrefix: 'emotion',
    userPrompt: patch.emotionPrompt,
    systemPrompt: resolveEmotionSystemPrompt(ctx.node.params.generateSystemPrompt, ctx.locale),
    extraParams: patch,
    emptyResultError: '模型未返回情绪图片'
  })
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
  const userPrompt = resolveUpscaleInstruction(
    expandInstructionMentions(
      ctx.node.params.generateInstruction ?? '',
      resolveMentionSources(ctx)
    ),
    upscale,
    ctx.locale
  )
  const system = resolveUpscaleSystemPrompt(ctx.node.params.generateSystemPrompt, ctx.locale)
  // /images 无独立 system 字段，拼入 prompt
  const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt
  const resolution =
    ctx.node.params.generateResolution?.trim() || upscaleScaleToResolution(upscale.scale)
  const aspectRatio = ctx.node.params.generateAspectRatio?.trim() || undefined
  const quality = ctx.node.params.generateQuality?.trim() || 'high'

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
    return commitGeneratedImages(
      ctx,
      [{ ...picked, id: picked.id?.trim() || 'passthrough:0' }],
      picked.relativePath?.trim()
    )
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
    ...(aspectRatio ? { aspectRatio } : {}),
    quality,
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
  return commitGeneratedImages(ctx, generatedImages, materializedBatch[0]?.relativePath?.trim(), {
    imageUpscale: upscale
  })
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
    return commitGeneratedImages(
      ctx,
      [{ ...picked, id: picked.id?.trim() || 'passthrough:0' }],
      picked.relativePath?.trim()
    )
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
  return commitGeneratedImages(ctx, generatedImages, materializedBatch[0]?.relativePath?.trim(), {
    imageExpand: expand
  })
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
    return commitGeneratedImages(
      ctx,
      [{ ...picked, id: picked.id?.trim() || 'passthrough:0' }],
      picked.relativePath?.trim()
    )
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
  return commitGeneratedImages(ctx, generatedImages, materializedBatch[0]?.relativePath?.trim(), {
    imageRedraw: redraw
  })
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
    return commitGeneratedImages(
      ctx,
      [{ ...picked, id: picked.id?.trim() || 'passthrough:0' }],
      picked.relativePath?.trim()
    )
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
  return commitGeneratedImages(ctx, generatedImages, materializedBatch[0]?.relativePath?.trim(), {
    imageErase: erase
  })
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
    return commitGeneratedImages(
      ctx,
      [{ ...picked, id: picked.id?.trim() || 'passthrough:0' }],
      picked.relativePath?.trim()
    )
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
  return commitGeneratedImages(ctx, generatedImages, materializedBatch[0]?.relativePath?.trim(), {
    imageMatte: matte
  })
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
    return commitGeneratedImages(
      ctx,
      [{ ...picked, id: picked.id?.trim() || 'passthrough:0' }],
      picked.relativePath?.trim()
    )
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
  const materializedBatch = await materializeGeneratedBatch(
    ctx,
    [item],
    `crop:${ctx.node.id}:${stamp}`
  )
  if (!materializedBatch.length) {
    throw new Error('图片落盘失败')
  }
  const generatedImages = mergeGeneratedImages(
    ctx,
    materializedBatch,
    `crop:${ctx.node.id}:${stamp}:keep`
  )
  return commitGeneratedImages(ctx, generatedImages, materializedBatch[0]?.relativePath?.trim(), {
    imageCrop: crop
  })
}

/**
 * 宫格切分：裁出选中（或全部）宫格，再逐格高清放大。
 */
/**
 * 宫格切分：纯裁切，不调用大模型。
 * 按 rows×cols 从源图裁出每个目标宫格并直接输出。
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

  let sourceUrl = ''
  if (ctx.resolveImageUrls) {
    sourceUrl = (await ctx.resolveImageUrls(sourceItems.slice(0, 1))).find(Boolean) ?? ''
  } else {
    sourceUrl = sourceItems[0]?.dataUrl?.trim() ?? ''
  }
  if (!sourceUrl && ctx.resolveAssetImageUrl) {
    for (const value of [
      ...(ctx.inputs.in ?? []),
      ...(ctx.inputs['in-image'] ?? []),
      ...collectIncomingValues(ctx.inputs)
    ]) {
      if (value.kind !== 'asset' || value.assetType !== 'image') continue
      const url = await ctx.resolveAssetImageUrl(value.assetId)
      if (url) {
        sourceUrl = url
        break
      }
    }
  }
  if (!sourceUrl) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }
  if (!ctx.composeImageGridCell) {
    throw new Error('宫格裁切能力未注入，无法执行宫格切分')
  }
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const batch: GraphImageItem[] = []

  for (const cell of targets) {
    if (ctx.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    const composed = await ctx.composeImageGridCell({
      sourceDataUrl: sourceUrl,
      state: grid,
      cellKey: cell
    })
    const cellDataUrl = composed.dataUrl?.trim()
    if (!cellDataUrl) {
      throw new Error(`宫格 ${cell} 裁切失败`)
    }
    batch.push({
      id: `gridSplit:${ctx.node.id}:${stamp}:${cell}`,
      dataUrl: cellDataUrl,
      createdAt
    })
  }

  if (!batch.length) {
    throw new Error('宫格切分失败')
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
  return commitGeneratedImages(ctx, generatedImages, materializedBatch[0]?.relativePath?.trim(), {
    imageGridSplit: grid
  })
}
