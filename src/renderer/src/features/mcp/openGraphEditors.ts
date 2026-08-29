/**
 * 打开中的图编辑器注册表：MCP graph_edit 用它判断某个资产的图
 * 是否正在被界面编辑——编辑中的资产拒绝远端修改，避免与编辑器
 * 内存态 / 自动保存互相覆盖。
 */
const openEditors = new Set<string>()

export function registerOpenGraphEditor(assetId: string): void {
  openEditors.add(assetId)
}

export function unregisterOpenGraphEditor(assetId: string): void {
  openEditors.delete(assetId)
}

export function isGraphEditorOpen(assetId: string): boolean {
  return openEditors.has(assetId)
}
