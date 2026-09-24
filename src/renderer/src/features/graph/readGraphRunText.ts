/** 按工程相对路径读取图运行落盘文本（IPC，避免 fetch(file://) 被 CSP connect-src 拦截） */
export async function readGraphRunText(relativePath: string): Promise<string> {
  const path = relativePath?.trim()
  if (!path) return ''
  try {
    const text = await window.studio.readProjectFile(path)
    return typeof text === 'string' ? text : ''
  } catch {
    return ''
  }
}
