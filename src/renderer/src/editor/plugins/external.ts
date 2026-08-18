import type { Context } from '@cordisjs/core'
import type { ExternalPluginManifest } from '@shared/ipc'
import {
  assertExtensionPermissions,
  validateExtensionManifest
} from '../extensions/protocol'
import type { EditorPluginPermission } from '../extensions/types'

const DECLARATIVE_PLUGIN_PERMISSIONS = new Set<EditorPluginPermission>([
  'workspace.read',
  'workspace.write'
])

function createExternalPlugin(manifest: ExternalPluginManifest) {
  return {
    name: manifest.id,
    inject: ['editor'],
    apply(ctx: Context): void {
      ctx.editor.record({
        id: manifest.id,
        version: manifest.version,
        displayName: manifest.displayName,
        source: 'external'
      })
      for (const item of manifest.contributions?.toolbarItems ?? []) {
        ctx.editor.toolbarItem(item)
      }
    }
  }
}

/**
 * 只激活声明式贡献。外部清单不能提供组件路径、脚本或 execute 函数。
 */
export async function loadExternalPlugins(ctx: Context): Promise<void> {
  if (typeof window.studio?.listPlugins !== 'function') return
  const plugins = await window.studio.listPlugins()
  for (const plugin of plugins) {
    try {
      if (plugin.id.startsWith('aiartengine.')) {
        throw new Error('The aiartengine.* namespace is reserved')
      }
      const validation = validateExtensionManifest(plugin)
      if (!validation.compatible) {
        throw new Error(validation.errors.join('; '))
      }
      assertExtensionPermissions(plugin, DECLARATIVE_PLUGIN_PERMISSIONS)
      ctx.plugin(createExternalPlugin(plugin))
    } catch (error) {
      console.warn(`[plugins] failed to load ${plugin.id}`, error)
    }
  }
}
