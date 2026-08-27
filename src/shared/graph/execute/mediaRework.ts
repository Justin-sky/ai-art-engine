/**
 * 媒体自动返工循环节点执行器：生成 → 质检 → FAIL 注入原因重新生成，直到 PASS 或达尝试上限。
 * 每轮生成单张图（复用图片生成参数解析），再用视觉文本模型按 mediaReview 质检包审核；
 * 循环状态序列化回写 mediaReworkState / mediaReworkStatus，最终图落入图库。
 * 未注入 generateImage / generateText 时不能自动返工，退回透传参考图。
 */
import { pickAgentPrompt } from '../agentPrompts'
import { expandInstructionMentions } from '../instructionMentions'
import { resolveImageGenerateParamsForApi, resolveGenerateSeed } from '../imageGenerateParams'
import {
  applyMediaReworkReview,
  buildMediaReworkInstruction,
  clampMediaReworkMaxAttempts,
  createMediaReworkState,
  parseMediaReworkState,
  serializeMediaReworkState,
  shouldMediaReworkContinue
} from '../mediaRework'
import { buildMediaReviewPack, parseMediaReviewVerdict } from '../mediaReview'
import { resolveImageSystemPrompt } from '../systemPromptSchemes'
import { buildImagePrompt } from '../userPromptSchemes'
import { resolveMentionSources } from './context'
import { dualImageGalleryOutputs } from './gallery'
import { autoIncomingTextForInstruction, selectIncomingValuesForInstruction } from './incoming'
import { collectImageGenerateSourceItems } from './mediaInputs'
import { commitGeneratedImages, materializeGeneratedBatch, mergeGeneratedImages } from './materialize'
import type { GraphImageItem, GraphValue, NodeExecuteContext } from './types'

export async function executeMediaReworkNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const maxAttempts = clampMediaReworkMaxAttempts(node.params.mediaReworkMaxAttempts)
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const mentionSources = resolveMentionSources(ctx)
  const baseInstruction = expandInstructionMentions(instructionRaw, mentionSources)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const incomingText = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources)
  const sourceItems = await collectImageGenerateSourceItems(ctx, instructionRaw)

  let state =
    parseMediaReworkState(node.params.mediaReworkState) ?? createMediaReworkState(maxAttempts)
  // 用户调高上限后可继续；上限变化时同步到状态
  if (state.status === 'exhausted' && maxAttempts > state.attempt) {
    state = { ...state, maxAttempts, status: 'running' }
  } else if (state.maxAttempts !== maxAttempts) {
    state = { ...state, maxAttempts }
  }

  // 已通过且未标记重跑：复用已有图库，不重复生成
  if (
    state.status === 'passed' &&
    node.params.mediaReviewPending === false &&
    (node.params.generatedImages ?? []).length
  ) {
    return dualImageGalleryOutputs(node.params.generatedImages ?? [], node.params.selectedImageId ?? '')
  }

  if (!ctx.generateImage || !ctx.generateText) {
    if (sourceItems.length) {
      return commitGeneratedImages(
        ctx,
        sourceItems.map((item, index) => ({ ...item, id: item.id?.trim() || `source:${index}` })),
        sourceItems[0]?.relativePath?.trim()
      )
    }
    return { out: { kind: 'images', items: [] } }
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

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

  const genParams = resolveImageGenerateParamsForApi(node.params)

  let finalBatch: GraphImageItem[] = []
  let finalReviewText = ''

  while (shouldMediaReworkContinue(state)) {
    if (ctx.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    const instruction = buildMediaReworkInstruction(baseInstruction, state.lastReason, ctx.locale)
    let userPrompt = buildImagePrompt(instruction, ctx.locale)
    if (incomingText) {
      userPrompt = userPrompt.trim() ? `${userPrompt.trim()}\n\n${incomingText}` : incomingText
    }
    const system = resolveImageSystemPrompt(node.params.generateSystemPrompt, ctx.locale)
    const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt
    if (!prompt.trim() && !portUrls.length) {
      throw new Error('GRAPH_PROCESS_NO_INPUT')
    }

    const result = await ctx.generateImage({
      prompt,
      model: node.params.generateModel || undefined,
      providerInstanceId: node.params.generateProviderInstanceId || undefined,
      aspectRatio: genParams.aspectRatio,
      resolution: genParams.resolution,
      quality: genParams.quality,
      n: 1,
      seed: resolveGenerateSeed(node.params, ctx.resolveProjectGenerateSeed?.()),
      inputReferences: portUrls.length ? portUrls : undefined
    })
    if (ctx.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    const images = (result.images ?? []).map((url) => url.trim()).filter(Boolean)
    if (!images.length) throw new Error('模型未返回图片')

    const pack = buildMediaReviewPack()
    const reviewSystem = pickAgentPrompt(pack, ctx.locale, 'systemPrompt')
    const reviewInstruction = pickAgentPrompt(pack, ctx.locale, 'instruction')
    const spec = baseInstruction || node.params.text?.trim() || ''
    const reviewPrompt = spec ? `${reviewInstruction}\n\n【生成指令】${spec}` : reviewInstruction
    const review = await ctx.generateText({
      prompt: reviewPrompt,
      system: reviewSystem,
      model: node.params.generateModel || undefined,
      providerInstanceId: node.params.generateProviderInstanceId || undefined,
      images: images.slice(0, 4)
    })
    if (ctx.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    finalReviewText = review.text.trim()
    if (!finalReviewText) throw new Error('模型未返回质检结果')

    const verdict = parseMediaReviewVerdict(finalReviewText)
    state = applyMediaReworkReview(state, verdict?.result ?? 'FAIL', verdict?.reason ?? finalReviewText)

    const createdAt = new Date().toISOString()
    finalBatch = images.map((dataUrl, index) => ({
      id: `gen:${node.id}:${state.attempt}:${index}`,
      dataUrl,
      createdAt
    }))
  }

  const reworkParams = {
    mediaReworkState: serializeMediaReworkState(state),
    mediaReworkStatus: state.status,
    mediaReworkMaxAttempts: state.maxAttempts,
    mediaReviewStatus: (state.status === 'passed' ? 'PASS' : 'FAIL') as 'PASS' | 'FAIL',
    mediaReviewReason: state.lastReason || '',
    mediaReviewPending: state.status !== 'passed'
  }
  node.params = { ...node.params, ...reworkParams }
  ctx.patchNode?.({ params: reworkParams })

  if (!finalBatch.length) {
    return { out: { kind: 'images', items: [] } }
  }

  const materialized = await materializeGeneratedBatch(ctx, finalBatch, `gen:${node.id}:rework`)
  const merged = mergeGeneratedImages(ctx, materialized, `gen:${node.id}:rework:keep`)
  return commitGeneratedImages(ctx, merged, materialized[0]?.relativePath?.trim())
}
