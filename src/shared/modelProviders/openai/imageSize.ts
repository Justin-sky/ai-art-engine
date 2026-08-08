/**
 * OpenAI gpt-image 系列 `size` 参数换算。
 *
 * OpenAI /images/generations 与 /images/edits 只接受固定 size：
 * 1024x1024（方图）、1536x1024（横图）、1024x1536（竖图）或 auto。
 * 应用内节点同时持有 resolution + aspectRatio，这里把两者映射到最近的官方 size；
 * 无法映射时返回 undefined（不传 size，接口默认 auto）。
 */

export const OPENAI_IMAGE_SIZES: ReadonlySet<string> = new Set([
  '1024x1024',
  '1536x1024',
  '1024x1536'
])

/** 宽高比 → 最近的官方固定 size */
const RATIO_TO_SIZE: Readonly<Record<string, string>> = {
  '1:1': '1024x1024',
  '16:9': '1536x1024',
  '9:16': '1024x1536',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
  '4:3': '1536x1024',
  '3:4': '1024x1536'
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
  if (pixel) {
    const width = Number(pixel[1])
    const height = Number(pixel[2])
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      const size = `${width}x${height}`
      return OPENAI_IMAGE_SIZES.has(size) ? size : 'auto'
    }
  }
  return null
}

/** 把应用内 resolution + aspectRatio 换算为 OpenAI size；无法换算时返回 undefined */
export function resolveOpenAiImageSize(
  resolution: string | undefined,
  aspectRatio: string | undefined
): string | undefined {
  const pixel = normalizeResolution(resolution)
  if (pixel) return pixel === 'auto' ? undefined : pixel

  const ratio = normalizeRatio(aspectRatio)
  if (ratio) return RATIO_TO_SIZE[ratio]

  return undefined
}
