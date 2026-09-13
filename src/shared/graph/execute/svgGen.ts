/**
 * SVG 生成节点（`svg.gen`）执行器：文本模型产出 SVG 源码 → 落盘为工程内 .svg 资产
 * （主进程按 MIME 落 .svg，资产类型沿用 image 家族）→ `out` 出选中项、`out-all` 出累计图库。
 *
 * 与 `svgAnim.ts` 的关系：本节点产出的 `svg` 端口值正是 SVG 烘焙节点的输入。
 */
import { buildGeneratedMediaFileKey, formatGeneratedMediaStamp } from '../../domain'
import { fail } from '../../errors/appError'
import { SHARED_ERRORS } from '../../errors/catalog'
import { expandInstructionMentions } from '../instructionMentions'
import { GRAPH_OUT_ALL_PORT_ID } from '../ports'
import {
  buildSvgGenCanvasInstruction,
  buildSvgGenReferenceInstruction,
  encodeSvgDataUrl,
  extractSvgMarkup,
  readSvgGenFromNode,
  resolveSvgGenSystemPrompt,
  SVG_GEN_REFERENCE_MAX
} from '../svgGen'
import { resolveMentionSources } from './context'
import { autoIncomingTextForInstruction, selectIncomingValuesForInstruction } from './incoming'
import { collectIncomingImageItems } from './mediaInputs'
import type { GraphSvgItem, GraphSvgValue, GraphValue, NodeExecuteContext } from './types'

/** SVG 图库保留上限（超出丢最旧的） */
const SVG_GENERATED_MAX = 24

/**
 * 收集 `in-image` 上游参考图并解析为多模态模型可消费的 URL。
 * 优先走能力缝 `resolveImageUrls`（落盘资产读原文件），无能力缝时退回条目内 dataUrl；
 * 超出 `SVG_GEN_REFERENCE_MAX` 的部分截断，避免把整库图片都送进单次请求。
 */
async function resolveSvgGenReferenceUrls(ctx: NodeExecuteContext): Promise<string[]> {
  const items = await collectIncomingImageItems(ctx)
  if (!items.length) return []
  const urls = ctx.resolveImageUrls
    ? await ctx.resolveImageUrls(items)
    : items.map((item) => item.dataUrl?.trim() ?? '')
  return urls
    .map((url) => url.trim())
    .filter(Boolean)
    .slice(0, SVG_GEN_REFERENCE_MAX)
}

export async function executeSvgGenNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const mentionSources = resolveMentionSources(ctx)
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const incomingText = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources)

  if (!ctx.generateText) {
    // 测试 / 离线：指令（或节点正文）本身已是 SVG 源码时直接落盘，否则按「缺输入」报错
    const local = extractSvgMarkup(instruction || (node.params.text ?? ''))
    if (!local) throw new Error('GRAPH_PROCESS_NO_INPUT')
    return await commitSvgGallery(ctx, [local])
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const referenceUrls = await resolveSvgGenReferenceUrls(ctx)
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const userPrompt = [
    instruction,
    incomingText,
    buildSvgGenCanvasInstruction(readSvgGenFromNode(node.params), ctx.locale),
    buildSvgGenReferenceInstruction(referenceUrls.length, ctx.locale)
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n\n')

  const result = await ctx.generateText({
    prompt: userPrompt,
    system: resolveSvgGenSystemPrompt(node.params.generateSystemPrompt, ctx.locale),
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    ...(referenceUrls.length ? { images: referenceUrls } : {})
  })
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const svg = extractSvgMarkup(result.text ?? '')
  if (!svg) throw fail(SHARED_ERRORS.svgGenEmpty)

  return await commitSvgGallery(ctx, [svg])
}

/**
 * 落盘 + 累计 + 组装输出（`out` 选中项 / `out-all` 全部历史）。
 * 无 saveRunMedia 能力缝时只保留内存态（text + dataUrl），仍可正常流转。
 */
export async function commitSvgGallery(
  ctx: NodeExecuteContext,
  sources: string[]
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const incoming = sources.map((svg) => svg.trim()).filter(Boolean)
  if (!incoming.length) throw new Error('GRAPH_PROCESS_NO_INPUT')

  const stamp = formatGeneratedMediaStamp()
  const createdAt = new Date().toISOString()
  const generated: GraphSvgItem[] = []

  for (const [index, svg] of incoming.entries()) {
    const key = buildGeneratedMediaFileKey({
      hostAssetName: ctx.resolveHostAssetName?.(),
      nodeTitle: node.title || node.typeId || 'svg',
      stamp,
      index: incoming.length > 1 ? index + 1 : null
    })
    const dataUrl = encodeSvgDataUrl(svg)
    let relativePath = ''
    if (ctx.saveRunMedia) {
      relativePath = await ctx.saveRunMedia({
        dataUrl,
        key,
        outputDir: node.params.mediaOutputDir?.trim() || undefined,
        node
      })
    }
    generated.push({
      id: key,
      title: incoming.length > 1 ? `${node.title || 'SVG'} ${index + 1}` : node.title || 'SVG',
      text: svg,
      dataUrl,
      createdAt,
      ...(relativePath?.trim() ? { relativePath: relativePath.trim() } : {})
    })
  }

  const previous = Array.isArray(node.params.generatedSvgs) ? node.params.generatedSvgs : []
  const merged = [
    ...generated,
    ...previous.filter((item) => !generated.some((next) => next.id === item.id))
  ].slice(0, SVG_GENERATED_MAX)
  const selectedSvgId = generated[0]?.id ?? merged[0]?.id
  const selectedItem = merged.find((item) => item.id === selectedSvgId) ?? merged[0]
  // 卡片缩略与「运行预览」走 preview 字段（与 frame.animGen 同口径）
  const params = {
    ...node.params,
    generatedSvgs: merged,
    selectedSvgId,
    ...(selectedItem?.dataUrl ? { previewDataUrl: selectedItem.dataUrl } : {}),
    ...(selectedItem?.relativePath ? { previewRelativePath: selectedItem.relativePath } : {})
  }
  node.params = params
  ctx.patchNode?.({
    params: {
      generatedSvgs: merged,
      selectedSvgId,
      ...(selectedItem?.dataUrl ? { previewDataUrl: selectedItem.dataUrl } : {}),
      ...(selectedItem?.relativePath ? { previewRelativePath: selectedItem.relativePath } : {})
    }
  })
  return {
    out: toSvgValue(selectedItem),
    [GRAPH_OUT_ALL_PORT_ID]: { kind: 'svgs', items: merged }
  }
}

/** SVG 图库条目 → 单值（`out` 端口） */
export function toSvgValue(item?: GraphSvgItem | null): GraphSvgValue {
  if (!item) return { kind: 'svg', text: '' }
  return {
    kind: 'svg',
    ...(item.id ? { id: item.id } : {}),
    ...(item.title ? { title: item.title } : {}),
    text: item.text,
    ...(item.dataUrl ? { dataUrl: item.dataUrl } : {}),
    ...(item.createdAt ? { createdAt: item.createdAt } : {}),
    ...(item.relativePath ? { relativePath: item.relativePath } : {})
  }
}
