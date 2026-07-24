import type { AssetType } from './domain'

/** 资产编辑器「全局参数」面板模式 */
export type EditorGlobalsMode = 'project' | 'asset' | 'none'

/**
 * 按资产类型决定空白处 / 打开编辑器时应展示的全局 Inspector。
 * 统一为工程级全局参数（风格预设等），与分镜脚本工作流一致。
 */
export function resolveAssetEditorGlobalsMode(_type?: AssetType | null): EditorGlobalsMode {
  return 'project'
}

export function parseGraphHostContext(hostId: string | null | undefined): {
  kind: 'asset' | 'script' | 'unknown'
  id?: string
} {
  if (!hostId) return { kind: 'unknown' }
  if (hostId.startsWith('asset:')) {
    return { kind: 'asset', id: hostId.slice('asset:'.length).split(':')[0] }
  }
  if (hostId.startsWith('script:')) {
    return { kind: 'script', id: hostId.slice('script:'.length).split(':')[0] }
  }
  return { kind: 'unknown' }
}
