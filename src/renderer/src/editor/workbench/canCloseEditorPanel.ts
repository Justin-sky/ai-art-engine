import { parseEditorPanelId } from './editorPanelIcon'
import { graphRunHosts } from '../../features/graph/model/graphRunHosts'

/** 编辑器面板对应节点图是否正在执行（关闭前应拦截） */
export function isEditorPanelGraphRunning(panelId: string): boolean {
  const parsed = parseEditorPanelId(panelId)
  if (!parsed) return false
  return graphRunHosts.isRunningForAsset(parsed.assetId)
}
