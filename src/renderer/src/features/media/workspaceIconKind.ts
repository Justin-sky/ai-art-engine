import {
  ANIM2D_ASSET_ICON,
  ASSET_TYPE_ICONS,
  FRAME_ANIM_GEN_ASSET_ICON,
  FREE_CANVAS_ICON,
  VIDEO_ASSET_ICON
} from '@shared/domain'

/**
 * 图标 token → 实际渲染形态。
 *
 * 这里必须保持「一个 token 只对应一种形态」：调用方（右键菜单分组、节点卡片、
 * 资产库）会混用 emoji 与专用 SVG token，一旦某段 emoji 被当成 SVG token 的别名，
 * 用它的条目就会和该资产类型渲染成同一个图标 —— 右键菜单里「影视 / 视频 /
 * 视频生成 / 逐帧拉片」四个条目曾因此全变成同一个视频图标。
 */
export type WorkspaceIconKind = 'freeCanvas' | 'video' | 'anim2d' | 'frameAnimGen' | 'emoji'

/** '⬜' 是自由画布的旧值 */
const FREE_CANVAS_ICON_KEYS: ReadonlySet<string> = new Set([
  FREE_CANVAS_ICON,
  `icon:${FREE_CANVAS_ICON}`,
  '⬜'
])

/**
 * 视频资产专用 SVG token。
 *
 * 刻意**不含** '🎞️'：胶片 emoji 被「逐帧拉片」「3D 动画」等节点当作普通 emoji 使用，
 * 收作别名会让这些节点与「视频 / 视频生成」渲染成同一个图标；GIF 占位、聊天选择器
 * 也各自按 emoji 使用它。
 */
export const VIDEO_ICON_KEYS: ReadonlySet<string> = new Set([
  VIDEO_ASSET_ICON,
  `icon:${VIDEO_ASSET_ICON}`
])

const ANIM2D_ICON_KEYS: ReadonlySet<string> = new Set([
  ANIM2D_ASSET_ICON,
  `icon:${ANIM2D_ASSET_ICON}`
])

const FRAME_ANIM_GEN_ICON_KEYS: ReadonlySet<string> = new Set([
  FRAME_ANIM_GEN_ASSET_ICON,
  `icon:${FRAME_ANIM_GEN_ASSET_ICON}`
])

const MOTION_ICON_KEYS: ReadonlySet<string> = new Set([ASSET_TYPE_ICONS.motion, '🎬'])
const WORLD_ICON_KEYS: ReadonlySet<string> = new Set([ASSET_TYPE_ICONS.world, '🤺'])

/** 该 token 渲染成哪种形态（缺省 emoji 文本） */
export function resolveWorkspaceIconKind(icon?: string, itemId?: string): WorkspaceIconKind {
  const key = icon ?? ''
  if (itemId === 'freeCanvas' || FREE_CANVAS_ICON_KEYS.has(key)) return 'freeCanvas'
  if (itemId === 'video' || VIDEO_ICON_KEYS.has(key)) return 'video'
  if (ANIM2D_ICON_KEYS.has(key)) return 'anim2d'
  if (FRAME_ANIM_GEN_ICON_KEYS.has(key)) return 'frameAnimGen'
  return 'emoji'
}

/** 🎬 / 🤺 一类 emoji 在窄行内偏小，需要整体放大一档 */
export function workspaceIconIsEnlarged(icon?: string, itemId?: string): boolean {
  if (itemId === 'motion' || itemId === 'world') return true
  const key = icon ?? ''
  return MOTION_ICON_KEYS.has(key) || WORLD_ICON_KEYS.has(key)
}
