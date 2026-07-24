export type EditorEventMap = {
  'selection:changed': {
    previous: import('./selection').EditorSelection
    current: import('./selection').EditorSelection
  }
  'document:dirty-changed': { documentId: string; dirty: boolean }
  'document:saved': { documentId: string }
  'command:executed': { commandId: string }
  'kernel:reset': undefined
}

export type EditorEventName = keyof EditorEventMap | (string & {})
export type EditorEventHandler<T = unknown> = (payload: T) => void

/** 轻量进程内事件总线；Feature 之间只通过事件契约通信。 */
export class EditorEventBus {
  private readonly listeners = new Map<string, Set<EditorEventHandler>>()

  on<K extends keyof EditorEventMap>(
    name: K,
    handler: EditorEventHandler<EditorEventMap[K]>
  ): () => void
  on(name: string, handler: EditorEventHandler): () => void
  on(name: string, handler: EditorEventHandler): () => void {
    const handlers = this.listeners.get(name) ?? new Set()
    handlers.add(handler)
    this.listeners.set(name, handlers)
    return () => {
      handlers.delete(handler)
      if (handlers.size === 0) this.listeners.delete(name)
    }
  }

  emit<K extends keyof EditorEventMap>(name: K, payload: EditorEventMap[K]): void
  emit(name: string, payload: unknown): void
  emit(name: string, payload: unknown): void {
    for (const handler of this.listeners.get(name) ?? []) handler(payload)
  }

  clear(): void {
    this.listeners.clear()
  }
}
