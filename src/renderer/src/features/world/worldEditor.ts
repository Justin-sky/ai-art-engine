import { inject, type InjectionKey, type Ref } from 'vue'
import type { WorldElementKind } from '@shared/graph'

export interface WorldEditorApi {
  openWorldEditor: (tab?: WorldElementKind) => void
}

export const worldEditorKey: InjectionKey<WorldEditorApi> = Symbol('worldEditor')

export function useWorldEditor(): WorldEditorApi | null {
  return inject(worldEditorKey, null)
}

export const worldElementKindKey: InjectionKey<Ref<WorldElementKind> | WorldElementKind> =
  Symbol('worldElementKind')

export function useWorldElementKind(): WorldElementKind | null {
  const injected = inject(worldElementKindKey, null)
  if (!injected) return null
  if (typeof injected === 'string') return injected
  return injected.value
}
