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

export type SniffedImageMime =
  'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/bmp' | 'image/svg+xml'

/**
 * 从前 12 字节嗅探真实光栅图 MIME；无法识别时返回 `null`。
 */
export function sniffImageMimeFromBytes(
  buf: Uint8Array | Buffer | null | undefined
): SniffedImageMime | null {
  if (!buf || buf.length < 3) return null
  // SVG: "<svg" or "<?xml"
  if (buf.length >= 4) {
    const textStart = Buffer.from(buf.slice(0, 128)).toString('utf8').trimStart().toLowerCase()
    if (textStart.startsWith('<svg') || textStart.startsWith('<?xml')) {
      return 'image/svg+xml'
    }
  }
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
  if (
    clean.startsWith('PHN2Zw') ||
    clean.startsWith('PHN2Zy') ||
    clean.startsWith('PD94bW') ||
    clean.startsWith('PD9YTU')
  ) {
    return 'image/svg+xml'
  }
  if (clean.startsWith('/9j/')) return 'image/jpeg'
  if (clean.startsWith('iVBORw0KGgo')) return 'image/png'
  if (clean.startsWith('UklGR')) return 'image/webp'
  if (clean.startsWith('R0lGODdh') || clean.startsWith('R0lGODlh')) return 'image/gif'
  try {
    const head = clean.slice(0, 48)
    const bytes = Buffer.from(head, 'base64')
    return sniffImageMimeFromBytes(bytes)
  } catch {
    return null
  }
}

/**
 * 将模型返回的 `b64_json` 包装为带真实 MIME 的 Data URL（自动识别 JPEG / PNG / WebP / GIF / SVG）。
 */
export function b64JsonToImageDataUrl(b64: string, fallbackMime = 'image/png'): string {
  const trimmed = b64.trim()
  if (trimmed.startsWith('data:')) {
    return normalizeImageDataUrlMime(trimmed)
  }
  if (trimmed.startsWith('<svg') || trimmed.startsWith('<?xml')) {
    const encoded = Buffer.from(trimmed, 'utf8').toString('base64')
    return `data:image/svg+xml;base64,${encoded}`
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
  if (payload.startsWith('<svg') || payload.startsWith('<?xml')) {
    const encoded = Buffer.from(payload, 'utf8').toString('base64')
    return `data:image/svg+xml;base64,${encoded}`
  }
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
  fallback: 'png' | 'jpg' | 'webp' | 'gif' | 'bmp' | 'svg' = 'png'
): 'png' | 'jpg' | 'webp' | 'gif' | 'bmp' | 'svg' {
  const lower = mime.toLowerCase()
  if (lower.includes('svg')) return 'svg'
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg'
  if (lower.includes('webp')) return 'webp'
  if (lower.includes('gif')) return 'gif'
  if (lower.includes('bmp')) return 'bmp'
  if (lower.includes('png')) return 'png'
  return fallback
}

function decodeBase64Prefix(b64: string, maxChars: number): Uint8Array | null {
  const clean = b64
    .trim()
    .replace(/^data:[^,]*,/, '')
    .replace(/\s+/g, '')
  if (clean.length < 16) return null
  const sliceLen = Math.min(clean.length, maxChars) - (Math.min(clean.length, maxChars) % 4)
  if (sliceLen < 4) return null
  const sub = clean.slice(0, sliceLen)
  try {
    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(sub, 'base64'))
    }
    if (typeof atob === 'function') {
      const bin = atob(sub)
      const out = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
      return out
    }
  } catch {
    return null
  }
  return null
}

/**
 * 从光栅图像头部字节快速解析像素宽高（支持 PNG / WebP / GIF / JPEG）。
 */
export function sniffImageDimensionsFromBytes(
  buf: Uint8Array | Buffer | null | undefined
): { width: number; height: number } | null {
  if (!buf || buf.length < 10) return null
  // PNG: IHDR at bytes 16..23
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    const width = ((buf[16]! << 24) | (buf[17]! << 16) | (buf[18]! << 8) | buf[19]!) >>> 0
    const height = ((buf[20]! << 24) | (buf[21]! << 16) | (buf[22]! << 8) | buf[23]!) >>> 0
    if (width > 0 && height > 0) return { width, height }
    return null
  }
  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    const width = buf[6]! | (buf[7]! << 8)
    const height = buf[8]! | (buf[9]! << 8)
    if (width > 0 && height > 0) return { width, height }
    return null
  }
  // WebP: RIFF....WEBP
  if (
    buf.length >= 30 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    const c0 = buf[12]
    const c1 = buf[13]
    const c2 = buf[14]
    const c3 = buf[15]
    // VP8 (lossy)
    if (c0 === 0x56 && c1 === 0x50 && c2 === 0x38 && c3 === 0x20) {
      const width = (buf[26]! | (buf[27]! << 8)) & 0x3fff
      const height = (buf[28]! | (buf[29]! << 8)) & 0x3fff
      if (width > 0 && height > 0) return { width, height }
    }
    // VP8L (lossless)
    if (c0 === 0x56 && c1 === 0x50 && c2 === 0x38 && c3 === 0x4c) {
      const b0 = buf[21]!
      const b1 = buf[22]!
      const b2 = buf[23]!
      const b3 = buf[24]!
      const width = 1 + (((b1 & 0x3f) << 8) | b0)
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
      if (width > 0 && height > 0) return { width, height }
    }
    // VP8X (extended)
    if (c0 === 0x56 && c1 === 0x50 && c2 === 0x38 && c3 === 0x58) {
      const width = 1 + (buf[24]! | (buf[25]! << 8) | (buf[26]! << 16))
      const height = 1 + (buf[27]! | (buf[28]! << 8) | (buf[29]! << 16))
      if (width > 0 && height > 0) return { width, height }
    }
    return null
  }
  // JPEG: scan markers for SOF0..SOF3 / SOF5..SOF7 / SOF9..SOF11 / SOF13..SOF15
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2
    while (offset + 8 < buf.length) {
      if (buf[offset] !== 0xff) {
        offset += 1
        continue
      }
      while (offset < buf.length && buf[offset] === 0xff) offset += 1
      if (offset >= buf.length) break
      const marker = buf[offset]!
      offset += 1
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (offset + 1 >= buf.length) break
      const segLen = (buf[offset]! << 8) | buf[offset + 1]!
      if (segLen < 2) break
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      if (isSof && offset + 6 < buf.length) {
        const height = (buf[offset + 3]! << 8) | buf[offset + 4]!
        const width = (buf[offset + 5]! << 8) | buf[offset + 6]!
        if (width > 0 && height > 0) return { width, height }
        return null
      }
      offset += segLen
    }
  }
  return null
}

/**
 * 从 Base64 或 Data URL 头部快速解析像素宽高（无需解码整张大图）。
 */
export function sniffImageDimensionsFromBase64(
  b64OrDataUrl: string | null | undefined
): { width: number; height: number } | null {
  if (!b64OrDataUrl) return null
  const head = decodeBase64Prefix(b64OrDataUrl, 128)
  if (!head) return null
  const fast = sniffImageDimensionsFromBytes(head)
  if (fast) return fast
  if (head[0] === 0xff && head[1] === 0xd8) {
    const jpegHead = decodeBase64Prefix(b64OrDataUrl, 65536)
    return sniffImageDimensionsFromBytes(jpegHead)
  }
  return null
}
