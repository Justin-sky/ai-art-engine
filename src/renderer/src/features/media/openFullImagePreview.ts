import { isAudioFilePath, isLayeredSourceImageFilePath, isVideoFilePath } from '@shared/import'
import { openMediaPreviewDialog, type MediaPreviewKind } from './mediaPreviewDialog'

function stripQueryAndHash(s: string): string {
  return s.split(/[?#]/)[0] || s
}

function decodePathCandidate(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    return decodeURIComponent(trimmed)
  } catch {
    return trimmed
  }
}

/** 从 relativePath / studio-media URL / data URL 抽出可判扩展名的路径候选 */
function pathCandidates(url: string, relativePath?: string | null): string[] {
  const out: string[] = []
  const rel = relativePath?.trim()
  if (rel) out.push(rel)

  const u = url.trim()
  if (!u) return out
  out.push(u)
  out.push(stripQueryAndHash(u))

  try {
    const parsed = new URL(u)
    const pathParam = parsed.searchParams.get('path')
    if (pathParam) out.push(pathParam)
    if (parsed.pathname) out.push(stripQueryAndHash(parsed.pathname))
  } catch {
    /* 非绝对 URL：上面的 strip 已覆盖 */
  }

  return out.map(decodePathCandidate).filter(Boolean)
}

function detectMediaKindFromPath(
  url: string,
  relativePath?: string | null
): 'image' | 'video' | 'audio' {
  if (url.startsWith('data:video')) return 'video'
  if (url.startsWith('data:audio')) return 'audio'

  for (const candidate of pathCandidates(url, relativePath)) {
    if (isVideoFilePath(candidate)) return 'video'
    if (isAudioFilePath(candidate)) return 'audio'
  }
  return 'image'
}

/** 资产类型优先于扩展名（成片视频的 relativePath 偶发是海报图时仍应按视频播） */
function mediaKindFromAssetType(type?: string | null): MediaPreviewKind | null {
  if (type === 'video' || type === 'motion') return 'video'
  if (type === 'voice' || type === 'music' || type === 'sfx') return 'audio'
  if (type === 'image' || type === 'canvas') return 'image'
  return null
}

/** 供预览入口与单测共用：显式 mediaKind > assetType > 路径扩展名 */
export function resolveMediaPreviewKind(source: {
  url?: string | null
  relativePath?: string | null
  mediaKind?: MediaPreviewKind | null
  assetType?: string | null
}): 'image' | 'video' | 'audio' {
  if (
    source.mediaKind === 'image' ||
    source.mediaKind === 'video' ||
    source.mediaKind === 'audio'
  ) {
    return source.mediaKind
  }
  const fromType = mediaKindFromAssetType(source.assetType)
  if (fromType === 'image' || fromType === 'video' || fromType === 'audio') return fromType
  return detectMediaKindFromPath(source.url?.trim() || '', source.relativePath)
}

/**
 * Inspector / 列表缩略图双击：浮动弹窗预览（不进 Dive 面包屑）。
 * 优先 relativePath（getAssetFileUrl → studio-media 原图），否则 dataUrl；
 * 分层源文件（PSD）原文件解不了，改取主进程合成解码出的预览图。
 */
export async function openFullImagePreview(source: {
  dataUrl?: string | null
  relativePath?: string | null
  title?: string | null
  /** 已知媒体种类时直接用，跳过路径猜测 */
  mediaKind?: MediaPreviewKind | null
  /** 资产 type；比纯扩展名更可靠 */
  assetType?: string | null
}): Promise<void> {
  const relativePath = source.relativePath?.trim() || ''
  const layeredSource = isLayeredSourceImageFilePath(relativePath)

  let url = source.dataUrl?.trim() || ''

  if (relativePath && !url) {
    try {
      url =
        (layeredSource
          ? await window.studio.getAssetPreviewUrl(relativePath)
          : await window.studio.getAssetFileUrl(relativePath)) || ''
    } catch {
      url = ''
    }
  }

  // 分层源文件（PSD）连合成预览都拿不到（无合成数据 / 解码失败）：弹窗只会是破图，
  // 改交系统默认程序（Photoshop）打开
  if (!url && layeredSource) {
    try {
      await window.studio.openAssetWithDefaultApp(relativePath)
    } catch (error) {
      console.warn('[asset] open layered source with default app failed', error)
    }
    return
  }

  if (!url && !relativePath) return

  const mediaKind = resolveMediaPreviewKind({
    url: url || relativePath,
    relativePath,
    mediaKind: source.mediaKind,
    assetType: source.assetType
  })

  openMediaPreviewDialog({
    mediaKind,
    url: url || relativePath,
    relativePath: relativePath || undefined,
    title: source.title?.trim() || undefined
  })
}

/** 资产管理：导入引用类图/声/视双击预览（剧本 txt 不走此窗） */
export async function openImportedMediaRefPreview(asset: {
  type?: string | null
  relativePath?: string | null
  name?: string | null
}): Promise<void> {
  if (asset.type === 'screenplay') return
  const relativePath = asset.relativePath?.trim()
  if (!relativePath) return
  await openFullImagePreview({
    relativePath,
    title: asset.name,
    assetType: asset.type
  })
}
