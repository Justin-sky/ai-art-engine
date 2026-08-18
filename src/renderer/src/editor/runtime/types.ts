import type { Context } from '@cordisjs/core'
import type { EditorKernel } from '../kernel'
import type { EditorHub } from './hub'

declare module '@cordisjs/core' {
  interface Context {
    kernel: EditorKernel
    editor: EditorHub
  }
}

export type EditorContext = Context

export type EditorPluginSource = 'core' | 'external' | 'demo'

export interface EditorPluginInfo {
  id: string
  version: string
  displayName: string
  source: EditorPluginSource
}
