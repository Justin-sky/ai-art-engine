/**
 * 将 GIF 动图（dataUrl 或二进制 ArrayBuffer / Uint8Array）解包为逐帧 PNG dataUrl 与延时信息。
 * 供 Anim2dInspector 及 2D 帧动画节点直接读入并编辑外部/AI 直出的 GIF。
 */
import { decodeGif, dataUrlToBytes, isGifBuffer, type DecodedGif } from '@shared/media/gifDecode'
import { isAnimatedImageMediaUrl } from '@shared/import'

export interface UnpackedGifFrame {
  index: number
  key: string
  dataUrl: string
  width: number
  height: number
  delayCs: number
  fps: number
}

export interface UnpackGifResult {
  width: number
  height: number
  loopCount: number | null
  frames: UnpackedGifFrame[]
  averageFps: number
}

function rgbaToPngDataUrl(rgba: Uint8ClampedArray, width: number, height: number): string {
  if (typeof document === 'undefined') {
    return ''
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const imgData = new ImageData(new Uint8ClampedArray(rgba), width, height)
  ctx.putImageData(imgData, 0, 0)
  return canvas.toDataURL('image/png')
}

export function unpackGifToFrames(
  input: string | Uint8Array | ArrayBuffer
): UnpackGifResult | null {
  try {
    let bytes: Uint8Array
    if (typeof input === 'string') {
      const trimmed = input.trim()
      if (
        !trimmed.startsWith('data:image/gif') &&
        !trimmed.startsWith('data:application/octet-stream')
      ) {
        // 尝试检查是否是纯 base64
        try {
          bytes = dataUrlToBytes(trimmed)
        } catch {
          return null
        }
      } else {
        bytes = dataUrlToBytes(trimmed)
      }
    } else if (input instanceof Uint8Array) {
      bytes = input
    } else {
      bytes = new Uint8Array(input)
    }

    if (!isGifBuffer(bytes)) {
      return null
    }

    const decoded: DecodedGif = decodeGif(bytes)
    if (!decoded.frames.length) return null

    let totalDelayCs = 0
    const frames: UnpackedGifFrame[] = []

    for (let i = 0; i < decoded.frames.length; i++) {
      const f = decoded.frames[i]
      totalDelayCs += f.delayCs
      const fps = Math.round(100 / Math.max(1, f.delayCs))
      const dataUrl = rgbaToPngDataUrl(f.rgba, decoded.width, decoded.height)
      frames.push({
        index: i,
        key: `f${i + 1}`,
        dataUrl,
        width: decoded.width,
        height: decoded.height,
        delayCs: f.delayCs,
        fps
      })
    }

    const avgCs = totalDelayCs / decoded.frames.length
    const averageFps = Math.max(1, Math.min(60, Math.round(100 / Math.max(1, avgCs))))

    return {
      width: decoded.width,
      height: decoded.height,
      loopCount: decoded.loopCount,
      frames,
      averageFps
    }
  } catch {
    return null
  }
}

/**
 * 异步解析并解包任何媒体源（dataUrl、studio-media://、裸相对路径、ArrayBuffer 等）中的 GIF 动图。
 */
export async function tryUnpackSourceGif(
  sourceUrl: string | Uint8Array | ArrayBuffer | null | undefined
): Promise<UnpackGifResult | null> {
  if (!sourceUrl) return null
  if (sourceUrl instanceof Uint8Array || sourceUrl instanceof ArrayBuffer) {
    return unpackGifToFrames(sourceUrl)
  }
  const trimmed = sourceUrl.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('data:image/gif') || trimmed.startsWith('data:application/octet-stream')) {
    const res = unpackGifToFrames(trimmed)
    if (res && res.frames.length > 0) return res
  }

  // 裸相对路径：尝试从主进程加载其 dataUrl
  let fetchUrl = trimmed
  if (!/^(studio-media:|https?:|data:|blob:|file:)/i.test(trimmed)) {
    try {
      const dataUrl = await window.studio?.getAssetMediaDataUrl?.(trimmed)
      if (dataUrl) {
        const res = unpackGifToFrames(dataUrl)
        if (res && res.frames.length > 0) return res
      }
    } catch {
      /* ignore */
    }
  }

  // 检查是否可能为 GIF 或媒体 URL
  const mightBeGif =
    isAnimatedImageMediaUrl(fetchUrl) || /^(studio-media:|https?:|blob:|file:)/i.test(fetchUrl)

  if (mightBeGif) {
    try {
      const resp = await fetch(fetchUrl)
      if (resp.ok) {
        const ab = await resp.arrayBuffer()
        const u8 = new Uint8Array(ab)
        if (isGifBuffer(u8)) {
          return unpackGifToFrames(u8)
        }
      }
    } catch {
      /* ignore fetch error */
    }
  }

  // 纯 base64 或 data: 兜底
  if (trimmed.startsWith('data:') || trimmed.length > 100) {
    return unpackGifToFrames(trimmed)
  }

  return null
}
