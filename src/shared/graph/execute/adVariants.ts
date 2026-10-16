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
  getAdVariantCellEffectivePrompt,
  mergeExpandedAdVariantCells,
  readAdVariantMatrixFromNode,
  resolveAdVariantDownstreamPaths
} from '../adVariantMatrix'
import { resolveAdVariantSystemPrompt } from '../systemPromptSchemes'
import { fail } from '@shared/errors/appError'
import { SHARED_ERRORS } from '../../errors/catalog'

/**
 * 广告变体生成：按矩阵单元格逐个生成图片（支持多张产品/场景参考图、单格重抽、增量补齐与锁定跳过），
 * 汇总进图库 out-all，并把每个单元格的生成结果相对路径回填到矩阵 outputRefs（用于 A/B 对比视图与下游筛选）。
 */
export async function executeAdVariantsNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const matrix = readAdVariantMatrixFromNode(node.params)
  const expanded = expandAdVariantMatrix(matrix.product, matrix.dimensions, {
    sellingPoints: matrix.sellingPoints,
    ctaText: matrix.ctaText,
    locale: ctx.locale
  })
  const cells = matrix.cells.length
    ? expanded.length
      ? mergeExpandedAdVariantCells(matrix.cells, expanded)
      : matrix.cells
    : expanded

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

  // 产品与场景参考图：支持最多 4 张参考图（如产品主图 + 包装细节 + 场景/模特参考），保证产品一致性
  let inputReferences: string[] = []
  const sourceItems = await collectIncomingImageItems(ctx)
  if (sourceItems.length) {
    const refsSlice = sourceItems.slice(0, 4)
    if (ctx.resolveImageUrls) {
      inputReferences = (await ctx.resolveImageUrls(refsSlice)).filter(Boolean)
    } else {
      inputReferences = refsSlice.map((item) => item?.dataUrl?.trim() ?? '').filter(Boolean)
    }
  }

  // 决定本次需要执行的单元格列表：
  // 1) 指定了 adVariantOnlyCellId：仅生成该单元格
  // 2) adVariantRunMode === 'missing'：仅生成尚未出图且未锁定的单元格（若全部已有图则回退为全部未锁定单元格）
  // 3) 默认 / 'all'：生成全部未锁定的单元格
  const onlyCellId = node.params.adVariantOnlyCellId?.trim() || ''
  const runMode = node.params.adVariantRunMode === 'missing' ? 'missing' : 'all'
  let targetCells = cells
  if (onlyCellId) {
    const matched = cells.filter((c) => c.id === onlyCellId)
    if (matched.length) targetCells = matched
  } else if (runMode === 'missing') {
    const missing = cells.filter((c) => !c.locked && c.outputRefs.length === 0)
    const unlocked = cells.filter((c) => !c.locked)
    targetCells = missing.length ? missing : unlocked.length ? unlocked : cells
  } else {
    const unlocked = cells.filter((c) => !c.locked)
    targetCells = unlocked.length ? unlocked : cells
  }

  const system = resolveAdVariantSystemPrompt(node.params.generateSystemPrompt, ctx.locale).trim()
  const aspectRatio = matrix.aspectRatio || node.params.generateAspectRatio || undefined
  const quality = matrix.quality || node.params.generateQuality || 'high'
  const createdAt = new Date().toISOString()
  const stamp = Date.now()

  const batch: GraphImageItem[] = []
  const batchCellIds: string[] = []
  for (const [cellIndex, cell] of targetCells.entries()) {
    if (ctx.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    const basePrompt = getAdVariantCellEffectivePrompt(cell)
    const prompt = system ? `${system}\n\n${basePrompt}` : basePrompt
    const result = await ctx.generateImage({
      prompt,
      model: node.params.generateModel || undefined,
      providerInstanceId: node.params.generateProviderInstanceId || undefined,
      aspectRatio,
      quality,
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
    throw fail(SHARED_ERRORS.resultMissing, { what: { zh: '变体图片', en: 'variant images' } }) // cjk-ok 双语错误数据（zh/en，由 errors/catalog 统一格式化）
  }

  const stampKey = `adVariant:${node.id}:${stamp}`
  const materializedBatch = await materializeGeneratedBatch(ctx, batch, stampKey)
  if (!materializedBatch.length) {
    throw fail(SHARED_ERRORS.persistImageFailed, { detail: '' })
  }
  const generatedImages = mergeGeneratedImages(ctx, materializedBatch, `${stampKey}:keep`)

  const relativePaths = materializedBatch.map((item) => item.relativePath?.trim() ?? '')
  const updatedCells = applyAdVariantOutputRefs(cells, batchCellIds, relativePaths)
  const { primaryPath, allPaths } = resolveAdVariantDownstreamPaths(
    updatedCells,
    matrix.outputFilter
  )

  const committed = commitGeneratedImages(
    ctx,
    generatedImages,
    primaryPath || materializedBatch[0]?.relativePath?.trim(),
    {
      adVariantMatrix: { ...matrix, cells: updatedCells },
      adVariantOnlyCellId: undefined
    }
  )

  // 若开启了「仅输出入选变体」或存在淘汰项，按 allPaths 过滤下游 out-all 列表，并对齐 out 首选图
  if (allPaths.length > 0) {
    const allowedSet = new Set(allPaths)
    const filteredGallery = generatedImages.filter(
      (img) => img.relativePath && allowedSet.has(img.relativePath.trim())
    )
    if (filteredGallery.length > 0) {
      const primaryItem =
        filteredGallery.find((img) => img.relativePath?.trim() === primaryPath) ??
        filteredGallery[filteredGallery.length - 1]
      return dualImageGalleryOutputs(filteredGallery, primaryItem?.id ?? '')
    }
  }

  return committed
}
