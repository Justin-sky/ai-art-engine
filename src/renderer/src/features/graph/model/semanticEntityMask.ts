/**
 * 实体替换掩码（渲染层）：在关键帧上点选 / 框选目标 → 黑白掩码 PNG；重建时扣保护区。
 *
 * 分割用本地 YOLO 实例分割（仓库里没有 SAM2 推理）：点一下，选**包含点击点**的实例；
 * YOLO 不认识的物体（多数商品）由用户拖框。几何换算在 `semanticEntityMaskMath.ts`。
 */
import { buildCutoutAlpha } from '@shared/yoloCutout'
import { analyzeCutout, loadImageElement, type CutoutAnalysis } from '../../yolo/cutout'
import { resolveAssetFileUrl } from '../../media/assetUrlCache'
import {
  dilateMask,
  instancesAtPoint,
  maskBounds,
  rectMask,
  subtractMasks,
  type NormBox
} from './semanticEntityMaskMath'

/** 实例掩码外扩比例（相对长边）：重绘区略大于主体，避免边缘残影 */
const DILATE_RATIO = 0.012
const SEGMENT_CONF = 0.25

export interface KeyframeSegmentation {
  relativePath: string
  url: string
  /** 原图分辨率（掩码按它输出） */
  width: number
  height: number
  analysis: CutoutAnalysis
}

export interface EntityMaskResult {
  dataUrl: string
  box: NormBox
  method: 'instance' | 'rect'
  /** 选中实例的类别名（rect 时为空） */
  label?: string
}

const segmentCache = new Map<string, Promise<KeyframeSegmentation>>()

/** 关键帧分割一次、缓存（同一帧点好几次不重复推理） */
export function segmentKeyframe(relativePath: string): Promise<KeyframeSegmentation> {
  const hit = segmentCache.get(relativePath)
  if (hit) return hit
  const task = (async () => {
    const url = await resolveAssetFileUrl(relativePath)
    const { analysis, image } = await analyzeCutout({ url, relativePath }, SEGMENT_CONF)
    return {
      relativePath,
      url,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      analysis
    }
  })()
  segmentCache.set(relativePath, task)
  task.catch(() => segmentCache.delete(relativePath))
  return task
}

function instanceAlpha(seg: KeyframeSegmentation, index: number): Float32Array {
  const a = seg.analysis
  const at = a.instances.findIndex((it) => it.index === index)
  return buildCutoutAlpha({
    masks: at >= 0 && a.masks[at] ? [a.masks[at]!] : [],
    maskHw: a.maskHw,
    soft: a.soft,
    letterbox: a.letterbox,
    srcWidth: a.srcWidth,
    srcHeight: a.srcHeight,
    threshold: 0.5,
    outScale: a.outputScale
  })
}

/**
 * 点选：`point` 为归一化坐标。取框包含点击点、且像素掩码也覆盖点击点的实例里**最小**的那个。
 * 没有命中时返回 null（界面提示改用拖框）。
 */
export async function maskFromPoint(
  seg: KeyframeSegmentation,
  point: { x: number; y: number }
): Promise<EntityMaskResult | null> {
  const a = seg.analysis
  const src = { x: point.x * a.srcWidth, y: point.y * a.srcHeight }
  const boxes = a.instances.map((it) => it.box)
  for (const order of instancesAtPoint(boxes, src)) {
    const index = a.instances[order]!.index
    const alpha = instanceAlpha(seg, index)
    const w = Math.max(1, Math.round(a.srcWidth * a.outputScale))
    const h = Math.max(1, Math.round(a.srcHeight * a.outputScale))
    const px = Math.min(w - 1, Math.floor(point.x * w))
    const py = Math.min(h - 1, Math.floor(point.y * h))
    if (!alpha[py * w + px]) continue
    const mask = dilateMask(alpha, w, h, Math.round(Math.max(w, h) * DILATE_RATIO))
    const box = maskBounds(mask, w, h)
    if (!box) continue
    return {
      dataUrl: binaryToPng(mask, w, h),
      box,
      method: 'instance',
      label: a.instances[order]!.labelZh
    }
  }
  return null
}

const sizeCache = new Map<string, Promise<{ width: number; height: number }>>()

/** 关键帧原分辨率（不跑分割：框选在没装 YOLO 模型时也要能用） */
export function keyframeSize(relativePath: string): Promise<{ width: number; height: number }> {
  const hit = sizeCache.get(relativePath)
  if (hit) return hit
  const task = (async () => {
    const img = await loadImageElement(await resolveAssetFileUrl(relativePath))
    return { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height }
  })()
  sizeCache.set(relativePath, task)
  task.catch(() => sizeCache.delete(relativePath))
  return task
}

/** 拖框：矩形掩码（按关键帧原分辨率） */
export function maskFromRect(
  size: { width: number; height: number },
  box: NormBox
): EntityMaskResult {
  return {
    dataUrl: binaryToPng(rectMask(size.width, size.height, box), size.width, size.height),
    box,
    method: 'rect'
  }
}

function binaryToPng(mask: Uint8Array, width: number, height: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('MASK_CANVAS_UNAVAILABLE')
  const img = ctx.createImageData(width, height)
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? 255 : 0
    img.data[i * 4] = v
    img.data[i * 4 + 1] = v
    img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

/** 读黑白掩码（可缩放到指定尺寸，让保护区与目标掩码逐像素对齐） */
async function readBinary(
  dataUrl: string,
  size?: { width: number; height: number }
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const img = await loadImageElement(dataUrl)
  const width = size?.width ?? (img.naturalWidth || img.width)
  const height = size?.height ?? (img.naturalHeight || img.height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('MASK_CANVAS_UNAVAILABLE')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)
  const rgba = ctx.getImageData(0, 0, width, height).data
  const data = new Uint8Array(width * height)
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4]! > 127 ? 1 : 0
  return { data, width, height }
}

/** 重建能力 `composeEntityMask`：目标掩码扣掉保护区，返回新掩码与重叠情况 */
export async function composeEntityMask(input: {
  maskDataUrl: string
  protectMaskDataUrls: string[]
}): Promise<{ dataUrl: string; coverage: number; protectedRatio: number }> {
  const target = await readBinary(input.maskDataUrl)
  const size = { width: target.width, height: target.height }
  const protect = await Promise.all(input.protectMaskDataUrls.map((url) => readBinary(url, size)))
  const result = subtractMasks(
    target.data,
    protect.map((p) => p.data)
  )
  return {
    dataUrl: binaryToPng(result.mask, target.width, target.height),
    coverage: result.coverage,
    protectedRatio: result.protectedRatio
  }
}
