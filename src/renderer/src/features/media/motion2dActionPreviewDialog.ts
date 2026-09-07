import { reactive, readonly } from 'vue'

export type Motion2dActionPreviewDialogState = {
  open: boolean
  /** 目标 motion2d 资产 id */
  assetId: string
  /** 资产名（标题）；空则由对话框回退到默认标题 */
  title: string
}

const state = reactive<Motion2dActionPreviewDialogState>({
  open: false,
  assetId: '',
  title: ''
})

export const motion2dActionPreviewDialogState = readonly(state)

/** 用动作资产自带的装配快照 + 动作帧打开骨架试播浮窗 */
export function openMotion2dActionPreviewDialog(payload: {
  assetId: string
  title?: string | null
}): void {
  const assetId = payload?.assetId?.trim()
  if (!assetId) return
  state.assetId = assetId
  state.title = payload?.title?.trim() || ''
  state.open = true
}

export function closeMotion2dActionPreviewDialog(): void {
  state.open = false
  state.assetId = ''
  state.title = ''
}
