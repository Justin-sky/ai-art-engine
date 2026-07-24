import { markRaw, shallowRef, type Component } from 'vue'
import type { AssetType } from '@shared/domain'
import type { EditorKernel } from '../kernel'

export interface PropertyDrawerDefinition {
  id: string
  component: Component
  order?: number
  match: (targetKind: string, value: unknown) => boolean
}

export interface AssetImporterDefinition {
  id: string
  assetType: AssetType
  extensions: string[]
  label: string
}

export interface EditorCommandContribution {
  id: string
  title: string
  shortcut?: string
  when?: (kernel: EditorKernel) => boolean
  run: (kernel: EditorKernel) => void | Promise<void>
}

function createContributionRegistry<T extends { id: string }>() {
  const items = shallowRef(new Map<string, T>())
  return {
    register(item: T): () => void {
      const next = new Map(items.value)
      next.set(item.id, item)
      items.value = next
      return () => {
        if (items.value.get(item.id) !== item) return
        const remaining = new Map(items.value)
        remaining.delete(item.id)
        items.value = remaining
      }
    },
    list(): T[] {
      return [...items.value.values()]
    },
    get(id: string): T | undefined {
      return items.value.get(id)
    }
  }
}

const drawers = createContributionRegistry<PropertyDrawerDefinition>()
const importers = createContributionRegistry<AssetImporterDefinition>()
const commands = createContributionRegistry<EditorCommandContribution>()

export function registerPropertyDrawer(definition: PropertyDrawerDefinition): () => void {
  return drawers.register({
    ...definition,
    component: markRaw(definition.component)
  })
}

export function listPropertyDrawers(): PropertyDrawerDefinition[] {
  return drawers.list().sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id)
  )
}

export function registerAssetImporter(definition: AssetImporterDefinition): () => void {
  return importers.register(definition)
}

export function listAssetImporters(): AssetImporterDefinition[] {
  return importers.list()
}

export function registerEditorCommand(
  contribution: EditorCommandContribution
): () => void {
  return commands.register(contribution)
}

export function listEditorCommands(): EditorCommandContribution[] {
  return commands.list()
}

export async function executeEditorCommand(
  id: string,
  kernel: EditorKernel
): Promise<boolean> {
  const command = commands.get(id)
  if (!command || (command.when && !command.when(kernel))) return false
  await command.run(kernel)
  return true
}
