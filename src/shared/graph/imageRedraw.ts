/**
 * 重绘（inpaint）：蒙版 + 用户提示词 → 图片模型局部重绘。
 * mask：白=重绘区，黑=保留区。
 */

import {
  EXPAND_FALLBACK_COUNTS,
  EXPAND_FALLBACK_RESOLUTIONS,
  normalizeExpandCount,
  normalizeExpandResolution,
  parseAspectRatioString,
  type ImageExpandState
} from './imageExpand'

export type RedrawTool = 'brush' | 'rect' | 'eraser'

export interface ImageRedrawState {
  /** 蒙版 PNG data URL（白=重绘，黑=保留）；可为空表示尚未绘制 */
  maskDataUrl: string
  /** 用户重绘描述 */
  prompt: string
  /** 画笔直径（编辑器 UI） */
  brushSize: number
  aspectId: string
  resolution: string
  count: number
}

export const DEFAULT_IMAGE_REDRAW: ImageRedrawState = {
  maskDataUrl: '',
  prompt: '',
  brushSize: 28,
  aspectId: 'original',
  resolution: '2K',
  count: 1
}

export const REDRAW_FALLBACK_RESOLUTIONS = EXPAND_FALLBACK_RESOLUTIONS
export const REDRAW_FALLBACK_COUNTS = EXPAND_FALLBACK_COUNTS

const MIN_BRUSH = 4
const MAX_BRUSH = 120

export function normalizeRedrawBrushSize(value: unknown): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return DEFAULT_IMAGE_REDRAW.brushSize
  return Math.min(MAX_BRUSH, Math.max(MIN_BRUSH, n))
}

export function normalizeImageRedraw(
  raw?: Partial<ImageRedrawState> | null
): ImageRedrawState {
  const base = { ...DEFAULT_IMAGE_REDRAW, ...(raw ?? {}) }
  const aspectId =
    typeof base.aspectId === 'string' && base.aspectId.trim()
      ? base.aspectId.trim()
      : DEFAULT_IMAGE_REDRAW.aspectId
  return {
    maskDataUrl: typeof base.maskDataUrl === 'string' ? base.maskDataUrl : '',
    prompt: typeof base.prompt === 'string' ? base.prompt : '',
    brushSize: normalizeRedrawBrushSize(base.brushSize),
    aspectId,
    resolution: normalizeExpandResolution(base.resolution),
    count: normalizeExpandCount(base.count)
  }
}

export function clampRedrawParamsToCapabilities(
  state: ImageRedrawState,
  caps: { aspectRatios: string[]; resolutions: string[]; counts: number[] }
): ImageRedrawState {
  const s = normalizeImageRedraw(state)
  const aspects = caps.aspectRatios.filter(Boolean)
  const resolutions =
    caps.resolutions.length > 0 ? caps.resolutions : [...REDRAW_FALLBACK_RESOLUTIONS]
  const counts = caps.counts.length > 0 ? caps.counts : [...REDRAW_FALLBACK_COUNTS]

  let aspectId = s.aspectId
  if (aspectId !== 'original' && aspects.length && !aspects.includes(aspectId)) {
    aspectId = 'original'
  }

  let resolution = s.resolution
  if (!resolutions.includes(resolution)) {
    resolution = resolutions.includes('2K')
      ? '2K'
      : (resolutions[0] ?? DEFAULT_IMAGE_REDRAW.resolution)
  }

  let count = s.count
  if (!counts.includes(count)) {
    count = counts.includes(1) ? 1 : (counts[0] ?? 1)
  }

  return normalizeImageRedraw({ ...s, aspectId, resolution, count })
}

export function redrawAspectRatioValue(
  aspectId: string,
  sourceAspect: number
): number | undefined {
  if (!aspectId || aspectId === 'original') return sourceAspect > 0 ? sourceAspect : 1
  return parseAspectRatioString(aspectId)
}

export function apiAspectRatioForRedraw(state: ImageRedrawState): string | undefined {
  const s = normalizeImageRedraw(state)
  if (s.aspectId === 'original') return undefined
  return s.aspectId
}

export function buildRedrawUserPrompt(state: ImageRedrawState): string {
  const s = normalizeImageRedraw(state)
  const user = s.prompt.trim()
  const parts = [
    'Inpaint / redraw only the masked (white / empty) regions of the reference image',
    'keep all unmasked pixels unchanged: subject, style, lighting and composition',
    'seamlessly blend new content into neighboring areas',
    'no text overlays, no borders, no frames'
  ]
  if (user) parts.push(`user request: ${user}`)
  return parts.join(', ')
}

export function hasRedrawMask(state: ImageRedrawState): boolean {
  return normalizeImageRedraw(state).maskDataUrl.startsWith('data:image')
}

export function readImageRedrawFromNode(params: {
  imageRedraw?: Partial<ImageRedrawState>
}): ImageRedrawState {
  return normalizeImageRedraw(params.imageRedraw)
}

export function imageRedrawToNodePatch(state: ImageRedrawState): {
  imageRedraw: ImageRedrawState
} {
  return { imageRedraw: normalizeImageRedraw(state) }
}

/** 复用扩图分辨率档位类型，便于共享工具栏 */
export type RedrawResolution = ImageExpandState['resolution']
