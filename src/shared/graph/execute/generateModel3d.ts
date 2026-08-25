import type { GraphValue } from '../types'
import type { NodeExecuteContext } from './types'
import {
  expandInstructionMentions
} from '../instructionMentions'
import { resolveMentionSources } from './context'
import { autoIncomingTextForInstruction } from './incoming'
import { selectIncomingValuesForInstruction } from './incoming'
import { collectImageGenerateSourceItems } from './mediaInputs'
import { dualImageGalleryOutputs } from './gallery'
import { GRAPH_OUT_ALL_PORT_ID } from '../ports'

/**
 * 收集上游图片输入（参考图）
 */
async function collectModel3dImageUrls(
  ctx: NodeExecuteContext,
  instructionRaw: string
): Promise<string[]> {
  const items = await collectImageGenerateSourceItems(ctx, instructionRaw)
  if (!items.length) return []

  if (ctx.resolveImageUrls) {
    return (await ctx.resolveImageUrls(items)).filter(Boolean)
  }
  return items.map((item) => item.dataUrl?.trim() ?? '').filter(Boolean)
}

/**
 * 3D 模型生成节点执行器
 *
 * 流程：
 * 1. 解析指令文本
 * 2. 收集上游图片参考
 * 3. 有 generateModel3d API 时调用 API 生成（异步 submit → poll → download）
 * 4. 无 API 时退化为透传（输出上游文本/图片）
 * 5. 返回模型资产输出
 */
export async function executeModel3dGenerateNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const mentionSources = resolveMentionSources(ctx)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const localNotes = expandInstructionMentions(instructionRaw, mentionSources) || undefined
  const incomingText = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources)

  // 收集图片参考
  const imageUrls = await collectModel3dImageUrls(ctx, instructionRaw)

  // 无 API 时的透传行为
  if (!ctx.generateModel3d) {
    // 有上游图片则透传
    if (imageUrls.length > 0) {
      return dualImageGalleryOutputs(
        imageUrls.map((url, i) => ({
          id: `passthrough:${i}`,
          dataUrl: url,
          relativePath: ''
        })),
        imageUrls[0] ?? ''
      )
    }
    // 有上游文本则输出文本
    if (incomingText || instructionRaw.trim()) {
      return {
        out: {
          kind: 'text',
          text: [localNotes, incomingText].filter(Boolean).join('\n').trim() || instructionRaw.trim()
        }
      }
    }
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  // 构建提示词
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  let prompt = instruction || incomingText || ''
  if (!prompt.trim() && !imageUrls.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  // 构建输入引用
  const inputReferences = imageUrls.map((url) => ({ kind: 'image_url' as const, url }))

  // 调用 3D 模型生成 API
  const result = await ctx.generateModel3d({
    prompt,
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    inputReferences: inputReferences.length > 0 ? inputReferences : undefined,
    name: node.title
  })

  // 构建输出值
  const modelValue: GraphValue = {
    kind: 'asset',
    assetId: result.assetId,
    assetType: 'model',
    relativePath: result.relativePath,
    label: node.params.label,
    weight: node.params.weight,
    notes: localNotes,
    title: node.title
  }

  return { out: modelValue, [GRAPH_OUT_ALL_PORT_ID]: modelValue }
}