import { readDirectorStage } from '../../domain'
import {
  resolveMotionImageItems,
  resolveMotionPromptText,
  resolveMotionVideoItems
} from '../motionShots'
import {
  splitScreenplayByExplicitEpisodeMarkers,
  splitScreenplayIntoEpisodes
} from '../screenplayFormat'
import type {
  GraphImageItem,
  GraphTextItem,
  GraphValue,
  GraphVideoItem,
  NodeExecuteContext
} from './types'
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

export async function executeCamera3dNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const hostAssetId = ctx.resolveHostAssetId?.()?.trim()
  const hostGenParams = hostAssetId ? ctx.resolveAssetGenParams?.(hostAssetId) : undefined
  let items: GraphImageItem[] = resolveMotionImageItems(hostGenParams, ctx.node.params, ctx.node.id)
  if (!items.length && ctx.node.params.previewDataUrl) {
    items.push({ dataUrl: ctx.node.params.previewDataUrl })
  } else if (!items.length && ctx.node.params.previewRelativePath) {
    items.push({ dataUrl: '', relativePath: ctx.node.params.previewRelativePath })
  }
  let videoItems: GraphVideoItem[] = resolveMotionVideoItems(
    hostGenParams,
    ctx.node.params,
    ctx.node.id
  )

  const stagesMap =
    hostGenParams?.stagesByNodeId &&
    typeof hostGenParams.stagesByNodeId === 'object' &&
    !Array.isArray(hostGenParams.stagesByNodeId)
      ? (hostGenParams.stagesByNodeId as Record<string, unknown>)
      : null
  const stageRaw = stagesMap?.[ctx.node.id] ?? hostGenParams?.stage
  if (
    ctx.renderDirectorStagePreviz &&
    stageRaw &&
    typeof stageRaw === 'object' &&
    (items.length === 0 || videoItems.length === 0)
  ) {
    const stage = readDirectorStage({ stage: stageRaw })
    if ((stage.cameras?.length ?? 0) > 0) {
      const rendered = await ctx.renderDirectorStagePreviz({
        stage,
        node: ctx.node,
        hostAssetId,
        hostAssetName: ctx.resolveHostAssetName?.(),
        includeKeyframe: items.length === 0,
        includeVideo: videoItems.length === 0
      })
      const now = new Date().toISOString()
      if (!items.length && rendered.some((r) => r.keyframePath || r.keyframeDataUrl)) {
        const cameraShots = rendered
          .filter((r) => r.keyframePath || r.keyframeDataUrl)
          .map((r, idx) => ({
            id: `previz-shot:${r.shotId}:${idx}`,
            dataUrl: r.keyframeDataUrl || '',
            createdAt: now,
            cameraId: r.cameraId,
            cameraName: r.cameraName,
            label: r.label,
            ...(r.keyframePath && !r.keyframePath.startsWith('data:')
              ? { relativePath: r.keyframePath }
              : {})
          }))
        items = cameraShots.map((s) => ({
          id: s.id,
          dataUrl: s.dataUrl,
          createdAt: s.createdAt,
          ...(s.relativePath ? { relativePath: s.relativePath } : {})
        }))
        ctx.patchNode?.({
          params: {
            cameraShots,
            ...(cameraShots[0]?.dataUrl ? { previewDataUrl: cameraShots[0].dataUrl } : {}),
            ...(cameraShots[0]?.relativePath
              ? { previewRelativePath: cameraShots[0].relativePath }
              : {})
          }
        })
      }
      if (!videoItems.length && rendered.some((r) => r.videoPath || r.videoDataUrl)) {
        const cameraVideos: Array<{
          id: string
          createdAt: string
          cameraId: string
          cameraName: string
          label: string
          dataUrl?: string
          relativePath?: string
        }> = rendered
          .filter((r) => r.videoPath || r.videoDataUrl)
          .map((r, idx) => ({
            id: `previz-video:${r.shotId}:${idx}`,
            createdAt: now,
            cameraId: r.cameraId,
            cameraName: r.cameraName,
            label: r.label,
            ...(r.videoPath && !r.videoPath.startsWith('data:')
              ? { relativePath: r.videoPath }
              : { dataUrl: r.videoDataUrl || r.videoPath || '' })
          }))
        videoItems = cameraVideos.map((v) => ({
          id: v.id,
          dataUrl: v.dataUrl || '',
          createdAt: v.createdAt,
          ...(v.relativePath ? { relativePath: v.relativePath } : {})
        }))
        ctx.patchNode?.({ params: { cameraVideos } })
      }
    }
  }

  const promptText = resolveMotionPromptText(hostGenParams, ctx.node.params, ctx.node.id)
  if (promptText && !ctx.node.params.directorPrompt) {
    ctx.patchNode?.({ params: { directorPrompt: promptText } })
  }
  return {
    'out-shots': { kind: 'images', items },
    'out-actions': { kind: 'videos', items: videoItems },
    'out-prompt': { kind: 'text', text: promptText }
  }
}

/** 画布上拖入的导演台资产引用：从资产 stage/graph 读取站位/动作/运镜词 */
export function executeMotionAssetRefNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const genParams = ctx.node.assetId ? ctx.resolveAssetGenParams?.(ctx.node.assetId) : undefined
  const items = resolveMotionImageItems(genParams, ctx.node.params, ctx.node.id)
  const videoItems = resolveMotionVideoItems(genParams, ctx.node.params, ctx.node.id)
  const promptText = resolveMotionPromptText(genParams, ctx.node.params, ctx.node.id)
  if (items.length || videoItems.length || promptText) {
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
        ...(cameraVideos.length ? { cameraVideos } : {}),
        ...(promptText ? { directorPrompt: promptText } : {})
      }
    })
  }
  return {
    'out-shots': { kind: 'images', items },
    'out-actions': { kind: 'videos', items: videoItems },
    'out-prompt': { kind: 'text', text: promptText }
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
  let items = flattenTextsValues(collectIncomingValues(ctx.inputs)).filter(
    (item) => item.text?.trim() || item.relativePath?.trim()
  )
  const requestedSelector = ctx.node.params.selectedTextId?.trim() ?? ''
  const symbolicEpisodeSelector = /^ep:\d+$/i.test(requestedSelector)
    ? requestedSelector
    : undefined
  // 若仅收到 1 条剧本且正文中含 >= 2 个显式「第X集 / EPISODE X」标记（或下游显式按 ep:N 选集且含多场戏），支持先落盘读取再按集展开选取
  if (items.length === 1) {
    const singleHydrated = (await hydrateTextItems(items, ctx.readRunText))[0]
    const rawBody = singleHydrated?.text?.trim() ?? ''
    let episodes = rawBody
      ? splitScreenplayByExplicitEpisodeMarkers(rawBody, {
          includeSharedBios: true,
          locale: ctx.locale
        })
      : []
    if (episodes.length < 2 && rawBody && /(?:^|:)ep:\d+$/i.test(requestedSelector)) {
      const autoEpisodes = splitScreenplayIntoEpisodes(rawBody, {
        mode: 'auto',
        scenesPerEpisode: 2,
        includeSharedBios: true,
        locale: ctx.locale
      })
      if (autoEpisodes.length >= 2) episodes = autoEpisodes
    }
    if (episodes.length >= 2) {
      const baseId = items[0]!.id?.trim() || 'ep'
      items = episodes.map((ep): GraphTextItem => ({
        id: `${baseId}:ep:${ep.index}`,
        title: ep.title,
        text: ep.text,
        createdAt: items[0]!.createdAt
      }))
    } else if (singleHydrated) {
      items = [singleHydrated]
    }
  }
  const picked = pickTextItem(items, requestedSelector)
  const selectedTextId =
    symbolicEpisodeSelector ??
    (picked ? textItemKey(picked, Math.max(0, items.indexOf(picked))) : undefined)
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
 * 逐帧拉片：交互取帧存于 `params.generatedImages`，执行时把图库透出为图片输出；
 * 若已做过区间重生成并替换回原视频（`framePullActiveVideoPath`）或连接了上游视频，同步从 `out-video` 输出当前视频。
 * 无已取帧时输出空图（不报错，节点本身以交互为主）。
 */
export function executeFramePullNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const frames = (ctx.node.params.generatedImages ?? []).filter(
    (item) =>
      (typeof item.dataUrl === 'string' && item.dataUrl.length > 0) ||
      (typeof item.relativePath === 'string' && item.relativePath.length > 0)
  )
  const activeVideoRel = ctx.node.params.framePullActiveVideoPath?.trim()
  const upstreamVideos = flattenVideosValues(collectIncomingValues(ctx.inputs)).filter(
    (item) =>
      (typeof item.dataUrl === 'string' && item.dataUrl.length > 0) ||
      (typeof item.relativePath === 'string' && item.relativePath.length > 0)
  )
  const upstreamVideo = upstreamVideos[0]
  const outVideo: GraphValue | undefined = activeVideoRel
    ? {
        kind: 'video',
        id: `framepull:${activeVideoRel}`,
        relativePath: activeVideoRel
      }
    : upstreamVideo
      ? {
          kind: 'video',
          ...(upstreamVideo.id ? { id: upstreamVideo.id } : {}),
          ...(upstreamVideo.dataUrl ? { dataUrl: upstreamVideo.dataUrl } : {}),
          ...(upstreamVideo.relativePath ? { relativePath: upstreamVideo.relativePath } : {}),
          ...(upstreamVideo.createdAt ? { createdAt: upstreamVideo.createdAt } : {})
        }
      : undefined

  if (!frames.length) {
    return {
      out: { kind: 'image', dataUrl: '' },
      ...(outVideo ? { 'out-video': outVideo } : {})
    }
  }
  const imageOut = commitGeneratedImages(
    ctx,
    frames,
    frames[frames.length - 1]?.relativePath?.trim()
  )
  return {
    ...imageOut,
    ...(outVideo ? { 'out-video': outVideo } : {})
  }
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
