import { readonly, shallowRef, type DeepReadonly, type Ref } from 'vue'
import type { EditorEventBus } from './events'

export type EditorSelectionKind =
  | 'none'
  | 'project'
  | 'shot'
  | 'asset'
  | 'asset.multi'
  | 'graph.node'
  | 'graph.group'
  | 'stage.object'
  | 'stage.camera'
  | 'stage.scene'
  | 'stage.panorama'
  | (string & {})

export interface EditorSelection<TMeta extends Record<string, unknown> = Record<string, unknown>> {
  kind: EditorSelectionKind
  key: string
  id?: string
  hostId?: string
  meta?: TMeta
}

export const EMPTY_EDITOR_SELECTION: EditorSelection = {
  kind: 'none',
  key: 'none'
}

export class EditorSelectionService {
  private readonly value = shallowRef<EditorSelection>(EMPTY_EDITOR_SELECTION)
  readonly current = readonly(this.value) as DeepReadonly<Ref<EditorSelection>>

  constructor(private readonly events: EditorEventBus) {}

  select(selection: EditorSelection): void {
    const previous = this.value.value
    if (
      previous.kind === selection.kind &&
      previous.key === selection.key &&
      previous.id === selection.id &&
      previous.hostId === selection.hostId
    ) {
      return
    }
    this.value.value = selection
    this.events.emit('selection:changed', { previous, current: selection })
  }

  clear(): void {
    this.select(EMPTY_EDITOR_SELECTION)
  }

  is(kind: EditorSelectionKind): boolean {
    return this.value.value.kind === kind
  }
}
