import type { GraphNode, GraphNodeParams } from '../types'
import {
  parseWorldElementGenResults,
  worldGenImageGroupOutputs,
  type WorldElementGenResult
} from '../worldElementParse'
import type {
  GraphAssetValue,
  GraphImageItem,
  GraphTextItem,
  GraphValue,
  GraphVideoItem,
  GraphVoiceItem,
  NodeExecuteContext
} from './types'
import {
  dualImageGalleryOutputs,
  dualTextGalleryOutputs,
  dualVideoGalleryOutputs,
  dualVoiceGalleryOutputs,
  newestImageSelectedId,
  newestTextSelectedId,
  newestVideoSelectedId,
  newestVoiceSelectedId
} from './gallery'
import { dualBeatCatalogOutputs, dualWorldCatalogOutputs } from './materialize'

/** 预览/汇总时按路径补全文；无 readRunText 或无路径则原样返回 */
export async function hydrateTextItems(
  items: GraphTextItem[],
  readRunText?: (relativePath: string) => Promise<string>
): Promise<GraphTextItem[]> {
  if (!items.length) return items
  return Promise.all(
    items.map(async (item) => {
      if (item.text?.trim()) return item
      const relativePath = item.relativePath?.trim()
      if (!relativePath || !readRunText) return item
      try {
        const text = (await readRunText(relativePath))?.trim() ?? ''
        return text ? { ...item, text } : item
      } catch {
        return item
      }
    })
  )
}

/**
 * 按节点参数中的累计图库 + selected*Id 重算 `out` / `out-all`。
 * 用于 soft-resolve / soft-snapshot：避免缓存 outputs.out 与当前选中不一致。
 * `typeId`：世界元素提取等需把 `out` 组装成目录 kind，而非普通 text。
 */
export function resolveGalleryOutputsFromNodeParams(
  params: GraphNodeParams | undefined | null,
  options?: { typeId?: string | null }
): Record<string, GraphValue> | null {
  if (!params) return null

  if (options?.typeId === 'world.gen') {
    const fromParams = Array.isArray(params.worldElementOutputs)
      ? (params.worldElementOutputs as WorldElementGenResult[])
      : []
    const withImages = fromParams.filter((item) => item?.type && item?.name && item?.imageUrl)
    const results = withImages.length > 0 ? withImages : parseWorldElementGenResults(params.text)
    if (!results.length) return null
    return worldGenImageGroupOutputs(results)
  }

  const generatedImages = params.generatedImages
  if (Array.isArray(generatedImages) && generatedImages.length) {
    const items: GraphImageItem[] = generatedImages.map((item) => ({
      id: item.id,
      dataUrl: item.dataUrl ?? '',
      relativePath: item.relativePath,
      createdAt: item.createdAt
    }))
    const selectedId = params.selectedImageId?.trim() || newestImageSelectedId(items)
    return dualImageGalleryOutputs(items, selectedId)
  }

  const generatedVideos = params.generatedVideos
  if (Array.isArray(generatedVideos) && generatedVideos.length) {
    const items: GraphVideoItem[] = generatedVideos.map((item) => ({
      id: item.id,
      dataUrl: item.dataUrl ?? '',
      relativePath: item.relativePath,
      createdAt: item.createdAt
    }))
    const selectedId = params.selectedVideoId?.trim() || newestVideoSelectedId(items)
    return dualVideoGalleryOutputs(items, selectedId)
  }

  const generatedVoices = params.generatedVoices
  if (Array.isArray(generatedVoices) && generatedVoices.length) {
    const items: GraphVoiceItem[] = generatedVoices.map((item) => ({
      id: item.id,
      relativePath: item.relativePath,
      createdAt: item.createdAt
    }))
    const selectedId = params.selectedVoiceId?.trim() || newestVoiceSelectedId(items)
    return dualVoiceGalleryOutputs(items, selectedId)
  }

  const generatedTexts = params.generatedTexts
  if (Array.isArray(generatedTexts) && generatedTexts.length) {
    const items: GraphTextItem[] = generatedTexts.map((item) => ({
      id: item.id,
      title: item.title,
      text: item.text ?? '',
      relativePath: item.relativePath,
      createdAt: item.createdAt
    }))
    const selectedId = params.selectedTextId?.trim() || newestTextSelectedId(items)
    if (options?.typeId === 'world.extract') {
      return dualWorldCatalogOutputs(items, selectedId)
    }
    if (options?.typeId === 'beat.split') {
      return dualBeatCatalogOutputs(items, selectedId)
    }
    if (options?.typeId === 'ui.split') {
      return { out: { kind: 'texts', items } }
    }
    return dualTextGalleryOutputs(items, selectedId)
  }

  const cameraShots = params.cameraShots
  if (Array.isArray(cameraShots) && cameraShots.length) {
    const items: GraphImageItem[] = cameraShots.map((shot) => ({
      id: shot.id,
      dataUrl: shot.dataUrl ?? '',
      relativePath: shot.relativePath,
      createdAt: shot.createdAt
    }))
    const selectedId = params.selectedImageId?.trim() || newestImageSelectedId(items)
    return dualImageGalleryOutputs(items, selectedId)
  }

  return null
}

/** 无 execute 时的兜底：透传第一个输入或空 */
export function executePassthrough(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const first = Object.values(ctx.inputs).flat()[0]
  if (first) return { out: first }
  return {}
}

export function isGraphAssetValue(v: GraphValue): v is GraphAssetValue {
  return v.kind === 'asset'
}

export function nodeToAssetValue(node: GraphNode): GraphAssetValue | null {
  if (!node.assetId || !node.assetType) return null
  return {
    kind: 'asset',
    assetId: node.assetId,
    assetType: node.assetType,
    label: node.params.label,
    weight: node.params.weight,
    volume: node.params.volume,
    muted: node.params.muted,
    notes: node.params.notes,
    title: node.title
  }
}
