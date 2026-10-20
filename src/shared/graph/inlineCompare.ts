import type { GraphNodeTypeId } from './types'

/**
 * 支持画布节点卡片内联 Before / After 滑块对比（Inline A/B Wipe）的节点类型集合：
 * 凡是接收上游图片并产出精修/重打光/超分/抠图/构图结果的加工节点，
 * 均可直接在节点卡片缩略图上对比「上游原图 vs 当前产出」。
 */
export const INLINE_AB_COMPARE_NODE_TYPES: ReadonlySet<string> = new Set<GraphNodeTypeId>([
  'image.portrait',
  'image.portraitTexture',
  'image.lighting',
  'image.multiAngle',
  'image.emotion',
  'image.process',
  'image.upscale',
  'image.expand',
  'image.redraw',
  'image.erase',
  'image.matte',
  'image.crop',
  'image.transform',
  'image.cutout',
  'image.compose',
  'image.align'
])

/**
 * 判断某节点当前是否具备开启卡片内联 Before / After 对比的条件。
 */
export function supportsInlineAbCompare(
  typeId: string | null | undefined,
  upstreamUrl?: string | null,
  outputUrl?: string | null
): boolean {
  if (!typeId || !INLINE_AB_COMPARE_NODE_TYPES.has(typeId)) return false
  const up = (upstreamUrl ?? '').trim()
  const out = (outputUrl ?? '').trim()
  return Boolean(up && out && up !== out)
}

/**
 * 将对比分割比例钳制在 `[0.02, 0.98]` 区间内。
 */
export function clampAbSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5
  return Math.min(0.98, Math.max(0.02, Math.round(ratio * 1000) / 1000))
}

export interface InlineAbSplitStyle {
  splitRatio: number
  splitPercent: number
  beforeClipPath: string
  afterClipPath: string
  handleLeftStyle: string
}

/**
 * 计算内联 Before / After 分屏滑块的 CSS 裁切与分割线样式。
 */
export function computeInlineAbSplitStyle(ratio: number): InlineAbSplitStyle {
  const splitRatio = clampAbSplitRatio(ratio)
  const splitPercent = Math.round(splitRatio * 1000) / 10
  const rightInset = Math.round((100 - splitPercent) * 10) / 10
  return {
    splitRatio,
    splitPercent,
    beforeClipPath: `inset(0 ${rightInset}% 0 0)`,
    afterClipPath: `inset(0 0 0 ${splitPercent}%)`,
    handleLeftStyle: `${splitPercent}%`
  }
}
