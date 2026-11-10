/** 渲染进程媒体 URL / 文本缓存，避免重复 IPC 与 fetch */
import { isAnimatedImageFilePath, isVectorImageFilePath } from '@shared/import'
import { getActiveChatProjectScopeSnapshot } from '../../composables/useChatHistory'

const fileUrlCache = new Map<string, string>()
const previewUrlCache = new Map<string, string>()
const textCache = new Map<string, string>()

async function resolveSubProjectStudioMediaUrl(relativePath: string): Promise<string> {
  if (
    !relativePath ||
    relativePath.startsWith('data:') ||
    relativePath.startsWith('studio-media:') ||
    relativePath.startsWith('file:') ||
    /^https?:\/\//i.test(relativePath) ||
    /^[A-Za-z]:[\\/]|^\//.test(relativePath) ||
    typeof window === 'undefined' ||
    typeof window.studio?.getAssetMediaDataUrl !== 'function'
  ) {
    return ''
  }
  const snap = getActiveChatProjectScopeSnapshot()
  const candidateRoots: string[] = []
  if (snap.activeProject?.rootPath?.trim()) {
    candidateRoots.push(snap.activeProject.rootPath.trim())
  }
  for (const p of snap.allProjects) {
    const r = p.rootPath?.trim()
    if (r && !candidateRoots.includes(r)) candidateRoots.push(r)
  }
  if (!candidateRoots.length) return ''
  const relClean = relativePath.replace(/^[\\/]+/, '')
  for (const subRoot of candidateRoots) {
    const absCandidate = `${subRoot.replace(/[\\/]+$/, '')}/${relClean}`
    try {
      const dataUrl = await window.studio.getAssetMediaDataUrl(absCandidate)
      if (dataUrl) {
        return `studio-media://local/?path=${encodeURIComponent(absCandidate)}`
      }
    } catch {
      /* 尝试下一个子工程 */
    }
  }
  return ''
}

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
  const raw = relativePath.trim()
  if (!raw) return ''
  if (raw.startsWith('data:') || raw.startsWith('studio-media:') || /^https?:\/\//i.test(raw)) {
    return raw
  }
  const key = raw.replace(/\\/g, '/')
  const hit = fileUrlCache.get(key)
  if (hit) return hit
  try {
    // 文件缺失时主进程返回 null（不再抛错）：按既有的「空串 = 无 URL」约定收口，调用方降级展示
    const url = await window.studio.getAssetFileUrl(key)
    if (url) {
      fileUrlCache.set(key, url)
      return url
    }
  } catch {
    // 路径越界等异常：同样尝试子工程回退
  }
  const subUrl = await resolveSubProjectStudioMediaUrl(key)
  if (subUrl) {
    fileUrlCache.set(key, subUrl)
    return subUrl
  }
  return ''
}

/** 图片 / 视频会 ensure 缩略图（视频为首帧 PNG）；其它类型等同 file URL */
export async function resolveAssetPreviewUrl(relativePath: string): Promise<string> {
  const raw = relativePath.trim()
  if (!raw) return ''
  if (raw.startsWith('data:') || raw.startsWith('studio-media:') || /^https?:\/\//i.test(raw)) {
    return raw
  }
  const key = raw.replace(/\\/g, '/')
  const hit = previewUrlCache.get(key)
  if (hit) return hit
  try {
    const url = await window.studio.getAssetPreviewUrl(key)
    if (url) {
      previewUrlCache.set(key, url)
      return url
    }
  } catch {
    // 尝试子工程回退
  }
  const subUrl = await resolveSubProjectStudioMediaUrl(key)
  if (subUrl) {
    previewUrlCache.set(key, subUrl)
    return subUrl
  }
  return ''
}

/**
 * 大图 / 播放预览 URL：动图（GIF）与矢量图（SVG）必须走原文件——前者的预览缩略图
 * 是静态首帧，会把动画压没；后者根本没有位图缩略图。静态图仍走缩略图，省内存与 IO。
 */
export async function resolveAssetPlaybackUrl(relativePath: string): Promise<string> {
  const key = relativePath.replace(/\\/g, '/').trim()
  if (!key) return ''
  if (isAnimatedImageFilePath(key) || isVectorImageFilePath(key)) return resolveAssetFileUrl(key)
  return resolveAssetPreviewUrl(key)
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
