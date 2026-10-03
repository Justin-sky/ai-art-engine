import { nativeImage, type NativeImage } from 'electron'
import { defErr, formatBi } from '@shared/errors/appError'
import {
  REFERENCE_IMAGE_TARGET_BYTES,
  formatBytesHuman,
  needsReferenceImageShrink,
  referenceImageAttempts
} from '@shared/media/referenceImage'

// ── 本文件错误条目（非 throw，仅用于构造提示文案）──
const E_REFERENCE_IMAGE_COMPRESSED = defErr<{ from: string; to: string; size: string }>(
  'provider.referenceImageCompressed',
  ({ from, to, size }) => `参考图已压缩：${from} → ${to}（${size}）`,
  ({ from, to, size }) => `Reference image compressed: ${from} → ${to} (${size})`
)

const DATA_URL_RE = /^data:([^;,]*)?(;base64)?,([\s\S]*)$/

export interface ParsedDataUrl {
  mime: string
  base64: boolean
  /** 逗号之后的原始载荷（base64 文本或百分号编码文本） */
  payload: string
  /** 解码后的字节数 */
  bytes: number
}

/** 解析 data URL 并算出真实字节数（不真的解码，避免为一个判断复制几 MB） */
export function parseDataUrl(url: string): ParsedDataUrl | null {
  const match = DATA_URL_RE.exec(url?.trim() ?? '')
  if (!match) return null
  const mime = (match[1] || 'image/png').toLowerCase()
  const base64 = Boolean(match[2])
  const payload = match[3] ?? ''
  // base64：4 字符 → 3 字节；百分号编码按字符数近似（只用于阈值判断与展示）
  const bytes = base64 ? Math.floor((payload.length * 3) / 4) : payload.length
  return { mime, base64, payload, bytes }
}

export function bufferToDataUrl(mime: string, buf: Buffer): string {
  return `data:${mime};base64,${buf.toString('base64')}`
}

export interface ShrunkReferenceImage {
  url: string
  /** 实际压过才有：形如「参考图已压缩：19.5MB → 2.3MB（4096×2731）」，进运行日志 */
  note?: string
}

/**
 * 发送前压缩超大参考图：解码 → 逐级降采样 / 重编码 → 取第一个低于目标体积的结果。
 *
 * 解不出画面（SVG / PSD / 损坏文件）或本来就小 → 原样返回，交给上游判断，
 * 不在本地武断地拦截用户素材。压不小（源图本来就是高压缩比）同样原样返回。
 */
export function shrinkReferenceImageDataUrl(url: string): ShrunkReferenceImage {
  const parsed = parseDataUrl(url)
  if (!parsed || !needsReferenceImageShrink(parsed.bytes)) return { url }

  const source = parsed.base64
    ? Buffer.from(parsed.payload, 'base64')
    : Buffer.from(decodeURIComponent(parsed.payload), 'utf8')

  let image: NativeImage
  try {
    image = nativeImage.createFromBuffer(source)
  } catch {
    return { url }
  }
  const size = image?.isEmpty() ? { width: 0, height: 0 } : image.getSize()
  if (!size.width || !size.height) return { url }

  let best: { url: string; bytes: number; width: number; height: number } | null = null
  for (const attempt of referenceImageAttempts({ ...size, mime: parsed.mime })) {
    const sameSize = attempt.width === size.width && attempt.height === size.height
    const resized = sameSize
      ? image
      : image.resize({ width: attempt.width, height: attempt.height, quality: 'better' })
    let buf: Buffer
    try {
      buf = attempt.format === 'png' ? resized.toPNG() : resized.toJPEG(attempt.quality)
    } catch {
      continue
    }
    if (!buf?.length) continue
    const actual = resized.getSize()
    const candidate = {
      url: bufferToDataUrl(attempt.format === 'png' ? 'image/png' : 'image/jpeg', buf),
      bytes: buf.length,
      width: actual.width,
      height: actual.height
    }
    if (!best || candidate.bytes < best.bytes) best = candidate
    if (candidate.bytes <= REFERENCE_IMAGE_TARGET_BYTES) break
  }

  // 压不动就别动：宁可原样交给上游，也不要送出一张更差的图
  if (!best || best.bytes >= parsed.bytes) return { url }

  return {
    url: best.url,
    note: formatBi(E_REFERENCE_IMAGE_COMPRESSED, {
      from: formatBytesHuman(parsed.bytes),
      to: formatBytesHuman(best.bytes),
      size: `${best.width}×${best.height}`
    })
  }
}
