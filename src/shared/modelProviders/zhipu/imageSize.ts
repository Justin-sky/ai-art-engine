/**
 * 智谱 CogView 图片 `size` 参数换算。
 *
 * CogView-4 支持 512-2048 自定义像素宽高，官方也提供一组推荐固定 size。
 * 应用内节点持有 resolution + aspectRatio，这里把宽高比映射到官方推荐值；
 * 显式像素值在 512-2048 范围内原样透传，否则返回 undefined（接口使用默认 1024x1024）。
 */

export const ZHIPU_IMAGE_SIZE_MIN = 512
export const ZHIPU_IMAGE_SIZE_MAX = 2048

/** 宽高比 → CogView 官方推荐 size */
const RATIO_TO_SIZE: Readonly<Record<string, string>> = {
  '1:1': '1024x1024',
  '16:9': '1344x768',
  '9:16': '768x1344',
  '4:3': '1152x864',
  '3:4': '864x1152',
  '3:2': '1344x768',
  '2:3': '768x1344',
  '21:9': '1440x720',
  '9:21': '720x1440'
}

function normalizeRatio(value: string | undefined): string | null {
  const raw = value?.trim().replace(/\s+/g, '')
  if (!raw) return null
  const m = /^(\d+):(\d+)$/.exec(raw)
  if (!m) return null
  const width = Number(m[1])
  const height = Number(m[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  return `${width}:${height}`
}

function normalizeResolution(value: string | undefined): string | null {
  const raw = value?.trim().toLowerCase()
  if (!raw) return null
  const pixel = /^(\d+)\s*[x×*]\s*(\d+)$/.exec(raw)
  if (!pixel) return null
  const width = Number(pixel[1])
  const height = Number(pixel[2])
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < ZHIPU_IMAGE_SIZE_MIN ||
    height < ZHIPU_IMAGE_SIZE_MIN ||
    width > ZHIPU_IMAGE_SIZE_MAX ||
    height > ZHIPU_IMAGE_SIZE_MAX
  ) {
    return null
  }
  return `${width}x${height}`
}

/** 把应用内 resolution + aspectRatio 换算为 CogView size；无法换算时返回 undefined */
export function resolveZhipuImageSize(
  resolution: string | undefined,
  aspectRatio: string | undefined
): string | undefined {
  const pixel = normalizeResolution(resolution)
  if (pixel) return pixel

  const ratio = normalizeRatio(aspectRatio)
  if (ratio) return RATIO_TO_SIZE[ratio]

  return undefined
}
