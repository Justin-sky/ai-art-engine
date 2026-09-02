/**
 * 纯 JS 图像解码：把 输入三形态（file / dataUrl / raw）统一成 RGBA 像素。
 * 刻意不用 sharp 等原生模块——主应用保持纯 JS 约定，跨平台零编译负担。
 * 支持 PNG / JPEG；WebP 请由渲染层 canvas 转 raw 传入。
 */
import { readFile } from 'fs/promises'
import { decode as decodeJpeg } from 'jpeg-js'
import { PNG } from 'pngjs'
import type { YoloImageInput } from '@shared/yolo'

export interface DecodedImage {
  width: number
  height: number
  /** RGBA，每像素 4 字节，行优先 */
  rgba: Uint8Array
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
}

function decodeBytes(bytes: Uint8Array, sourceLabel: string): DecodedImage {
  if (isPng(bytes)) {
    const png = PNG.sync.read(Buffer.from(bytes))
    return { width: png.width, height: png.height, rgba: Uint8Array.from(png.data) }
  }
  if (isJpeg(bytes)) {
    const raw = decodeJpeg(Buffer.from(bytes), { useTArray: true })
    return { width: raw.width, height: raw.height, rgba: Uint8Array.from(raw.data) }
  }
  if (isWebp(bytes)) {
    throw new Error(
      `YOLO: webp image (${sourceLabel}) is not supported by the built-in decoder; pass raw RGBA instead`
    )
  }
  throw new Error(`YOLO: unsupported image format (${sourceLabel}); expect PNG or JPEG`)
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl)
  if (!match) throw new Error('YOLO: invalid dataUrl input')
  const mime = match[1] ?? ''
  const isBase64 = !!match[2]
  const body = match[3] ?? ''
  const bytes = isBase64
    ? Uint8Array.from(Buffer.from(body, 'base64'))
    : Uint8Array.from(Buffer.from(decodeURIComponent(body), 'latin1'))
  return { bytes, mime }
}

export async function decodeImage(input: YoloImageInput): Promise<DecodedImage> {
  switch (input.kind) {
    case 'raw': {
      if (!input.width || !input.height || input.rgba.length < input.width * input.height * 4) {
        throw new Error('YOLO: invalid raw image input (size mismatch)')
      }
      return { width: input.width, height: input.height, rgba: input.rgba }
    }
    case 'dataUrl': {
      const { bytes, mime } = dataUrlToBytes(input.dataUrl)
      return decodeBytes(bytes, mime || 'dataUrl')
    }
    case 'file': {
      const bytes = await readFile(input.path)
      return decodeBytes(bytes, input.path)
    }
  }
}
