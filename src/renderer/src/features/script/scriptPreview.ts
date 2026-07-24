import { inject, type InjectionKey } from 'vue'

export interface ScriptPreviewApi {
  openShotEditor: () => void
  openShotTable: () => void
}

export const scriptPreviewKey: InjectionKey<ScriptPreviewApi> = Symbol('scriptPreview')

export function useScriptPreview(): ScriptPreviewApi | null {
  return inject(scriptPreviewKey, null)
}
