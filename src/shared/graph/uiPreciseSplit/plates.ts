/**
 * 逐级剥层（progressive peeling）：
 *   plate[L+1] = 去字后的原图
 *   plate[k]   = plate[k+1] 去掉第 k 级全部元素、补全其下方内容
 * 第 k 级元素的图层 = matte(plate[k+1], plate[k])。
 *
 * 补底方式（逐元素判定）：
 * - 元素下方是透明（悬浮在透明底上）→ 直接置透明，零误差
 * - 低层级（大面板、立绘，遮挡内容重要）→ 指令编辑模型补全，结果对齐后只在蒙版内羽化回贴，
 *   蒙版外像素保持原样（模型改动了别处也不影响）；没移掉的元素逐个回退本地补底
 * - 高层级（小图标/角标，下方多为简单底板）或无生图能力 → 推拉金字塔本地补底
 */

import { buildPeelEditPrompt } from './prompts'
import {
  boxBlurFloat,
  cloneImage,
  createImage,
  dilateMask,
  expandRect,
  inpaintPushPull,
  nearestAspectRatio,
  pixelDistance,
  resizeBilinear
} from './pixels'
import { paintRect, ringStats } from './refine'
import type { PixelRect, PreciseSplitIo, RgbaImage, UiElementNode } from './types'

export interface PeelLevelReport {
  level: number
  method: 'generative' | 'local' | 'transparent'
  elementCount: number
}

function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

function peelPad(img: RgbaImage): number {
  return Math.max(2, Math.round(Math.max(img.width, img.height) * 0.004))
}

/** 元素正下方是否是透明底（外圈环带基本透明） */
function sitsOnTransparency(img: RgbaImage, box: PixelRect): boolean {
  const ring = ringStats(img, expandRect(box, 3, img.width, img.height), 2)
  return ring.color[3]! < 20
}

/**
 * 估计生成结果相对参考图的整体平移（模型重绘常有几像素漂移）。
 * 在 ≤320px 的缩略图上、蒙版外区域做 SAD 搜索。
 */
export function estimateShift(
  ref: RgbaImage,
  mov: RgbaImage,
  hole: Uint8Array
): { dx: number; dy: number; error: number } {
  const scale = Math.max(1, Math.ceil(Math.max(ref.width, ref.height) / 320))
  const w = Math.max(1, Math.round(ref.width / scale))
  const h = Math.max(1, Math.round(ref.height / scale))
  const a = resizeBilinear(ref, w, h)
  const b = resizeBilinear(mov, w, h)
  const valid = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(ref.width - 1, Math.floor(x * scale))
      const sy = Math.min(ref.height - 1, Math.floor(y * scale))
      valid[y * w + x] = hole[sy * ref.width + sx] ? 0 : 1
    }
  }
  const radius = Math.max(2, Math.min(10, Math.round(Math.max(w, h) * 0.03)))
  let best = { dx: 0, dy: 0, error: Infinity }
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      let sum = 0
      let count = 0
      for (let y = Math.max(0, -dy); y < Math.min(h, h - dy); y += 2) {
        for (let x = Math.max(0, -dx); x < Math.min(w, w - dx); x += 2) {
          const p = y * w + x
          if (!valid[p]) continue
          sum += pixelDistance(a.data, p * 4, b.data, ((y + dy) * w + x + dx) * 4)
          count++
        }
      }
      if (count < 16) continue
      const err = sum / count
      if (err < best.error) best = { dx, dy, error: err }
    }
  }
  return { dx: best.dx * scale, dy: best.dy * scale, error: best.error }
}

function shiftImage(img: RgbaImage, dx: number, dy: number): RgbaImage {
  if (!dx && !dy) return img
  const out = createImage(img.width, img.height)
  for (let y = 0; y < img.height; y++) {
    const sy = Math.min(img.height - 1, Math.max(0, y + dy))
    for (let x = 0; x < img.width; x++) {
      const sx = Math.min(img.width - 1, Math.max(0, x + dx))
      const si = (sy * img.width + sx) * 4
      const o = (y * img.width + x) * 4
      out.data[o] = img.data[si]!
      out.data[o + 1] = img.data[si + 1]!
      out.data[o + 2] = img.data[si + 2]!
      out.data[o + 3] = img.data[si + 3]!
    }
  }
  return out
}

function meanDistanceInRect(a: RgbaImage, b: RgbaImage, rect: PixelRect): number {
  let sum = 0
  let n = 0
  for (let y = rect.top; y < rect.top + rect.height; y++) {
    for (let x = rect.left; x < rect.left + rect.width; x++) {
      const i = (y * a.width + x) * 4
      sum += pixelDistance(a.data, i, b.data, i)
      n++
    }
  }
  return n ? sum / n : 0
}

/**
 * 移除一组元素，返回补底后的新底板。
 */
export async function peelLevel(input: {
  io: PreciseSplitIo
  plate: RgbaImage
  elements: readonly UiElementNode[]
  level: number
  useGenerative: boolean
  locale?: string
}): Promise<{ plate: RgbaImage; report: PeelLevelReport[] }> {
  const { io, plate, elements, level } = input
  const W = plate.width
  const H = plate.height
  const pad = peelPad(plate)
  const next = cloneImage(plate)
  const report: PeelLevelReport[] = []

  const transparent: UiElementNode[] = []
  const solid: UiElementNode[] = []
  for (const el of elements) (sitsOnTransparency(plate, el.box) ? transparent : solid).push(el)

  const hole = new Uint8Array(W * H)
  for (const el of elements) paintRect(hole, W, H, expandRect(el.box, pad, W, H))

  // 本地补底总是先算：既是回退结果，也提供补底区域的 alpha；
  // 外圈全透明时推拉插值的结果就是精确的 alpha=0
  const local = cloneImage(next)
  inpaintPushPull(local, hole)

  const copyLocal = (rect: PixelRect): void => {
    for (let y = rect.top; y < rect.top + rect.height; y++) {
      const start = (y * W + rect.left) * 4
      next.data.set(local.data.subarray(start, start + rect.width * 4), start)
    }
  }

  if (!solid.length) {
    for (const el of transparent) copyLocal(expandRect(el.box, pad, W, H))
    report.push({ level, method: 'transparent', elementCount: transparent.length })
    return { plate: next, report }
  }

  let generated: RgbaImage | null = null
  if (input.useGenerative && io.editImage) {
    throwIfAborted(io.signal)
    try {
      const image = await io.encodePng(next)
      const raw = await io.editImage({
        prompt: buildPeelEditPrompt({
          locale: input.locale,
          width: W,
          height: H,
          targets: solid.map((el) => ({ name: el.name, box: el.box }))
        }),
        image,
        aspectRatio: nearestAspectRatio(W, H)
      })
      if (raw) {
        const resized = resizeBilinear(raw, W, H)
        const shift = estimateShift(next, resized, hole)
        // 蒙版外平均色差过大 = 模型改了构图/画幅，结果不可用
        if (Number.isFinite(shift.error) && shift.error <= 24) {
          generated = shiftImage(resized, shift.dx, shift.dy)
        } else {
          io.log?.(
            `peel L${level}: generated plate rejected (misaligned, err=${shift.error.toFixed(1)})`
          )
        }
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err
      io.log?.(
        `peel L${level}: generative inpaint failed, using local fill (${String((err as Error)?.message ?? err)})`
      )
    }
  }

  // 羽化蒙版（向外扩 2px 再模糊 2px），蒙版外像素逐位保持原样
  const soft = new Float32Array(W * H)
  const grown = dilateMask(hole, W, H, 2)
  for (let p = 0; p < soft.length; p++) soft[p] = grown[p]!
  const feather = boxBlurFloat(soft, W, H, 2)
  const fill = generated ?? local
  for (let p = 0; p < feather.length; p++) {
    const m = hole[p] ? 1 : feather[p]!
    if (m <= 0) continue
    const i = p * 4
    for (let c = 0; c < 3; c++)
      next.data[i + c] = fill.data[i + c]! * m + next.data[i + c]! * (1 - m)
    // alpha 跟随本地补底（生图模型输出不带透明通道）
    next.data[i + 3] = local.data[i + 3]! * m + next.data[i + 3]! * (1 - m)
  }
  for (const el of transparent) copyLocal(expandRect(el.box, pad, W, H))
  if (transparent.length)
    report.push({ level, method: 'transparent', elementCount: transparent.length })

  if (generated) {
    // 模型没移掉的元素：改用本地补底
    let fallback = 0
    for (const el of solid) {
      const r = expandRect(el.box, pad, W, H)
      if (meanDistanceInRect(next, plate, r) >= 6) continue
      fallback++
      copyLocal(r)
    }
    if (fallback)
      io.log?.(`peel L${level}: ${fallback} element(s) not removed by the model, used local fill`)
    report.push({ level, method: 'generative', elementCount: solid.length - fallback })
    if (fallback) report.push({ level, method: 'local', elementCount: fallback })
  } else {
    report.push({ level, method: 'local', elementCount: solid.length })
  }
  return { plate: next, report }
}
