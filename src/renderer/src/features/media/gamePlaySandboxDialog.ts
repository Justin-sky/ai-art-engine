import { reactive, readonly } from 'vue'

export type GamePlaySandboxDialogState = {
  open: boolean
  /** 节点宿主：图内双击时用 */
  hostId: string
  nodeId: string
  /** 资产库双击时用 */
  gamePlayAssetId: string
  title: string
}

const state = reactive<GamePlaySandboxDialogState>({
  open: false,
  hostId: '',
  nodeId: '',
  gamePlayAssetId: '',
  title: ''
})

export const gamePlaySandboxDialogState = readonly(state)

export function openGamePlaySandboxDialog(payload: {
  hostId?: string | null
  nodeId?: string | null
  gamePlayAssetId?: string | null
  title?: string | null
}): void {
  const hostId = payload.hostId?.trim() || ''
  const nodeId = payload.nodeId?.trim() || ''
  const gamePlayAssetId = payload.gamePlayAssetId?.trim() || ''
  if (!gamePlayAssetId && !(hostId && nodeId)) return
  state.hostId = hostId
  state.nodeId = nodeId
  state.gamePlayAssetId = gamePlayAssetId
  state.title = payload.title?.trim() || ''
  state.open = true
}

export function closeGamePlaySandboxDialog(): void {
  state.open = false
  state.hostId = ''
  state.nodeId = ''
  state.gamePlayAssetId = ''
  state.title = ''
}
