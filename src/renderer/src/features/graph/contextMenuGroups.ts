/**
 * 画布右键菜单的资源分组嵌套。
 *
 * 分组声明（id → typeIds）仍在 `NodeGraphEditor.vue`：可添加节点随画布作用域变化，
 * 声明必须挨着 `addableMenuItems` 才看得清。这里只做纯数据搬运——把影视相关的四个
 * 分组收进「影视」父级，并把分组图标收成一处纯函数，便于单测锁住层级、顺序与图标。
 */

import { ANIM2D_ASSET_ICON, ASSET_TYPE_ICONS } from '@shared/domain'

export type ContextMenuResourceGroup<TItem, TId extends string = string> = {
  id: TId
  label: string
  icon: string
  items: TItem[]
  /** 二级分组：有值时本组自身不放节点，只作入口（影视） */
  children?: Array<ContextMenuResourceGroup<TItem, TId>>
}

/** 影视父级 id（不是资产类型，仅作菜单分组标识） */
export const CONTEXT_MENU_NESTED_PARENT_ID = 'filmTv'

/**
 * 「影视」父级图标。
 *
 * 不用 🎬（motion 图标会被 WorkspaceItemIcon 放大渲染），也不用 🎞️（「逐帧拉片」
 * 「3D 动画」节点在用这个胶片 emoji，重复会分不清）。🎦 是影院屏，语义贴「影视」。
 */
export const CONTEXT_MENU_FILM_TV_ICON = '🎦'

/**
 * 分组图标：按分组 id 取固定 emoji，资产类型分组回落到该类型的资产图标。
 *
 * 注意 `video` 是唯一不回落到资产图标的分组：视频资产图标（专用 SVG）与
 * 「视频生成」节点是同一个，分组若也用它，右键菜单里「视频」与「视频生成」
 * 就长得一模一样 —— 分组用 📹 区分开，节点侧保持视频资产图标不变。
 *
 * 同理 `text` 分组用 📚（一叠文稿＝一组文本），因为组内的「备注」节点是 📝：
 * 分组若也用 📝，菜单里「文本分组」与「备注」会分不清。
 */
export function contextMenuResourceGroupIcon(groupId: string): string {
  switch (groupId) {
    case 'episode':
      return '📽️'
    case 'imageRefine':
      return '🎨'
    case 'imageEdit':
      return '🛠️'
    case 'video':
      return '📹'
    case 'text':
      return '📚'
    case 'game':
      return '🕹️'
    case 'motionFx':
      return ANIM2D_ASSET_ICON
    case 'model3d':
      return '🧊'
    /**
     * 「空间世界」分组不用 🌍：组内节点（`asset.spatialWorld`）就是 🌍，
     * 分组与节点长得一样就分不清谁是组、谁是节点（同 video / text 分组的教训）。
     */
    case 'spatialWorld':
      return '🗺️'
    case 'comic':
      return '💬'
    case 'qc':
      return '🤖'
    case 'ad':
      return '📢'
    default:
      return ASSET_TYPE_ICONS[groupId as keyof typeof ASSET_TYPE_ICONS] ?? '◇'
  }
}

/** 收进影视父级的分组 id；数组顺序＝二级菜单展示顺序（剧本 → 剧集 → 世界元素 → 场） */
export const CONTEXT_MENU_NESTED_CHILD_GROUP_IDS = [
  'screenplay',
  'episode',
  'world',
  'beat'
] as const

const NESTED_CHILD_ID_SET: ReadonlySet<string> = new Set(CONTEXT_MENU_NESTED_CHILD_GROUP_IDS)

/**
 * 把影视相关的分组收进「影视」父级：
 * - 子分组从根菜单摘掉、改挂到父级下，顺序取 `CONTEXT_MENU_NESTED_CHILD_GROUP_IDS`（不参与名称排序）；
 * - 父级自身 items 为空，只提供二级入口，其余分组原样留在根菜单；
 * - 子分组在当前作用域下没有可添加节点时（上游已过滤）不占位；四个都不剩则父级不出现。
 */
export function nestContextMenuResourceGroups<TItem, TId extends string>(
  groups: ReadonlyArray<ContextMenuResourceGroup<TItem, TId>>,
  parent: { label: string; icon: string }
): Array<ContextMenuResourceGroup<TItem, TId | typeof CONTEXT_MENU_NESTED_PARENT_ID>> {
  const roots: Array<ContextMenuResourceGroup<TItem, TId | typeof CONTEXT_MENU_NESTED_PARENT_ID>> =
    groups.filter((group) => !NESTED_CHILD_ID_SET.has(group.id))
  const byId = new Map<string, ContextMenuResourceGroup<TItem, TId>>(
    groups.map((group) => [group.id, group])
  )
  const children = CONTEXT_MENU_NESTED_CHILD_GROUP_IDS.map((id) => byId.get(id)).filter(
    (group): group is ContextMenuResourceGroup<TItem, TId> => group != null
  )
  if (children.length === 0) return roots
  return [
    ...roots,
    {
      id: CONTEXT_MENU_NESTED_PARENT_ID,
      label: parent.label,
      icon: parent.icon,
      items: [],
      children
    }
  ]
}
