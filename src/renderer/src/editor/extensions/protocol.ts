import type { EditorPluginManifest, EditorPluginPermission } from './types'

export const EDITOR_EXTENSION_API_VERSION = 1 as const

const KNOWN_PERMISSIONS = new Set<EditorPluginPermission>([
  'workspace.read',
  'workspace.write',
  'filesystem.read',
  'generation.run'
])

export interface ExtensionValidationResult {
  compatible: boolean
  errors: string[]
}

/** 外部清单进入 Cordis 前的纯数据检查，不负责加载任意脚本。 */
export function validateExtensionManifest(
  manifest: EditorPluginManifest
): ExtensionValidationResult {
  const errors: string[] = []
  if (!/^[a-z0-9][a-z0-9._-]+$/i.test(manifest.id)) {
    errors.push('Extension id must contain only letters, numbers, dot, underscore or dash')
  }
  if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(manifest.version)) {
    errors.push('Extension version must be semantic version format')
  }
  if (manifest.apiVersion !== EDITOR_EXTENSION_API_VERSION) {
    errors.push(
      `Unsupported extension API ${manifest.apiVersion}; expected ${EDITOR_EXTENSION_API_VERSION}`
    )
  }
  for (const permission of manifest.permissions ?? []) {
    if (!KNOWN_PERMISSIONS.has(permission)) {
      errors.push(`Unknown extension permission: ${permission}`)
    }
  }
  return { compatible: errors.length === 0, errors }
}

export function assertExtensionPermissions(
  manifest: EditorPluginManifest,
  granted: ReadonlySet<EditorPluginPermission>
): void {
  const denied = (manifest.permissions ?? []).filter(
    (permission) => !granted.has(permission)
  )
  if (denied.length) {
    throw new Error(`Extension ${manifest.id} lacks permissions: ${denied.join(', ')}`)
  }
}
