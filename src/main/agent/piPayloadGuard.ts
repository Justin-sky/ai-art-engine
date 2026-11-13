import { nativeImage } from 'electron'
import { extname } from 'node:path'
import type { ImageContent, TextContent } from '@earendil-works/pi-ai'

/** 单条工具返回文本默认安全上限（约 ~140 KB，杜绝单次工具撑爆 8 MB 请求体） */
export const SINGLE_TOOL_TEXT_MAX_CHARS = 140_000

/** 视觉自检/读取图片免缩放直通阈值（<= 380 KB 原样保留） */
export const VISION_PASSTHROUGH_MAX_BYTES = 380 * 1024

/** 单张发往大模型的视觉图片最大允许原始字节数（无法缩放时的硬上限 1.2 MB = ~1.6 MB base64） */
export const VISION_HARD_MAX_RAW_BYTES = 1_200 * 1024

/** 单次工具结果最多附带图片张数 */
export const MAX_IMAGES_PER_TOOL_RESULT = 4

const PLAIN_TEXT_EXTENSIONS = new Set([
  '.md',
  '.mdx',
  '.markdown',
  '.txt',
  '.text',
  '.log',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.env',
  '.csv',
  '.tsv',
  '.xml',
  '.svg',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.less',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.vue',
  '.py',
  '.sh',
  '.ps1',
  '.bat',
  '.cmd',
  '.cs',
  '.gd',
  '.tscn',
  '.tres',
  '.lua',
  '.shader',
  '.glsl',
  '.wgsl',
  '.hlsl',
  '.sql',
  '.srt',
  '.vtt',
  '.lrc'
])

/**
 * 判断路径后缀是否属于可按 UTF-8 文本安全挂载的纯文本扩展名。
 * 显式排除 `.png` / `.webp` / `.jpg` / `.mp4` / `.mp3` / `.glb` 等媒体二进制文件，
 * 根除 `graph_read` 将图片预览路径误当成文本读出数 MB 二进制乱码的问题。
 */
export function isSafePlainTextFilePath(filePath: string): boolean {
  const ext = extname(String(filePath ?? '').trim()).toLowerCase()
  return Boolean(ext) && PLAIN_TEXT_EXTENSIONS.has(ext)
}

/**
 * 检测字节缓冲是否包含常见二进制文件魔数或 NUL 字节，防止无后缀/伪装后缀的二进制文件被当成 UTF-8 文本注入上下文。
 */
export function hasBinarySignatureOrNullBytes(buf: Buffer): boolean {
  if (!buf || buf.byteLength === 0) return false
  if (
    buf.byteLength >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return true // PNG
  }
  if (buf.byteLength >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return true // JPEG
  }
  if (
    buf.byteLength >= 4 &&
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38
  ) {
    return true // GIF
  }
  if (
    buf.byteLength >= 4 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46
  ) {
    return true // RIFF (WebP / WAV / AVI)
  }
  if (
    buf.byteLength >= 4 &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    buf[2] === 0x03 &&
    buf[3] === 0x04
  ) {
    return true // ZIP / APK / DOCX / XLSX
  }
  if (
    buf.byteLength >= 8 &&
    buf[4] === 0x66 &&
    buf[5] === 0x74 &&
    buf[6] === 0x79 &&
    buf[7] === 0x70
  ) {
    return true // MP4 / MOV / HEIC (ftyp)
  }
  if (
    buf.byteLength >= 4 &&
    buf[0] === 0x67 &&
    buf[1] === 0x6c &&
    buf[2] === 0x54 &&
    buf[3] === 0x46
  ) {
    return true // GLB (glTF binary)
  }
  const sampleLen = Math.min(buf.byteLength, 8_192)
  for (let i = 0; i < sampleLen; i += 1) {
    if (buf[i] === 0x00) return true
  }
  return false
}

const INLINE_DATA_URL_RE = /data:([a-zA-Z0-9.+/-]+);base64,([A-Za-z0-9+/=\r\n]{1024,})/g

/**
 * 判断单个字符串值是否是二进制图片/媒体被误按 UTF-8 解码后产生的乱码串（例如 `\uFFFDPNG\r\n...` 或大量 NUL / 替换字符）。
 */
export function looksLikeDecodedBinaryMojibake(value: string): boolean {
  if (!value || value.length < 32) return false
  if (
    /^\uFFFD?PNG\r?\n/.test(value) ||
    value.startsWith('\x89PNG') ||
    (value.startsWith('RIFF') && value.slice(8, 12) === 'WEBP')
  ) {
    return true
  }
  const sampleLen = Math.min(value.length, 4_096)
  let badCount = 0
  let nulCount = 0
  for (let i = 0; i < sampleLen; i += 1) {
    const code = value.charCodeAt(i)
    if (code === 0) {
      nulCount += 1
      badCount += 1
    } else if (code === 0xfffd || (code < 32 && code !== 9 && code !== 10 && code !== 13)) {
      badCount += 1
    }
  }
  return nulCount >= 2 || badCount / sampleLen > 0.08
}

/**
 * 清洗普通文本中的内联超长 `data:<mime>;base64,...` 与二进制乱码块。
 */
export function sanitizeInlineBinaryAndDataUrls(text: string): string {
  if (!text) return ''
  if (looksLikeDecodedBinaryMojibake(text)) {
    return `[检测到二进制媒体数据 (${text.length} 字符)，已自动省略]`
  }
  let cleaned = text
  if (cleaned.includes(';base64,')) {
    cleaned = cleaned.replace(INLINE_DATA_URL_RE, (_full, mime: string, b64: string) => {
      return `[inline data:${mime};base64 omitted (${b64.length} chars)]`
    })
  }
  // 清洗被 JSON.stringify 序列化进文本中的 PNG 二进制乱码字面量（治愈磁盘旧会话中的损坏 toolResult）
  if (
    cleaned.includes('\uFFFDPNG') ||
    cleaned.includes('\\u0000\\u0000\\u0000') ||
    cleaned.includes('\x00\x00')
  ) {
    cleaned = cleaned.replace(/\x00+/g, '')
  }
  return cleaned
}

/**
 * 递归清洗结构化对象（如 `graph_read` 的节点 `params` 或 JSON 形式的大工具输出）：
 * - 剥离误混入的二进制乱码字符串与超长内联 `data:...;base64,...`；
 * - 对超长单字段字符串做头尾保留摘要，保证结构完整且合法可解析。
 */
export function sanitizeStructuredToolValue(
  value: unknown,
  maxStringFieldChars = 24_000,
  depth = 0
): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    if (looksLikeDecodedBinaryMojibake(value)) {
      return `[binary media payload omitted (${value.length} chars)]`
    }
    const noDataUrl = sanitizeInlineBinaryAndDataUrls(value)
    if (noDataUrl.length <= maxStringFieldChars) return noDataUrl
    const head = Math.max(400, Math.floor(maxStringFieldChars * 0.65))
    const tail = Math.max(200, Math.floor(maxStringFieldChars * 0.25))
    const omitted = noDataUrl.length - head - tail
    return `${noDataUrl.slice(0, head)}\n...[字段过长，已省略 ${omitted} 字符]...\n${noDataUrl.slice(-tail)}`
  }
  if (typeof value !== 'object') return value
  if (depth > 12) return '[deep object omitted]'
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeStructuredToolValue(item, maxStringFieldChars, depth + 1))
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = sanitizeStructuredToolValue(v, maxStringFieldChars, depth + 1)
  }
  return out
}

/**
 * 压缩或截断单条工具输出文本，使其永远 <= `maxChars`。
 * 若输入为超大 JSON（如旧会话已持久化的 13 MB `graph_read` JSON），优先按 JSON 结构清洗内部超长/乱码字段，
 * 保留合法 JSON 节点结构；若仍超长再执行安全的头尾截断。
 */
export function capSingleToolText(rawText: string, maxChars = SINGLE_TOOL_TEXT_MAX_CHARS): string {
  if (!rawText) return ''
  const limit = Math.max(1_200, maxChars)
  const hasBinaryArtifact =
    rawText.includes('\uFFFDPNG') ||
    rawText.includes('\\u0000\\u0000') ||
    rawText.includes(';base64,')

  if (rawText.length <= limit && !hasBinaryArtifact) {
    return rawText
  }

  let candidate = rawText
  const trimmedStart = candidate.trimStart()
  if (
    (trimmedStart.startsWith('{') || trimmedStart.startsWith('[')) &&
    (candidate.length > limit || hasBinaryArtifact)
  ) {
    try {
      const parsed = JSON.parse(candidate)
      const perFieldCap = Math.max(1_200, Math.min(18_000, Math.floor(limit / 5)))
      const sanitized = sanitizeStructuredToolValue(parsed, perFieldCap)
      candidate = JSON.stringify(sanitized)
    } catch {
      candidate = sanitizeInlineBinaryAndDataUrls(candidate)
    }
  } else {
    candidate = sanitizeInlineBinaryAndDataUrls(candidate)
  }

  if (candidate.length <= limit) return candidate

  const noticeReserve = 140
  const headLen = Math.max(400, Math.floor((limit - noticeReserve) * 0.65))
  const tailLen = Math.max(200, limit - noticeReserve - headLen)
  const omitted = candidate.length - headLen - tailLen
  return `${candidate.slice(0, headLen)}\n\n...[单次工具返回过长，已自动省略中间 ${omitted} 字符以防上下文超限]...\n\n${candidate.slice(-tailLen)}`
}

export interface CompactVisionImageOptions {
  /** 免缩放直通字节阈值（默认 380 KB） */
  passthroughMaxBytes?: number
  /** 首选长边像素上限（默认 1024px，兼顾抠图边缘细节与体积） */
  maxEdge?: number
  /** 二级回退长边像素上限（默认 768px） */
  fallbackMaxEdge?: number
  /** 缩放后单张目标最大原始字节数（默认 850 KB） */
  targetMaxBytes?: number
}

/**
 * 将发往视觉大模型的图片缓冲压缩至轻量视觉尺寸（<= ~400–800 KB）：
 * 1) `<= 380 KB` 原样直通；
 * 2) 优先按 `1024px` 等比缩放为 PNG，**保留 Alpha 透明通道**（确保 Agent 仍能检查抠图黑边/半透明残影）；
 * 3) 若 `1024px` PNG 仍偏大，降级至 `768px` PNG；若依然超过阈值（如高噪点实拍大图），再转 `JPEG (quality=82)`。
 */
export function compactImageBufferForAgentVision(
  bytes: Buffer,
  mimeType: string,
  opts?: CompactVisionImageOptions
): { buffer: Buffer; mimeType: string; compacted: boolean } {
  const passthroughMax = opts?.passthroughMaxBytes ?? VISION_PASSTHROUGH_MAX_BYTES
  if (!bytes || bytes.byteLength <= passthroughMax) {
    return { buffer: bytes, mimeType, compacted: false }
  }

  const maxEdge = opts?.maxEdge ?? 1_024
  const fallbackEdge = opts?.fallbackMaxEdge ?? 768
  const targetMaxBytes = opts?.targetMaxBytes ?? 850 * 1024

  try {
    if (nativeImage && typeof nativeImage.createFromBuffer === 'function') {
      const img = nativeImage.createFromBuffer(bytes)
      if (img && !img.isEmpty()) {
        const { width, height } = img.getSize()
        if (width > 0 && height > 0) {
          const resizeAtEdge = (edge: number) => {
            const longest = Math.max(width, height)
            if (longest <= edge) return img
            return img.resize({
              width: Math.max(1, Math.round((width * edge) / longest)),
              height: Math.max(1, Math.round((height * edge) / longest)),
              quality: 'good'
            })
          }

          const isJpegSource = /image\/jpe?g/i.test(mimeType)
          const resizedPrimary = resizeAtEdge(maxEdge)

          if (isJpegSource) {
            const jpgPrimary = resizedPrimary.toJPEG(84)
            if (jpgPrimary.byteLength > 0 && jpgPrimary.byteLength <= targetMaxBytes) {
              return { buffer: jpgPrimary, mimeType: 'image/jpeg', compacted: true }
            }
            const jpgFallback = resizeAtEdge(fallbackEdge).toJPEG(78)
            if (jpgFallback.byteLength > 0 && jpgFallback.byteLength < bytes.byteLength) {
              return { buffer: jpgFallback, mimeType: 'image/jpeg', compacted: true }
            }
          } else {
            const pngPrimary = resizedPrimary.toPNG()
            if (pngPrimary.byteLength > 0 && pngPrimary.byteLength <= 620 * 1024) {
              return { buffer: pngPrimary, mimeType: 'image/png', compacted: true }
            }
            const resizedSecondary = resizeAtEdge(fallbackEdge)
            const pngSecondary = resizedSecondary.toPNG()
            if (pngSecondary.byteLength > 0 && pngSecondary.byteLength <= targetMaxBytes) {
              return { buffer: pngSecondary, mimeType: 'image/png', compacted: true }
            }
            const jpgFallback = resizedSecondary.toJPEG(82)
            if (jpgFallback.byteLength > 0 && jpgFallback.byteLength < bytes.byteLength) {
              return { buffer: jpgFallback, mimeType: 'image/jpeg', compacted: true }
            }
          }
        }
      }
    }
  } catch {
    /* headless / mock environment without nativeImage */
  }

  return { buffer: bytes, mimeType, compacted: false }
}

/**
 * 统一守护任意工具返回的 `(TextContent | ImageContent)[]` 内容块：
 * - 清洗并截断超大文本块；
 * - 限制单次工具返回最多 4 张图片，并自动缩放超大图；若运行环境不支持缩放且单图超过硬上限则降级为文本说明。
 */
export function guardToolResultBlocks(
  blocks: ReadonlyArray<TextContent | ImageContent>,
  opts?: {
    maxTextChars?: number
    maxImages?: number
  }
): (TextContent | ImageContent)[] {
  const maxTextChars = opts?.maxTextChars ?? SINGLE_TOOL_TEXT_MAX_CHARS
  const maxImages = opts?.maxImages ?? MAX_IMAGES_PER_TOOL_RESULT
  const out: (TextContent | ImageContent)[] = []
  let imageCount = 0

  for (const block of blocks) {
    if (block.type === 'text') {
      out.push({
        ...block,
        text: capSingleToolText(block.text, maxTextChars)
      })
      continue
    }

    if (block.type === 'image') {
      imageCount += 1
      if (imageCount > maxImages) {
        out.push({
          type: 'text',
          text: `[单次工具附带图片超过 ${maxImages} 张，第 ${imageCount} 张已省略；如需查看可单独调用 read]`
        })
        continue
      }

      const rawBase64 = String(block.data ?? '')
      const approxRawBytes = Math.floor((rawBase64.length * 3) / 4)
      if (approxRawBytes <= VISION_PASSTHROUGH_MAX_BYTES) {
        out.push(block)
        continue
      }

      const decoded = Buffer.from(rawBase64, 'base64')
      const compacted = compactImageBufferForAgentVision(decoded, block.mimeType || 'image/png')
      if (compacted.buffer.byteLength <= VISION_HARD_MAX_RAW_BYTES) {
        out.push({
          type: 'image',
          data: compacted.buffer.toString('base64'),
          mimeType: compacted.mimeType
        })
      } else {
        out.push({
          type: 'text',
          text: `[工具返回图片体积过大 (${compacted.buffer.byteLength} bytes)，已自动省略内联图像数据以防请求超限]`
        })
      }
    }
  }

  return out
}
