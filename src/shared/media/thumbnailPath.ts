/** 工程内图片预览缩略图路径约定与识别 */

export const THUMBNAILS_DIR = '.aiartengine/thumbs'
export const THUMB_MAX_EDGE = 384

function toPosix(path: string): string {
  return path.replace(/\\/g, '/')
}

function trimPath(value: string | null | undefined): string | null {
  const t = value?.trim()
  return t || null
}

/** 原图相对路径 → 缩略图相对路径（PNG，旁挂于 .aiartengine/thumbs/） */
export function thumbRelativePathFor(sourceRelativePath: string): string {
  const normalized = toPosix(sourceRelativePath).replace(/^\.\//, '')
  return `${THUMBNAILS_DIR}/${normalized}.png`
}

/** 是否为真缩略图路径（非原图占位） */
export function isRealThumbnailPath(
  thumbnailPath: string | null | undefined,
  sourceRelativePath?: string | null
): boolean {
  const thumb = trimPath(thumbnailPath)
  if (!thumb) return false
  const posix = toPosix(thumb)
  if (posix.startsWith(`${THUMBNAILS_DIR}/`)) return true
  const source = trimPath(sourceRelativePath)
  if (source && toPosix(source) === posix) return false
  return false
}

/**
 * 解析 Inspector / 播放器用的媒体路径：图片可用真 thumb，视频与声音必须原文件。
 * 视频首帧 PNG 仅供资产列表图标（走 getAssetPreviewUrl），不可塞进 `<video src>`。
 */
export function resolvePreviewMediaPath(input: {
  relativePath?: string | null
  thumbnailPath?: string | null
  type?: string | null
}): string | null {
  const rel = trimPath(input.relativePath)
  const type = input.type ?? ''
  if (type === 'video' || type === 'voice') return rel

  const thumb = trimPath(input.thumbnailPath)
  if (thumb && isRealThumbnailPath(thumb, rel)) return thumb
  return rel
}

/** 原图像素路径（编辑器 / 模型 / 双击大图） */
export function resolveFullMediaPath(input: {
  relativePath?: string | null
  thumbnailPath?: string | null
  type?: string | null
}): string | null {
  const rel = trimPath(input.relativePath)
  if (rel) return rel
  const thumb = trimPath(input.thumbnailPath)
  if (thumb && !isRealThumbnailPath(thumb)) return thumb
  return null
}
