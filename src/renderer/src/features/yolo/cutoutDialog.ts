import { reactive, readonly } from 'vue'

export type CutoutDialogState = {
  open: boolean
  /** 来源资产 id（保存后用于提示；可为空，例如从画布图片进入） */
  assetId: string
  /** 资产名称，作为抠图产物的文件名主干 */
  name: string
  /** 可直接给 <img> / canvas 使用的源图地址 */
  url: string
  /** 工程内相对路径；png/jpeg 时交给主进程解码 */
  relativePath: string
}

const state = reactive<CutoutDialogState>({
  open: false,
  assetId: '',
  name: '',
  url: '',
  relativePath: ''
})

export const cutoutDialogState = readonly(state)

export function openCutoutDialog(payload: {
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

export function closeCutoutDialog(): void {
  state.open = false
  state.url = ''
  state.name = ''
  state.relativePath = ''
  state.assetId = ''
}
