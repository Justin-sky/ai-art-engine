/**
 * 实体替换掩码的纯函数（无 DOM，单测直接覆盖）。
 *
 * 掩码统一用 `Uint8Array`（每像素 0 / 1，长度 = 宽 × 高），白（1）= 要替换的区域。
 */
import { featherAlpha } from '@shared/yoloCutout'
import type { YoloBox } from '@shared/yolo'

export interface NormBox {
  x: number
  y: number
  w: number
  h: number
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * 点击点落在哪些实例的外接框里：按框面积从小到大排（点在人身上的商品，优先选商品而不是人）。
 * `point` 为原图像素坐标。调用方再用像素级掩码确认点击点确实在实例上。
 */
export function instancesAtPoint(boxes: YoloBox[], point: { x: number; y: number }): number[] {
  return boxes
    .map((box, index) => ({ box, index }))
    .filter(
      ({ box }) =>
        point.x >= box.x &&
        point.x <= box.x + box.width &&
        point.y >= box.y &&
        point.y <= box.y + box.height
    )
    .sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height)
    .map(({ index }) => index)
}

/**
 * 把 0/1 alpha 外扩 `radius` 像素。重绘区要比主体略大：贴着轮廓切，模型会在边缘留下原主体的残影。
 */
export function dilateMask(
  alpha: Float32Array,
  width: number,
  height: number,
  radius: number
): Uint8Array {
  const soft = radius > 0 ? featherAlpha(alpha, width, height, radius) : alpha
  const out = new Uint8Array(width * height)
  for (let i = 0; i < out.length; i++) out[i] = soft[i]! > 0.02 ? 1 : 0
  return out
}

/** 掩码白区的归一化外接框；全黑时返回 null */
export function maskBounds(mask: Uint8Array, width: number, height: number): NormBox | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      if (!mask[row + x]) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return null
  return {
    x: minX / width,
    y: minY / height,
    w: (maxX - minX + 1) / width,
    h: (maxY - minY + 1) / height
  }
}

/** 拖框（两个归一化角点）→ 规范化矩形；太小（误点）时返回 null */
export function rectFromDrag(
  a: { x: number; y: number },
  b: { x: number; y: number },
  minSize = 0.01
): NormBox | null {
  const x0 = clamp01(Math.min(a.x, b.x))
  const y0 = clamp01(Math.min(a.y, b.y))
  const x1 = clamp01(Math.max(a.x, b.x))
  const y1 = clamp01(Math.max(a.y, b.y))
  if (x1 - x0 < minSize || y1 - y0 < minSize) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** 矩形掩码 */
export function rectMask(width: number, height: number, box: NormBox): Uint8Array {
  const out = new Uint8Array(width * height)
  const x0 = Math.floor(box.x * width)
  const y0 = Math.floor(box.y * height)
  const x1 = Math.min(width, Math.ceil((box.x + box.w) * width))
  const y1 = Math.min(height, Math.ceil((box.y + box.h) * height))
  for (let y = Math.max(0, y0); y < y1; y++)
    out.fill(1, y * width + Math.max(0, x0), y * width + x1)
  return out
}

/**
 * 扣掉保护区（同镜已经换好的实体）：处理后一个实体时，不允许改动前一个刚换好的区域。
 *
 * - `coverage`：扣除后白区占整帧的比例（0 = 这个实体整块都被保护区盖住了，没得画）；
 * - `protectedRatio`：原白区里被扣掉的比例（重叠程度，超过阈值要警告）。
 */
export function subtractMasks(
  target: Uint8Array,
  protect: Uint8Array[]
): { mask: Uint8Array; coverage: number; protectedRatio: number } {
  const mask = Uint8Array.from(target)
  let before = 0
  let after = 0
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    before += 1
    if (protect.some((p) => p[i])) mask[i] = 0
    else after += 1
  }
  return {
    mask,
    coverage: mask.length ? after / mask.length : 0,
    protectedRatio: before ? (before - after) / before : 0
  }
}
