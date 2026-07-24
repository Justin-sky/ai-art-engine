import { inject, type InjectionKey } from 'vue'

export interface NarrativeTableApi {
  openNarrativeTable: () => void
}

export const narrativeTableKey: InjectionKey<NarrativeTableApi> = Symbol('narrativeTable')

export function useNarrativeTable(): NarrativeTableApi | null {
  return inject(narrativeTableKey, null)
}
