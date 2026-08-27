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

async function resolveComicImageSrc(
  ctx: NodeExecuteContext,
  imageUrl: string
): Promise<string> {
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
  const page =
    readComicPageFromGenParams(ctx.node.params) ?? createComicPage()
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

  const batch: GraphImageItem[] = [
    {
      id: `comic-page:${ctx.node.id}`,
      title: filled.title?.trim() || ctx.node.title || 'Comic page',
      dataUrl,
      createdAt: new Date().toISOString()
    }
  ]
  const materialized = await materializeGeneratedBatch(
    ctx,
    batch,
    `comicPage:${ctx.node.id}`
  )
  if (!materialized.length) throw fail(SHARED_ERRORS.persistImageFailed, { detail: '' })
  const previewPath = materialized[0]?.relativePath?.trim()
  return commitGeneratedImages(ctx, materialized, previewPath, {
    comicPage: serializeComicPage(filled)
  })
}
