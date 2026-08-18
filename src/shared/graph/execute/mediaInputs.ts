import {
  normalizeProjectStyleImages,
  resolveGenerateStyleImages,
  type ProjectStyleImage
} from '../../domain'
import type { GraphImageItem, GraphValue, NodeExecuteContext } from './types'
import { flattenAssetValues, flattenImagesValues } from './gallery'
import { collectIncomingValues, selectIncomingValuesForInstruction } from './incoming'

export function resolveNodeStyleImages(ctx: NodeExecuteContext): ProjectStyleImage[] {
  const global = ctx.resolveProjectStyleImages?.() ?? []
  const images = resolveGenerateStyleImages(ctx.node.params, global)
  return ctx.enrichStyleImages ? ctx.enrichStyleImages(images) : images
}

export async function resolveStyleReferenceUrls(
  ctx: NodeExecuteContext,
  images?: ProjectStyleImage[] | null
): Promise<string[]> {
  const normalized = normalizeProjectStyleImages(images)
  if (!normalized.length) return []
  if (ctx.resolveStyleImageUrls) {
    return (await ctx.resolveStyleImageUrls(normalized)).filter(Boolean)
  }
  return normalized
    .map((item) => item.dataUrl?.trim())
    .filter((url): url is string => Boolean(url?.startsWith('data:')))
}

export async function collectImageItemsFromValue(
  value: GraphValue,
  ctx: NodeExecuteContext
): Promise<GraphImageItem[]> {
  const items: GraphImageItem[] = []
  const seen = new Set<string>()
  const pushItem = (item: GraphImageItem): void => {
    const key =
      item.id?.trim() ||
      item.relativePath?.trim() ||
      item.dataUrl?.trim() ||
      `idx:${items.length}`
    if (seen.has(key)) return
    const hasPayload =
      (typeof item.dataUrl === 'string' && item.dataUrl.length > 0) ||
      (typeof item.relativePath === 'string' && item.relativePath.length > 0)
    if (!hasPayload) return
    seen.add(key)
    items.push(item)
  }

  for (const item of flattenImagesValues([value])) {
    pushItem(item)
  }

  if (ctx.resolveAssetImageUrl) {
    for (const asset of flattenAssetValues([value])) {
      if (asset.assetType !== 'image') continue
      const url = await ctx.resolveAssetImageUrl(asset.assetId)
      if (!url) continue
      pushItem({ id: asset.assetId, dataUrl: url })
    }
  }

  return items
}

export async function collectImageGenerateSourceItems(
  ctx: NodeExecuteContext,
  instructionRaw: string
): Promise<GraphImageItem[]> {
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const items: GraphImageItem[] = []
  const seen = new Set<string>()
  for (const value of selected) {
    for (const item of await collectImageItemsFromValue(value, ctx)) {
      const key =
        item.id?.trim() ||
        item.relativePath?.trim() ||
        item.dataUrl?.trim() ||
        `idx:${items.length}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
    }
  }
  return items
}

/** 收集节点入边图片（含 image / images，以及图片资产引用） */
export async function collectIncomingImageItems(ctx: NodeExecuteContext): Promise<GraphImageItem[]> {
  const imageInputs = [...(ctx.inputs.in ?? []), ...(ctx.inputs['in-image'] ?? [])]
  const values = imageInputs.length ? imageInputs : collectIncomingValues(ctx.inputs)
  const items: GraphImageItem[] = []
  const seen = new Set<string>()
  for (const value of values) {
    for (const item of await collectImageItemsFromValue(value, ctx)) {
      const key =
        item.id?.trim() ||
        item.relativePath?.trim() ||
        item.dataUrl?.trim() ||
        `idx:${items.length}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
    }
  }
  return items
}
