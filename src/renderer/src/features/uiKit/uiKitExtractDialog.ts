import { reactive, readonly } from 'vue'

/** 素材库图片资产 → 「提取 UI 部件」浮窗的全局态 */
export type UiKitExtractDialogState = {
  open: boolean
  /** 来源资产 id（保存后提示用；可为空） */
  assetId: string
  /** 来源整屏图资产名，作为输出文件夹 / manifest 的 sourceName 主干 */
  name: string
  /** 可直接给 <img> / canvas 使用的源图地址 */
  url: string
  /** 工程内相对路径 */
  relativePath: string
}

const state = reactive<UiKitExtractDialogState>({
  open: false,
  assetId: '',
  name: '',
  url: '',
  relativePath: ''
})

export const uiKitExtractDialogState = readonly(state)

export function openUiKitExtractDialog(payload: {
  url: string
  name?: string | null
  relativePath?: string | null
  assetId?: string | null
}): void {
  state.url = payload.url?.trim() || ''
  state.name = payload.name?.trim() || ''
  state.relativePath = payload.relativePath?.trim() || ''
  state.assetId = payload.assetId?.trim() || ''
  state.open = true
}

export function closeUiKitExtractDialog(): void {
  state.open = false
  state.url = ''
  state.name = ''
  state.relativePath = ''
  state.assetId = ''
}
