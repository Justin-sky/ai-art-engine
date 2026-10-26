import {
  createComicPage,
  fillComicPageFromImageUrls,
  readComicPageFromGenParams,
  readingOrderPanels,
  serializeComicPage
} from '../comicPage'
import { isCanvasSafeImageSrc } from '../imageLayerSplit'
import type { GraphImageItem, GraphValue, NodeExecuteContext } from './types'
import { collectIncomingImageItems, collectIncomingVideoItems } from './mediaInputs'
import { commitGeneratedImages, materializeGeneratedBatch } from './materialize'
import { fail } from '@shared/errors/appError'
import { SHARED_ERRORS } from '../../errors/catalog'

function imageItemRef(item: GraphImageItem): string {
  return item.relativePath?.trim() || item.dataUrl?.trim() || ''
}

async function resolveComicImageSrc(ctx: NodeExecuteContext, imageUrl: string): Promise<string> {
  const url = imageUrl.trim()
  if (!url) return ''
  if (isCanvasSafeImageSrc(url)) return url
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (!ctx.resolveImageUrls) return url
  const resolved = await ctx.resolveImageUrls([{ relativePath: url }])
  const next = resolved[0]?.trim() ?? ''
  return next && isCanvasSafeImageSrc(next) ? next : next
}

/**
 * 漫画页：上游图片按分格阅读顺序填入空格，浏览器 canvas 合成 PNG 进图库。
 */
export async function executeComicPageNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const page = readComicPageFromGenParams(ctx.node.params) ?? createComicPage()
  const incoming = await collectIncomingImageItems(ctx)
  const urls = incoming.map(imageItemRef).filter(Boolean)
  const allPanelsAlreadyHaveImages =
    page.panels.length > 0 && page.panels.every((p) => Boolean(p.imageUrl?.trim()))
  let filled = fillComicPageFromImageUrls(page, urls, {
    fillEmptyOnly: !(allPanelsAlreadyHaveImages && urls.length >= page.panels.length)
  })

  // 自动关联分镜微动视频（I2V）与 2.5D 景深视差前景抠图（image.matte / image.cutout），并自动对齐横竖画幅：
  // 1) 若某分镜格的上游生图节点同时派生了下游 asset.video（I2V）节点且已产出视频，自动将该视频绑定至对应分镜格的 videoUrl；
  // 2) 若某分镜格的上游生图节点同时派生了下游 image.matte / image.cutout 抠图节点且已产出透明前景图，自动绑定至 foregroundImageUrl 并开启 2.5D 视差；
  // 3) 若漫画页仍为默认竖版尺寸（1080×1520），而上游分镜节点显式采用了 16:9 横版画幅，自动将漫画页同步升级为 1920×1080 横版宽银幕画布。
  const incomingVideos = await collectIncomingVideoItems(ctx)
  const videoByPanelId = new Map<string, string>()
  const fgByPanelId = new Map<string, string>()
  const orderedPanels = readingOrderPanels(filled)
  const doc = ctx.document
  let hasLandscapeUpstream = false
  if (doc && Array.isArray(doc.edges) && Array.isArray(doc.nodes)) {
    const inImageSourceIds = doc.edges
      .filter(
        (e) =>
          e.target === ctx.node.id &&
          (!e.targetPort || e.targetPort === 'in-image' || e.targetPort === 'in')
      )
      .map((e) => e.source)
    inImageSourceIds.forEach((srcNodeId, idx) => {
      const srcNode = doc.nodes.find((n) => n.id === srcNodeId)
      if (srcNode?.params?.generateAspectRatio === '16:9') {
        hasLandscapeUpstream = true
      }
      const targetPanel = orderedPanels[idx]
      if (!targetPanel) return
      const derivedVideoEdge = doc.edges.find((e) => {
        if (e.source !== srcNodeId) return false
        const targetNode = doc.nodes.find((n) => n.id === e.target)
        return targetNode?.typeId === 'asset.video'
      })
      if (derivedVideoEdge) {
        const videoNode = doc.nodes.find((n) => n.id === derivedVideoEdge.target)
        const genVid = videoNode?.params?.generatedVideos?.[0]
        const vidRel =
          genVid?.relativePath?.trim() ||
          videoNode?.params?.previewRelativePath?.trim() ||
          genVid?.dataUrl?.trim() ||
          ''
        if (vidRel) {
          videoByPanelId.set(targetPanel.id, vidRel)
        }
      }
      const derivedMatteEdge = doc.edges.find((e) => {
        if (e.source !== srcNodeId) return false
        const targetNode = doc.nodes.find((n) => n.id === e.target)
        return (
          targetNode?.typeId === 'image.matte' ||
          targetNode?.typeId === 'image.cutout' ||
          targetNode?.typeId === 'image.removeBg'
        )
      })
      if (derivedMatteEdge) {
        const matteNode = doc.nodes.find((n) => n.id === derivedMatteEdge.target)
        const genImg = matteNode?.params?.generatedImages?.[0]
        const fgRel =
          genImg?.relativePath?.trim() ||
          matteNode?.params?.previewRelativePath?.trim() ||
          genImg?.dataUrl?.trim() ||
          ''
        if (fgRel) {
          fgByPanelId.set(targetPanel.id, fgRel)
        }
      }
    })
  }
  if (hasLandscapeUpstream && filled.width === 1080 && filled.height === 1520) {
    filled = { ...filled, width: 1920, height: 1080 }
  }
  if (incomingVideos.length > 0 && videoByPanelId.size === 0 && orderedPanels.length > 0) {
    if (incomingVideos.length === orderedPanels.length) {
      incomingVideos.forEach((v, idx) => {
        const ref = v.relativePath?.trim() || v.dataUrl?.trim() || ''
        if (ref && orderedPanels[idx]) videoByPanelId.set(orderedPanels[idx]!.id, ref)
      })
    } else {
      const firstVidRef =
        incomingVideos[0]?.relativePath?.trim() || incomingVideos[0]?.dataUrl?.trim() || ''
      if (firstVidRef) {
        const climaxPanel =
          orderedPanels.find((p) => p.videoUrl?.trim()) ??
          orderedPanels.find((p) => p.effectType === 'focus-lines' && p.cornerOffsets) ??
          orderedPanels.find((p) => p.effectType === 'focus-lines') ??
          orderedPanels[Math.min(2, orderedPanels.length - 1)]
        if (climaxPanel) videoByPanelId.set(climaxPanel.id, firstVidRef)
      }
    }
  }
  if (videoByPanelId.size > 0 || fgByPanelId.size > 0) {
    filled = {
      ...filled,
      panels: filled.panels.map((p) => {
        const vidUrl = videoByPanelId.get(p.id)
        const fgUrl = fgByPanelId.get(p.id)
        if (!vidUrl && !fgUrl) return p
        return {
          ...p,
          ...(vidUrl ? { videoUrl: vidUrl } : {}),
          ...(fgUrl
            ? {
                foregroundImageUrl: fgUrl,
                parallaxDepth: p.parallaxDepth ?? 0.6
              }
            : {})
        }
      })
    }
  }
  if (!filled.panels.length) {
    throw new Error('GRAPH_COMIC_PAGE_EMPTY')
  }
  if (!ctx.composeComicPageImage) {
    throw new Error('COMIC_PAGE_COMPOSE_UNAVAILABLE')
  }

  const composed = await ctx.composeComicPageImage({
    page: filled,
    resolveImage: (imageUrl) => resolveComicImageSrc(ctx, imageUrl)
  })
  const dataUrl = composed.dataUrl?.trim()
  if (!dataUrl) throw new Error('COMIC_PAGE_COMPOSE_FAILED')

  const createdAt = new Date().toISOString()
  const batch: GraphImageItem[] = []
  if (composed.bubbleDataUrls) {
    for (const panel of filled.panels) {
      for (const bubble of panel.bubbles) {
        const bUrl = composed.bubbleDataUrls?.[bubble.id]?.trim()
        if (!bUrl) continue
        batch.push({
          id: `comic-bubble:${ctx.node.id}:${bubble.id}`,
          title: bubble.speaker ? `${bubble.speaker}: ${bubble.text}` : bubble.text,
          dataUrl: bUrl,
          createdAt
        })
      }
    }
  }
  if (composed.panelDataUrls) {
    filled.panels.forEach((panel, idx) => {
      const pUrl = composed.panelDataUrls?.[panel.id]?.trim()
      if (!pUrl) return
      batch.push({
        id: `comic-panel:${ctx.node.id}:${panel.id}`,
        title: panel.title?.trim() || `Panel ${idx + 1}`,
        dataUrl: pUrl,
        createdAt
      })
    })
  }
  batch.push({
    id: `comic-page:${ctx.node.id}`,
    title: filled.title?.trim() || ctx.node.title || 'Comic page',
    dataUrl,
    createdAt
  })
  const materialized = await materializeGeneratedBatch(ctx, batch, `comicPage:${ctx.node.id}`)
  if (!materialized.length) throw fail(SHARED_ERRORS.persistImageFailed, { detail: '' })
  const mainPageItem =
    materialized.find((item) => item.id === `comic-page:${ctx.node.id}`) ??
    materialized[materialized.length - 1]
  const previewPath = mainPageItem?.relativePath?.trim()
  return commitGeneratedImages(ctx, materialized, previewPath, {
    comicPage: serializeComicPage(filled)
  })
}
