/**
 * 打开中的时间线编辑器注册表：MCP 改时间线前用它判断某个剧本资产的时间线
 * 是否正在被界面编辑——编辑器里可能有还没落盘的剪辑，远端写入会与它的自动保存
 * 互相覆盖（谁后写谁说了算），所以编辑中一律拒绝写入。
 */
const openEditors = new Set<string>()

export function registerOpenTimelineEditor(assetId: string): void {
  openEditors.add(assetId)
}

export function unregisterOpenTimelineEditor(assetId: string): void {
  openEditors.delete(assetId)
}

export function isTimelineEditorOpen(assetId: string): boolean {
  return openEditors.has(assetId)
}
