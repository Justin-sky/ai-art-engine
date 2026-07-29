import { inject, type InjectionKey, type Ref } from 'vue'
import type { WorldElementKind } from '@shared/graph'

export const worldElementKindKey: InjectionKey<Ref<WorldElementKind> | WorldElementKind> =
  Symbol('worldElementKind')

export function useWorldElementKind(): WorldElementKind | null {
  const injected = inject(worldElementKindKey, null)
  if (!injected) return null
  if (typeof injected === 'string') return injected
  return injected.value
}
