import type { GraphNode, GraphNodeParams } from '../types'
import { splitScreenplayByExplicitEpisodeMarkers } from '../screenplayFormat'
import {
  parseUiComponentLibrary,
  stringifyUiComponentLibrary,
  uiComponentItemImage
} from '../uiComponentLibrary'
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
  newestVoiceSelectedId,
  pickImageItem
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
      ...(item.title ? { title: item.title } : {}),
      ...(item.layerPrompt ? { layerPrompt: item.layerPrompt } : {}),
      dataUrl: item.dataUrl ?? '',
      relativePath: item.relativePath,
      createdAt: item.createdAt
    }))
    if (options?.typeId === 'ui.componentLib') {
      const lib = parseUiComponentLibrary(params.uiComponentLibrary ?? '')
      if (lib?.items?.length) {
        return {
          out: { kind: 'uiComponents', doc: lib, text: stringifyUiComponentLibrary(lib) },
          'out-images': { kind: 'images', items }
        }
      }
      const fallbackLibItems = lib?.items?.filter((i) => uiComponentItemImage(i)) ?? []
      void fallbackLibItems
      return {
        'out-images': { kind: 'images', items }
      }
    }
    const selectedId =
      params.selectedImageId?.trim() ||
      (options?.typeId === 'ui.gen'
        ? items.find((item) => item.title?.startsWith('\u5e95\u56fe\u00b7'))?.id
        : undefined) ||
      newestImageSelectedId(items)
    if (options?.typeId === 'ui.gen') {
      const picked = pickImageItem(items, selectedId)
      const layerPrompt =
        picked?.layerPrompt?.trim() || params.uiSelectedLayerPrompt?.trim() || undefined
      const outSelected: GraphValue | undefined = picked
        ? {
            kind: 'image',
            id: picked.id,
            ...(picked.title ? { title: picked.title } : {}),
            ...(layerPrompt ? { layerPrompt } : {}),
            dataUrl: picked.dataUrl || '',
            createdAt: picked.createdAt,
            ...(picked.relativePath ? { relativePath: picked.relativePath } : {})
          }
        : undefined
      return {
        out: { kind: 'images', items },
        'out-all': { kind: 'images', items },
        ...(outSelected ? { 'out-selected': outSelected } : {})
      }
    }
    const base = dualImageGalleryOutputs(items, selectedId)
    if (options?.typeId === 'game.economy' || options?.typeId === 'game.numerical') {
      const econRel =
        typeof params.previewRelativePath === 'string' ? params.previewRelativePath.trim() : ''
      const econText = typeof params.text === 'string' ? params.text.trim() : ''
      if (econRel) {
        return {
          ...base,
          'out-text': { kind: 'text', text: '', relativePath: econRel }
        }
      }
      if (econText && econText !== '…') {
        return {
          ...base,
          'out-text': { kind: 'text', text: econText }
        }
      }
    }
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
    let items: GraphTextItem[] = generatedTexts.map((item) => ({
      id: item.id,
      title: item.title,
      text: item.text ?? '',
      ...(item.cleanPrompt ? { cleanPrompt: item.cleanPrompt } : {}),
      ...(item.screenKind ? { screenKind: item.screenKind } : {}),
      ...(item.aspectRatio ? { aspectRatio: item.aspectRatio } : {}),
      ...(item.layerPrompt ? { layerPrompt: item.layerPrompt } : {}),
      relativePath: item.relativePath,
      createdAt: item.createdAt
    }))
    if (
      (options?.typeId === 'asset.screenplay' ||
        options?.typeId === 'novel.outline' ||
        (options?.typeId === 'asset.novel' && params.novelNodeMode === 'outline')) &&
      items.length === 1
    ) {
      const candidateText =
        items[0]!.text.trim() || (typeof params.text === 'string' ? params.text.trim() : '')
      const explicitEpisodes = candidateText
        ? splitScreenplayByExplicitEpisodeMarkers(candidateText, {
            includeSharedBios: true,
            skipStats: true
          })
        : []
      if (explicitEpisodes.length >= 2) {
        const baseId = items[0]!.id?.trim() || 'ep'
        items = explicitEpisodes.map((ep) => ({
          id: `${baseId}:ep:${ep.index}`,
          title: ep.title,
          text: ep.text,
          createdAt: items[0]!.createdAt
        }))
      }
    }
    const selectedId = params.selectedTextId?.trim() || newestTextSelectedId(items)
    if (options?.typeId === 'ui.split') {
      return { out: { kind: 'texts', items } }
    }
    const dual = dualTextGalleryOutputs(items, selectedId)
    const isOutlineNode =
      options?.typeId === 'novel.outline' ||
      (options?.typeId === 'asset.novel' && params.novelNodeMode === 'outline')
    const fullOutlineRel =
      typeof params.previewRelativePath === 'string' ? params.previewRelativePath.trim() : ''
    const fullOutlineText = typeof params.text === 'string' ? params.text.trim() : ''
    if (isOutlineNode && dual.out?.kind === 'text') {
      if (fullOutlineRel) {
        dual.out = { ...dual.out, text: '', relativePath: fullOutlineRel }
      } else if (fullOutlineText && fullOutlineText !== '…') {
        dual.out = { ...dual.out, text: fullOutlineText, relativePath: undefined }
      }
    }
    return dual
  }

  if (
    (options?.typeId === 'asset.screenplay' ||
      options?.typeId === 'novel.outline' ||
      (options?.typeId === 'asset.novel' && params.novelNodeMode === 'outline')) &&
    typeof params.text === 'string'
  ) {
    const explicitEpisodes = splitScreenplayByExplicitEpisodeMarkers(params.text, {
      includeSharedBios: true
    })
    if (explicitEpisodes.length >= 2) {
      const items: GraphTextItem[] = explicitEpisodes.map((ep) => ({
        id: `ep:${ep.index}`,
        title: ep.title,
        text: ep.text
      }))
      const selectedId = params.selectedTextId?.trim() || items[0]!.id || ''
      const dual = dualTextGalleryOutputs(items, selectedId)
      const isOutlineNode =
        options?.typeId === 'novel.outline' ||
        (options?.typeId === 'asset.novel' && params.novelNodeMode === 'outline')
      const fullOutlineText = params.text.trim()
      if (
        isOutlineNode &&
        fullOutlineText &&
        fullOutlineText !== '…' &&
        dual.out?.kind === 'text'
      ) {
        dual.out = { ...dual.out, text: fullOutlineText, relativePath: undefined }
      }
      return dual
    }
  }

  if (options?.typeId === 'asset.novel' && params.novelNodeMode !== 'outline') {
    const novelRel =
      typeof params.previewRelativePath === 'string' ? params.previewRelativePath.trim() : ''
    const novelText = typeof params.text === 'string' ? params.text.trim() : ''
    if (novelRel || (novelText && novelText !== '…')) {
      const chapNum = Math.max(1, Math.round(Number(params.novelCurrentChapter) || 1))
      const item: GraphTextItem = {
        id: `chap:${chapNum}`,
        title: `第${chapNum}章`, // cjk-ok
        text: novelRel ? '' : novelText,
        ...(novelRel ? { relativePath: novelRel } : {})
      }
      return dualTextGalleryOutputs([item], item.id!)
    }
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
