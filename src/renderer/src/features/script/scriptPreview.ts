import { inject, type InjectionKey } from 'vue'

export interface ScriptPreviewApi {
  openShotImageEditor: () => void
  /** 打开分镜视频生成窗口 */
  openShotEditor: () => void
  openShotTable: () => void
}

export const scriptPreviewKey: InjectionKey<ScriptPreviewApi> = Symbol('scriptPreview')

export function useScriptPreview(): ScriptPreviewApi | null {
  return inject(scriptPreviewKey, null)
}
