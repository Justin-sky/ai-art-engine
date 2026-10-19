/**
 * 图像二进制 Magic Bytes 嗅探与 Data URL MIME 归一化。
 *
 * 背景：
 * 1. 多家上游图像/放大 API（OpenAI 兼容网关、豆包 Seedream、智谱、ModelScope、OpenRouter 等）
 *    在 `b64_json` 或无后缀 CDN URL 中经常返回 JPEG（`FF D8 FF`）或 WebP（`RIFF....WEBP`）字节，
 *    但外层被硬编码包装为 `data:image/png;base64,...` 或 `.png` 文件名。
 * 2. 落盘若仅信任声明的 MIME 或 URL 后缀，会产生「`.png` 扩展名 + `FF D8 FF E0` JPEG 字节」的错位文件；
 *    随后 `task_run` 视觉自检（`readVisualCheckImagesForRelativePaths`）或 `@image` 附件按 `.png` 后缀声明
 *    `image/png` 发送给多模态模型时，会被上游图片格式校验器拦截报错。
 */

export type SniffedImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/bmp'

/**
 * 从前 12 字节嗅探真实光栅图 MIME；无法识别时返回 `null`。
 */
export function sniffImageMimeFromBytes(
  buf: Uint8Array | Buffer | null | undefined
): SniffedImageMime | null {
  if (!buf || buf.length < 3) return null
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg'
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png'
  }
  // GIF: "GIF87a" or "GIF89a"
  if (
    buf.length >= 6 &&
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61
  ) {
    return 'image/gif'
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'image/webp'
  }
  // BMP: "BM"
  if (buf[0] === 0x42 && buf[1] === 0x4d) {
    return 'image/bmp'
  }
  return null
}

/**
 * 从 Base64 载荷头部嗅探真实图像 MIME（无需解码整张大图）。
 */
export function sniffImageMimeFromBase64(b64: string): SniffedImageMime | null {
  const clean = b64
    .trim()
    .replace(/^data:[^,]*,/, '')
    .trimStart()
  if (clean.length < 4) return null
  if (clean.startsWith('/9j/')) return 'image/jpeg'
  if (clean.startsWith('iVBORw0KGgo')) return 'image/png'
  if (clean.startsWith('UklGR')) return 'image/webp'
  if (clean.startsWith('R0lGODdh') || clean.startsWith('R0lGODlh')) return 'image/gif'
  try {
    const head = clean.slice(0, 24)
    const bytes = Buffer.from(head, 'base64')
    return sniffImageMimeFromBytes(bytes)
  } catch {
    return null
  }
}

/**
 * 将模型返回的 `b64_json` 包装为带真实 MIME 的 Data URL（自动识别 JPEG / PNG / WebP / GIF）。
 */
export function b64JsonToImageDataUrl(b64: string, fallbackMime = 'image/png'): string {
  const trimmed = b64.trim()
  if (trimmed.startsWith('data:')) {
    return normalizeImageDataUrlMime(trimmed)
  }
  const mime = sniffImageMimeFromBase64(trimmed) ?? fallbackMime
  return `data:${mime};base64,${trimmed}`
}

/**
 * 修正已组装 Data URL 中声明的 MIME 与实际 Base64 字节不一致的情况。
 */
export function normalizeImageDataUrlMime(dataUrl: string): string {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]+)$/i.exec(dataUrl.trim())
  if (!m || !m[2]) return dataUrl
  const payload = m[3] ?? ''
  const sniffed = sniffImageMimeFromBase64(payload)
  if (!sniffed) return dataUrl
  const declared = (m[1] || '').trim().toLowerCase()
  if (declared === sniffed) return dataUrl
  return `data:${sniffed};base64,${payload}`
}

/**
 * 将图像 MIME 映射为不带点的标准文件扩展名。
 */
export function imageExtFromMime(
  mime: string,
  fallback: 'png' | 'jpg' | 'webp' | 'gif' | 'bmp' = 'png'
): 'png' | 'jpg' | 'webp' | 'gif' | 'bmp' {
  const lower = mime.toLowerCase()
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg'
  if (lower.includes('webp')) return 'webp'
  if (lower.includes('gif')) return 'gif'
  if (lower.includes('bmp')) return 'bmp'
  if (lower.includes('png')) return 'png'
  return fallback
}
