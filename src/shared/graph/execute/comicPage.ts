import {
  createComicPage,
  fillComicPageFromImageUrls,
  readComicPageFromGenParams,
  serializeComicPage
} from '../comicPage'
import { isCanvasSafeImageSrc } from '../imageLayerSplit'
import type { GraphImageItem, GraphValue, NodeExecuteContext } from './types'
import { collectIncomingImageItems } from './mediaInputs'
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
  const filled = fillComicPageFromImageUrls(page, urls)
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
