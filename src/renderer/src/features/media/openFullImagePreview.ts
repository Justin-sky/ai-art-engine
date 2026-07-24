/**
 * Inspector / 列表缩略图双击：打开原图像素预览窗。
 * 优先 relativePath（getAssetFileUrl → studio-media 原图），否则 dataUrl。
 * 视频 / 音频 URL 同样走预览窗（由 ShotPreviewWindowView 按类型渲染）。
 */
export async function openFullImagePreview(source: {
  dataUrl?: string | null
  relativePath?: string | null
}): Promise<void> {
  const relativePath = source.relativePath?.trim()
  if (relativePath) {
    try {
      const url = await window.studio.getAssetFileUrl(relativePath)
      if (url) {
        await window.studio.openShotPreviewWindow(url)
        return
      }
    } catch {
      /* fall through to dataUrl */
    }
  }

  const dataUrl = source.dataUrl?.trim()
  if (!dataUrl) return
  if (
    dataUrl.startsWith('data:') ||
    /^https?:\/\//i.test(dataUrl) ||
    dataUrl.startsWith('studio-media:')
  ) {
    await window.studio.openShotPreviewWindow(dataUrl)
  }
}

/** 资产管理：导入引用类图/声/视双击预览（剧本 txt 不走此窗） */
export async function openImportedMediaRefPreview(asset: {
  type?: string | null
  relativePath?: string | null
}): Promise<void> {
  if (asset.type === 'screenplay') return
  const relativePath = asset.relativePath?.trim()
  if (!relativePath) return
  await openFullImagePreview({ relativePath })
}
