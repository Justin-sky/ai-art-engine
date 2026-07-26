/** 渲染进程媒体 URL / 文本缓存，避免重复 IPC 与 fetch */

const fileUrlCache = new Map<string, string>()
const previewUrlCache = new Map<string, string>()
const textCache = new Map<string, string>()

export function clearAssetUrlCaches(): void {
  fileUrlCache.clear()
  previewUrlCache.clear()
  textCache.clear()
}

export function invalidateAssetUrlCache(relativePath?: string): void {
  if (!relativePath) {
    clearAssetUrlCaches()
    return
  }
  const key = relativePath.replace(/\\/g, '/')
  fileUrlCache.delete(key)
  previewUrlCache.delete(key)
  textCache.delete(key)
}

export async function resolveAssetFileUrl(relativePath: string): Promise<string> {
  const key = relativePath.replace(/\\/g, '/').trim()
  if (!key) return ''
  const hit = fileUrlCache.get(key)
  if (hit) return hit
  const url = await window.studio.getAssetFileUrl(key)
  fileUrlCache.set(key, url)
  return url
}

/** 图片 / 视频会 ensure 缩略图（视频为首帧 PNG）；其它类型等同 file URL */
export async function resolveAssetPreviewUrl(relativePath: string): Promise<string> {
  const key = relativePath.replace(/\\/g, '/').trim()
  if (!key) return ''
  const hit = previewUrlCache.get(key)
  if (hit) return hit
  try {
    const url = await window.studio.getAssetPreviewUrl(key)
    if (url) previewUrlCache.set(key, url)
    return url
  } catch {
    return ''
  }
}

/** 通过 studio-media URL 异步读取文本文件正文（带缓存） */
export async function fetchTextFromAssetRelativePath(relativePath: string): Promise<string> {
  const key = relativePath.replace(/\\/g, '/').trim()
  if (!key) return ''
  const hit = textCache.get(key)
  if (hit !== undefined) return hit
  const url = await resolveAssetFileUrl(key)
  if (!url) return ''
  const res = await fetch(url)
  if (!res.ok) return ''
  const text = await res.text()
  textCache.set(key, text)
  return text
}
