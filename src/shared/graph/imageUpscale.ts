/**
 * 高清放大：子模型 / 倍数 → 执行参数（走图片模型超分）。
 */

export type UpscaleVariantId = 'general' | 'portrait' | 'landscape'
export type UpscaleScale = 2 | 4 | 6

export interface ImageUpscaleState {
  /** 历史字段；执行路径一律走图片模型 */
  engineId?: 'imageApi'
  variantId: UpscaleVariantId
  scale: UpscaleScale
}

export interface UpscaleVariantDef {
  id: UpscaleVariantId
  titleKey: string
}

export const UPSCALE_VARIANTS: readonly UpscaleVariantDef[] = [
  { id: 'general', titleKey: 'general' },
  { id: 'portrait', titleKey: 'portrait' },
  { id: 'landscape', titleKey: 'landscape' }
] as const

export const UPSCALE_SCALES: readonly UpscaleScale[] = [2, 4, 6] as const

export const DEFAULT_IMAGE_UPSCALE: ImageUpscaleState = {
  engineId: 'imageApi',
  variantId: 'general',
  scale: 2
}

export function normalizeUpscaleScale(value: unknown): UpscaleScale {
  const n = Number(value)
  if (n === 4 || n === 6 || n === 2) return n
  return 2
}

export function normalizeImageUpscale(
  raw?: Partial<ImageUpscaleState> | null
): ImageUpscaleState {
  const base = { ...DEFAULT_IMAGE_UPSCALE, ...(raw ?? {}) }
  const variantId = UPSCALE_VARIANTS.some((v) => v.id === base.variantId)
    ? base.variantId
    : DEFAULT_IMAGE_UPSCALE.variantId
  return {
    engineId: 'imageApi',
    variantId,
    scale: normalizeUpscaleScale(base.scale)
  }
}

/** 倍数映射到图片生成分辨率档 */
export function upscaleScaleToResolution(scale: UpscaleScale): string {
  if (scale >= 6) return '4K'
  if (scale >= 4) return '4K'
  return '2K'
}

function variantPrompt(variant: UpscaleVariantId): string {
  switch (variant) {
    case 'portrait':
      return 'portrait photo upscale, preserve facial details and skin texture'
    case 'landscape':
      return 'landscape photo upscale, preserve distant detail and natural edges'
    default:
      return 'general purpose image upscale, preserve sharpness and natural detail'
  }
}

/** 构造超分提示词（作为参考图 img2img / 图片模型输入）。 */
export function buildUpscalePrompt(state: ImageUpscaleState): string {
  const s = normalizeImageUpscale(state)
  return [
    `Upscale the input image by ${s.scale}x`,
    'AI image upscaling',
    variantPrompt(s.variantId),
    'keep composition, colors and identity unchanged',
    'no cropping, no restyling, no added objects'
  ].join(', ')
}

export function readImageUpscaleFromNode(params: {
  imageUpscale?: Partial<ImageUpscaleState>
}): ImageUpscaleState {
  return normalizeImageUpscale(params.imageUpscale)
}

export function imageUpscaleToNodePatch(state: ImageUpscaleState): {
  imageUpscale: ImageUpscaleState
} {
  return { imageUpscale: normalizeImageUpscale(state) }
}
