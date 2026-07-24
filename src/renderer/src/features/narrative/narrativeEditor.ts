import { inject, type InjectionKey } from 'vue'

export interface NarrativeEditorApi {
  openNarrativeEditor: () => void
}

export const narrativeEditorKey: InjectionKey<NarrativeEditorApi> = Symbol('narrativeEditor')

export function useNarrativeEditor(): NarrativeEditorApi | null {
  return inject(narrativeEditorKey, null)
}
