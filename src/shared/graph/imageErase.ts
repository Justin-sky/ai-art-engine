/**
 * 擦除：蒙版操作与重绘相同，语义为移除蒙版区内容并由背景自然填补。
 * mask：白=擦除区，黑=保留区。
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

export type ImageEraseState = ImageRedrawState

export const DEFAULT_IMAGE_ERASE: ImageEraseState = { ...DEFAULT_IMAGE_REDRAW }

export const ERASE_FALLBACK_RESOLUTIONS = REDRAW_FALLBACK_RESOLUTIONS
export const ERASE_FALLBACK_COUNTS = REDRAW_FALLBACK_COUNTS

export const normalizeEraseBrushSize = normalizeRedrawBrushSize

export function normalizeImageErase(
  raw?: Partial<ImageEraseState> | null
): ImageEraseState {
  return normalizeImageRedraw(raw)
}

export function clampEraseParamsToCapabilities(
  state: ImageEraseState,
  caps: { aspectRatios: string[]; resolutions: string[]; counts: number[] }
): ImageEraseState {
  return clampRedrawParamsToCapabilities(state, caps)
}

export const apiAspectRatioForErase = apiAspectRatioForRedraw

export function buildEraseUserPrompt(state: ImageEraseState): string {
  const s = normalizeImageErase(state)
  const user = s.prompt.trim()
  const parts = [
    'Erase / remove the content in the masked (white / empty) regions of the reference image',
    'fill those regions with plausible background that continues neighboring areas',
    'keep all unmasked pixels unchanged: subject, style, lighting and composition',
    'do not redraw new objects in the masked area unless needed to complete the background',
    'seamlessly blend edges',
    'no text overlays, no borders, no frames'
  ]
  if (user) parts.push(`user request: ${user}`)
  return parts.join(', ')
}

export const hasEraseMask = hasRedrawMask

export function readImageEraseFromNode(params: {
  imageErase?: Partial<ImageEraseState>
}): ImageEraseState {
  return normalizeImageErase(params.imageErase)
}

export function imageEraseToNodePatch(state: ImageEraseState): {
  imageErase: ImageEraseState
} {
  return { imageErase: normalizeImageErase(state) }
}
