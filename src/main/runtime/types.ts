import type { Context } from '@cordisjs/core'
import type { ProvidersHub, StorageHub } from './hub'

declare module '@cordisjs/core' {
  interface Context {
    providers: ProvidersHub
    storage: StorageHub
  }
}

export type MainContext = Context
