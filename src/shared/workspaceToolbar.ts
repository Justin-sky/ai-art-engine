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

/** 默认顺序：自由画布 → 宿主资产 → 剧本 → 分镜 → 世界元素 → 叙事 → 导演台 → 图片 → 视频 → 声音 */
export const WORKSPACE_TOOLBAR_ITEMS: WorkspaceToolbarItem[] = [
  { id: 'freeCanvas', assetType: 'canvas', icon: 'free-canvas', openOnCreate: true },
  { id: 'subgraph', assetType: 'subgraph', openOnCreate: true },
  { id: 'screenplay', assetType: 'screenplay', openOnCreate: true },
  { id: 'world', assetType: 'world', openOnCreate: true },
  { id: 'beat', assetType: 'beat', openOnCreate: true },
  { id: 'motion', assetType: 'motion', openOnCreate: true },
  // 2D 动作没有独立编辑页（纯 JSON 文档，由 stage.2d 节点对话框保存 / 载入）：
  // 三个「新建」入口都走 useAssetCreation 的 createMotion2dActionAsset（建好 + 选中 +
  // 资产库定位 + 预览弹窗），否则点击看起来毫无反应
  { id: 'motion2d', assetType: 'motion2d', openOnCreate: false },
  { id: 'image', assetType: 'image', openOnCreate: true },
  { id: 'video', assetType: 'video', openOnCreate: true },
  { id: 'voice', assetType: 'voice', openOnCreate: true }
]

/**
 * 刻意不在「新建」里出现的资产类型。
 *
 * `gamePlay`：游戏生成已改由 AI 对话面板驱动（MCP `gameplay_*` + cook 成功后自动登记），
 * 图内也没有可编排的入口，手工新建出来的只是一个没有工程目录的空壳——没有编辑器能挂上
 * 真实游戏，双击只能看内置样例。列表里留着它就等于给用户挖坑：说的是「新建游戏」，
 * 实际拿到的是一个死资产。想要游戏直接在对话里说一句玩法即可。
 */
export const WORKSPACE_TOOLBAR_EXCLUDED_ASSET_TYPES: readonly AssetType[] = ['gamePlay']

export interface ResolvedWorkspaceToolbarItem extends WorkspaceToolbarItem {
  label: string
  icon: string
  tooltip: string
}

export function resolveWorkspaceToolbarItem(
  item: WorkspaceToolbarItem
): ResolvedWorkspaceToolbarItem {
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
    .filter((item) => !WORKSPACE_TOOLBAR_EXCLUDED_ASSET_TYPES.includes(item.assetType))
    .filter((item) => item.enabled !== false)
    .filter((item) => {
      if (options?.toolbar && item.showInToolbar === false) return false
      if (options?.assetMenu && item.showInAssetMenu === false) return false
      return true
    })
    .map(resolveWorkspaceToolbarItem)
}
