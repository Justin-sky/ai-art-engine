/**
 * 消息流 / 卡片里动图（GIF）的播放策略。
 *
 * 资产缩略图是静态首帧（thumbnailService 用 nativeImage 解码后写 PNG，只剩第一帧），
 * 直接拿缩略图当 `<img src>` 会把动画压没；而一律用原文件又会让一屏多张 GIF 常驻解码。
 * 折中口径：先用缩略图顶上，元素进入视口后才换原文件播动画，离开视口还原缩略图。
 */
import { isAnimatedImageFilePath } from '@shared/import'
import { resolveAssetFileUrl } from './assetUrlCache'

/** 提前一个视口外的距离开始加载原文件，滚动到位时动画已就绪 */
export const ANIMATED_PLAYBACK_ROOT_MARGIN = '200px'

/** 是否为需要「原文件播放」的动图路径（当前仅 GIF） */
export function isAnimatedPlaybackPath(relativePath: string): boolean {
  return isAnimatedImageFilePath(relativePath)
}

/**
 * 图片 src 决策：动图且已进入播放状态时用原文件，
 * 其余一律「缩略图优先、缺失回退原文件」——非动图行为与改动前完全一致。
 */
export function pickChatImageSrc(input: {
  relativePath: string
  previewUrl?: string | null
  fileUrl?: string | null
  playback: boolean
}): string {
  const previewUrl = input.previewUrl?.trim() ?? ''
  const fileUrl = input.fileUrl?.trim() ?? ''
  if (input.playback && fileUrl && isAnimatedPlaybackPath(input.relativePath)) {
    return fileUrl
  }
  return previewUrl || fileUrl
}

/**
 * 观察元素是否进入视口；返回解绑函数。
 * 环境不支持 IntersectionObserver 时按「始终可见」处理，不牺牲功能。
 */
export function observeInView(
  el: Element,
  onVisibleChange: (visible: boolean) => void,
  rootMargin: string = ANIMATED_PLAYBACK_ROOT_MARGIN
): () => void {
  if (typeof IntersectionObserver !== 'function') {
    onVisibleChange(true)
    return () => {}
  }
  const observer = new IntersectionObserver(
    (entries) => onVisibleChange(entries.some((entry) => entry.isIntersecting)),
    { rootMargin }
  )
  observer.observe(el)
  return () => observer.disconnect()
}

/**
 * 命令式版本（供 v-html 注入的 `<img>` 使用）：进入视口换原文件播放，离开视口还原静态占位。
 * 返回解绑函数；非动图返回空操作。节点已被移除时自动停表，调用方无需专门清理。
 */
export function attachAnimatedImagePlayback(
  img: HTMLImageElement,
  relativePath: string,
  placeholderSrc?: string
): () => void {
  if (!isAnimatedPlaybackPath(relativePath)) return () => {}

  const placeholder = (placeholderSrc ?? img.getAttribute('src') ?? '').trim()
  let playing = false
  let disposed = false
  let disconnect: () => void = () => {}

  const showPlaceholder = (): void => {
    if (!playing) return
    playing = false
    if (placeholder) img.src = placeholder
  }

  const showPlayback = (): void => {
    if (playing) return
    void resolveAssetFileUrl(relativePath).then((url) => {
      if (disposed || playing || !url || !img.isConnected) return
      playing = true
      img.src = url
    })
  }

  disconnect = observeInView(img, (visible) => {
    if (disposed) return
    if (!img.isConnected) {
      disposed = true
      disconnect()
      return
    }
    if (visible) showPlayback()
    else showPlaceholder()
  })

  return () => {
    if (disposed) return
    disposed = true
    disconnect()
  }
}
