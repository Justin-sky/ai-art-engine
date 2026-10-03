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

/**
 * jpeg-js 解码上限（内存 / 分辨率）。
 *
 * 为什么要改默认值：jpeg-js 默认 `maxMemoryUsageInMB: 512`（官方注释是「避免不可信
 * 内容造成意外 OOM」），而这里解的是用户本机素材 —— 相机原图 40MP 起。它按
 * 「每分量块表 256B + 分量行缓冲 + 输出 RGBA」累计记账，实测（jpeg-js 0.4.4、
 * 4:4:4 最坏情形）：6000×4000(24MP) ≈ 480MB、8000×6000(48MP) ≈ 550MB、
 * 11648×8736(101.8MP) ≈ 2135MB，即约 21 字节/像素。于是 30MP 出头就触顶，抛
 * `maxMemoryUsageInMB limit exceeded by at least NMB`，整次检测被判失败并写进
 * `asset.visionTags.status = 'skipped'`（素材卡上表现为「打标失败」，且重试也不变）。
 *
 * 语义坑：这两个选项是「乘法上限」而不是开关 —— 传 0 会变成 maxMemoryUsageBytes = 0，
 * 第一次分配就抛，所以放宽只能给一个大值。
 *
 * 取值依据：4096MB 与 160MP 配对。按上测最坏记账 21 字节/像素，160MP ≈ 3.4GB，
 * 落在 4GB 之内 —— 真实相机 / 扫描仪能出的最大尺寸（GFX100 102MP、Phase One 150MP）
 * 都解得开；而真正的兜底交给分辨率上限：伪造巨幅尺寸的解压炸弹仍会被拒，不会
 * 一路分配下去。4:2:0 的普通相机图账更小，余量更大。
 *
 * 放宽的代价可控：解码跑在 yoloWorker（utilityProcess），真 OOM 只死 worker，
 * yoloService 会标记崩溃并在下次检测重试，不牵连主进程与界面。
 */
export const JPEG_MAX_MEMORY_MB = 4096

/** 分辨率上限（MP）：160 覆盖现有最大画幅相机；解压炸弹在这里被拒 */
export const JPEG_MAX_RESOLUTION_MP = 160

/** jpeg-js 记账的最坏情形（实测 11648×8736 ≈ 2135MB），用于校验上面两个上限的配对关系 */
export const JPEG_WORST_CASE_BYTES_PER_PIXEL = 21

/** 传给 jpeg-js 的解码选项；导出以便单测断言「放宽确实生效、且两个上限仍配对」 */
export const JPEG_DECODE_OPTIONS = {
  useTArray: true,
  maxMemoryUsageInMB: JPEG_MAX_MEMORY_MB,
  maxResolutionInMP: JPEG_MAX_RESOLUTION_MP
} as const

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

function isWebp(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
}

function decodeBytes(bytes: Uint8Array, sourceLabel: string): DecodedImage {
  if (isPng(bytes)) {
    const png = PNG.sync.read(Buffer.from(bytes))
    return { width: png.width, height: png.height, rgba: Uint8Array.from(png.data) }
  }
  if (isJpeg(bytes)) {
    const raw = decodeJpeg(Buffer.from(bytes), JPEG_DECODE_OPTIONS)
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
