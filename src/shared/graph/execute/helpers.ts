import type { GraphNode, GraphNodeParams } from '../types'
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
  dualModelGalleryOutputs,
  dualTextGalleryOutputs,
  dualVideoGalleryOutputs,
  dualVoiceGalleryOutputs,
  newestImageSelectedId,
  newestModelSelectedId,
  newestTextSelectedId,
  newestVideoSelectedId,
  newestVoiceSelectedId
} from './gallery'

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
 */
export function resolveGalleryOutputsFromNodeParams(
  params: GraphNodeParams | undefined | null,
  options?: { typeId?: string | null }
): Record<string, GraphValue> | null {
  if (!params) return null

  const generatedImages = params.generatedImages
  if (Array.isArray(generatedImages) && generatedImages.length) {
    const items: GraphImageItem[] = generatedImages.map((item) => ({
      id: item.id,
      dataUrl: item.dataUrl ?? '',
      relativePath: item.relativePath,
      createdAt: item.createdAt
    }))
    const selectedId = params.selectedImageId?.trim() || newestImageSelectedId(items)
    const base = dualImageGalleryOutputs(items, selectedId)
    const gifRel =
      (typeof params.svgGifRelativePath === 'string' && params.svgGifRelativePath.trim()) ||
      (typeof params.animGifRelativePath === 'string' && params.animGifRelativePath.trim()) ||
      ''
    if (gifRel) {
      return {
        ...base,
        'out-gif': { kind: 'image', dataUrl: '', relativePath: gifRel }
      }
    }
    return base
  }

  const generatedModels = params.generatedModels
  if (Array.isArray(generatedModels) && generatedModels.length) {
    const items = generatedModels.map((item) => ({
      id: item.id,
      relativePath: item.relativePath,
      createdAt: item.createdAt,
      assetId: item.assetId,
      // 只吃 task_id 的下游端点（部件补全 / 动画重定向）同样指望这一步别把 task id 丢掉
      providerTaskId: item.providerTaskId,
      /**
       * 空间世界 id 必须一起带回来：单节点执行 / soft-resolve 时上游不 cook，
       * 下游「空间世界导出」只能从这份重建结果里拿 world_id。
       * 漏了就直接报 GRAPH_WORLD_EXPORT_NO_WORLD —— 明明刚生成过世界，却说没有世界。
       */
      spatialWorldId: item.spatialWorldId,
      rigMeta: item.rigMeta,
      rigQa: item.rigQa,
      bonePose: item.bonePose,
      clip: item.clip
    }))
    const selectedId = params.selectedModelId?.trim() || newestModelSelectedId(items)
    return dualModelGalleryOutputs(items, selectedId)
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

  const previewRelativePath =
    typeof params.previewRelativePath === 'string' ? params.previewRelativePath.trim() : ''
  const previewDataUrl =
    typeof params.previewDataUrl === 'string' ? params.previewDataUrl.trim() : ''
  if (previewRelativePath || previewDataUrl) {
    const typeId = options?.typeId ?? ''
    if (typeId === 'asset.image') {
      const items: GraphImageItem[] = [
        {
          id: 'preview:0',
          dataUrl: previewDataUrl,
          ...(previewRelativePath ? { relativePath: previewRelativePath } : {})
        }
      ]
      return dualImageGalleryOutputs(items, 'preview:0')
    }
    if (typeId === 'asset.video') {
      const items: GraphVideoItem[] = [
        {
          id: 'preview:0',
          dataUrl: previewDataUrl,
          ...(previewRelativePath ? { relativePath: previewRelativePath } : {})
        }
      ]
      return dualVideoGalleryOutputs(items, 'preview:0')
    }
    if ((typeId === 'asset.model3d' || typeId === 'asset.spatialWorld') && previewRelativePath) {
      const items = [
        {
          id: 'preview:0',
          relativePath: previewRelativePath
        }
      ]
      return dualModelGalleryOutputs(items, 'preview:0')
    }
    if (
      (typeId === 'asset.voice' ||
        typeId === 'asset.sfx' ||
        typeId === 'asset.music' ||
        typeId === 'asset.dialogue') &&
      previewRelativePath
    ) {
      const items: GraphVoiceItem[] = [
        {
          id: 'preview:0',
          relativePath: previewRelativePath
        }
      ]
      return dualVoiceGalleryOutputs(items, 'preview:0')
    }
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
