import { ASSET_TYPE_ICONS, isDraftAssetId, type AssetInfo } from '@shared/domain'
import { draftToAssetInfo, useDraftStore } from '../../stores/drafts'
import { useProjectStore } from '../../stores/project'
import type { EditorPanelKind } from './usePanelTitles'

const PANEL_DEFINITIONS: Array<{ prefix: string; kind: EditorPanelKind }> = [
  { prefix: 'asset-editor-', kind: 'asset' },
  { prefix: 'screenplay-editor-', kind: 'screenplay' },
  { prefix: 'script-editor-', kind: 'script' },
  { prefix: 'canvas-editor-', kind: 'canvas' },
  { prefix: 'world-editor-', kind: 'world' },
  { prefix: 'narrative-editor-', kind: 'narrative' },
  { prefix: 'director-editor-', kind: 'director' }
]

function resolveAsset(assetId: string): AssetInfo | null {
  const project = useProjectStore()
  const asset = project.assets.find((item) => item.id === assetId)
  if (asset) return asset
  if (!isDraftAssetId(assetId)) return null
  const draft = useDraftStore().getDraft(assetId)
  return draft ? draftToAssetInfo(draft) : null
}

function kindFallbackIcon(kind: EditorPanelKind): string {
  switch (kind) {
    case 'screenplay':
      return ASSET_TYPE_ICONS.screenplay
    case 'script':
      return ASSET_TYPE_ICONS.script
    case 'canvas':
      return ASSET_TYPE_ICONS.canvas
    case 'world':
      return ASSET_TYPE_ICONS.world
    case 'narrative':
      return ASSET_TYPE_ICONS.narrative
    case 'director':
      return ASSET_TYPE_ICONS.motion
    case 'asset':
      return '◆'
  }
}

export function parseEditorPanelId(
  panelId: string
): { kind: EditorPanelKind; assetId: string } | null {
  for (const definition of PANEL_DEFINITIONS) {
    if (!panelId.startsWith(definition.prefix)) continue
    return {
      kind: definition.kind,
      assetId: panelId.slice(definition.prefix.length)
    }
  }
  return null
}

/** 某资产可能对应的全部编辑器面板 id（按类型前缀枚举） */
export function editorPanelIdsForAsset(assetId: string): string[] {
  return PANEL_DEFINITIONS.map((definition) => `${definition.prefix}${assetId}`)
}

export function resolveEditorPanelIcon(panelId: string): string {
  const parsed = parseEditorPanelId(panelId)
  if (!parsed) return ''
  const asset = resolveAsset(parsed.assetId)
  if (asset) return ASSET_TYPE_ICONS[asset.type] ?? kindFallbackIcon(parsed.kind)
  return kindFallbackIcon(parsed.kind)
}

const LOCKED_DOCK_PANEL_IDS = new Set(['workspace', 'workspace-tools'])

export function isClosableDockTab(panelId: string, tabComponent?: string): boolean {
  if (!panelId) return false
  if (LOCKED_DOCK_PANEL_IDS.has(panelId)) return false
  if (tabComponent === 'lockedTab') return false
  return true
}
