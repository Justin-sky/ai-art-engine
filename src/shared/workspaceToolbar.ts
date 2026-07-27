import { ASSET_TYPE_ICONS, ASSET_TYPE_LABELS, type AssetType } from './domain'

/** 工作区左侧工具栏 / 资产右键「新建」菜单的统一条目定义 */
export interface WorkspaceToolbarItem {
  /** 稳定 id，便于后续扩展或插件注册 */
  id: string
  assetType: AssetType
  /** 覆盖默认显示名 */
  label?: string
  /** 覆盖默认图标（emoji 或后续 SVG key） */
  icon?: string
  /** 悬浮提示，默认同 label */
  tooltip?: string
  /** 是否在左侧工具栏显示，默认 true */
  showInToolbar?: boolean
  /** 是否在资产窗口右键「新建」菜单显示，默认 true */
  showInAssetMenu?: boolean
  /** 是否在创建后自动打开对应编辑器 */
  openOnCreate?: boolean
  /** 预留：后续可按权限/功能开关隐藏 */
  enabled?: boolean
}

/** 默认顺序：剧集 → 自由画布 → 剧本 → 分镜 → 世界元素 → 叙事 → 导演台 → 图片 → 视频 → 声音 */
export const WORKSPACE_TOOLBAR_ITEMS: WorkspaceToolbarItem[] = [
  { id: 'canvas', assetType: 'canvas', openOnCreate: true },
  { id: 'freeCanvas', assetType: 'canvas', icon: '⬜', openOnCreate: true },
  { id: 'screenplay', assetType: 'screenplay', openOnCreate: true },
  { id: 'script', assetType: 'script', openOnCreate: true },
  { id: 'world', assetType: 'world', openOnCreate: true },
  { id: 'narrative', assetType: 'narrative', openOnCreate: true },
  { id: 'motion', assetType: 'motion', openOnCreate: true },
  { id: 'image', assetType: 'image', openOnCreate: true },
  { id: 'video', assetType: 'video', openOnCreate: true },
  { id: 'voice', assetType: 'voice', openOnCreate: true }
]

export interface ResolvedWorkspaceToolbarItem extends WorkspaceToolbarItem {
  label: string
  icon: string
  tooltip: string
}

export function resolveWorkspaceToolbarItem(item: WorkspaceToolbarItem): ResolvedWorkspaceToolbarItem {
  const label = item.label ?? ASSET_TYPE_LABELS[item.assetType] ?? item.assetType
  return {
    ...item,
    label,
    icon: item.icon ?? ASSET_TYPE_ICONS[item.assetType] ?? '•',
    tooltip: item.tooltip ?? label,
    openOnCreate: item.openOnCreate !== false,
    enabled: item.enabled !== false
  }
}

export function listWorkspaceToolbarItems(
  items: WorkspaceToolbarItem[] = WORKSPACE_TOOLBAR_ITEMS,
  options?: { toolbar?: boolean; assetMenu?: boolean }
): ResolvedWorkspaceToolbarItem[] {
  return items
    .filter((item) => item.enabled !== false)
    .filter((item) => {
      if (options?.toolbar && item.showInToolbar === false) return false
      if (options?.assetMenu && item.showInAssetMenu === false) return false
      return true
    })
    .map(resolveWorkspaceToolbarItem)
}
