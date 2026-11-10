import { useProjectStore } from '../../../stores/project'
import { getActiveChatProjectScopeSnapshot } from '../../../composables/useChatHistory'
import { thumbRelativePathFor } from '@shared/media/thumbnailPath'

/**
 * 解析相对路径或本地媒体地址为 data URL：
 * 1. 先按当前工作空间根目录解析（或直接解析 studio-media:// / file:// / 绝对路径）
 * 2. 若工作空间下不存在该相对路径，则回退尝试当前挂载的聊天子工程根目录（如 D:\aircraft\Client_Harmony）
 */
export async function resolveMediaDataUrlWithSubProjects(
  pathOrUrl: string
): Promise<string | undefined> {
  const clean = pathOrUrl.trim()
  if (!clean) return undefined
  if (clean.startsWith('data:') || /^https?:\/\//i.test(clean)) return clean
  try {
    const direct = await window.studio.getAssetMediaDataUrl(clean)
    if (direct) return direct
  } catch {
    // 尝试子工程根目录回退
  }
  if (
    clean.startsWith('studio-media:') ||
    clean.startsWith('file:') ||
    /^[A-Za-z]:[\\/]|^\//.test(clean)
  ) {
    return undefined
  }
  let rootPath = ''
  try {
    rootPath = useProjectStore().rootPath ?? ''
  } catch {
    /* Pinia 未激活时忽略 */
  }
  const snap = getActiveChatProjectScopeSnapshot(rootPath)
  const candidateRoots: string[] = []
  if (snap.activeProject?.rootPath?.trim()) {
    candidateRoots.push(snap.activeProject.rootPath.trim())
  }
  for (const p of snap.allProjects) {
    const r = p.rootPath?.trim()
    if (r && !candidateRoots.includes(r)) candidateRoots.push(r)
  }
  const relClean = clean.replace(/^[\\/]+/, '')
  for (const subRoot of candidateRoots) {
    const absCandidate = `${subRoot.replace(/[\\/]+$/, '')}/${relClean}`
    try {
      const subDataUrl = await window.studio.getAssetMediaDataUrl(absCandidate)
      if (subDataUrl) return subDataUrl
    } catch {
      /* 尝试下一个子工程 */
    }
  }
  return undefined
}

/** 将图执行输出解析为 API 可用的 data URL / http(s)（不含 studio-media / file） */
export async function resolveGraphImageUrls(
  items: Array<{ dataUrl?: string; relativePath?: string }>
): Promise<string[]> {
  const urls: string[] = []
  for (const item of items) {
    const dataUrl = item.dataUrl?.trim()
    if (dataUrl && (dataUrl.startsWith('data:') || /^https?:\/\//i.test(dataUrl))) {
      urls.push(dataUrl)
      continue
    }
    const relativePath = item.relativePath?.trim()
    // studio-media / file 预览地址不能直接给远端 API，优先用 relativePath 或 studio-media 自身转 data URL
    if (dataUrl && (dataUrl.startsWith('studio-media:') || dataUrl.startsWith('file:'))) {
      if (relativePath) {
        const resolved = await resolveMediaDataUrlWithSubProjects(relativePath)
        if (resolved) {
          urls.push(resolved)
          continue
        }
      }
      const fromStudioMedia = await resolveMediaDataUrlWithSubProjects(dataUrl)
      if (fromStudioMedia) {
        urls.push(fromStudioMedia)
        continue
      }
    }
    if (!relativePath) continue
    const resolved = await resolveMediaDataUrlWithSubProjects(relativePath)
    if (resolved) {
      urls.push(resolved)
    }
  }
  return urls
}

/**
 * 将图执行输出的视频解析为「首帧」图片 data URL（供视觉质检/文本模型看图）。
 * 首帧由主进程系统取帧（视频缩略图）保证；已是图片 data URL / http(s) 时原样返回。
 */
export async function resolveVideoFirstFrameImageUrls(
  items: Array<{ dataUrl?: string; relativePath?: string }>
): Promise<string[]> {
  const urls: string[] = []
  for (const item of items) {
    const dataUrl = item.dataUrl?.trim()
    if (dataUrl && (dataUrl.startsWith('data:image/') || /^https?:\/\//i.test(dataUrl))) {
      urls.push(dataUrl)
      continue
    }
    const relativePath = item.relativePath?.trim()
    if (!relativePath) continue
    try {
      // 确保首帧缩略图已生成（视频走系统取帧），再把首帧 PNG 读成 data URL
      await window.studio.getAssetPreviewUrl(relativePath)
      const thumbUrl = await window.studio.getAssetMediaDataUrl(thumbRelativePathFor(relativePath))
      if (thumbUrl) urls.push(thumbUrl)
    } catch {
      /* 跳过无法取帧的路径 */
    }
  }
  return urls
}

/**
 * 将图执行输出的视频按时间均匀抽帧为图片 data URL（质检多帧理解）。
 * 依赖主进程 ffmpeg 按时间取帧；无 ffmpeg 或取帧失败时回退首帧缩略图。
 */
export async function resolveVideoReviewFrameImageUrls(
  items: Array<{ dataUrl?: string; relativePath?: string }>,
  count: number
): Promise<string[]> {
  const urls: string[] = []
  for (const item of items) {
    const dataUrl = item.dataUrl?.trim()
    if (dataUrl && (dataUrl.startsWith('data:image/') || /^https?:\/\//i.test(dataUrl))) {
      // 单帧来源（生成器直接输出）无法多帧采样，直接作为一帧使用
      urls.push(dataUrl)
      continue
    }
    const relativePath = item.relativePath?.trim()
    if (!relativePath) continue
    try {
      const frames = await window.studio.extractVideoFrames(relativePath, count)
      if (frames.length) {
        urls.push(...frames)
        continue
      }
      // 回退：首帧缩略图
      await window.studio.getAssetPreviewUrl(relativePath)
      const thumbUrl = await window.studio.getAssetMediaDataUrl(thumbRelativePathFor(relativePath))
      if (thumbUrl) urls.push(thumbUrl)
    } catch {
      /* 跳过无法取帧的路径 */
    }
  }
  return urls
}

/** 按资产 id 解析主文件为图片 data URL（供生成 API） */
export async function resolveAssetImageUrl(assetId: string): Promise<string | undefined> {
  const project = useProjectStore()
  const asset = project.assets.find((item) => item.id === assetId)
  if (!asset) return undefined
  if (asset.type !== 'image') return undefined
  const relativePath = asset.relativePath?.trim() || asset.thumbnailPath?.trim()
  if (!relativePath) return undefined
  try {
    return await window.studio.getAssetMediaDataUrl(relativePath)
  } catch {
    return undefined
  }
}

/**
 * 按资产 id 解析为生成 API 可用的媒体引用。
 * 图片：data URL；视频：工程相对路径（生成前再上传 TOS）；其它：data URL。
 */
export async function resolveAssetMediaDataUrl(assetId: string): Promise<string | undefined> {
  const project = useProjectStore()
  const asset = project.assets.find((item) => item.id === assetId)
  if (!asset) return undefined
  const relativePath = asset.relativePath?.trim()
  if (!relativePath) return undefined
  try {
    if (asset.type === 'image') {
      return await window.studio.getAssetMediaDataUrl(relativePath)
    }
    // 视频参考不在此处转 data URL；交给主进程生成前上传 TOS
    if (asset.type === 'video') {
      return relativePath.replace(/\\/g, '/')
    }
    return await window.studio.getAssetMediaDataUrl(relativePath)
  } catch {
    return undefined
  }
}
