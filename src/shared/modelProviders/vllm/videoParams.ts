/**
 * vLLM-Omni `/v1/videos` 参数换算（multipart/form-data）。
 * 请求接受 width/height（整数）与 seconds；这里把应用内的
 * resolution + aspectRatio 换算成宽高，把 duration 换算成秒。
 */

export interface VllmVideoSize {
  width: number
  height: number
}

const TIER_BASE = 720

const TIER_HEIGHTS: Readonly<Record<string, number>> = {
  '480P': 480,
  '720P': 720,
  '1080P': 1080
}

function normalizeRatio(value: string | undefined): [number, number] | null {
  const raw = value?.trim().replace(/\s+/g, '')
  if (!raw) return null
  const m = /^(\d+):(\d+)$/.exec(raw)
  if (!m) return null
  const width = Number(m[1])
  const height = Number(m[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  return [width, height]
}

function normalizeResolution(value: string | undefined): string | null {
  const raw = value?.trim().toLowerCase()
  if (!raw) return null
  const pixel = /^(\d+)\s*[x×*]\s*(\d+)$/.exec(raw)
  if (pixel) {
    const width = Number(pixel[1])
    const height = Number(pixel[2])
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return `${width}x${height}`
    }
  }
  return raw.toUpperCase()
}

function snapEven(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

function sizeFromRatio(ratio: [number, number], base: number): VllmVideoSize {
  const [rw, rh] = ratio
  if (rw >= rh) {
    return { width: snapEven((base * rw) / rh), height: base }
  }
  return { width: base, height: snapEven((base * rh) / rw) }
}

/** 把应用内 resolution + aspectRatio 换算为 vLLM-Omni width/height；无法换算时返回 null */
export function resolveVllmVideoSize(
  resolution: string | undefined,
  aspectRatio: string | undefined
): VllmVideoSize | null {
  const res = normalizeResolution(resolution)
  if (res && /^\d+x\d+$/.test(res)) {
    const [width, height] = res.split('x').map(Number) as [number, number]
    if (width > 0 && height > 0) return { width, height }
  }

  const ratio = normalizeRatio(aspectRatio)
  if (ratio) {
    const base = res ? TIER_HEIGHTS[res] : undefined
    return sizeFromRatio(ratio, base ?? TIER_BASE)
  }

  if (res && TIER_HEIGHTS[res]) {
    return sizeFromRatio([16, 9], TIER_HEIGHTS[res])
  }
  return null
}

/** duration（秒）→ vLLM-Omni `seconds` 字符串 */
export function resolveVllmVideoDuration(duration: number | undefined): string | undefined {
  if (duration == null || !Number.isFinite(duration) || duration <= 0) return undefined
  return String(Math.max(1, Math.round(duration)))
}
