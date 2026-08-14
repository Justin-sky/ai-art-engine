/**
 * 裁剪：归一化裁切框 + 比例预设（拉伸后变为 custom）。
 * cropX/Y/W/H 相对原图像素，范围 [0,1]。
 */

import { parseAspectRatioString } from './imageExpand'

export type CropAspectId =
  | 'original'
  | 'custom'
  | '1:1'
  | '4:3'
  | '3:4'
  | '16:9'
  | '9:16'

export interface ImageCropState {
  cropX: number
  cropY: number
  cropW: number
  cropH: number
  aspectId: CropAspectId | string
}

export const CROP_ASPECT_PRESETS: readonly CropAspectId[] = [
  'original',
  '1:1',
  '4:3',
  '3:4',
  '16:9',
  '9:16'
] as const

export const DEFAULT_IMAGE_CROP: ImageCropState = {
  cropX: 0.1,
  cropY: 0.1,
  cropW: 0.8,
  cropH: 0.8,
  aspectId: 'original'
}

const MIN_CROP = 0.05

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function normalizeCropAspectId(value: unknown): string {
  const id = String(value ?? '').trim()
  return id || DEFAULT_IMAGE_CROP.aspectId
}

export function normalizeCropRect(
  raw: Partial<Pick<ImageCropState, 'cropX' | 'cropY' | 'cropW' | 'cropH'>>
): Pick<ImageCropState, 'cropX' | 'cropY' | 'cropW' | 'cropH'> {
  let w = clamp(Number(raw.cropW), MIN_CROP, 1)
  let h = clamp(Number(raw.cropH), MIN_CROP, 1)
  let x = clamp(Number(raw.cropX), 0, 1)
  let y = clamp(Number(raw.cropY), 0, 1)
  if (x + w > 1) x = Math.max(0, 1 - w)
  if (y + h > 1) y = Math.max(0, 1 - h)
  w = Math.min(w, 1 - x)
  h = Math.min(h, 1 - y)
  return {
    cropX: x,
    cropY: y,
    cropW: Math.max(MIN_CROP, w),
    cropH: Math.max(MIN_CROP, h)
  }
}

export function normalizeImageCrop(
  raw?: Partial<ImageCropState> | null
): ImageCropState {
  const base = { ...DEFAULT_IMAGE_CROP, ...(raw ?? {}) }
  return {
    ...normalizeCropRect(base),
    aspectId: normalizeCropAspectId(base.aspectId)
  }
}

/** 目标裁切框相对原图的宽高比（像素空间） */
export function cropTargetAspect(
  aspectId: string,
  sourceAspect: number
): number | undefined {
  if (!aspectId || aspectId === 'custom') return undefined
  if (aspectId === 'original') return sourceAspect > 0 ? sourceAspect : 1
  return parseAspectRatioString(aspectId)
}

/**
 * 在保持中心的前提下，将裁切框贴合目标宽高比（不超出 [0,1] 画布）。
 * targetAspect = 裁切像素宽/高。
 */
export function fitCropRectToAspect(
  rect: Pick<ImageCropState, 'cropX' | 'cropY' | 'cropW' | 'cropH'>,
  targetAspect: number,
  sourceAspect: number
): Pick<ImageCropState, 'cropX' | 'cropY' | 'cropW' | 'cropH'> {
  const sa = sourceAspect > 0 ? sourceAspect : 1
  const ta = targetAspect > 0 ? targetAspect : 1
  // 归一化框在「原图坐标系」：dx 对应像素宽 ∝ cropW * sa，高 ∝ cropH
  // 像素宽高比 = (cropW * sa) / cropH = ta → cropW/cropH = ta/sa
  const normRatio = ta / sa
  const cx = rect.cropX + rect.cropW / 2
  const cy = rect.cropY + rect.cropH / 2
  let w = rect.cropW
  let h = rect.cropH
  const cur = w / Math.max(MIN_CROP, h)
  if (Math.abs(cur - normRatio) < 0.001) {
    return normalizeCropRect(rect)
  }
  // 以当前面积近似，优先不超出边界
  const area = w * h
  h = Math.sqrt(area / Math.max(MIN_CROP, normRatio))
  w = h * normRatio
  if (w > 1) {
    w = 1
    h = w / normRatio
  }
  if (h > 1) {
    h = 1
    w = h * normRatio
  }
  w = Math.max(MIN_CROP, Math.min(1, w))
  h = Math.max(MIN_CROP, Math.min(1, h))
  const x = cx - w / 2
  const y = cy - h / 2
  return normalizeCropRect({ cropX: x, cropY: y, cropW: w, cropH: h })
}

export function readImageCropFromNode(params: {
  imageCrop?: Partial<ImageCropState>
}): ImageCropState {
  return normalizeImageCrop(params.imageCrop)
}

export function imageCropToNodePatch(state: ImageCropState): {
  imageCrop: ImageCropState
} {
  return { imageCrop: normalizeImageCrop(state) }
}
