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

/**
 * Dock Inspector 在 dive 前后不会重挂，必须每次都读当前舞台，
 * 不能把 setup 时的 scene 快照握到下一次 dive；
 * 同时在从 dive 返回上一层的卸载过渡期（active 已置空但 Inspector 尚未完成异步卸载），
 * 回退到最近一次有效的 scene 实例，避免 watch / onBeforeUnmount 抛错。
 */
export function bindLiveDirectorStageScene(
  injected: DirectorStageSceneApi | null | undefined
): DirectorStageSceneApi {
  let fallback: DirectorStageSceneApi | null = resolveDirectorStageScene(injected)
  return new Proxy({} as DirectorStageSceneApi, {
    get(_target, prop, _receiver) {
      const api = resolveDirectorStageScene(injected) ?? fallback
      if (!api) {
        throw new Error('DirectorStageInspector requires an active director stage scene')
      }
      fallback = api
      const value = Reflect.get(api, prop, api)
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(api)
        : value
    }
  })
}
