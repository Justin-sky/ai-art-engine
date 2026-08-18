import { isAssetRefNode } from '../nodeRole'
import { expandInstructionMentions } from '../instructionMentions'
import {
  resolveGameSystemSystemPrompt,
  resolveScreenplaySystemPrompt,
  resolveToPromptSystemPrompt
} from '../systemPromptSchemes'
import {
  buildScreenplayPrompt,
  defaultGameSystemUserPrompt,
  buildToPromptUserPrompt
} from '../userPromptSchemes'
import { resolveAssetTextFromGenParams } from '../assetText'
import type { GraphValue, NodeExecuteContext } from './types'
import { dualTextGalleryOutputs, flattenAssetValues, flattenImagesValues } from './gallery'
import { autoIncomingTextForInstruction, selectIncomingValuesForInstruction } from './incoming'
import { commitInMemoryTextGallery, persistScreenplayGeneration } from './materialize'
import { normalizeLocalScreenplayText, resolveMentionSources } from './context'

export async function executeTextAssetRefNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  if (!ctx.node.assetId || !ctx.node.assetType) {
    throw new Error('GRAPH_UNBOUND_ASSET')
  }
  if (ctx.hasAsset && !ctx.hasAsset(ctx.node.assetId)) {
    throw new Error('GRAPH_MISSING_ASSET')
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
  const incomingText = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources)

  if (!ctx.generateText) {
    const localText = normalizeLocalScreenplayText(node.params.text)
    const text = instruction.trim() || incomingText || localText
    if (!text.trim()) return dualTextGalleryOutputs([], '')
    return await persistScreenplayGeneration(ctx, text)
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

  return await persistScreenplayGeneration(ctx, text)
}

/** 游戏系统策划案生成：按专业系统策划提示词生成功能点与 UI 布局要求，并写入文本图库 */
export async function executeGameSystemGenerateNode(
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
  const incomingText = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources)

  if (!ctx.generateText) {
    const localText = normalizeLocalScreenplayText(node.params.text)
    const text = instruction.trim() || incomingText || localText
    if (!text.trim()) return dualTextGalleryOutputs([], '')
    return await persistScreenplayGeneration(ctx, text)
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const userPrompt = instruction.trim() || defaultGameSystemUserPrompt(ctx.locale)
  const prompt = incomingText ? `${userPrompt.trim()}\n\n${incomingText}` : userPrompt
  const system = resolveGameSystemSystemPrompt(node.params.generateSystemPrompt, ctx.locale)

  const result = await ctx.generateText({
    prompt,
    system,
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined
  })
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const text = result.text.trim()
  if (!text) throw new Error('模型未返回游戏系统策划案')

  return await persistScreenplayGeneration(ctx, text)
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
  const incomingText = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources)
  const localText = node.params.text?.trim() ?? ''
  const hints = flattenAssetValues(selected)
    .map((asset) => [asset.title, asset.label, asset.notes].filter(Boolean).join(' · '))
    .filter(Boolean)
    .join('\n')

  if (!ctx.generateText) {
    const text = instruction.trim() || incomingText || localText || hints
    if (text && text !== localText) {
      node.params = { ...node.params, text }
      ctx.patchNode?.({ params: { text } })
    }
    if (!text) return { out: { kind: 'text', text: '' } }
    return commitInMemoryTextGallery(ctx, text)
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const images = await collectImageUrlsForPrompt(ctx, instructionRaw)
  if (!images.length) {
    // 反推必须有图；有指令但无图时仍提示需要图片输入（非「未连接」泛化）
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  let prompt = buildToPromptUserPrompt(instruction, ctx.locale)
  if (incomingText) {
    prompt = `${prompt.trim()}\n\n${incomingText}`
  }
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

  return persistScreenplayGeneration(ctx, text)
}
