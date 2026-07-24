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

const editorKernel = createEditorKernel()

/** 应用级 Editor Kernel；Feature 通过该入口协作，不直接互相引用。 */
export function useEditorKernel(): EditorKernel {
  return editorKernel
}
