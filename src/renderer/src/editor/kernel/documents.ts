import { computed, shallowRef } from 'vue'
import type { EditorEventBus } from './events'

export interface EditorDocumentAdapter {
  id: string
  parentId?: string
  save: () => void | Promise<void>
  autoSaveEnabled?: () => boolean
  autoSaveDelayMs?: () => number
}

export interface EditorDocumentSession {
  id: string
  parentId?: string
  status: 'clean' | 'dirty' | 'saving' | 'error'
  dirty: boolean
  saving: boolean
  error?: string
  lastSavedAt?: string
}

/** 统一文档 dirty/save/autosave 生命周期。 */
export class EditorDocumentService {
  private readonly adapters = new Map<string, EditorDocumentAdapter>()
  private readonly sessionsRef = shallowRef(new Map<string, EditorDocumentSession>())
  private readonly autosaveTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly pendingSaves = new Map<string, Promise<void>>()

  readonly sessions = computed(() => [...this.sessionsRef.value.values()])
  readonly hasDirtyDocuments = computed(() =>
    [...this.sessionsRef.value.values()].some((session) => session.dirty)
  )

  constructor(
    private readonly events: EditorEventBus,
    private readonly autosaveDelayMs = 1500
  ) {}

  register(adapter: EditorDocumentAdapter): () => void {
    this.adapters.set(adapter.id, adapter)
    this.updateSession(adapter.id, {
      id: adapter.id,
      parentId: adapter.parentId,
      status: 'clean',
      dirty: false,
      saving: false
    })
    return () => {
      if (this.adapters.get(adapter.id) === adapter) this.unregister(adapter.id)
    }
  }

  unregister(documentId: string): void {
    this.adapters.delete(documentId)
    const timer = this.autosaveTimers.get(documentId)
    if (timer) clearTimeout(timer)
    this.autosaveTimers.delete(documentId)
    const next = new Map(this.sessionsRef.value)
    next.delete(documentId)
    this.sessionsRef.value = next
  }

  markDirty(documentId: string): void {
    const session = this.sessionsRef.value.get(documentId)
    if (!session) return
    if (!session.dirty) {
      this.events.emit('document:dirty-changed', { documentId, dirty: true })
    }
    this.updateSession(documentId, {
      ...session,
      status: 'dirty',
      dirty: true,
      saving: false,
      error: undefined
    })
    this.scheduleAutosave(documentId)
  }

  markClean(documentId: string): void {
    const session = this.sessionsRef.value.get(documentId)
    if (!session?.dirty) return
    const timer = this.autosaveTimers.get(documentId)
    if (timer) clearTimeout(timer)
    this.autosaveTimers.delete(documentId)
    this.updateSession(documentId, {
      ...session,
      status: 'clean',
      dirty: false,
      saving: false,
      error: undefined
    })
    this.events.emit('document:dirty-changed', { documentId, dirty: false })
  }

  async save(documentId: string): Promise<void> {
    const existing = this.pendingSaves.get(documentId)
    if (existing) return existing
    const adapter = this.adapters.get(documentId)
    const session = this.sessionsRef.value.get(documentId)
    if (!adapter || !session) return
    // 无改动时跳过，避免关窗 flush 对干净文档做空写
    if (!session.dirty) return

    const task = (async () => {
      this.updateSession(documentId, {
        ...session,
        status: 'saving',
        saving: true,
        error: undefined
      })
      try {
        await adapter.save()
        const latest = this.sessionsRef.value.get(documentId)
        if (latest) {
          this.updateSession(documentId, {
            ...latest,
            status: 'clean',
            dirty: false,
            saving: false,
            error: undefined,
            lastSavedAt: new Date().toISOString()
          })
        }
        this.events.emit('document:dirty-changed', { documentId, dirty: false })
        this.events.emit('document:saved', { documentId })
      } catch (error) {
        const latest = this.sessionsRef.value.get(documentId)
        if (latest) {
          this.updateSession(documentId, {
            ...latest,
            status: 'error',
            dirty: true,
            saving: false,
            error: error instanceof Error ? error.message : String(error)
          })
        }
        throw error
      } finally {
        this.pendingSaves.delete(documentId)
      }
    })()
    this.pendingSaves.set(documentId, task)
    return task
  }

  async saveAll(): Promise<void> {
    await Promise.all(
      [...this.sessionsRef.value.values()]
        .filter((session) => session.dirty)
        .map((session) => this.save(session.id))
    )
  }

  isDirty(documentId: string, recursive = false): boolean {
    const session = this.sessionsRef.value.get(documentId)
    if (session?.dirty) return true
    if (!recursive) return false
    const children = [...this.sessionsRef.value.values()].filter(
      (item) => item.parentId === documentId
    )
    return children.some((child) => child.dirty || this.isDirty(child.id, true))
  }

  listDirty(): EditorDocumentSession[] {
    return [...this.sessionsRef.value.values()].filter((session) => session.dirty)
  }

  reset(): void {
    for (const timer of this.autosaveTimers.values()) clearTimeout(timer)
    this.autosaveTimers.clear()
    this.adapters.clear()
    this.pendingSaves.clear()
    this.sessionsRef.value = new Map()
  }

  private scheduleAutosave(documentId: string): void {
    const adapter = this.adapters.get(documentId)
    if (!adapter?.autoSaveEnabled?.()) return
    const oldTimer = this.autosaveTimers.get(documentId)
    if (oldTimer) clearTimeout(oldTimer)
    this.autosaveTimers.set(
      documentId,
      setTimeout(() => {
        this.autosaveTimers.delete(documentId)
        void this.save(documentId).catch((error) => {
          console.error(`[editor] autosave failed: ${documentId}`, error)
        })
      }, Math.max(1000, adapter.autoSaveDelayMs?.() ?? this.autosaveDelayMs))
    )
  }

  private updateSession(documentId: string, session: EditorDocumentSession): void {
    const next = new Map(this.sessionsRef.value)
    next.set(documentId, session)
    this.sessionsRef.value = next
  }
}
