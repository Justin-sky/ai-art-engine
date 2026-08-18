import { shallowRef } from 'vue'
import type { VueComponent } from 'dockview-vue'
import {
  resolveWorkspaceToolbarItem,
  type ResolvedWorkspaceToolbarItem,
  type WorkspaceToolbarItem
} from '@shared/workspaceToolbar'
import type { EditorWindowDefinition, EditorWindowFactoryContext } from './types'

const windowsRef = shallowRef(new Map<string, EditorWindowDefinition>())
const toolbarItemsRef = shallowRef(new Map<string, WorkspaceToolbarItem>())

export function registerEditorWindow(definition: EditorWindowDefinition): () => void {
  const next = new Map(windowsRef.value)
  next.set(definition.id, definition)
  windowsRef.value = next
  return () => {
    if (windowsRef.value.get(definition.id) !== definition) return
    const remaining = new Map(windowsRef.value)
    remaining.delete(definition.id)
    windowsRef.value = remaining
  }
}

export function listEditorWindows(): EditorWindowDefinition[] {
  return [...windowsRef.value.values()]
}

export function createEditorWindowComponents(
  context: EditorWindowFactoryContext
): Record<string, VueComponent> {
  return Object.fromEntries(
    listEditorWindows().map((definition) => [
      definition.id,
      definition.createComponent(context)
    ])
  )
}

export function listPersistentEditorWindowIds(): string[] {
  return listEditorWindows()
    .filter((definition) => definition.persistent !== false)
    .map((definition) => definition.id)
}

export function registerToolbarItem(item: WorkspaceToolbarItem): () => void {
  const next = new Map(toolbarItemsRef.value)
  next.set(item.id, item)
  toolbarItemsRef.value = next
  return () => {
    if (toolbarItemsRef.value.get(item.id) !== item) return
    const remaining = new Map(toolbarItemsRef.value)
    remaining.delete(item.id)
    toolbarItemsRef.value = remaining
  }
}

export function listRegisteredToolbarItems(
  options?: { toolbar?: boolean; assetMenu?: boolean }
): ResolvedWorkspaceToolbarItem[] {
  return [...toolbarItemsRef.value.values()]
    .filter((item) => item.enabled !== false)
    .filter((item) => {
      if (options?.toolbar && item.showInToolbar === false) return false
      if (options?.assetMenu && item.showInAssetMenu === false) return false
      return true
    })
    .map(resolveWorkspaceToolbarItem)
}
