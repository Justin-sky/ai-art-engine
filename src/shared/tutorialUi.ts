/**
 * 教学视频 UI 定位：稳定 `data-tutorial-id` 约定。
 *
 * ## 设计口径（不要给每个 typeId / 工具窗手写枚举）
 *
 * 录制能力挂在**公共路径**上：
 * - 画布 / 工具栏 / 选中节点 / 指令面板 / 运行钮：固定 id
 * - 右键菜单：`graph-ctx-group-{groupId}` / `graph-ctx-type-{typeId}` 派生
 * - Dive（漫画页 / 节点工具 / 子图等）：`graph-dive` + `graph-dive-view-{viewId}`；
 *   工具浮窗经 provide 把 view id 落到 `StudioFloatingWindow`
 * - 记事本：`graph-notepad` / `graph-notepad-input`（DialogLayer 与 dive 共用组件）
 * - 生成参数 / 模型：`graph-gen-params` / `graph-model-select`
 */

import type { ComputedRef, InjectionKey, Ref } from 'vue'

/** 固定教学 id（公共路径）；动态派生 id 见下方 helper，不必进本表 */
export const TUTORIAL_UI_IDS = [
  'graph-canvas',
  'graph-toolbar',
  'graph-run',
  'graph-selected-node',
  'graph-ctx-menu',
  'graph-instruction-panel',
  'graph-instruction-input',
  'graph-gen-params',
  'graph-model-select',
  /** Dive 内容区（任意 dive 帧） */
  'graph-dive',
  /** Dive 面包屑条 */
  'graph-dive-bar',
  /** Dive「返回上一级」 */
  'graph-dive-up',
  /** 记事本浮窗 */
  'graph-notepad',
  /** 记事本正文输入 */
  'graph-notepad-input'
] as const

export type TutorialUiId = (typeof TUTORIAL_UI_IDS)[number]

export function isTutorialUiId(value: string): value is TutorialUiId {
  return (TUTORIAL_UI_IDS as readonly string[]).includes(value)
}

/** typeId / groupId / viewId → 合法 data-tutorial-id 片段（点改横杠） */
export function tutorialIdSlug(raw: string): string {
  return raw
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** 右键菜单：资源分组入口，如 image → graph-ctx-group-image */
export function tutorialCtxGroupId(groupId: string): string {
  return `graph-ctx-group-${tutorialIdSlug(groupId)}`
}

/** 右键菜单：具体节点类型，如 asset.image → graph-ctx-type-asset-image */
export function tutorialCtxTypeId(typeId: string): string {
  return `graph-ctx-type-${tutorialIdSlug(typeId)}`
}

/** Dive 视图，如 comic.page → graph-dive-view-comic-page；node.multiAngle → graph-dive-view-node-multiAngle */
export function tutorialDiveViewId(viewId: string): string {
  return `graph-dive-view-${tutorialIdSlug(viewId)}`
}

/**
 * Dive 节点工具把当前 view 的教学 id provide 给子树里的 StudioFloatingWindow
 *（Teleport 后 inject 仍有效），这样多角度 / 裁剪等浮窗不必逐个打标。
 */
export const tutorialFloatingIdKey: InjectionKey<
  ComputedRef<string | undefined> | Ref<string | undefined> | string | undefined
> = Symbol('tutorialFloatingId')

/** 双击节点后可能出现的目标（用于刷新 HUD 焦点） */
export const TUTORIAL_POST_DBLCLICK_FOCUS_IDS = [
  'graph-instruction-panel',
  'graph-notepad',
  'graph-dive'
] as const

/**
 * 给工具描述用的简短说明（不要把全部动态 id 枚进 prompt）。
 */
export const TUTORIAL_UI_ID_HINT =
  'graph-canvas / graph-toolbar / graph-run / graph-selected-node / graph-ctx-menu / ' +
  'graph-ctx-group-{groupId} / graph-ctx-type-{typeId} / graph-instruction-panel / ' +
  'graph-instruction-input / graph-gen-params / graph-model-select / graph-dive / ' +
  'graph-dive-bar / graph-dive-up / graph-dive-view-{viewId} / graph-notepad / graph-notepad-input'

/** DOM 属性名（与 Vue `data-tutorial-id` 一致） */
export const TUTORIAL_UI_ATTR = 'data-tutorial-id'

export type TutorialUiBounds = {
  tutorialId: string
  x: number
  y: number
  width: number
  height: number
  /** 高亮框中心，便于直接填 cursor */
  centerX: number
  centerY: number
}
