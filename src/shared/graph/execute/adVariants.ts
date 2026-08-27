import type { GraphImageItem, GraphValue, NodeExecuteContext } from './types'
import {
  commitGeneratedImages,
  materializeGeneratedBatch,
  mergeGeneratedImages
} from './materialize'
import { collectIncomingImageItems } from './mediaInputs'
import { dualImageGalleryOutputs } from './gallery'
import {
  applyAdVariantOutputRefs,
  expandAdVariantMatrix,
  readAdVariantMatrixFromNode
} from '../adVariantMatrix'
import { resolveAdVariantSystemPrompt } from '../systemPromptSchemes'

/**
 * 广告变体生成：按矩阵单元格逐个生成图片（可选产品参考图），汇总进图库 out-all，
 * 并把每个单元格的生成结果相对路径回填到矩阵 outputRefs（用于 A/B 对比视图）。
 */
export async function executeAdVariantsNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const matrix = readAdVariantMatrixFromNode(node.params)
  const cells = matrix.cells.length
    ? matrix.cells
    : expandAdVariantMatrix(matrix.product, matrix.dimensions)

  if (!cells.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  if (!ctx.generateImage) {
    // 无图片生成 API：不生成，返回空图库（矩阵仍保留，便于预览/调试）
    return dualImageGalleryOutputs([], '')
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  // 可选产品参考图：存在则作为所有单元格的 inputReferences，保证产品一致性
  let inputReferences: string[] = []
  const sourceItems = await collectIncomingImageItems(ctx)
  if (sourceItems.length) {
    if (ctx.resolveImageUrls) {
      inputReferences = (await ctx.resolveImageUrls(sourceItems.slice(0, 1))).filter(Boolean)
    } else {
      const dataUrl = sourceItems[0]?.dataUrl?.trim()
      if (dataUrl) inputReferences = [dataUrl]
    }
  }

  const system = resolveAdVariantSystemPrompt(node.params.generateSystemPrompt, ctx.locale).trim()
  const createdAt = new Date().toISOString()
  const stamp = Date.now()

  const batch: GraphImageItem[] = []
  const batchCellIds: string[] = []
  for (const [cellIndex, cell] of cells.entries()) {
    if (ctx.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    const prompt = system ? `${system}\n\n${cell.prompt}` : cell.prompt
    const result = await ctx.generateImage({
      prompt,
      model: node.params.generateModel || undefined,
      providerInstanceId: node.params.generateProviderInstanceId || undefined,
      aspectRatio: matrix.aspectRatio || undefined,
      quality: 'high',
      n: 1,
      inputReferences: inputReferences.length ? inputReferences : undefined
    })
    for (const [index, url] of (result.images ?? []).entries()) {
      const dataUrl = typeof url === 'string' ? url.trim() : ''
      if (!dataUrl) continue
      batch.push({
        id: `adVariant:${node.id}:${stamp}:${cellIndex}:${index}`,
        dataUrl,
        createdAt
      })
      batchCellIds.push(cell.id)
    }
  }

  if (!batch.length) {
    throw new Error('模型未返回变体图片')
  }

  const stampKey = `adVariant:${node.id}:${stamp}`
  const materializedBatch = await materializeGeneratedBatch(ctx, batch, stampKey)
  if (!materializedBatch.length) {
    throw new Error('图片落盘失败')
  }
  const generatedImages = mergeGeneratedImages(ctx, materializedBatch, `${stampKey}:keep`)

  const relativePaths = materializedBatch.map((item) => item.relativePath?.trim() ?? '')
  const updatedCells = applyAdVariantOutputRefs(cells, batchCellIds, relativePaths)

  return commitGeneratedImages(
    ctx,
    generatedImages,
    materializedBatch[0]?.relativePath?.trim(),
    { adVariantMatrix: { ...matrix, cells: updatedCells } }
  )
}
