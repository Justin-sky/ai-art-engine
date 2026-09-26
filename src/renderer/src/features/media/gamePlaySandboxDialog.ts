import { reactive, readonly } from 'vue'

export type GamePlaySandboxDialogState = {
  open: boolean
  /** 节点宿主：图内双击时用 */
  hostId: string
  nodeId: string
  /** 资产库双击时用 */
  gamePlayAssetId: string
  /** 对话产物卡「试玩」时用：单文件 HTML 的工程内相对路径 */
  htmlPath: string
  title: string
}

const state = reactive<GamePlaySandboxDialogState>({
  open: false,
  hostId: '',
  nodeId: '',
  gamePlayAssetId: '',
  htmlPath: '',
  title: ''
})

export const gamePlaySandboxDialogState = readonly(state)

/**
 * 打开试玩窗口。三种入口互斥、按优先级取第一个可用的：
 * 资产 id（资产库）→ 单文件路径（对话产物卡）→ 宿主节点（图内双击）。
 */
export function openGamePlaySandboxDialog(payload: {
  hostId?: string | null
  nodeId?: string | null
  gamePlayAssetId?: string | null
  htmlPath?: string | null
  title?: string | null
}): void {
  const hostId = payload.hostId?.trim() || ''
  const nodeId = payload.nodeId?.trim() || ''
  const gamePlayAssetId = payload.gamePlayAssetId?.trim() || ''
  const htmlPath = payload.htmlPath?.trim() || ''
  if (!gamePlayAssetId && !htmlPath && !(hostId && nodeId)) return
  state.hostId = hostId
  state.nodeId = nodeId
  state.gamePlayAssetId = gamePlayAssetId
  state.htmlPath = htmlPath
  state.title = payload.title?.trim() || ''
  state.open = true
}

export function closeGamePlaySandboxDialog(): void {
  state.open = false
  state.hostId = ''
  state.nodeId = ''
  state.gamePlayAssetId = ''
  state.htmlPath = ''
  state.title = ''
}
