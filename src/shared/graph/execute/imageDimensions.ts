/**
 * 从 data URL 解析图片宽高：纯函数、零依赖，供质检的客观校验使用。
 *
 * 只解码头部若干字节（PNG/JPEG/WebP 的尺寸信息都在文件头），
 * 避免为取两个数字而解码整张图的 base64。
 * 解析不出尺寸时返回 null，调用方应优雅降级（跳过该项校验），不得据此判定失败。
 */

export interface ImageDimensions {
  width: number
  height: number
}

/** 头部取样长度：768 字节足以覆盖三种格式的尺寸字段 */
const HEAD_BASE64_CHARS = 1024

export function readImageDimensions(dataUrl: string): ImageDimensions | null {
  if (!dataUrl) return null
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return null
  const meta = dataUrl.slice(0, comma)
  const payload = dataUrl.slice(comma + 1)
  if (!/;\s*base64/i.test(meta)) return null

  const head = base64HeadBytes(payload, HEAD_BASE64_CHARS)
  if (head.length < 16) return null

  if (/^data:image\/png/i.test(meta) || isPng(head)) return pngSize(head)
  if (/^data:image\/jpe?g/i.test(meta) || isJpeg(head)) return jpegSize(head)
  if (/^data:image\/webp/i.test(meta) || isWebp(head)) return webpSize(head)
  return pngSize(head) ?? jpegSize(head) ?? webpSize(head)
}

function base64HeadBytes(payload: string, chars: number): Uint8Array {
  const clean = payload.replace(/\s+/g, '').slice(0, chars)
  const length = clean.length - (clean.length % 4)
  if (length < 8) return new Uint8Array(0)
  try {
    const binary = atob(clean.slice(0, length))
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  } catch {
    return new Uint8Array(0)
  }
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  )
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i] ?? 0)
  return out
}

function isPng(b: Uint8Array): boolean {
  return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
}

function isJpeg(b: Uint8Array): boolean {
  return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
}

function isWebp(b: Uint8Array): boolean {
  return ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP'
}

/** PNG：签名(8) + 长度(4) + "IHDR"(4) 之后即宽高，各 4 字节大端 */
function pngSize(b: Uint8Array): ImageDimensions | null {
  if (b.length < 24) return null
  if (ascii(b, 12, 4) !== 'IHDR') return null
  const width = readUInt32BE(b, 16)
  const height = readUInt32BE(b, 20)
  return width > 0 && height > 0 ? { width, height } : null
}

/** JPEG：逐个跳过标记段，直到 SOFn（C0~CF，排除 DHT/JPG/DAC） */
function jpegSize(b: Uint8Array): ImageDimensions | null {
  if (!isJpeg(b)) return null
  let offset = 2
  while (offset + 9 < b.length) {
    if (b[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = b[offset + 1]!
    if (marker === 0xff) {
      offset += 1
      continue
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) return null
    const length = (b[offset + 2]! << 8) | b[offset + 3]!
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isStartOfFrame) {
      const height = (b[offset + 5]! << 8) | b[offset + 6]!
      const width = (b[offset + 7]! << 8) | b[offset + 8]!
      return width > 0 && height > 0 ? { width, height } : null
    }
    if (length < 2) return null
    offset += 2 + length
  }
  return null
}

/** WebP：VP8X（扩展）/ VP8L（无损）/ VP8（有损）三种块头 */
function webpSize(b: Uint8Array): ImageDimensions | null {
  if (!isWebp(b)) return null
  const fourCC = ascii(b, 12, 4)

  if (fourCC === 'VP8X' && b.length >= 30) {
    const width = (b[24]! | (b[25]! << 8) | (b[26]! << 16)) + 1
    const height = (b[27]! | (b[28]! << 8) | (b[29]! << 16)) + 1
    return width > 0 && height > 0 ? { width, height } : null
  }

  if (fourCC === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24)
    const width = (bits & 0x3fff) + 1
    const height = ((bits >> 14) & 0x3fff) + 1
    return width > 0 && height > 0 ? { width, height } : null
  }

  if (fourCC === 'VP8 ') {
    for (let i = 20; i + 6 < b.length; i++) {
      if (b[i] === 0x9d && b[i + 1] === 0x01 && b[i + 2] === 0x2a) {
        const width = ((b[i + 4]! << 8) | b[i + 3]!) & 0x3fff
        const height = ((b[i + 6]! << 8) | b[i + 5]!) & 0x3fff
        return width > 0 && height > 0 ? { width, height } : null
      }
    }
  }

  return null
}

/** 由宽高推导出 "16:9" 形式的宽高比描述，供客观校验比对 */
export function describeAspectRatio(dimensions: ImageDimensions): string {
  const { width, height } = dimensions
  if (!width || !height) return ''
  const divisor = gcd(width, height)
  return `${width / divisor}:${height / divisor}`
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}
