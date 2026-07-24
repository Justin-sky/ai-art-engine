import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorCommandService } from '../src/renderer/src/editor/kernel/commands'
import { EditorDocumentService } from '../src/renderer/src/editor/kernel/documents'
import { EditorEventBus } from '../src/renderer/src/editor/kernel/events'
import { EditorSelectionService } from '../src/renderer/src/editor/kernel/selection'

describe('EditorCommandService', () => {
  it('isolates undo history by document scope', async () => {
    const service = new EditorCommandService(new EditorEventBus())
    let a = 0
    let b = 0

    service.setActiveScope('a')
    await service.execute({
      id: 'a+1',
      label: 'A',
      execute: () => { a += 1 },
      undo: () => { a -= 1 }
    })
    service.setActiveScope('b')
    await service.execute({
      id: 'b+1',
      label: 'B',
      execute: () => { b += 1 },
      undo: () => { b -= 1 }
    })

    await service.undo()
    expect({ a, b }).toEqual({ a: 1, b: 0 })
    service.setActiveScope('a')
    await service.undo()
    expect({ a, b }).toEqual({ a: 0, b: 0 })
  })

  it('coalesces commands with the same merge key', async () => {
    const service = new EditorCommandService(new EditorEventBus())
    let value = 0
    await service.execute({
      id: 'first',
      label: 'Edit',
      mergeKey: 'field',
      execute: () => { value = 1 },
      undo: () => { value = 0 }
    })
    await service.execute({
      id: 'second',
      label: 'Edit',
      mergeKey: 'field',
      execute: () => { value = 2 },
      undo: () => { value = 1 }
    })
    await service.undo()
    expect(value).toBe(0)
  })
})

describe('EditorDocumentService', () => {
  afterEach(() => vi.useRealTimers())

  it('tracks clean, dirty, saving and saved states', async () => {
    let resolveSave!: () => void
    const save = vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve }))
    const service = new EditorDocumentService(new EditorEventBus())
    service.register({ id: 'doc', save })

    await service.save('doc')
    expect(save).not.toHaveBeenCalled()

    service.markDirty('doc')
    expect(service.sessions.value[0]).toMatchObject({ status: 'dirty', dirty: true })
    const pending = service.save('doc')
    expect(service.sessions.value[0]).toMatchObject({ status: 'saving', saving: true })
    resolveSave()
    await pending
    expect(service.sessions.value[0]).toMatchObject({ status: 'clean', dirty: false })
  })

  it('autosaves only when enabled and after the configured delay', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => undefined)
    let enabled = false
    const service = new EditorDocumentService(new EditorEventBus())
    service.register({
      id: 'doc',
      save,
      autoSaveEnabled: () => enabled,
      autoSaveDelayMs: () => 5000
    })

    service.markDirty('doc')
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).not.toHaveBeenCalled()

    enabled = true
    service.markDirty('doc')
    await vi.advanceTimersByTimeAsync(4999)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledOnce()
  })

  it('aggregates dirty state through parent documents', () => {
    const service = new EditorDocumentService(new EditorEventBus())
    service.register({ id: 'script', save: async () => undefined })
    service.register({
      id: 'shot',
      parentId: 'script',
      save: async () => undefined
    })
    service.markDirty('shot')
    expect(service.isDirty('script', true)).toBe(true)
    expect(service.isDirty('script')).toBe(false)
  })
})

describe('EditorSelectionService', () => {
  it('emits one event for a semantic selection change', () => {
    const events = new EditorEventBus()
    const listener = vi.fn()
    events.on('selection:changed', listener)
    const selection = new EditorSelectionService(events)
    selection.select({ kind: 'shot', key: 'shot:1', id: '1' })
    selection.select({ kind: 'shot', key: 'shot:1', id: '1' })
    expect(listener).toHaveBeenCalledOnce()
  })
})
