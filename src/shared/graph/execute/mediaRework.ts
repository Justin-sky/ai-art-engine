/**
 * 媒体自动返工循环节点执行器：生成 → 质检 → FAIL 注入原因重新生成，直到 PASS 或达尝试上限。
 * 每轮生成单张图（复用图片生成参数解析），再用视觉文本模型按 mediaReview 质检包审核；
 * 循环状态序列化回写 mediaReworkState / mediaReworkStatus，最终图落入图库。
 * 未注入 generateImage / generateText 时不能自动返工，退回透传参考图。
 *
 * 与改造前的关键差异：
 * 1. 质检改用 reviewModel（视觉模型），不再拿图像模型跑 generateText——此前质检结论基本不可信；
 * 2. 全部轮次产物都进图库，且按「PASS 优先、其次评分最高」挑最优作为输出，
 *    此前只保留最后一轮，等于花 N 倍成本却可能拿到最差的一张；
 * 3. 结论解析不出（模型未按协议输出）记为 UNDECIDED，不消耗尝试额度；
 * 4. 客观指标（宽高比）由程序判定，且硬指标不过关时不被模型的主观 PASS 推翻；
 * 5. 返工策略按失败轮次升档，并逐轮换种子，避免固定种子下每轮出同一张；
 * 6. 支持首轮出图后暂停等待人工确认，避免无人值守一路烧到上限；
 * 7. 记录各轮调用开销与质检评分，供界面展示。
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
  resolveReworkStrategy,
  selectBestIteration,
  serializeMediaReworkState,
  shouldMediaReworkContinue,
  type MediaReworkIterationResult
} from '../mediaRework'
import {
  buildMediaReviewPack,
  checkMediaObjective,
  parseMediaReviewScores,
  parseMediaReviewVerdict,
  resolveReviewModel,
  serializeMediaReviewScores,
  type MediaReviewRole
} from '../mediaReview'
import {
  mediaObjectiveIssueText,
  mediaReviewIdentityBlock,
  mediaReviewObjectiveBlock,
  mediaReviewSpecBlock
} from '../mediaReviewPrompts'
import { buildModelChain, parseModelChain, runWithModelFallback } from '../modelFallback'
import type { GraphNodeParams } from '../types'
import { resolveImageSystemPrompt } from '../systemPromptSchemes'
import { buildImagePrompt } from '../userPromptSchemes'
import { resolveMentionSources } from './context'
import { newestImageSelectedId, dualImageGalleryOutputs } from './gallery'
import { describeAspectRatio, readImageDimensions } from './imageDimensions'
import { autoIncomingTextForInstruction, selectIncomingValuesForInstruction } from './incoming'
import { collectImageGenerateSourceItems } from './mediaInputs'
import { commitGeneratedImages, materializeGeneratedBatch, mergeGeneratedImages } from './materialize'
import type { GraphImageItem, GraphValue, NodeExecuteContext } from './types'
import { fail } from '@shared/errors/appError'
import { SHARED_ERRORS } from '../../errors/catalog'

/** 视觉模型单次最多接收的图片数（参考图 + 产物合计） */
const REVIEW_IMAGE_LIMIT = 4

/**
 * 逐轮换种子。
 * 固定种子下重跑会得到近乎相同的图，问题根本改不掉；
 * 这里在非首轮时递增，既保证每轮画面不同，又保留可复现性。
 */
function resolveReworkSeed(base: number | undefined, round: number): number | undefined {
  if (round <= 1) return base
  if (typeof base === 'number' && Number.isFinite(base)) {
    return Math.abs(Math.floor(base) + round) % 2147483647
  }
  return undefined
}

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

  // 首轮人工确认：已出图并等待用户决定，此期间不继续消耗调用
  if (
    node.params.mediaReworkConfirmFirst === true &&
    node.params.mediaReworkAwaitingConfirm === true &&
    (node.params.generatedImages ?? []).length
  ) {
    return dualImageGalleryOutputs(node.params.generatedImages ?? [], node.params.selectedImageId ?? '')
  }

  const generateImageFn = ctx.generateImage
  const generateTextFn = ctx.generateText
  if (!generateImageFn || !generateTextFn) {
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
  const baseSeed = resolveGenerateSeed(node.params, ctx.resolveProjectGenerateSeed?.())
  // 质检模型与生成模型解耦：缺省回退生成模型仅为兼容旧图
  const reviewModel = resolveReviewModel(node.params)

  // 备选模型链：首选模型调用失败（限流 / 不可用 / 超时）时按序自动切换，
  // 否则一次 429 就会让已经烧掉多轮的返工整轮作废。
  const imageChain = buildModelChain(
    {
      ...(node.params.generateModel?.trim() ? { model: node.params.generateModel.trim() } : {}),
      ...(node.params.generateProviderInstanceId?.trim()
        ? { providerInstanceId: node.params.generateProviderInstanceId.trim() }
        : {})
    },
    parseModelChain(node.params.generateModelFallbacks)
  )
  const reviewChain = buildModelChain(
    {
      ...(reviewModel.model ? { model: reviewModel.model } : {}),
      ...(reviewModel.providerInstanceId
        ? { providerInstanceId: reviewModel.providerInstanceId }
        : {})
    },
    parseModelChain(node.params.reviewModelFallbacks)
  )

  /** 累积全部轮次产物：返工的价值是「多试取优」 */
  const rounds: GraphImageItem[] = []
  let finalReviewText = ''
  let lastObjectiveTexts: string[] = []
  let awaitingConfirm = false

  while (shouldMediaReworkContinue(state)) {
    if (ctx.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    const round = state.attempt + 1
    const strategy = resolveReworkStrategy(node.params.mediaReworkStrategy, state.attempt)

    const instruction = buildMediaReworkInstruction(baseInstruction, state.lastReason, ctx.locale, {
      strategy,
      objectiveIssues: lastObjectiveTexts
    })
    let userPrompt = buildImagePrompt(instruction, ctx.locale)
    if (incomingText) {
      userPrompt = userPrompt.trim() ? `${userPrompt.trim()}\n\n${incomingText}` : incomingText
    }
    const system = resolveImageSystemPrompt(node.params.generateSystemPrompt, ctx.locale)
    const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt
    if (!prompt.trim() && !portUrls.length) {
      throw new Error('GRAPH_PROCESS_NO_INPUT')
    }

    const seed = resolveReworkSeed(baseSeed, round)

    const imageCall = await runWithModelFallback(
      imageChain,
      (ref) =>
        generateImageFn({
          prompt,
          ...(ref.model ? { model: ref.model } : {}),
          ...(ref.providerInstanceId ? { providerInstanceId: ref.providerInstanceId } : {}),
          aspectRatio: genParams.aspectRatio,
          resolution: genParams.resolution,
          quality: genParams.quality,
          n: 1,
          ...(seed !== undefined ? { seed } : {}),
          inputReferences: portUrls.length ? portUrls : undefined
        }),
      { signal: ctx.signal }
    )
    const result = imageCall.value
    if (ctx.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    const images = (result.images ?? []).map((url) => url.trim()).filter(Boolean)
    if (!images.length) throw fail(SHARED_ERRORS.noModelImage)

    // 客观校验先行：宽高比这类硬指标由程序判定，不必劳烦视觉模型
    const dimensions = readImageDimensions(images[0] ?? '')
    const objectiveIssues = checkMediaObjective({
      ...(genParams.aspectRatio ? { expectedAspectRatio: genParams.aspectRatio } : {}),
      ...(dimensions ? { actualAspectRatio: describeAspectRatio(dimensions) } : {})
    })
    lastObjectiveTexts = objectiveIssues.map((issue) =>
      mediaObjectiveIssueText(issue.code, issue.detail, ctx.locale)
    )

    // 质检：参考图与产物一并送入，并逐张标注身份，否则「与参考图一致」无从判定
    const pack = buildMediaReviewPack()
    const reviewSystem = pickAgentPrompt(pack, ctx.locale, 'systemPrompt')
    const reviewInstruction = pickAgentPrompt(pack, ctx.locale, 'instruction')
    const roles: MediaReviewRole[] = [
      ...portUrls.map(() => 'reference' as const),
      ...images.map(() => 'artifact' as const)
    ].slice(0, REVIEW_IMAGE_LIMIT)
    const identity = mediaReviewIdentityBlock(roles, ctx.locale)
    const objective = mediaReviewObjectiveBlock(lastObjectiveTexts, ctx.locale)
    const spec = baseInstruction || node.params.text?.trim() || ''
    const reviewPrompt = [
      reviewInstruction,
      mediaReviewSpecBlock(spec, ctx.locale),
      identity,
      objective
    ]
      .filter(Boolean)
      .join('\n\n')

    const reviewCall = await runWithModelFallback(
      reviewChain,
      (ref) =>
        generateTextFn({
          prompt: reviewPrompt,
          system: reviewSystem,
          ...(ref.model ? { model: ref.model } : {}),
          ...(ref.providerInstanceId ? { providerInstanceId: ref.providerInstanceId } : {}),
          images: [...portUrls, ...images].slice(0, REVIEW_IMAGE_LIMIT)
        }),
      { signal: ctx.signal }
    )
    const review = reviewCall.value
    if (ctx.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    finalReviewText = review.text.trim()
    if (!finalReviewText) throw fail(SHARED_ERRORS.resultMissing, { what: { zh: '质检结果', en: 'QC verdict' } })  // cjk-ok 双语错误数据（zh/en，由 errors/catalog 统一格式化）

    const verdict = parseMediaReviewVerdict(finalReviewText)
    const scores = parseMediaReviewScores(finalReviewText)

    const roundImageIds = images.map((_, index) => `gen:${node.id}:${round}:${index}`)
    const createdAt = new Date().toISOString()
    rounds.push(
      ...images.map((dataUrl, index) => ({
        id: roundImageIds[index],
        dataUrl,
        createdAt
      }))
    )

    // 硬指标不过关即判 FAIL：不能被模型的主观 PASS 推翻
    const objectiveFailed = objectiveIssues.length > 0
    const resultKind: MediaReworkIterationResult = objectiveFailed
      ? 'FAIL'
      : (verdict?.result ?? 'UNDECIDED')
    const reason = objectiveFailed
      ? lastObjectiveTexts.join('; ')
      : (verdict?.reason ?? '')

    state = applyMediaReworkReview(state, resultKind, reason, {
      ...(seed !== undefined ? { seed } : {}),
      imageIds: roundImageIds,
      ...(scores ? { score: scores.average } : {}),
      strategy,
      ...(imageCall.used.model ? { model: imageCall.used.model } : {}),
      ...(reviewCall.used.model ? { reviewModel: reviewCall.used.model } : {}),
      modelSwitches: imageCall.skipped.length + reviewCall.skipped.length
    })
    state = {
      ...state,
      cost: [
        ...(state.cost ?? []),
        { attempt: state.attempt, imageCalls: 1, reviewCalls: 1, at: createdAt }
      ]
    }

    // 首轮人工确认：先让用户看到第一张，确认后才继续烧后续轮次
    if (node.params.mediaReworkConfirmFirst === true && state.status === 'running') {
      awaitingConfirm = true
      break
    }
  }

  const reworkParams: Partial<GraphNodeParams> = {
    mediaReworkState: serializeMediaReworkState(state),
    mediaReworkStatus: state.status,
    mediaReworkMaxAttempts: state.maxAttempts,
    mediaReviewStatus: (state.status === 'passed' ? 'PASS' : 'FAIL') as 'PASS' | 'FAIL',
    mediaReviewReason: state.lastReason || '',
    mediaReviewPending: state.status !== 'passed',
    mediaReworkAwaitingConfirm: awaitingConfirm,
    mediaReworkCost: `${JSON.stringify(state.cost ?? [], null, 2)}\n`
  }
  const lastScores = parseMediaReviewScores(finalReviewText)
  if (lastScores) reworkParams.mediaReviewScores = serializeMediaReviewScores(lastScores)

  if (!rounds.length) {
    node.params = { ...node.params, ...reworkParams }
    ctx.patchNode?.({ params: reworkParams })
    return { out: { kind: 'images', items: [] } }
  }

  const materialized = await materializeGeneratedBatch(ctx, rounds, `gen:${node.id}:rework`)
  const merged = mergeGeneratedImages(ctx, materialized, `gen:${node.id}:rework:keep`)

  // 输出最优产物：PASS 优先，其次质检均分最高；图库仍保留全部轮次供人工挑选
  const best = selectBestIteration(state)
  const bestId = best?.imageIds?.[0]
  const selectedId =
    bestId && merged.some((item) => item.id === bestId)
      ? bestId
      : newestImageSelectedId(merged)

  const galleryPatch = {
    ...reworkParams,
    generatedImages: merged,
    selectedImageId: selectedId,
    previewRelativePath:
      merged.find((item) => item.id === selectedId)?.relativePath?.trim() || ''
  }
  node.params = { ...node.params, ...galleryPatch }
  ctx.patchNode?.({ params: galleryPatch })
  return dualImageGalleryOutputs(merged, selectedId)
}
