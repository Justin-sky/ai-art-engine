import { isRealThumbnailPath } from '@shared/media/thumbnailPath'
import { invalidateAssetUrlCache, resolveAssetPreviewUrl } from './assetUrlCache'
import { captureModelThumbnailDataUrl } from './captureModelThumbnail'

const inFlight = new Map<string, Promise<string>>()

function sourceKey(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').trim()
}

/**
 * 3D 资产预览 URL：已有 thumbs 直接用；否则离屏拍一张、落盘、再取预览。
 * 同路径去重，避免 @ 面板和资产库同时打开时重复渲染。
 */
export function ensureModelPreviewUrl(input: {
  relativePath?: string | null
  thumbnailPath?: string | null
}): Promise<string> {
  const source = sourceKey(input.relativePath ?? '')
  if (!source) return Promise.resolve('')
  const existing = inFlight.get(source)
  if (existing) return existing

  const task = (async (): Promise<string> => {
    if (isRealThumbnailPath(input.thumbnailPath, source)) {
      const ready = await resolveAssetPreviewUrl(input.thumbnailPath!)
      if (ready) return ready
    }
    const cached = await resolveAssetPreviewUrl(source)
    if (cached) return cached
    try {
      const dataUrl = await captureModelThumbnailDataUrl(source)
      if (!dataUrl) return ''
      const saved = await window.studio.saveModelThumbnail({
        sourceRelativePath: source,
        dataUrl
      })
      invalidateAssetUrlCache(source)
      if (saved.thumbnailPath) invalidateAssetUrlCache(saved.thumbnailPath)
      return saved.thumbnailPath ? await resolveAssetPreviewUrl(saved.thumbnailPath) : ''
    } catch {
      return ''
    }
  })()

  inFlight.set(source, task)
  void task.finally(() => {
    inFlight.delete(source)
  })
  return task
}
