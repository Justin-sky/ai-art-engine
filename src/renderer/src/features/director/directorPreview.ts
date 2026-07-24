import { inject, type InjectionKey, type Ref } from 'vue'
import type { DirectorViewerState } from '@shared/domain'

export interface DirectorPreviewApi {
  previewUrl: Ref<string>
  getViewer: () => DirectorViewerState
  setViewer: (viewer: DirectorViewerState) => void
  openStageView: (processingNodeId?: string | null) => void | Promise<void>
}

export const directorPreviewKey: InjectionKey<DirectorPreviewApi> = Symbol('directorPreview')

export function useDirectorPreview(): DirectorPreviewApi | null {
  return inject(directorPreviewKey, null)
}
