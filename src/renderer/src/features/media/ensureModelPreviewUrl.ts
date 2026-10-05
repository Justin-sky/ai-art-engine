import { isRealThumbnailPath } from '@shared/media/thumbnailPath'
import { invalidateAssetUrlCache, resolveAssetPreviewUrl } from './assetUrlCache'
import { captureModelThumbnailDataUrl } from './captureModelThumbnail'

const inFlight = new Map<string, Promise<string>>()

/**
 * 单条缩略图的兜底上限。
 *
 * 画廊里每条缩略图都是 `await` 出来的，而**图库是 `Promise.all`**：
 * 任何一条永不返回（如泼溅解析静默卡死），整个画廊就全停在「…」上 ——
 * 一条坏产物不该拖垮其它产物的预览。
 */
const THUMB_BUDGET_MS = 25_000

function withBudget<T>(task: Promise<T>, fallback: T, ms = THUMB_BUDGET_MS): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    void task.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(fallback)
      }
    )
  })
}

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

  const task = withBudget(
    (async (): Promise<string> => {
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
    })(),
    ''
  )

  inFlight.set(source, task)
  void task.finally(() => {
    inFlight.delete(source)
  })
  return task
}
