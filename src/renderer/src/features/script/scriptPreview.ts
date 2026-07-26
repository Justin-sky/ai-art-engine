import { inject, type InjectionKey } from 'vue'

export interface ScriptPreviewApi {
  openShotImageEditor: () => void
  /** 在剧本画布下方展开分镜视频图（与分镜图同一嵌入方式） */
  openShotEditor: () => void
  openShotTable: () => void
}

export const scriptPreviewKey: InjectionKey<ScriptPreviewApi> = Symbol('scriptPreview')

export function useScriptPreview(): ScriptPreviewApi | null {
  return inject(scriptPreviewKey, null)
}
