/** 按工程相对路径读取图运行落盘的剧本文本（对齐图片 getAssetFileUrl） */
export async function readGraphRunText(relativePath: string): Promise<string> {
  const path = relativePath?.trim()
  if (!path) return ''
  try {
    const url = await window.studio.getAssetFileUrl(path)
    if (!url) return ''
    const res = await fetch(url)
    if (!res.ok) return ''
    return await res.text()
  } catch {
    return ''
  }
}
