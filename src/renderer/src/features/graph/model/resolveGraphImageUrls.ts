import { useProjectStore } from '../../../stores/project'

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
    // studio-media / file 预览地址不能直接给远端 API
    if (dataUrl && (dataUrl.startsWith('studio-media:') || dataUrl.startsWith('file:'))) {
      const relativePath = item.relativePath?.trim()
      if (relativePath) {
        try {
          urls.push(await window.studio.getAssetMediaDataUrl(relativePath))
          continue
        } catch {
          /* fall through */
        }
      }
    }
    const relativePath = item.relativePath?.trim()
    if (!relativePath) continue
    try {
      urls.push(await window.studio.getAssetMediaDataUrl(relativePath))
    } catch {
      /* 跳过无法读取的路径 */
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
