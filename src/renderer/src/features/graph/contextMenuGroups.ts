/**
 * 画布右键菜单的资源分组。
 *
 * 分组声明（id → typeIds）仍在 `NodeGraphEditor.vue`：可添加节点随画布作用域变化，
 * 声明必须挨着 `addableMenuItems` 才看得清。这里只做纯数据搬运——把影视流水线节点
 * 统一平铺收进「影视」一级分组下（不设二级子分组），并把分组图标收成一处纯函数，便于单测锁住顺序与图标。
 */

import { ANIM2D_ASSET_ICON, ASSET_TYPE_ICONS } from '@shared/domain'

export type ContextMenuResourceGroup<TItem, TId extends string = string> = {
  id: TId
  label: string
  icon: string
  items: TItem[]
  /** 兼容保留字段；影视分组现已去掉二级分组，节点直接平铺在 items 下 */
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
    /**
     * 「视频语义」不用 🧭：组内语义分析 / 时间线节点就是 🧭，
     * 分组与节点同图标会分不清（同 video / text 分组的教训）。
     */
    case 'videoSemantic':
      return '🧠'
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
    case 'filmTv':
      return CONTEXT_MENU_FILM_TV_ICON
    /**
     * 影视三个阶段分组：图标不能与组内节点撞（剧本生成 📜 / 设定 🎭 / 镜头 📷 / 批量拍摄 🪄），
     * 否则分不清谁是组、谁是节点（同 video / text 分组的教训）。
     */
    case 'filmPre':
      return '🗒️'
    case 'filmArt':
      return '🖌️'
    case 'filmShoot':
      return '📽️'
    default:
      return ASSET_TYPE_ICONS[groupId as keyof typeof ASSET_TYPE_ICONS] ?? '◇'
  }
}

/**
 * 归入影视分组的阶段 id；数组顺序＝影视分组内节点的拼接顺序（按制作阶段：前期 → 美术 → 拍摄）。
 * 组内节点也按流水线顺序排列（不参与名称排序），见 NodeGraphEditor 的 FILM_MENU_GROUP_IDS。
 */
export const CONTEXT_MENU_NESTED_CHILD_GROUP_IDS = ['filmPre', 'filmArt', 'filmShoot'] as const

const NESTED_CHILD_ID_SET: ReadonlySet<string> = new Set([
  CONTEXT_MENU_NESTED_PARENT_ID,
  ...CONTEXT_MENU_NESTED_CHILD_GROUP_IDS
])

/**
 * 把影视相关的节点统一平铺收进「影视」分组（去掉二级分组）：
 * - 影视阶段分组从根菜单摘掉，节点按 `前期 → 美术 → 拍摄` 流水线顺序直接放入「影视」分组 `items`；
 * - 不再生成 `children` 二级子菜单，其余分组原样留在根菜单；
 * - 当前作用域下没有任何影视可添加节点时不占位。
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
  const items = [CONTEXT_MENU_NESTED_PARENT_ID, ...CONTEXT_MENU_NESTED_CHILD_GROUP_IDS].flatMap(
    (id) => byId.get(id)?.items ?? []
  )
  if (items.length === 0) return roots
  return [
    ...roots,
    {
      id: CONTEXT_MENU_NESTED_PARENT_ID,
      label: parent.label,
      icon: parent.icon,
      items
    }
  ]
}
