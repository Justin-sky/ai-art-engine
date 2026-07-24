/**
 * 扩图：相对原图的四向扩展边距 + 画幅 / 分辨率 / 张数。
 * 画幅比例等以当前图片模型 supported_parameters 为准（UI 动态加载）。
 */

export interface ImageExpandState {
  /**
   * 相对原图宽高的扩展量（≥0）。
   * 画布宽 = 原图宽 × (1 + left + right)，高同理。
   */
  expandLeft: number
  expandRight: number
  expandTop: number
  expandBottom: number
  /**
   * 画幅：`original` = 按扩展后内容比例；其它为模型支持的比例字符串（如 16:9）。
   */
  aspectId: string
  resolution: string
  count: number
}

/** @deprecated 旧锚点字段，读入时迁移为 expand* */
export type LegacyExpandAnchor = {
  anchorX?: number
  anchorY?: number
  anchorW?: number
  anchorH?: number
}

/** 默认：上方与右侧各扩半幅原图（约 3×3 中占左下 2×2） */
export const DEFAULT_IMAGE_EXPAND: ImageExpandState = {
  expandLeft: 0,
  expandRight: 0.5,
  expandTop: 0.5,
  expandBottom: 0,
  aspectId: 'original',
  resolution: '2K',
  count: 1
}

/** 无模型能力时的分辨率 / 张数回退 */
export const EXPAND_FALLBACK_RESOLUTIONS = ['1K', '2K', '4K'] as const
export const EXPAND_FALLBACK_COUNTS = [1, 2, 4] as const

const MAX_EXPAND = 4

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function normalizeExpandAspectId(value: unknown): string {
  const id = String(value ?? '').trim()
  return id || DEFAULT_IMAGE_EXPAND.aspectId
}

export function normalizeExpandResolution(value: unknown): string {
  const s = String(value ?? '').trim()
  return s || DEFAULT_IMAGE_EXPAND.resolution
}

export function normalizeExpandCount(value: unknown): number {
  const n = Math.floor(Number(value))
  if (Number.isFinite(n) && n >= 1) return n
  return DEFAULT_IMAGE_EXPAND.count
}

export function normalizeExpandMargin(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return clamp(n, 0, MAX_EXPAND)
}

/** 旧锚点 → 相对原图扩展边距 */
export function anchorsToExpandMargins(raw: LegacyExpandAnchor): Pick<
  ImageExpandState,
  'expandLeft' | 'expandRight' | 'expandTop' | 'expandBottom'
> {
  const w = clamp(Number(raw.anchorW), 0.05, 1)
  const h = clamp(Number(raw.anchorH), 0.05, 1)
  const x = clamp(Number(raw.anchorX), 0, 1)
  const y = clamp(Number(raw.anchorY), 0, 1)
  return {
    expandLeft: normalizeExpandMargin(x / w),
    expandRight: normalizeExpandMargin((1 - x - w) / w),
    expandTop: normalizeExpandMargin(y / h),
    expandBottom: normalizeExpandMargin((1 - y - h) / h)
  }
}

/** 扩展边距 → 画布归一化锚点（供预览百分比布局） */
export function expandMarginsToAnchors(
  state: Pick<
    ImageExpandState,
    'expandLeft' | 'expandRight' | 'expandTop' | 'expandBottom'
  >
): { anchorX: number; anchorY: number; anchorW: number; anchorH: number } {
  const left = normalizeExpandMargin(state.expandLeft)
  const right = normalizeExpandMargin(state.expandRight)
  const top = normalizeExpandMargin(state.expandTop)
  const bottom = normalizeExpandMargin(state.expandBottom)
  const totalW = 1 + left + right
  const totalH = 1 + top + bottom
  return {
    anchorX: left / totalW,
    anchorY: top / totalH,
    anchorW: 1 / totalW,
    anchorH: 1 / totalH
  }
}

export function normalizeExpandMargins(
  raw: Partial<
    Pick<ImageExpandState, 'expandLeft' | 'expandRight' | 'expandTop' | 'expandBottom'>
  >
): Pick<ImageExpandState, 'expandLeft' | 'expandRight' | 'expandTop' | 'expandBottom'> {
  return {
    expandLeft: normalizeExpandMargin(raw.expandLeft),
    expandRight: normalizeExpandMargin(raw.expandRight),
    expandTop: normalizeExpandMargin(raw.expandTop),
    expandBottom: normalizeExpandMargin(raw.expandBottom)
  }
}

function hasLegacyAnchors(raw: Record<string, unknown>): boolean {
  return (
    raw.anchorW != null ||
    raw.anchorH != null ||
    raw.anchorX != null ||
    raw.anchorY != null
  )
}

function hasExpandMargins(raw: Record<string, unknown>): boolean {
  return (
    raw.expandLeft != null ||
    raw.expandRight != null ||
    raw.expandTop != null ||
    raw.expandBottom != null
  )
}

export function normalizeImageExpand(
  raw?: Partial<ImageExpandState & LegacyExpandAnchor> | null
): ImageExpandState {
  const base = { ...(raw ?? {}) } as Partial<ImageExpandState & LegacyExpandAnchor> &
    Record<string, unknown>
  let margins: Pick<
    ImageExpandState,
    'expandLeft' | 'expandRight' | 'expandTop' | 'expandBottom'
  >
  if (hasExpandMargins(base)) {
    margins = normalizeExpandMargins(base)
  } else if (hasLegacyAnchors(base)) {
    margins = anchorsToExpandMargins(base)
  } else {
    margins = normalizeExpandMargins(DEFAULT_IMAGE_EXPAND)
  }
  return {
    ...margins,
    aspectId: normalizeExpandAspectId(base.aspectId),
    resolution: normalizeExpandResolution(base.resolution),
    count: normalizeExpandCount(base.count)
  }
}

/** 解析 "16:9" / "16/9" 为宽高比数值 */
export function parseAspectRatioString(value: string): number | undefined {
  const s = value.trim()
  if (!s || s === 'original') return undefined
  const m = /^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/.exec(s)
  if (!m) return undefined
  const w = Number(m[1])
  const h = Number(m[2])
  if (!(w > 0) || !(h > 0)) return undefined
  return w / h
}

export function expandAspectRatioValue(
  aspectId: string,
  sourceAspect?: number
): number | undefined {
  if (aspectId === 'original') {
    return sourceAspect && sourceAspect > 0 ? sourceAspect : undefined
  }
  return parseAspectRatioString(aspectId)
}

/** 由扩展边距得到内容画布宽高比（原图宽高比 × 边距） */
export function contentAspectFromExpand(
  state: ImageExpandState,
  sourceAspect: number
): number {
  const s = normalizeImageExpand(state)
  const totalW = 1 + s.expandLeft + s.expandRight
  const totalH = 1 + s.expandTop + s.expandBottom
  const ar = sourceAspect > 0 ? sourceAspect : 1
  return (ar * totalW) / totalH
}

/** 目标画布宽高（按分辨率档限制长边） */
export function expandCanvasPixelSize(
  aspectRatio: number,
  resolution: string
): { width: number; height: number } {
  const long =
    resolution === '4K' ? 4096 : resolution === '1K' ? 1024 : 2048
  const ar = aspectRatio > 0 ? aspectRatio : 1
  if (ar >= 1) {
    return { width: long, height: Math.max(1, Math.round(long / ar)) }
  }
  return { width: Math.max(1, Math.round(long * ar)), height: long }
}

/**
 * 按模型能力收紧分辨率 / 张数 / 比例；比例始终保留 `original`。
 */
export function clampExpandParamsToCapabilities(
  state: ImageExpandState,
  caps: { aspectRatios: string[]; resolutions: string[]; counts: number[] }
): ImageExpandState {
  const s = normalizeImageExpand(state)
  const aspects = caps.aspectRatios.filter(Boolean)
  const resolutions =
    caps.resolutions.length > 0 ? caps.resolutions : [...EXPAND_FALLBACK_RESOLUTIONS]
  const counts = caps.counts.length > 0 ? caps.counts : [...EXPAND_FALLBACK_COUNTS]

  let aspectId = s.aspectId
  if (aspectId !== 'original' && aspects.length && !aspects.includes(aspectId)) {
    aspectId = 'original'
  }

  let resolution = s.resolution
  if (!resolutions.includes(resolution)) {
    resolution = resolutions.includes('2K')
      ? '2K'
      : (resolutions[0] ?? DEFAULT_IMAGE_EXPAND.resolution)
  }

  let count = s.count
  if (!counts.includes(count)) {
    count = counts.includes(1) ? 1 : (counts[0] ?? 1)
  }

  return normalizeImageExpand({ ...s, aspectId, resolution, count })
}

export function buildExpandPrompt(state: ImageExpandState): string {
  const s = normalizeImageExpand(state)
  const dirs: string[] = []
  if (s.expandLeft > 0.02) dirs.push('left')
  if (s.expandRight > 0.02) dirs.push('right')
  if (s.expandTop > 0.02) dirs.push('top')
  if (s.expandBottom > 0.02) dirs.push('bottom')
  const dirText = dirs.length ? dirs.join(', ') : 'edges'
  return [
    'Outpaint / expand the canvas around the placed reference image',
    `fill empty regions toward: ${dirText}`,
    'keep the original subject, style, lighting and composition unchanged',
    'seamlessly continue background and environment into new areas',
    'no text overlays, no borders, no frames'
  ].join(', ')
}

export function readImageExpandFromNode(params: {
  imageExpand?: Partial<ImageExpandState & LegacyExpandAnchor>
}): ImageExpandState {
  return normalizeImageExpand(params.imageExpand)
}

export function imageExpandToNodePatch(state: ImageExpandState): {
  imageExpand: ImageExpandState
} {
  return { imageExpand: normalizeImageExpand(state) }
}

export function apiAspectRatioForExpand(state: ImageExpandState): string | undefined {
  const s = normalizeImageExpand(state)
  if (s.aspectId === 'original') return undefined
  return s.aspectId
}
