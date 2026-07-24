import { inject, type InjectionKey } from 'vue'

export interface WorldTableApi {
  openWorldTable: () => void
}

export const worldTableKey: InjectionKey<WorldTableApi> = Symbol('worldTable')

export function useWorldTable(): WorldTableApi | null {
  return inject(worldTableKey, null)
}
