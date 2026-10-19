/**
 * 打开中的时间线编辑器注册表：支持 MCP 在时间线打开时实时同步重载画面。
 */
const openEditors = new Map<string, (() => void) | undefined>()

export function registerOpenTimelineEditor(assetId: string, onExternalUpdate?: () => void): void {
  openEditors.set(assetId, onExternalUpdate)
}

export function unregisterOpenTimelineEditor(assetId: string): void {
  openEditors.delete(assetId)
}

export function isTimelineEditorOpen(assetId: string): boolean {
  return openEditors.has(assetId)
}

export function notifyOpenTimelineEditorUpdated(assetId: string): boolean {
  const fn = openEditors.get(assetId)
  if (typeof fn === 'function') {
    fn()
    return true
  }
  return false
}
