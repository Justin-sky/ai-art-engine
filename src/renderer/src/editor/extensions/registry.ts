import { shallowRef } from 'vue'
import {
  registerNodeType,
  registerGraphScope,
  registerGraphScopeHost,
  unregisterNodeType,
  mergeGraphPolicy
} from '@shared/graph'
import {
  resolveWorkspaceToolbarItem,
  type ResolvedWorkspaceToolbarItem,
  type WorkspaceToolbarItem
} from '@shared/workspaceToolbar'
import { registerInspector } from '../../inspector/registry'
import { registerGraphCard } from '../../graph/cards/registry'
import { useEditorKernel } from '../kernel'
import type {
  ActiveEditorExtension,
  EditorExtensionManifest,
  EditorWindowDefinition,
  EditorWindowFactoryContext
} from './types'
import type { EditorPluginPermission } from './types'
import {
  assertExtensionPermissions,
  validateExtensionManifest
} from './protocol'
import {
  registerAssetImporter,
  registerEditorCommand,
  registerPropertyDrawer
} from './contributions'

const manifests = new Map<string, EditorExtensionManifest>()
const active = new Map<string, ActiveEditorExtension>()
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
): Record<string, import('dockview-vue').VueComponent> {
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

export function registerExtensionManifest(manifest: EditorExtensionManifest): void {
  const validation = validateExtensionManifest(manifest)
  if (!validation.compatible) {
    throw new Error(`Invalid extension ${manifest.id}: ${validation.errors.join('; ')}`)
  }
  manifests.set(manifest.id, manifest)
}

/**
 * 受控插件入口：只接受已经由宿主导入的清单，并先校验权限。
 * 不使用 eval、动态远程 URL 或任意 Node 权限。
 */
export function registerControlledExtension(
  manifest: EditorExtensionManifest,
  grantedPermissions: ReadonlySet<EditorPluginPermission>
): ActiveEditorExtension {
  assertExtensionPermissions(manifest, grantedPermissions)
  registerExtensionManifest(manifest)
  return activateExtension(manifest.id)
}

export function activateExtension(id: string): ActiveEditorExtension {
  const manifest = manifests.get(id)
  if (!manifest) throw new Error(`Unknown editor extension: ${id}`)
  for (const dependency of manifest.dependencies ?? []) {
    if (!active.has(dependency)) activateExtension(dependency)
  }
  active.get(id)?.deactivate()

  const disposables: Array<() => void> = []
  for (const definition of manifest.inspectors ?? []) {
    disposables.push(registerInspector(definition))
  }
  for (const definition of manifest.windows ?? []) {
    disposables.push(registerEditorWindow(definition))
  }
  for (const definition of manifest.nodeTypes ?? []) {
    registerNodeType(definition)
    disposables.push(() => unregisterNodeType(definition.typeId))
  }
  for (const definition of manifest.graphScopes ?? []) {
    disposables.push(registerGraphScope(definition))
  }
  for (const binding of manifest.graphScopeHosts ?? []) {
    disposables.push(registerGraphScopeHost(binding))
  }
  if (manifest.graphPolicy) {
    disposables.push(mergeGraphPolicy(manifest.id, manifest.graphPolicy))
  }
  for (const item of manifest.toolbarItems ?? []) {
    disposables.push(registerToolbarItem(item))
  }
  for (const definition of manifest.propertyDrawers ?? []) {
    disposables.push(registerPropertyDrawer(definition))
  }
  for (const definition of manifest.importers ?? []) {
    disposables.push(registerAssetImporter(definition))
  }
  for (const definition of manifest.commands ?? []) {
    disposables.push(registerEditorCommand(definition))
  }

  const extensionDispose = manifest.activate?.({
    kernel: useEditorKernel(),
    registerInspector: (definition) => {
      const dispose = registerInspector(definition)
      disposables.push(dispose)
      return dispose
    },
    registerWindow: (definition) => {
      const dispose = registerEditorWindow(definition)
      disposables.push(dispose)
      return dispose
    },
    registerPropertyDrawer: (definition) => {
      const dispose = registerPropertyDrawer(definition)
      disposables.push(dispose)
      return dispose
    },
    registerImporter: (definition) => {
      const dispose = registerAssetImporter(definition)
      disposables.push(dispose)
      return dispose
    },
    registerCommand: (definition) => {
      const dispose = registerEditorCommand(definition)
      disposables.push(dispose)
      return dispose
    },
    registerGraphScope: (definition) => {
      const dispose = registerGraphScope(definition)
      disposables.push(dispose)
      return dispose
    },
    registerGraphScopeHost: (binding) => {
      const dispose = registerGraphScopeHost(binding)
      disposables.push(dispose)
      return dispose
    },
    registerGraphCard: (definition) => {
      const dispose = registerGraphCard(definition)
      disposables.push(dispose)
      return dispose
    }
  })
  if (extensionDispose) disposables.push(extensionDispose)

  const instance: ActiveEditorExtension = {
    manifest,
    deactivate: () => {
      for (const dispose of [...disposables].reverse()) dispose()
      if (active.get(id) === instance) active.delete(id)
    }
  }
  active.set(id, instance)
  return instance
}

export function activateRegisteredExtensions(): ActiveEditorExtension[] {
  return [...manifests.values()]
    .sort(
      (a, b) =>
        (a.activationOrder ?? 0) - (b.activationOrder ?? 0) ||
        a.id.localeCompare(b.id)
    )
    .map((manifest) => activateExtension(manifest.id))
}

export function listActiveExtensions(): ActiveEditorExtension[] {
  return [...active.values()]
}

export function deactivateExtension(id: string): void {
  active.get(id)?.deactivate()
}

export function deactivateAllExtensions(): void {
  for (const extension of [...active.values()].reverse()) extension.deactivate()
}
