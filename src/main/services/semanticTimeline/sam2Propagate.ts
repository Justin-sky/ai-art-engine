/**
 * 用户点选实体后：用上一帧掩码外接框作为下一帧提示，逐帧传播分割。
 * 依赖本地 YOLO-seg / SAM2（yoloService.segment）；模型不可用时返回空序列并注明。
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { yoloService } from '../../yolo/yoloService'
import { runFfmpeg } from '../ffmpegRunner'
import { resolveFfmpegForSemantic } from './resolveFfmpeg'

export interface PropagateMaskInput {
  videoAbs: string
  startSec: number
  endSec: number
  fps: number
  /** 首帧提示框（像素） */
  promptBox: { x: number; y: number; width: number; height: number }
  outMaskDirAbs: string
}

export interface PropagateMaskResult {
  maskCount: number
  note?: string
}

function boxFromMask(
  mask: { width: number; height: number; data: number[] | Uint8Array },
  frameW: number,
  frameH: number
): { x: number; y: number; width: number; height: number } | null {
  const mw = mask.width
  const mh = mask.height
  let minX = mw
  let minY = mh
  let maxX = 0
  let maxY = 0
  const data = mask.data
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const v = data[y * mw + x] ?? 0
      if (v > 0.5) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX || maxY < minY) return null
  const sx = frameW / mw
  const sy = frameH / mh
  return {
    x: minX * sx,
    y: minY * sy,
    width: (maxX - minX + 1) * sx,
    height: (maxY - minY + 1) * sy
  }
}

/** 抽取单帧到临时 jpg */
async function extractFrame(videoAbs: string, timeSec: number, outJpg: string): Promise<boolean> {
  const ffmpeg = resolveFfmpegForSemantic()
  try {
    await runFfmpeg(ffmpeg, [
      '-y',
      '-ss',
      String(Math.max(0, timeSec)),
      '-i',
      videoAbs,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      outJpg
    ])
    return existsSync(outJpg)
  } catch {
    return false
  }
}

/**
 * 逐帧传播：每帧用当前提示框跑 segment，写出 mask_NNNNN.png（若 API 只给网格则写 JSON sidecar）。
 */
export async function propagateEntityMask(input: PropagateMaskInput): Promise<PropagateMaskResult> {
  mkdirSync(input.outMaskDirAbs, { recursive: true })
  const duration = Math.max(0, input.endSec - input.startSec)
  const frameCount = Math.max(1, Math.round(duration * input.fps))
  let box = { ...input.promptBox }
  let maskCount = 0
  const tmpDir = join(input.outMaskDirAbs, '_frames')
  mkdirSync(tmpDir, { recursive: true })

  for (let i = 0; i < frameCount; i++) {
    const t = input.startSec + i / input.fps
    const framePath = join(tmpDir, `f_${String(i + 1).padStart(5, '0')}.jpg`)
    if (!(await extractFrame(input.videoAbs, t, framePath))) continue
    try {
      const seg = await yoloService.segment({
        image: { kind: 'file', path: framePath },
        // 部分实现支持 box 提示；忽略未知字段时仍会整图分割再取最大实例
        ...({ promptBox: box } as Record<string, unknown>)
      } as Parameters<typeof yoloService.segment>[0])
      const masks = seg.masks ?? []
      const boxes = seg.boxes ?? []
      // 选与提示框 IoU 最高的实例
      let bestIdx = 0
      if (boxes.length > 1) {
        let best = -1
        boxes.forEach((b, idx) => {
          const ix = Math.max(0, Math.min(b.x + b.width, box.x + box.width) - Math.max(b.x, box.x))
          const iy = Math.max(
            0,
            Math.min(b.y + b.height, box.y + box.height) - Math.max(b.y, box.y)
          )
          const inter = ix * iy
          const uni = b.width * b.height + box.width * box.height - inter
          const score = uni > 0 ? inter / uni : 0
          if (score > best) {
            best = score
            bestIdx = idx
          }
        })
      }
      const mask = masks[bestIdx]
      const chosenBox = boxes[bestIdx]
      if (chosenBox) {
        box = {
          x: chosenBox.x,
          y: chosenBox.y,
          width: chosenBox.width,
          height: chosenBox.height
        }
      } else if (mask) {
        const next = boxFromMask(mask, seg.width, seg.height)
        if (next) box = next
      }
      const metaPath = join(input.outMaskDirAbs, `mask_${String(i + 1).padStart(5, '0')}.json`)
      writeFileSync(
        metaPath,
        JSON.stringify({ frame: i, timeSec: t, box, hasMask: !!mask }, null, 2),
        'utf8'
      )
      maskCount += 1
    } catch (e) {
      return {
        maskCount,
        note: e instanceof Error ? e.message : 'segment unavailable'
      }
    }
  }

  return {
    maskCount,
    note: maskCount === 0 ? 'no masks produced (model missing or empty)' : undefined
  }
}
