/**
 * 媒体质检节点执行器：把上游图片（可扩展至视频首帧）交给视觉文本模型做导演 PASS/FAIL 审核。
 * 结论经 parseMediaReviewVerdict 解析后回标 mediaReviewStatus / mediaReviewReason / mediaReviewPending，
 * 并写入文本图库供下游消费。未注入 generateText 时不调用模型，输出空文本并保持待审核。
 */
import { pickAgentPrompt } from '../agentPrompts'
import { expandInstructionMentions } from '../instructionMentions'
import {
  buildMediaReviewPack,
  mediaReviewCachedText,
  mediaReviewParamsFromVerdict,
  parseMediaReviewVerdict
} from '../mediaReview'
import { resolveMentionSources } from './context'
import { flattenImagesValues, flattenVideosValues } from './gallery'
import { collectIncomingValues } from './incoming'
import { commitInMemoryTextGallery } from './materialize'
import type { GraphValue, NodeExecuteContext } from './types'
import { fail } from '@shared/errors/appError'
import { SHARED_ERRORS } from '../../errors/catalog'

/**
 * 收集上游媒体 → 可加载 URL（图片 + 视频首帧；去重，最多 4 张以免请求过大）。
 * 视频不塞原片，改用主进程系统取帧得到首帧图片供视觉模型看图。
 */
async function collectMediaReviewImages(ctx: NodeExecuteContext): Promise<string[]> {
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

  const urls: string[] = []
  if (imageItems.length && ctx.resolveImageUrls) {
    urls.push(...(await ctx.resolveImageUrls(imageItems)))
  } else {
    for (const item of imageItems) {
      const dataUrl = item.dataUrl?.trim()
      if (dataUrl) urls.push(dataUrl)
    }
  }
  if (videoItems.length && ctx.resolveVideoFirstFrameImageUrls) {
    urls.push(...(await ctx.resolveVideoFirstFrameImageUrls(videoItems)))
  }
  return [...new Set(urls.filter(Boolean))].slice(0, 4)
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

  if (!ctx.generateText) {
    return { out: { kind: 'text', text: '' } }
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const images = await collectMediaReviewImages(ctx)
  if (!images.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const mentionSources = resolveMentionSources(ctx)
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const spec = instructionRaw
    ? expandInstructionMentions(instructionRaw, mentionSources)
    : node.params.text?.trim() ?? ''

  const pack = buildMediaReviewPack()
  const system = pickAgentPrompt(pack, ctx.locale, 'systemPrompt')
  const instruction = pickAgentPrompt(pack, ctx.locale, 'instruction')
  const prompt = spec ? `${instruction}\n\n【生成指令】${spec}` : instruction

  const result = await ctx.generateText({
    prompt,
    system,
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    images
  })
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const text = result.text.trim()
  if (!text) throw fail(SHARED_ERRORS.resultMissing, { what: { zh: '质检结果', en: 'QC verdict' } })  // cjk-ok 双语错误数据（zh/en，由 errors/catalog 统一格式化）

  const verdict = parseMediaReviewVerdict(text)
  if (verdict) {
    const patch = mediaReviewParamsFromVerdict(verdict)
    node.params = { ...node.params, ...patch }
    ctx.patchNode?.({ params: patch })
  }

  return commitInMemoryTextGallery(ctx, text)
}
