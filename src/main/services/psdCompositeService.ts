/**
 * PSD 合成预览解码：把 Photoshop 分层源文件「拍平」成可渲染的 PNG。
 *
 * 为什么要自己做：Chromium 与 Electron `nativeImage` 的解码器都不认 PSD
 * （见 `@shared/import` 的 isLayeredSourceImageFilePath），但 PSD 的 Image Data Section
 * 里本来就存着整份合成图——用 ag-psd 把它读出来，即可像普通图片一样进缩略图、
 * 预览与大图弹窗链路。
 *
 * 读取口径刻意收窄（这类文件动辄几十上百 MB）：
 * - `skipLayerImageData` / `skipThumbnail` / `skipLinkedFilesData`：只要合成图，
 *   图层像素、内嵌缩略图与智能对象源文件一概不读；
 * - `useImageData`：结果落 `imageData` 而不是 `canvas`——主进程 Node 侧没有 canvas 实现；
 * - 文件体积上限 + `totalMemoryLimit`：解不出画面好过把主进程内存吃光。
 *
 * 已知边界（ag-psd 自身的限制，撞上就返回 null 由上层降级）：合成图只支持 Raw / RLE
 * 压缩与 RGB / 灰度 / 索引 / 位图色彩模式，ZIP 压缩、CMYK / Lab 的 PSD 解不出画面。
 * 图层记录畸形的 PSD（常见于非 Photoshop 工具写出的文件）另有一条降级：剥掉 Layer & Mask
 * 段后重读，见 stripLayerAndMaskSection——这类文件正是 ag-psd 直接抛错的重灾区。
 *
 * 解码是同步 CPU 密集操作，调用方（thumbnailService）只在异步链路里用它。
 */
import { readFileSync, statSync } from 'fs'
import { initializeCanvas, readPsd } from 'ag-psd'
import { PNG } from 'pngjs'

/**
 * ag-psd 在 Node 侧默认没有 canvas：合成图按 RGBA 分配缓冲时会走 `createImageData`。
 * 我们只要像素、不要画布，所以塞一个纯数组实现；`createCanvas` 若真被调用，说明走到了
 * canvas 输出路径（本模块不用），让它抛错、由上层兜成「解不出画面」再降级。
 */
type AgPsdCanvasFactory = Parameters<typeof initializeCanvas>[0]
type AgPsdImageDataFactory = NonNullable<Parameters<typeof initializeCanvas>[1]>

initializeCanvas(
  (() => {
    throw new Error('canvas is not available in the Electron main process')
  }) as unknown as AgPsdCanvasFactory,
  ((width: number, height: number) => ({
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4)
  })) as unknown as AgPsdImageDataFactory
)

export interface PsdCompositeImage {
  width: number
  height: number
  /** RGBA，每像素 4 字节，行优先 */
  rgba: Uint8Array
}

/** 单个 PSD 的文件体积上限：超出直接放弃，回落其它预览手段 */
const MAX_PSD_FILE_BYTES = 512 * 1024 * 1024
/** 解码期内存上限（ag-psd totalMemoryLimit） */
const MAX_PSD_DECODE_BYTES = 512 * 1024 * 1024
/** PSD 头部固定长度（签名到色彩模式，不含后续各段） */
const HEADER_LENGTH = 26
/** 四字节的段长度前缀 0：把 Layer & Mask 段整体置空时用 */
const EMPTY_SECTION_LENGTH = Buffer.alloc(4)

/** 段跳读：offset 处是四字节长度前缀，返回下一段起点；越界返回 null */
function sectionEnd(buffer: Buffer, offset: number): number | null {
  if (offset + 4 > buffer.length) return null
  const end = offset + 4 + buffer.readUInt32BE(offset)
  return end <= buffer.length ? end : null
}

/**
 * 只留合成图所需的段：Header 与 Color Mode Data、Image Resources 原样保留，
 * Layer & Mask 段的长度前缀置 0 整体丢弃，再接上原 Image Data 段。
 *
 * 为什么要动这一刀：合成图与图层是彼此独立的段，但 ag-psd 必须完整解析图层记录
 * （`skipLayerImageData` 只跳过图层像素），遇到非 Photoshop 工具写出的畸形记录会直接抛
 * `Invalid layer size`，整份文件就再也读不出画面——而它的合成图其实完好无损。
 * 按长度前缀绕开图层段即可拿到合成图，图层数据对预览没有价值。
 *
 * 只处理 PSD（version 1）；PSB 的段长度是八字节、布局不同，直接放弃。
 */
function stripLayerAndMaskSection(buffer: Buffer): Buffer | null {
  if (buffer.length < HEADER_LENGTH + 4) return null
  if (buffer.toString('latin1', 0, 4) !== '8BPS') return null
  if (buffer.readUInt16BE(4) !== 1) return null

  const colorModeDataEnd = sectionEnd(buffer, HEADER_LENGTH)
  if (colorModeDataEnd === null) return null
  const resourcesEnd = sectionEnd(buffer, colorModeDataEnd)
  if (resourcesEnd === null) return null
  const layerMaskEnd = sectionEnd(buffer, resourcesEnd)
  if (layerMaskEnd === null) return null
  // 图层段本来就是空的，或后面没有合成图段：这刀切了也白切
  if (layerMaskEnd <= resourcesEnd + 4) return null
  if (layerMaskEnd + 2 > buffer.length) return null

  return Buffer.concat([
    buffer.subarray(0, resourcesEnd),
    EMPTY_SECTION_LENGTH,
    buffer.subarray(layerMaskEnd)
  ])
}

/** 单次读取尝试：结果与失败原因一起带出，便于只在两条路都失败时打一次日志 */
function readComposite(buffer: Buffer): { image: PsdCompositeImage | null; error: unknown } {
  try {
    const psd = readPsd(buffer, {
      skipLayerImageData: true,
      skipThumbnail: true,
      skipLinkedFilesData: true,
      useImageData: true,
      throwForMissingFeatures: false,
      logMissingFeatures: false,
      totalMemoryLimit: MAX_PSD_DECODE_BYTES
    })
    const { imageData } = psd
    if (!imageData?.width || !imageData.height) return { image: null, error: null }
    const { width, height, data } = imageData
    if (data.length < width * height * 4) return { image: null, error: null }
    return {
      image: {
        width,
        height,
        // 共用 ag-psd 已分配的缓冲（不复制），上层只读
        rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      },
      error: null
    }
  } catch (err) {
    return { image: null, error: err }
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  return err === null || err === undefined ? 'no composite image data' : String(err)
}

/**
 * 合成图 → RGBA。读不出画面（格式不支持 / 无合成数据 / 内存超限）时返回 null，不抛。
 * 常规文件一次读完；被畸形图层记录卡住时，剥掉图层段再读一次。
 */
export function decodePsdComposite(buffer: Buffer): PsdCompositeImage | null {
  const direct = readComposite(buffer)
  if (direct.image) return direct.image

  const stripped = stripLayerAndMaskSection(buffer)
  if (stripped) {
    const rescued = readComposite(stripped)
    if (rescued.image) return rescued.image
    console.warn('[psd] composite decode failed on stripped buffer', describeError(rescued.error))
    return null
  }

  console.warn('[psd] composite decode failed', describeError(direct.error))
  return null
}

/** 读盘 + 解码；文件缺失 / 过大 / 解不出画面时返回 null */
export function readPsdCompositeFile(absPath: string): PsdCompositeImage | null {
  try {
    const stat = statSync(absPath)
    if (!stat.isFile() || stat.size <= 0) return null
    if (stat.size > MAX_PSD_FILE_BYTES) {
      console.warn('[psd] file too large for composite preview', absPath, stat.size)
      return null
    }
    const image = decodePsdComposite(readFileSync(absPath))
    if (!image) console.warn('[psd] composite decode failed', absPath)
    return image
  } catch (err) {
    console.warn('[psd] read failed', absPath, err)
    return null
  }
}

/** RGBA → PNG（交给 nativeImage / `<img>` 的通用载体） */
export function encodeRgbaPng(image: PsdCompositeImage): Buffer {
  const png = new PNG({ width: image.width, height: image.height })
  Buffer.from(image.rgba.buffer, image.rgba.byteOffset, image.rgba.length).copy(png.data)
  return PNG.sync.write(png)
}
