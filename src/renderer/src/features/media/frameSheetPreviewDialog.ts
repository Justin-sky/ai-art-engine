import { reactive, readonly } from 'vue'

export type FrameSheetPreviewDialogState = {
  open: boolean
  /** 原始 sheet 大图文件 URL（勿用缩略图 / 视频首帧类 preview URL） */
  url: string
  title: string
  /** 识别到的网格；null 表示未知，由用户按帧排版手动填行列 */
  rows: number | null
  cols: number | null
}

const state = reactive<FrameSheetPreviewDialogState>({
  open: false,
  url: '',
  title: '',
  rows: null,
  cols: null
})

export const frameSheetPreviewDialogState = readonly(state)

export function openFrameSheetPreviewDialog(payload: {
  url: string
  title?: string | null
  rows?: number | null
  cols?: number | null
}): void {
  const url = payload.url?.trim()
  if (!url) return
  state.url = url
  state.title = payload.title?.trim() || ''
  const rows = payload.rows ? Math.max(1, Math.floor(payload.rows)) : null
  const cols = payload.cols ? Math.max(1, Math.floor(payload.cols)) : null
  state.rows = rows ?? null
  state.cols = cols ?? null
  state.open = true
}

export function closeFrameSheetPreviewDialog(): void {
  state.open = false
  state.url = ''
  state.title = ''
  state.rows = null
  state.cols = null
}
