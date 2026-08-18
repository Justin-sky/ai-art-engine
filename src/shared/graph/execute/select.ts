import { GraphPortType } from '../types'
import { catalogTextFromInputs } from '../catalogValue'
import { resolveMotionImageItems, resolveMotionVideoItems } from '../motionShots'
import { parseBeatJson } from '../beatParse'
import { formatBeatRefText } from '../beatParams'
import type { GraphImageItem, GraphValue, GraphVideoItem, NodeExecuteContext } from './types'
import {
  flattenImagesValues,
  flattenTextsValues,
  flattenVideosValues,
  flattenVoicesValues,
  imageItemKey,
  pickImageItem,
  pickTextItem,
  pickVideoItem,
  pickVoiceItem,
  textItemKey,
  videoItemKey,
  voiceItemKey
} from './gallery'
import { collectIncomingValues } from './incoming'
import { commitGeneratedImages } from './materialize'
import { hydrateTextItems } from './helpers'

export function executeCamera3dNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const shots = ctx.node.params.cameraShots ?? []
  const items: GraphImageItem[] = shots
    .filter(
      (shot) =>
        (typeof shot.dataUrl === 'string' && shot.dataUrl.length > 0) ||
        (typeof shot.relativePath === 'string' && shot.relativePath.length > 0)
    )
    .map((shot) => ({
      id: shot.id,
      dataUrl: shot.dataUrl || '',
      createdAt: shot.createdAt,
      ...(shot.relativePath ? { relativePath: shot.relativePath } : {})
    }))
  // 无站位截图时回退单张预览图
  if (!items.length && ctx.node.params.previewDataUrl) {
    items.push({ dataUrl: ctx.node.params.previewDataUrl })
  } else if (!items.length && ctx.node.params.previewRelativePath) {
    items.push({ dataUrl: '', relativePath: ctx.node.params.previewRelativePath })
  }
  const videos = ctx.node.params.cameraVideos ?? []
  const videoItems: GraphVideoItem[] = videos
    .filter(
      (video) =>
        (typeof video.dataUrl === 'string' && video.dataUrl.length > 0) ||
        (typeof video.relativePath === 'string' && video.relativePath.length > 0)
    )
    .map((video) => ({
      id: video.id,
      dataUrl: video.dataUrl || '',
      createdAt: video.createdAt,
      ...(video.relativePath ? { relativePath: video.relativePath } : {})
    }))
  return {
    'out-shots': { kind: 'images', items },
    'out-actions': { kind: 'videos', items: videoItems }
  }
}

/** 画布上拖入的导演台资产引用：从资产 stage/graph 读取站位/动作 */
export function executeMotionAssetRefNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const genParams = ctx.node.assetId ? ctx.resolveAssetGenParams?.(ctx.node.assetId) : undefined
  const items = resolveMotionImageItems(genParams, ctx.node.params, ctx.node.id)
  const videoItems = resolveMotionVideoItems(genParams, ctx.node.params, ctx.node.id)
  if (items.length || videoItems.length) {
    const cameraShots = items.map((image, index) => ({
      id: image.id ?? `shot:${index}`,
      dataUrl: image.dataUrl,
      createdAt: image.createdAt ?? new Date().toISOString(),
      ...(image.relativePath ? { relativePath: image.relativePath } : {})
    }))
    const cameraVideos = videoItems.map((video, index) => ({
      id: video.id ?? `action:${index}`,
      dataUrl: video.dataUrl,
      createdAt: video.createdAt ?? new Date().toISOString(),
      ...(video.relativePath ? { relativePath: video.relativePath } : {})
    }))
    ctx.patchNode?.({
      params: {
        ...(cameraShots.length ? { cameraShots, previewDataUrl: cameraShots[0]?.dataUrl } : {}),
        ...(cameraVideos.length ? { cameraVideos } : {})
      }
    })
  }
  return {
    'out-shots': { kind: 'images', items },
    'out-actions': { kind: 'videos', items: videoItems }
  }
}

/** 选取图片：从图片数组中选出一张，输出为单张 image */
export function executeSelectImageNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const items = flattenImagesValues(collectIncomingValues(ctx.inputs)).filter(
    (item) =>
      (typeof item.dataUrl === 'string' && item.dataUrl.length > 0) ||
      (typeof item.relativePath === 'string' && item.relativePath.length > 0)
  )
  const picked = pickImageItem(items, ctx.node.params.selectedImageId)
  const selectedImageId = picked
    ? imageItemKey(picked, Math.max(0, items.indexOf(picked)))
    : undefined
  const previewDataUrl = picked?.dataUrl?.trim() ? picked.dataUrl : undefined
  const previewRelativePath = picked?.relativePath?.trim() ? picked.relativePath : undefined
  ctx.node.params = {
    ...ctx.node.params,
    ...(selectedImageId ? { selectedImageId } : {}),
    previewDataUrl,
    previewRelativePath
  }
  ctx.patchNode?.({
    params: {
      selectedImageId,
      previewDataUrl,
      previewRelativePath
    }
  })
  if (!picked) {
    return { out: { kind: 'image', dataUrl: '' } }
  }
  return {
    out: {
      kind: 'image',
      id: selectedImageId,
      dataUrl: picked.dataUrl || '',
      createdAt: picked.createdAt,
      ...(picked.relativePath ? { relativePath: picked.relativePath } : {})
    }
  }
}

/**
 * 选取文本：从 texts 数组中选出一条，输出为单个 text（落盘项会读全文）。
 */
export async function executeSelectTextNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const items = flattenTextsValues(collectIncomingValues(ctx.inputs)).filter(
    (item) => item.text?.trim() || item.relativePath?.trim()
  )
  const picked = pickTextItem(items, ctx.node.params.selectedTextId)
  const selectedTextId = picked
    ? textItemKey(picked, Math.max(0, items.indexOf(picked)))
    : undefined
  const hydrated = picked ? (await hydrateTextItems([picked], ctx.readRunText))[0] : undefined
  const text = hydrated?.text?.trim() ?? ''
  const previewRelativePath = hydrated?.relativePath?.trim() || undefined
  ctx.node.params = {
    ...ctx.node.params,
    ...(selectedTextId ? { selectedTextId } : {}),
    text,
    ...(previewRelativePath ? { previewRelativePath } : { previewRelativePath: undefined })
  }
  ctx.patchNode?.({
    params: {
      selectedTextId,
      text,
      previewRelativePath
    }
  })
  return { out: { kind: 'text', text } }
}

/**
 * 从入边取场目录 JSON。
 * soft 快照偶发把上游目录解析成 text，此时若正文可 parse 为场行则同样接受。
 */
function beatCatalogTextFromIncoming(inputs: Record<string, GraphValue[]>): string {
  const values = collectIncomingValues(inputs)
  const fromBeat = catalogTextFromInputs(values, GraphPortType.beat)
  if (fromBeat) return fromBeat
  for (const value of values) {
    if (value?.kind !== 'text') continue
    const text = value.text?.trim() ?? ''
    if (!text) continue
    const rows = parseBeatJson(text)
    if (rows?.length) return text
  }
  return ''
}

/**
 * 选择场：从 beat 目录中选出一行，输出可读普通文本。
 */
export function executeSelectBeatNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const catalogText = beatCatalogTextFromIncoming(ctx.inputs)
  const rows = parseBeatJson(catalogText) ?? []
  const selectedId = ctx.node.params.selectedBeatId?.trim()
  const picked = (selectedId ? rows.find((row) => row.id === selectedId) : undefined) ?? rows[0]
  if (!picked) {
    // 上游瞬时软快照失败时保留已有结果，避免「执行当前」把预览清空
    const existing = ctx.node.params.text?.trim() ?? ''
    if (existing) {
      return { out: { kind: 'text', text: existing } }
    }
    ctx.node.params = { ...ctx.node.params, text: '', selectedBeatId: '' }
    ctx.patchNode?.({ params: { text: '', selectedBeatId: '' } })
    return {}
  }
  const text = formatBeatRefText(picked)
  ctx.node.params = {
    ...ctx.node.params,
    selectedBeatId: picked.id,
    text
  }
  ctx.patchNode?.({
    params: {
      selectedBeatId: picked.id,
      text
    }
  })
  return { out: { kind: 'text', text } }
}

/** 选取视频：从视频数组中选出一条，输出为单个 video */
export function executeSelectVideoNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const items = flattenVideosValues(collectIncomingValues(ctx.inputs)).filter(
    (item) =>
      (typeof item.dataUrl === 'string' && item.dataUrl.length > 0) ||
      (typeof item.relativePath === 'string' && item.relativePath.length > 0)
  )
  const picked = pickVideoItem(items, ctx.node.params.selectedVideoId)
  const selectedVideoId = picked
    ? videoItemKey(picked, Math.max(0, items.indexOf(picked)))
    : undefined
  const previewDataUrl = picked?.dataUrl?.trim() ? picked.dataUrl : undefined
  const previewRelativePath = picked?.relativePath?.trim() ? picked.relativePath : undefined
  ctx.node.params = {
    ...ctx.node.params,
    ...(selectedVideoId ? { selectedVideoId } : {}),
    previewDataUrl,
    previewRelativePath
  }
  ctx.patchNode?.({
    params: {
      selectedVideoId,
      previewDataUrl,
      previewRelativePath
    }
  })
  if (!picked) {
    return { out: { kind: 'video' } }
  }
  return {
    out: {
      kind: 'video',
      id: selectedVideoId,
      ...(picked.dataUrl ? { dataUrl: picked.dataUrl } : {}),
      createdAt: picked.createdAt,
      ...(picked.relativePath ? { relativePath: picked.relativePath } : {})
    }
  }
}

/**
 * 逐帧拉片：交互取帧存于 `params.generatedImages`，执行时把图库透出为图片输出。
 * 无已取帧时输出空图（不报错，节点本身以交互为主）。
 */
export function executeFramePullNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const frames = (ctx.node.params.generatedImages ?? []).filter(
    (item) =>
      (typeof item.dataUrl === 'string' && item.dataUrl.length > 0) ||
      (typeof item.relativePath === 'string' && item.relativePath.length > 0)
  )
  if (!frames.length) {
    return { out: { kind: 'image', dataUrl: '' } }
  }
  return commitGeneratedImages(ctx, frames, frames[frames.length - 1]?.relativePath?.trim())
}

/** 选取声音：从声音数组中选出一条，输出为单个 voice */
export function executeSelectVoiceNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const items = flattenVoicesValues(collectIncomingValues(ctx.inputs)).filter(
    (item) => typeof item.relativePath === 'string' && item.relativePath.length > 0
  )
  const picked = pickVoiceItem(items, ctx.node.params.selectedVoiceId)
  const selectedVoiceId = picked
    ? voiceItemKey(picked, Math.max(0, items.indexOf(picked)))
    : undefined
  const previewRelativePath = picked?.relativePath?.trim() ? picked.relativePath : undefined
  ctx.node.params = {
    ...ctx.node.params,
    ...(selectedVoiceId ? { selectedVoiceId } : {}),
    previewRelativePath
  }
  ctx.patchNode?.({
    params: {
      selectedVoiceId,
      previewRelativePath
    }
  })
  if (!picked) {
    return { out: { kind: 'voice' } }
  }
  return {
    out: {
      kind: 'voice',
      id: selectedVoiceId,
      createdAt: picked.createdAt,
      ...(picked.relativePath ? { relativePath: picked.relativePath } : {})
    }
  }
}
