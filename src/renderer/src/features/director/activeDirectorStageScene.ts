import { readonly, shallowRef, type DeepReadonly, type Ref } from 'vue'
import type { DirectorStageSceneApi } from './useDirectorStageScene'

const active = shallowRef<DirectorStageSceneApi | null>(null)

/** Dive 内舞台 scene，供外层 Dock Inspector 等跨树读取。 */
export const activeDirectorStageScene: DeepReadonly<Ref<DirectorStageSceneApi | null>> = readonly(
  active
) as DeepReadonly<Ref<DirectorStageSceneApi | null>>

export function setActiveDirectorStageScene(scene: DirectorStageSceneApi): void {
  active.value = scene
}

export function clearActiveDirectorStageScene(scene?: DirectorStageSceneApi | null): void {
  if (scene && active.value !== scene) return
  active.value = null
}

export function resolveDirectorStageScene(
  injected: DirectorStageSceneApi | null | undefined
): DirectorStageSceneApi | null {
  return injected ?? active.value
}
