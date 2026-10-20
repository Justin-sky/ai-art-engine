import { normalizeGraph } from './normalize'
import type { GraphDocument } from './types'

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
export const AIAE_PNG_WORKFLOW_KEYWORD = 'aiae:graph'

/** 标准 CRC32 查找表（用于构造合法 PNG tEXt chunk） */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function writeUint32BE(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff
  target[offset + 1] = (value >>> 16) & 0xff
  target[offset + 2] = (value >>> 8) & 0xff
  target[offset + 3] = value & 0xff
}

function readUint32BE(source: Uint8Array, offset: number): number {
  return (
    ((source[offset]! << 24) |
      (source[offset + 1]! << 16) |
      (source[offset + 2]! << 8) |
      source[offset + 3]!) >>>
    0
  )
}

function isPngSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false
  }
  return true
}

function utf8ToBase64(text: string): string {
  const utf8 = new TextEncoder().encode(text)
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(utf8).toString('base64')
  }
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < utf8.length; i += chunk) {
    binary += String.fromCharCode(...utf8.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function base64ToUtf8(b64: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(b64, 'base64').toString('utf8')
  }
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}

/**
 * 清理大体积内联 DataURL（保留节点拓扑、参数与提示词），防止隐写块撑大 PNG 文件体积。
 */
export function slimGraphForPngEmbed(graph: GraphDocument): GraphDocument {
  const cloned = JSON.parse(JSON.stringify(graph)) as GraphDocument
  for (const node of cloned.nodes ?? []) {
    if (!node.params) continue
    if (node.params.previewDataUrl?.startsWith('data:')) {
      delete node.params.previewDataUrl
    }
    if (Array.isArray(node.params.generatedImages)) {
      node.params.generatedImages = node.params.generatedImages.map((item) => ({
        ...item,
        dataUrl: item.dataUrl?.startsWith('data:') ? '' : item.dataUrl
      }))
    }
  }
  return cloned
}

/**
 * 将 `GraphDocument` 无损嵌入到 PNG 字节流的 `IEND` 块之前（使用标准 `tEXt` chunk，关键字 `aiae:graph`）。
 * 任何人在 AI Art Engine 画布中拖入该 PNG，即可 100% 还原整条节点图与提示词配方。
 */
export function embedGraphInPngBytes(pngBytes: Uint8Array, graph: GraphDocument): Uint8Array {
  if (!isPngSignature(pngBytes)) {
    throw new Error('INVALID_PNG_BYTES')
  }
  const slimmed = slimGraphForPngEmbed(graph)
  const payloadB64 = utf8ToBase64(JSON.stringify(slimmed))
  const keywordBytes = new TextEncoder().encode(AIAE_PNG_WORKFLOW_KEYWORD)
  const textBytes = new TextEncoder().encode(payloadB64)

  // tEXt data = keyword + 0x00 + text
  const chunkData = new Uint8Array(keywordBytes.length + 1 + textBytes.length)
  chunkData.set(keywordBytes, 0)
  chunkData[keywordBytes.length] = 0
  chunkData.set(textBytes, keywordBytes.length + 1)

  const typeBytes = new Uint8Array([0x74, 0x45, 0x58, 0x74]) // 'tEXt'
  const crcInput = new Uint8Array(4 + chunkData.length)
  crcInput.set(typeBytes, 0)
  crcInput.set(chunkData, 4)
  const crc = crc32(crcInput)

  const fullChunk = new Uint8Array(4 + 4 + chunkData.length + 4)
  writeUint32BE(fullChunk, 0, chunkData.length)
  fullChunk.set(typeBytes, 4)
  fullChunk.set(chunkData, 8)
  writeUint32BE(fullChunk, 8 + chunkData.length, crc)

  // 查找 IEND chunk 起始偏移并插入在 IEND 之前（同时剔除旧的同名 aiae:graph chunk）
  const keptChunks: Uint8Array[] = [pngBytes.subarray(0, 8)]
  let offset = 8
  let inserted = false
  while (offset + 8 <= pngBytes.length) {
    const len = readUint32BE(pngBytes, offset)
    const chunkEnd = offset + 12 + len
    if (chunkEnd > pngBytes.length) break
    const type = String.fromCharCode(
      pngBytes[offset + 4]!,
      pngBytes[offset + 5]!,
      pngBytes[offset + 6]!,
      pngBytes[offset + 7]!
    )
    if (type === 'tEXt') {
      const dataStart = offset + 8
      const dataSlice = pngBytes.subarray(dataStart, dataStart + len)
      const nullIdx = dataSlice.indexOf(0)
      if (nullIdx > 0) {
        const key = new TextDecoder().decode(dataSlice.subarray(0, nullIdx))
        if (key === AIAE_PNG_WORKFLOW_KEYWORD) {
          offset = chunkEnd
          continue
        }
      }
    }
    if (type === 'IEND' && !inserted) {
      keptChunks.push(fullChunk)
      inserted = true
    }
    keptChunks.push(pngBytes.subarray(offset, chunkEnd))
    offset = chunkEnd
  }
  if (!inserted) {
    keptChunks.push(fullChunk)
  }

  const totalLength = keptChunks.reduce((acc, part) => acc + part.length, 0)
  const result = new Uint8Array(totalLength)
  let writePos = 0
  for (const part of keptChunks) {
    result.set(part, writePos)
    writePos += part.length
  }
  return result
}

/**
 * 从 PNG 字节流中解析 `aiae:graph` 工作流 `tEXt` 块；若不包含隐写节点图则返回 `null`。
 */
export function extractGraphFromPngBytes(pngBytes: Uint8Array): GraphDocument | null {
  if (!isPngSignature(pngBytes)) return null
  let offset = 8
  while (offset + 8 <= pngBytes.length) {
    const len = readUint32BE(pngBytes, offset)
    const chunkEnd = offset + 12 + len
    if (chunkEnd > pngBytes.length) break
    const type = String.fromCharCode(
      pngBytes[offset + 4]!,
      pngBytes[offset + 5]!,
      pngBytes[offset + 6]!,
      pngBytes[offset + 7]!
    )
    if (type === 'tEXt') {
      const dataStart = offset + 8
      const dataSlice = pngBytes.subarray(dataStart, dataStart + len)
      const nullIdx = dataSlice.indexOf(0)
      if (nullIdx > 0) {
        const key = new TextDecoder().decode(dataSlice.subarray(0, nullIdx))
        if (key === AIAE_PNG_WORKFLOW_KEYWORD) {
          try {
            const payloadB64 = new TextDecoder().decode(dataSlice.subarray(nullIdx + 1))
            const jsonText = base64ToUtf8(payloadB64.trim())
            const parsed = JSON.parse(jsonText) as GraphDocument
            if (parsed && Array.isArray(parsed.nodes)) {
              return normalizeGraph(parsed)
            }
          } catch {
            return null
          }
        }
      }
    }
    if (type === 'IEND') break
    offset = chunkEnd
  }
  return null
}

/**
 * 将 `GraphDocument` 直接隐写进 `data:image/png;base64,...` DataURL。
 */
export function embedGraphInPngDataUrl(pngDataUrl: string, graph: GraphDocument): string {
  const prefix = 'data:image/png;base64,'
  if (!pngDataUrl.startsWith(prefix)) return pngDataUrl
  const b64 = pngDataUrl.slice(prefix.length)
  let bytes: Uint8Array
  if (typeof Buffer !== 'undefined') {
    bytes = new Uint8Array(Buffer.from(b64, 'base64'))
  } else {
    const bin = atob(b64)
    bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  }
  const embedded = embedGraphInPngBytes(bytes, graph)
  if (typeof Buffer !== 'undefined') {
    return `${prefix}${Buffer.from(embedded).toString('base64')}`
  }
  let outBin = ''
  const chunk = 0x8000
  for (let i = 0; i < embedded.length; i += chunk) {
    outBin += String.fromCharCode(...embedded.subarray(i, i + chunk))
  }
  return `${prefix}${btoa(outBin)}`
}

// ── 像素级隐形数字盲水印（Invisible Pixel Steganography, PSNR > 48dB） ──

const PIXEL_WATERMARK_MAGIC = new Uint8Array([0x41, 0x49, 0x41, 0x45]) // 'AIAE'

export interface PixelWatermarkPayload {
  schema: 'aiae.pixel-watermark.v1'
  author?: string
  workflowHash?: string
  nodeType?: string
  recipeSummary?: string
  timestamp?: number
  extra?: Record<string, unknown>
}

/**
 * 将版权溯源信息或精修配方以人眼零感知（PSNR > 50dB）的方式隐写进 RGBA 像素最低有效位（LSB），
 * 即使 PNG `tEXt` 元数据块被剥离，依然可以从像素中盲检还原。
 */
export function embedInvisiblePixelWatermarkRgba(
  pixels: Uint8ClampedArray,
  payload: PixelWatermarkPayload | string
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels)
  const rawText = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const utf8 = new TextEncoder().encode(rawText)
  if (utf8.length === 0 || utf8.length > 32767) {
    return out
  }

  const crc = crc32(utf8)
  const packet = new Uint8Array(10 + utf8.length)
  packet.set(PIXEL_WATERMARK_MAGIC, 0)
  packet[4] = (utf8.length >>> 8) & 0xff
  packet[5] = utf8.length & 0xff
  writeUint32BE(packet, 6, crc)
  packet.set(utf8, 10)

  const totalBits = packet.length * 8
  const maxAvailableChannels = Math.floor(out.length / 4) * 3
  if (totalBits > maxAvailableChannels) {
    return out
  }

  let bitIdx = 0
  for (let p = 0; p < out.length && bitIdx < totalBits; p += 4) {
    for (let c = 0; c < 3 && bitIdx < totalBits; c++) {
      const bytePos = bitIdx >>> 3
      const bitShift = 7 - (bitIdx & 7)
      const bit = (packet[bytePos]! >>> bitShift) & 1
      out[p + c] = (out[p + c]! & 0xfe) | bit
      bitIdx++
    }
  }

  return out
}

/**
 * 从 RGBA 像素缓冲区中盲检并提取隐形数字水印与配方基因锁（自动校验 `AIAE` 魔数与 CRC32）
 */
export function extractInvisiblePixelWatermarkRgba(pixels: Uint8ClampedArray): {
  valid: boolean
  rawText: string
  payload: PixelWatermarkPayload | null
  crc32Hex: string
} {
  const empty = { valid: false, rawText: '', payload: null, crc32Hex: '' }
  const totalPixels = Math.floor(pixels.length / 4)
  if (totalPixels * 3 < 80) return empty

  const readBytes = (byteCount: number): Uint8Array => {
    const buf = new Uint8Array(byteCount)
    const totalBits = byteCount * 8
    let bitIdx = 0
    for (let p = 0; p < pixels.length && bitIdx < totalBits; p += 4) {
      for (let c = 0; c < 3 && bitIdx < totalBits; c++) {
        const bit = pixels[p + c]! & 1
        const bytePos = bitIdx >>> 3
        const bitShift = 7 - (bitIdx & 7)
        buf[bytePos] = (buf[bytePos]! | (bit << bitShift)) & 0xff
        bitIdx++
      }
    }
    return buf
  }

  const header = readBytes(10)
  for (let i = 0; i < 4; i++) {
    if (header[i] !== PIXEL_WATERMARK_MAGIC[i]) return empty
  }

  const payloadLen = ((header[4]! << 8) | header[5]!) >>> 0
  if (payloadLen === 0 || payloadLen > 32767) return empty
  if ((10 + payloadLen) * 8 > totalPixels * 3) return empty

  const expectedCrc = readUint32BE(header, 6)
  const fullPacket = readBytes(10 + payloadLen)
  const payloadBytes = fullPacket.subarray(10, 10 + payloadLen)
  const actualCrc = crc32(payloadBytes)
  if (actualCrc !== expectedCrc) return empty

  const rawText = new TextDecoder().decode(payloadBytes)
  let parsedPayload: PixelWatermarkPayload | null = null
  try {
    const obj = JSON.parse(rawText)
    if (obj && typeof obj === 'object') {
      parsedPayload = obj as PixelWatermarkPayload
    }
  } catch {
    // Allow plain text watermark as well
  }

  return {
    valid: true,
    rawText,
    payload: parsedPayload,
    crc32Hex: expectedCrc.toString(16).padStart(8, '0')
  }
}

/**
 * 计算隐写水印前后的峰值信噪比（PSNR, 单位 dB；完全相同时返回 99.9）
 */
export function computeWatermarkPsnrDb(
  original: Uint8ClampedArray,
  watermarked: Uint8ClampedArray
): number {
  const len = Math.min(original.length, watermarked.length)
  if (len < 4) return 99.9
  let sumSqErr = 0
  let count = 0
  for (let i = 0; i < len; i += 4) {
    for (let c = 0; c < 3; c++) {
      const diff = (original[i + c] ?? 0) - (watermarked[i + c] ?? 0)
      sumSqErr += diff * diff
      count++
    }
  }
  if (sumSqErr === 0 || count === 0) return 99.9
  const mse = sumSqErr / count
  return Number((10 * Math.log10((255 * 255) / mse)).toFixed(2))
}
