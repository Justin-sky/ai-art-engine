import { onBeforeUnmount, onMounted } from 'vue'
import { useEditorKernel } from '../editor/kernel'
import { editorPreferences } from '../editor/preferences'

export interface EditorDocumentSessionOptions {
  id: () => string
  parentId?: () => string | undefined
  save: () => void | Promise<void>
  saveOnUnmount?: boolean
  autoSaveEnabled?: () => boolean
  autoSaveDelayMs?: () => number
}

/** Vue 编辑器接入 EditorDocumentService 的统一生命周期适配器。 */
export function useEditorDocumentSession(options: EditorDocumentSessionOptions) {
  const editor = useEditorKernel()
  let unregister: (() => void) | null = null

  onMounted(() => {
    unregister = editor.documents.register({
      id: options.id(),
      parentId: options.parentId?.(),
      save: options.save,
      autoSaveEnabled:
        options.autoSaveEnabled ?? (() => editorPreferences.autoSaveEnabled.value),
      autoSaveDelayMs:
        options.autoSaveDelayMs ?? (() => editorPreferences.autoSaveIntervalSec.value * 1000)
    })
  })

  onBeforeUnmount(() => {
    if (
      options.saveOnUnmount !== false &&
      editorPreferences.autoSaveEnabled.value
    ) {
      void editor.documents.save(options.id()).catch((error) => {
        console.error(`[editor] document unmount save failed: ${options.id()}`, error)
      })
    }
    unregister?.()
    unregister = null
  })

  return {
    markDirty: () => editor.documents.markDirty(options.id()),
    markClean: () => editor.documents.markClean(options.id()),
    save: () => editor.documents.save(options.id()),
    isDirty: () => editor.documents.isDirty(options.id())
  }
}
