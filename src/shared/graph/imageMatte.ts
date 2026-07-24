/**
 * 抠图（matte）：默认自动去背景；可选蒙版 refinement。
 * mask：白=保留主体，黑=去背景；无蒙版时全图自动抠图。
 */

import {
  DEFAULT_IMAGE_REDRAW,
  REDRAW_FALLBACK_COUNTS,
  REDRAW_FALLBACK_RESOLUTIONS,
  apiAspectRatioForRedraw,
  clampRedrawParamsToCapabilities,
  hasRedrawMask,
  normalizeImageRedraw,
  normalizeRedrawBrushSize,
  type ImageRedrawState
} from './imageRedraw'

export type ImageMatteState = ImageRedrawState

export const DEFAULT_IMAGE_MATTE: ImageMatteState = { ...DEFAULT_IMAGE_REDRAW }

export const MATTE_FALLBACK_RESOLUTIONS = REDRAW_FALLBACK_RESOLUTIONS
export const MATTE_FALLBACK_COUNTS = REDRAW_FALLBACK_COUNTS

export const normalizeMatteBrushSize = normalizeRedrawBrushSize

export function normalizeImageMatte(
  raw?: Partial<ImageMatteState> | null
): ImageMatteState {
  return normalizeImageRedraw(raw)
}

export function clampMatteParamsToCapabilities(
  state: ImageMatteState,
  caps: { aspectRatios: string[]; resolutions: string[]; counts: number[] }
): ImageMatteState {
  return clampRedrawParamsToCapabilities(state, caps)
}

export const apiAspectRatioForMatte = apiAspectRatioForRedraw

export const hasMatteMask = hasRedrawMask

export function buildMatteUserPrompt(state: ImageMatteState): string {
  const s = normalizeImageMatte(state)
  const user = s.prompt.trim()
  const masked = hasMatteMask(s)
  const parts = masked
    ? [
        'Cut out / matte the subject: keep only the masked (white) regions',
        'make all unmasked (black / empty) regions fully transparent',
        'preserve subject edges, fine hair and soft boundaries as clean alpha',
        'do not alter colors or details inside the kept subject',
        'output a single RGBA image with transparent background',
        'no text overlays, no borders, no frames, no solid backdrop'
      ]
    : [
        'Remove the background and cut out the main subject automatically',
        'produce a clean RGBA cutout with fully transparent background',
        'preserve subject edges, fine hair and soft boundaries as clean alpha',
        'keep subject colors and details unchanged',
        'no text overlays, no borders, no frames, no solid backdrop'
      ]
  if (user) parts.push(`user request: ${user}`)
  return parts.join(', ')
}

export function readImageMatteFromNode(params: {
  imageMatte?: Partial<ImageMatteState>
}): ImageMatteState {
  return normalizeImageMatte(params.imageMatte)
}

export function imageMatteToNodePatch(state: ImageMatteState): {
  imageMatte: ImageMatteState
} {
  return { imageMatte: normalizeImageMatte(state) }
}
