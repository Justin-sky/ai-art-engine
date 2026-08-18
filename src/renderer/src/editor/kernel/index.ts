import { EditorCommandService } from './commands'
import { EditorDocumentService } from './documents'
import { EditorEventBus } from './events'
import { EditorSelectionService } from './selection'

export * from './commands'
export * from './documents'
export * from './events'
export * from './selection'

export interface EditorKernel {
  events: EditorEventBus
  selection: EditorSelectionService
  commands: EditorCommandService
  documents: EditorDocumentService
  reset: () => void
}

export function createEditorKernel(): EditorKernel {
  const events = new EditorEventBus()
  const kernel: EditorKernel = {
    events,
    selection: new EditorSelectionService(events),
    commands: new EditorCommandService(events),
    documents: new EditorDocumentService(events),
    reset: () => {
      kernel.selection.clear()
      kernel.commands.clearAllHistories()
      kernel.documents.reset()
      kernel.events.emit('kernel:reset', undefined)
    }
  }
  return kernel
}

let boundKernel: EditorKernel | null = null

export function bindEditorKernel(kernel: EditorKernel): void {
  boundKernel = kernel
}

/** 由 Cordis runtime 绑定；未启动时惰性创建，供测试与单测直接用。 */
export function useEditorKernel(): EditorKernel {
  if (!boundKernel) boundKernel = createEditorKernel()
  return boundKernel
}
