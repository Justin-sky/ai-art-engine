import type { ExternalPluginManifest } from '@shared/ipc'
import {
  registerControlledExtension
} from './registry'
import type {
  EditorExtensionManifest,
  EditorPluginPermission
} from './types'

const DECLARATIVE_PLUGIN_PERMISSIONS = new Set<EditorPluginPermission>([
  'workspace.read',
  'workspace.write'
])

function toEditorManifest(plugin: ExternalPluginManifest): EditorExtensionManifest {
  return {
    id: plugin.id,
    version: plugin.version,
    apiVersion: plugin.apiVersion,
    displayName: plugin.displayName,
    permissions: plugin.permissions,
    toolbarItems: plugin.contributions?.toolbarItems ?? []
  }
}

/**
 * 只激活声明式贡献。外部清单不能提供组件路径、脚本或 execute 函数。
 */
export async function loadExternalExtensions(): Promise<void> {
  if (typeof window.studio?.listPlugins !== 'function') return
  const plugins = await window.studio.listPlugins()
  for (const plugin of plugins) {
    try {
      if (plugin.id.startsWith('aiartengine.')) {
        throw new Error('The aiartengine.* namespace is reserved')
      }
      registerControlledExtension(
        toEditorManifest(plugin),
        DECLARATIVE_PLUGIN_PERMISSIONS
      )
    } catch (error) {
      console.warn(`[plugins] failed to activate ${plugin.id}`, error)
    }
  }
}
