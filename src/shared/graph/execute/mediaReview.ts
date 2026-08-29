/**
 * 媒体质检节点执行器：把上游图片（可扩展至视频首帧）交给视觉模型做导演 PASS/FAIL 审核。
 * 结论经 parseMediaReviewVerdict 解析后回标 mediaReviewStatus / mediaReviewReason / mediaReviewPending，
 * 并写入文本图库供下游消费。未注入 generateText 时不调用模型，输出空文本并保持待审核。
 *
 * 与改造前的关键差异：
 * 1. 质检模型与生成模型解耦（reviewModel），不再拿图像模型去跑文本质检——那是结论不可信的根因；
 * 2. 输入逐张标注「参考图 / 待审产物」，否则「与参考图一致」这条硬性检查无从执行；
 * 3. 客观指标（张数等）由程序先行判定，不浪费视觉模型调用；
 * 4. 五维评分解析落 params，供界面展示与返工选优（此前算了分却没用）。
 */
import { pickAgentPrompt } from '../agentPrompts'
import { expandInstructionMentions } from '../instructionMentions'
import {
  buildMediaReviewPack,
  checkMediaObjective,
  mediaReviewCachedText,
  mediaReviewParamsFromVerdict,
  parseMediaReviewScores,
  parseMediaReviewVerdict,
  resolveMediaReviewRoles,
  resolveReviewModel,
  serializeMediaObjectiveIssues,
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
import { resolveMentionSources } from './context'
import { flattenImagesValues, flattenVideosValues } from './gallery'
import { collectIncomingValues } from './incoming'
import { commitInMemoryTextGallery } from './materialize'
import type { GraphValue, NodeExecuteContext } from './types'
import { fail } from '@shared/errors/appError'
import { SHARED_ERRORS } from '../../errors/catalog'

/** 视觉模型单次最多接收的图片数：过多既撑爆上下文也无益于判定 */
const REVIEW_IMAGE_LIMIT = 4

interface MediaReviewInputImage {
  url: string
  role: MediaReviewRole
}

/**
 * 收集上游媒体 → 可加载 URL 并标注角色（去重，最多 4 张以免请求过大）。
 * 视频不塞原片，改用主进程系统取帧得到首帧图片供视觉模型看图。
 */
async function collectMediaReviewImages(
  ctx: NodeExecuteContext,
  referenceCount?: number
): Promise<MediaReviewInputImage[]> {
  const incoming = collectIncomingValues(ctx.inputs)
  const imageItems = flattenImagesValues(incoming).filter(
    (item) =>
      (typeof item.dataUrl === 'string' && item.dataUrl.length > 0) ||
      (typeof item.relativePath === 'string' && item.relativePath.length > 0)
  )
  const videoItems = flattenVideosValues(incoming).filter(
    (item) =>
      (typeof item.dataUrl === 'string' && item.dataUrl.length > 0) ||
      (typeof item.relativePath === 'string' && item.relativePath.length > 0)
  )

  const imageUrls: string[] = []
  if (imageItems.length && ctx.resolveImageUrls) {
    imageUrls.push(...(await ctx.resolveImageUrls(imageItems)))
  } else {
    for (const item of imageItems) {
      const dataUrl = item.dataUrl?.trim()
      if (dataUrl) imageUrls.push(dataUrl)
    }
  }

  const frameUrls: string[] = []
  if (videoItems.length && ctx.resolveVideoFirstFrameImageUrls) {
    frameUrls.push(...(await ctx.resolveVideoFirstFrameImageUrls(videoItems)))
  }

  const frameSet = new Set(frameUrls)
  const combined = [...new Set([...imageUrls, ...frameUrls].filter(Boolean))].slice(
    0,
    REVIEW_IMAGE_LIMIT
  )
  const pictureCount = combined.filter((url) => !frameSet.has(url)).length
  const roles = resolveMediaReviewRoles(pictureCount, referenceCount)

  let pictureIndex = 0
  return combined.map((url) => {
    // 视频首帧恒为审核对象：它是产物，不该被当成风格基准
    if (frameSet.has(url)) return { url, role: 'artifact' as const }
    return { url, role: roles[pictureIndex++] ?? ('artifact' as const) }
  })
}

export async function executeMediaReviewNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const status = node.params.mediaReviewStatus
  const pending = node.params.mediaReviewPending !== false

  // 已审核过且未标记重新审核：复用上次结论，不重复调用模型
  if (!pending && (status === 'PASS' || status === 'FAIL')) {
    const cachedText = node.params.text?.trim() || mediaReviewCachedText(status, node.params.mediaReviewReason ?? '')
    return { out: { kind: 'text', text: cachedText } }
  }

  const generateTextFn = ctx.generateText
  if (!generateTextFn) {
    return { out: { kind: 'text', text: '' } }
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const images = await collectMediaReviewImages(ctx, node.params.mediaReviewReferenceCount)
  if (!images.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const mentionSources = resolveMentionSources(ctx)
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const spec = instructionRaw
    ? expandInstructionMentions(instructionRaw, mentionSources)
    : node.params.text?.trim() ?? ''

  // 客观校验先行：程序能判定的不劳烦视觉模型
  const artifactCount = images.filter((item) => item.role === 'artifact').length
  const expectedCount = node.params.generateCount
  const issues = checkMediaObjective({
    ...(typeof expectedCount === 'number' && Number.isFinite(expectedCount)
      ? { expectedCount }
      : {}),
    actualCount: artifactCount
  })
  const issueTexts = issues.map((issue) =>
    mediaObjectiveIssueText(issue.code, issue.detail, ctx.locale)
  )

  const pack = buildMediaReviewPack()
  const system = pickAgentPrompt(pack, ctx.locale, 'systemPrompt')
  const instruction = pickAgentPrompt(pack, ctx.locale, 'instruction')
  const identity = mediaReviewIdentityBlock(
    images.map((item) => item.role),
    ctx.locale
  )
  const objective = mediaReviewObjectiveBlock(issueTexts, ctx.locale)
  const prompt = [instruction, mediaReviewSpecBlock(spec, ctx.locale), identity, objective]
    .filter(Boolean)
    .join('\n\n')

  // 质检模型与生成模型解耦：缺省回退生成模型仅为兼容旧图，此时 dedicated=false 供 UI 提示
  const reviewModel = resolveReviewModel(node.params)

  // 备选模型链：质检模型限流 / 不可用时按序自动切换，否则整条返工链会因一次 429 停摆
  const reviewCall = await runWithModelFallback(
    buildModelChain(
      {
        ...(reviewModel.model ? { model: reviewModel.model } : {}),
        ...(reviewModel.providerInstanceId
          ? { providerInstanceId: reviewModel.providerInstanceId }
          : {})
      },
      parseModelChain(node.params.reviewModelFallbacks)
    ),
    (ref) =>
      generateTextFn({
        prompt,
        system,
        ...(ref.model ? { model: ref.model } : {}),
        ...(ref.providerInstanceId ? { providerInstanceId: ref.providerInstanceId } : {}),
        images: images.map((item) => item.url)
      }),
    { signal: ctx.signal }
  )
  const result = reviewCall.value
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const text = result.text.trim()
  if (!text) throw fail(SHARED_ERRORS.resultMissing, { what: { zh: '质检结果', en: 'QC verdict' } })  // cjk-ok 双语错误数据（zh/en，由 errors/catalog 统一格式化）

  const verdict = parseMediaReviewVerdict(text)
  const scores = parseMediaReviewScores(text)
  const patch: Partial<GraphNodeParams> = {}
  if (verdict) Object.assign(patch, mediaReviewParamsFromVerdict(verdict))
  if (scores) patch.mediaReviewScores = serializeMediaReviewScores(scores)
  if (issues.length) {
    patch.mediaReviewObjectiveIssues = serializeMediaObjectiveIssues(issues)
  }
  if (Object.keys(patch).length) {
    node.params = { ...node.params, ...patch }
    ctx.patchNode?.({ params: patch })
  }

  return commitInMemoryTextGallery(ctx, text)
}
