import { describe, expect, it } from 'vitest'
import { ASSET_TYPE_ICONS } from '../src/shared/domain'
import {
  CONTEXT_MENU_FILM_TV_ICON,
  contextMenuResourceGroupIcon
} from '../src/renderer/src/features/graph/contextMenuGroups'
import {
  resolveWorkspaceIconKind,
  workspaceIconIsEnlarged
} from '../src/renderer/src/features/media/workspaceIconKind'

/** 右键菜单里曾撞成同一个图标的四个条目 */
const FILM_TV = CONTEXT_MENU_FILM_TV_ICON // 影视（父级分组）
const VIDEO_GROUP = contextMenuResourceGroupIcon('video') // 视频（分组）
const VIDEO_GEN = resolveVideoGenNodeIcon() // 视频生成（asset.video 节点）
const FRAME_PULL = '🎞️' // 逐帧拉片（video.framePull 节点）

/** `asset.video` 的节点图标＝视频资产图标；与 builtins.ts 的 VIDEO_ASSET_ICON 同源 */
function resolveVideoGenNodeIcon(): string {
  return ASSET_TYPE_ICONS.video
}

describe('workspace icon kind', () => {
  it('renders the video asset token as the dedicated video glyph', () => {
    expect(resolveWorkspaceIconKind(ASSET_TYPE_ICONS.video)).toBe('video')
    expect(resolveWorkspaceIconKind(`icon:${ASSET_TYPE_ICONS.video}`)).toBe('video')
    expect(resolveWorkspaceIconKind('', 'video')).toBe('video')
  })

  it('keeps plain emoji as emoji — the film-strip emoji is not a video alias', () => {
    // 回归：'🎞️' 曾被当作视频 SVG 的别名，导致「影视 / 视频 / 视频生成 / 逐帧拉片」
    // 四个条目全部渲染成同一个视频图标
    expect(resolveWorkspaceIconKind('🎞️')).toBe('emoji')
    expect(resolveWorkspaceIconKind('🎦')).toBe('emoji')
    expect(resolveWorkspaceIconKind('📹')).toBe('emoji')
  })

  it('still routes the other dedicated tokens', () => {
    expect(resolveWorkspaceIconKind('free-canvas')).toBe('freeCanvas')
    expect(resolveWorkspaceIconKind('⬜')).toBe('freeCanvas')
    expect(resolveWorkspaceIconKind('anim2d')).toBe('anim2d')
    expect(resolveWorkspaceIconKind('frame-anim-gen')).toBe('frameAnimGen')
  })

  it('enlarges motion / world emoji only', () => {
    expect(workspaceIconIsEnlarged(ASSET_TYPE_ICONS.motion)).toBe(true)
    expect(workspaceIconIsEnlarged('🎬')).toBe(true)
    expect(workspaceIconIsEnlarged('🤺')).toBe(true)
    expect(workspaceIconIsEnlarged('', 'motion')).toBe(true)
    expect(workspaceIconIsEnlarged('🎞️')).toBe(false)
    expect(workspaceIconIsEnlarged('🎦')).toBe(false)
  })
})

describe('context menu resource group icons', () => {
  it('keeps 影视 / 视频 / 视频生成 / 逐帧拉片 visually distinct', () => {
    const entries = [
      ['影视', FILM_TV],
      ['视频', VIDEO_GROUP],
      ['视频生成', VIDEO_GEN],
      ['逐帧拉片', FRAME_PULL]
    ] as const

    // 图标 token 两两不同
    const tokens = entries.map(([, token]) => token)
    expect(new Set(tokens).size).toBe(tokens.length)

    // 且渲染形态也两两不同：token 不同但落到同一种 SVG 仍会看起来一样
    const glyphs = entries.map(([, token]) => `${resolveWorkspaceIconKind(token)}:${token}`)
    expect(new Set(glyphs).size).toBe(glyphs.length)
  })

  it('does not reuse the film-strip or clapper emoji for the 影视 parent', () => {
    expect(CONTEXT_MENU_FILM_TV_ICON).not.toBe('🎞️')
    expect(CONTEXT_MENU_FILM_TV_ICON).not.toBe('🎬')
    // 🎬 会被放大渲染，父级分组不该用
    expect(workspaceIconIsEnlarged(CONTEXT_MENU_FILM_TV_ICON)).toBe(false)
  })

  it('falls back to the asset type icon for asset-type groups', () => {
    expect(contextMenuResourceGroupIcon('image')).toBe(ASSET_TYPE_ICONS.image)
    expect(contextMenuResourceGroupIcon('voice')).toBe(ASSET_TYPE_ICONS.voice)
    expect(contextMenuResourceGroupIcon('screenplay')).toBe(ASSET_TYPE_ICONS.screenplay)
    expect(contextMenuResourceGroupIcon('beat')).toBe(ASSET_TYPE_ICONS.beat)
    expect(contextMenuResourceGroupIcon('world')).toBe(ASSET_TYPE_ICONS.world)
  })

  it('gives every hand-picked group a real token', () => {
    for (const id of [
      'episode',
      'imageRefine',
      'imageEdit',
      'video',
      'videoSemantic',
      'text',
      'game',
      'motionFx',
      'model3d',
      'comic',
      'qc',
      'ad'
    ]) {
      expect(contextMenuResourceGroupIcon(id)).toMatch(/\S/)
    }
    // 未知分组不炸，回落到占位符
    expect(contextMenuResourceGroupIcon('nope')).toBe('◇')
  })
})
