import { reactive, readonly } from 'vue'

export type MediaPreviewKind = 'image' | 'video' | 'audio' | 'text'

export type MediaPreviewDialogState = {
  open: boolean
  mediaKind: MediaPreviewKind
  url: string
  relativePath: string
  title: string
  text: string
}

const state = reactive<MediaPreviewDialogState>({
  open: false,
  mediaKind: 'image',
  url: '',
  relativePath: '',
  title: '',
  text: ''
})

export const mediaPreviewDialogState = readonly(state)

export function openMediaPreviewDialog(payload: {
  mediaKind: MediaPreviewKind
  url?: string | null
  relativePath?: string | null
  title?: string | null
  text?: string | null
}): void {
  state.mediaKind = payload.mediaKind
  state.url = payload.url?.trim() || ''
  state.relativePath = payload.relativePath?.trim() || ''
  state.title = payload.title?.trim() || ''
  state.text = payload.text?.trim() || ''
  state.open = true
}

export function closeMediaPreviewDialog(): void {
  state.open = false
  state.url = ''
  state.relativePath = ''
  state.title = ''
  state.text = ''
  state.mediaKind = 'image'
}
