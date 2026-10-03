/**
 * 参考图（送往模型 API 的输入图）体积预算。
 *
 * 为什么要压：参考图在调用前会被转成 data URL / multipart 里的原始字节，上游与中转网关
 * 普遍对单图有 **10MB 量级**的限制（base64 内联时还要再膨胀 4/3）；相机原图动辄 15~25MB，
 * 于是被上游按「file / parameters do not meet the requirements」这类文案直接拒掉，
 * 用户看到的就是一句与图片大小无关的模糊报错。
 *
 * 这里只放**纯策略**（是否需要压、压到多大、用什么格式），实际解码/编码在
 * `src/main/services/referenceImageService.ts`（依赖 Electron nativeImage）。
 */

/** 超过这个体积才动手（小图不白白解码一遍） */
export const REFERENCE_IMAGE_TRIGGER_BYTES = 6 * 1024 * 1024
/** 压缩目标体积：留出 base64 膨胀与网关限额的余量 */
export const REFERENCE_IMAGE_TARGET_BYTES = 4 * 1024 * 1024
/** 压缩后长边上限（保留足够细节供图生图使用） */
export const REFERENCE_IMAGE_MAX_EDGE = 4096

export interface ReferenceImageAttempt {
  width: number
  height: number
  format: 'png' | 'jpeg'
  /** JPEG 质量；PNG 忽略 */
  quality: number
}

/** 人读体积，用于日志与提示：19.5MB / 812.3KB / 640B */
export function formatBytesHuman(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0B'
  if (bytes < 1024) return `${Math.round(bytes)}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

/** 是否需要压缩：只看体积（尺寸判断要解码，代价高，不值得为小图付） */
export function needsReferenceImageShrink(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes > REFERENCE_IMAGE_TRIGGER_BYTES
}

/** 等比缩放到长边不超过 maxEdge；永不放大 */
export function fitWithinMaxEdge(
  width: number,
  height: number,
  maxEdge: number
): { width: number; height: number } {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const longest = Math.max(w, h)
  if (longest <= maxEdge) return { width: w, height: h }
  const scale = maxEdge / longest
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

/** 首选编码格式：可能带透明的 PNG / WebP 保格式（JPEG 会把透明压成黑底），其余走 JPEG */
export function preferredReferenceImageFormat(mime: string): 'png' | 'jpeg' {
  return /image\/(png|webp|gif|avif)/i.test(mime) ? 'png' : 'jpeg'
}

/**
 * 编码尝试梯度：先保原格式（只重编码），再逐级降边长与质量，最后退到 JPEG。
 * 调用方从前往后试，取第一个满足目标体积的结果；全都不满足时取最小的那个。
 */
export function referenceImageAttempts(info: {
  width: number
  height: number
  mime: string
}): ReferenceImageAttempt[] {
  const preferred = preferredReferenceImageFormat(info.mime)
  const ladder: ReferenceImageAttempt[] = [
    {
      ...fitWithinMaxEdge(info.width, info.height, REFERENCE_IMAGE_MAX_EDGE),
      format: preferred,
      quality: 88
    },
    { ...fitWithinMaxEdge(info.width, info.height, 2560), format: preferred, quality: 84 },
    { ...fitWithinMaxEdge(info.width, info.height, 2048), format: 'jpeg', quality: 80 },
    { ...fitWithinMaxEdge(info.width, info.height, 1536), format: 'jpeg', quality: 78 }
  ]
  const seen = new Set<string>()
  return ladder.filter((attempt) => {
    const key = `${attempt.width}x${attempt.height}:${attempt.format}:${attempt.quality}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
