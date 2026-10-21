/**
 * 高精抠图（RMBG-1.4 / BiRefNet-Lite / MODNet）ONNX 推理管线（运行于 yoloWorker 子进程）。
 *
 * 与 YOLO 160×160 原型掩码不同，高精抠图模型在 512×512 或 1024×1024 分辨率下直接预测
 * 連続 Alpha 概率图（0~1），对发丝、半透明薄纱、非 COCO 游戏道具/图标及封闭内洞具有极高保真度。
 */
import { findMattingCatalogModel, type MattingNormalizationKind } from '@shared/mattingCatalog'
import type { YoloBox, YoloLetterboxGeometry } from '@shared/yolo'
import { createOrtSession } from './ortSession'

type OrtModule = typeof import('onnxruntime-node')
type OrtSession = import('onnxruntime-node').InferenceSession

/** 输出给渲染层的默认高精掩码网格边长上限（保留 1024×1024 原生推理分辨率，不降采样损毁发丝） */
export const MATTING_OUTPUT_MASK_HW = 1024

let cachedMatting: { path: string; session: OrtSession } | null = null

async function getMattingSession(mod: OrtModule, modelPath: string): Promise<OrtSession> {
  if (cachedMatting && cachedMatting.path === modelPath) {
    return cachedMatting.session
  }
  const session = await createOrtSession(mod, modelPath)
  cachedMatting = { path: modelPath, session }
  return session
}

export function disposeMattingSession(): void {
  cachedMatting = null
}

function inferSpecFromId(modelId: string): {
  inputSize: number
  norm: MattingNormalizationKind
} {
  const catalog = findMattingCatalogModel(modelId)
  if (catalog) {
    return { inputSize: catalog.inputSize, norm: catalog.norm }
  }
  const lower = modelId.toLowerCase()
  if (lower.includes('modnet')) return { inputSize: 512, norm: 'modnet' }
  if (lower.includes('birefnet')) return { inputSize: 1024, norm: 'imagenet' }
  return { inputSize: 1024, norm: 'rmbg' }
}

/**
 * 抑制高精抠图概率图中远离主体的微小离散伪影岛（如背景毯子边缘的小印花/角落暗影）。
 * 以 0.36 为核心前景连通阈值提取连通域，剔除面积不足最大连通域 4% 的外围孤立块，
 * 同时对保留连通域外扩 5px 软光环，确保主体的游离发梢与半透明边缘完整保留。
 */
function suppressPeripheralNoiseIslands(probGrid: Float32Array, hw: number): void {
  const total = hw * hw
  if (total <= 0) return
  const compId = new Int32Array(total).fill(-1)
  const compSizes: number[] = []
  const queue = new Int32Array(total)
  let maxCompArea = 0

  for (let i = 0; i < total; i++) {
    if (compId[i] !== -1 || probGrid[i]! < 0.36) continue
    const cid = compSizes.length
    let head = 0
    let tail = 0
    compId[i] = cid
    queue[tail++] = i
    while (head < tail) {
      const cur = queue[head++]!
      const cx = cur % hw
      const cy = (cur - cx) / hw
      if (cx > 0 && compId[cur - 1] === -1 && probGrid[cur - 1]! >= 0.36) {
        compId[cur - 1] = cid
        queue[tail++] = cur - 1
      }
      if (cx + 1 < hw && compId[cur + 1] === -1 && probGrid[cur + 1]! >= 0.36) {
        compId[cur + 1] = cid
        queue[tail++] = cur + 1
      }
      if (cy > 0 && compId[cur - hw] === -1 && probGrid[cur - hw]! >= 0.36) {
        compId[cur - hw] = cid
        queue[tail++] = cur - hw
      }
      if (cy + 1 < hw && compId[cur + hw] === -1 && probGrid[cur + hw]! >= 0.36) {
        compId[cur + hw] = cid
        queue[tail++] = cur + hw
      }
    }
    compSizes.push(tail)
    if (tail > maxCompArea) maxCompArea = tail
  }

  if (maxCompArea <= 0 || compSizes.length <= 1) return

  const minKeepArea = maxCompArea * 0.04
  const keepDist = new Int16Array(total).fill(32767)
  let head = 0
  let tail = 0
  for (let i = 0; i < total; i++) {
    const cid = compId[i]!
    if (cid >= 0 && compSizes[cid]! >= minKeepArea) {
      keepDist[i] = 0
      queue[tail++] = i
    }
  }
  const maxHalo = 6
  while (head < tail) {
    const cur = queue[head++]!
    const d = keepDist[cur]!
    if (d >= maxHalo) continue
    const cx = cur % hw
    const cy = (cur - cx) / hw
    const nbrs = [
      cx > 0 ? cur - 1 : -1,
      cx + 1 < hw ? cur + 1 : -1,
      cy > 0 ? cur - hw : -1,
      cy + 1 < hw ? cur + hw : -1
    ]
    for (const n of nbrs) {
      if (n >= 0 && keepDist[n]! > d + 1) {
        keepDist[n] = d + 1
        queue[tail++] = n
      }
    }
  }
  for (let i = 0; i < total; i++) {
    if (keepDist[i]! > maxHalo) {
      probGrid[i] = 0
    }
  }
}

function normalizeChannel(
  byteVal: number,
  channel: 0 | 1 | 2,
  norm: MattingNormalizationKind
): number {
  const u = byteVal / 255
  if (norm === 'imagenet') {
    const mean = channel === 0 ? 0.485 : channel === 1 ? 0.456 : 0.406
    const std = channel === 0 ? 0.229 : channel === 1 ? 0.224 : 0.225
    return (u - mean) / std
  }
  if (norm === 'modnet') {
    return (u - 0.5) / 0.5
  }
  // rmbg-1.4: mean=[0.5, 0.5, 0.5], std=[1.0, 1.0, 1.0]
  return u - 0.5
}

export interface MattingInferResult {
  box: YoloBox
  mask: { width: number; height: number; data: Uint8Array }
  letterbox: YoloLetterboxGeometry
}

export async function inferMattingSubject(
  mod: OrtModule,
  decoded: { rgba: Uint8Array; width: number; height: number },
  modelPath: string,
  modelId: string
): Promise<MattingInferResult | null> {
  const { width: srcWidth, height: srcHeight, rgba } = decoded
  if (srcWidth <= 0 || srcHeight <= 0) return null

  const spec = inferSpecFromId(modelId)
  const size = spec.inputSize
  const scale = Math.min(size / srcWidth, size / srcHeight)
  const newW = Math.max(1, Math.round(srcWidth * scale))
  const newH = Math.max(1, Math.round(srcHeight * scale))
  const padX = Math.floor((size - newW) / 2)
  const padY = Math.floor((size - newH) / 2)

  // BiRefNet-Lite / RMBG-1.4 / MODNet 均在全画幅直接双线性缩放（无 letterbox 填充条）分布上训练；
  // 直接缩放到 size×size 既能保留短边 100% 原生推理分辨率，又避免人工填充边导致贴边背景褶皱被误检为前景。
  const plane = size * size
  const tensor = new Float32Array(3 * plane)

  for (let y = 0; y < size; y++) {
    const sy = Math.min(srcHeight - 1, Math.max(0, ((y + 0.5) * srcHeight) / size - 0.5))
    const y0 = Math.floor(sy)
    const y1 = Math.min(srcHeight - 1, y0 + 1)
    const fy = sy - y0
    const dstRow = y * size
    for (let x = 0; x < size; x++) {
      const sx = Math.min(srcWidth - 1, Math.max(0, ((x + 0.5) * srcWidth) / size - 0.5))
      const x0 = Math.floor(sx)
      const x1 = Math.min(srcWidth - 1, x0 + 1)
      const fx = sx - x0
      const i00 = (y0 * srcWidth + x0) * 4
      const i10 = (y0 * srcWidth + x1) * 4
      const i01 = (y1 * srcWidth + x0) * 4
      const i11 = (y1 * srcWidth + x1) * 4
      const w00 = (1 - fx) * (1 - fy)
      const w10 = fx * (1 - fy)
      const w01 = (1 - fx) * fy
      const w11 = fx * fy
      const r = rgba[i00]! * w00 + rgba[i10]! * w10 + rgba[i01]! * w01 + rgba[i11]! * w11
      const g =
        rgba[i00 + 1]! * w00 + rgba[i10 + 1]! * w10 + rgba[i01 + 1]! * w01 + rgba[i11 + 1]! * w11
      const b =
        rgba[i00 + 2]! * w00 + rgba[i10 + 2]! * w10 + rgba[i01 + 2]! * w01 + rgba[i11 + 2]! * w11
      const dstIdx = dstRow + x
      tensor[dstIdx] = normalizeChannel(r, 0, spec.norm)
      tensor[plane + dstIdx] = normalizeChannel(g, 1, spec.norm)
      tensor[plane * 2 + dstIdx] = normalizeChannel(b, 2, spec.norm)
    }
  }

  const session = await getMattingSession(mod, modelPath)
  const inputName = session.inputNames[0]!
  const outputs = await session.run({
    [inputName]: new mod.Tensor('float32', tensor, [1, 3, size, size])
  })
  // 取首个具有空间维度的输出张量
  const outName =
    session.outputNames.find((name) => (outputs[name]?.data?.length ?? 0) >= 64 * 64) ??
    session.outputNames[0]!
  const rawData = outputs[outName]!.data as Float32Array
  const outHw = Math.max(1, Math.round(Math.sqrt(rawData.length)))

  // 判断输出是否为未激活的 logits（如 BiRefNet），若是则过 sigmoid
  let minVal = Infinity
  let maxVal = -Infinity
  for (let i = 0; i < rawData.length; i++) {
    const v = rawData[i]!
    if (v < minVal) minVal = v
    if (v > maxVal) maxVal = v
  }
  const isLogits = minVal < -0.05 || maxVal > 1.05
  const probGrid = new Float32Array(outHw * outHw)
  let pMin = Infinity
  let pMax = -Infinity
  for (let i = 0; i < probGrid.length; i++) {
    const raw = rawData[i]!
    const p = isLogits ? 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, raw)))) : raw
    probGrid[i] = p
    if (p < pMin) pMin = p
    if (p > pMax) pMax = p
  }
  const span = pMax - pMin
  if (span > 1e-4) {
    for (let i = 0; i < probGrid.length; i++) {
      probGrid[i] = Math.max(0, Math.min(1, (probGrid[i]! - pMin) / span))
    }
  }

  suppressPeripheralNoiseIslands(probGrid, outHw)

  // 将全画幅推理概率图重映射至统一的 letterbox 掩码坐标系（与 YOLO 实例分割及上层采样保持几何对齐）
  const maskHw = Math.min(MATTING_OUTPUT_MASK_HW, Math.max(512, outHw))
  const maskData = new Uint8Array(maskHw * maskHw)
  const padXMin = (padX / size) * maskHw
  const padXMax = ((padX + newW) / size) * maskHw
  const padYMin = (padY / size) * maskHw
  const padYMax = ((padY + newH) / size) * maskHw
  const contentW = Math.max(1e-5, padXMax - padXMin)
  const contentH = Math.max(1e-5, padYMax - padYMin)

  let minX = maskHw
  let minY = maskHw
  let maxX = -1
  let maxY = -1

  for (let my = 0; my < maskHw; my++) {
    if (my + 0.5 < padYMin || my + 0.5 > padYMax) continue
    const vNorm = (my + 0.5 - padYMin) / contentH
    const sy = vNorm * outHw - 0.5
    const y0 = Math.max(0, Math.min(outHw - 1, Math.floor(sy)))
    const y1 = Math.max(0, Math.min(outHw - 1, y0 + 1))
    const fy = Math.max(0, sy - y0)
    for (let mx = 0; mx < maskHw; mx++) {
      if (mx + 0.5 < padXMin || mx + 0.5 > padXMax) continue
      const uNorm = (mx + 0.5 - padXMin) / contentW
      const sx = uNorm * outHw - 0.5
      const x0 = Math.max(0, Math.min(outHw - 1, Math.floor(sx)))
      const x1 = Math.max(0, Math.min(outHw - 1, x0 + 1))
      const fx = Math.max(0, sx - x0)
      const top = probGrid[y0 * outHw + x0]! * (1 - fx) + probGrid[y0 * outHw + x1]! * fx
      const bot = probGrid[y1 * outHw + x0]! * (1 - fx) + probGrid[y1 * outHw + x1]! * fx
      const p = Math.max(0, Math.min(1, top * (1 - fy) + bot * fy))
      const byte = Math.round(p * 255)
      maskData[my * maskHw + mx] = byte
      if (byte >= 32) {
        if (mx < minX) minX = mx
        if (mx > maxX) maxX = mx
        if (my < minY) minY = my
        if (my > maxY) maxY = my
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return null
  }

  const toSrcX = (mx: number): number =>
    Math.max(0, Math.min(srcWidth, ((mx / maskHw) * size - padX) / scale))
  const toSrcY = (my: number): number =>
    Math.max(0, Math.min(srcHeight, ((my / maskHw) * size - padY) / scale))

  const bx1 = toSrcX(minX)
  const by1 = toSrcY(minY)
  const bx2 = toSrcX(maxX + 1)
  const by2 = toSrcY(maxY + 1)

  return {
    box: {
      label: 'matting-subject',
      confidence: 0.99,
      x: bx1,
      y: by1,
      width: Math.max(1, bx2 - bx1),
      height: Math.max(1, by2 - by1)
    },
    mask: {
      width: maskHw,
      height: maskHw,
      data: maskData
    },
    letterbox: {
      size,
      scale,
      padX,
      padY
    }
  }
}

/**
 * 将低分辨率的 YOLO 实例掩码（如 160×160）双线性重采样到高精掩码网格（如 512×512），
 * 并与高精抠图掩码融合：实例框内的高频发丝/镂空细节由 mattingMask 主导，实例归属由 yoloMask 约束。
 */
export function fuseYoloInstanceWithMattingMask(
  yoloMask: Uint8Array,
  yoloHw: number,
  mattingMask: Uint8Array,
  targetHw: number
): Uint8Array {
  const out = new Uint8Array(targetHw * targetHw)
  if (yoloHw <= 0 || targetHw <= 0) return out
  for (let y = 0; y < targetHw; y++) {
    const sy = ((y + 0.5) / targetHw) * yoloHw - 0.5
    const y0 = Math.max(0, Math.min(yoloHw - 1, Math.floor(sy)))
    const y1 = Math.max(0, Math.min(yoloHw - 1, y0 + 1))
    const fy = Math.max(0, sy - y0)
    const row = y * targetHw
    for (let x = 0; x < targetHw; x++) {
      const sx = ((x + 0.5) / targetHw) * yoloHw - 0.5
      const x0 = Math.max(0, Math.min(yoloHw - 1, Math.floor(sx)))
      const x1 = Math.max(0, Math.min(yoloHw - 1, x0 + 1))
      const fx = Math.max(0, sx - x0)
      const top = yoloMask[y0 * yoloHw + x0]! * (1 - fx) + yoloMask[y0 * yoloHw + x1]! * fx
      const bot = yoloMask[y1 * yoloHw + x0]! * (1 - fx) + yoloMask[y1 * yoloHw + x1]! * fx
      const yProb = (top * (1 - fy) + bot * fy) / 255
      if (yProb <= 0.08) continue
      const mProb = mattingMask[row + x]! / 255
      // 在实例覆盖范围内优先采用高精抠图的边缘概率；若高精抠图也有响应则取交集精修
      const fused = mProb > 0.02 ? mProb * Math.min(1, yProb * 1.6) : yProb * 0.85
      out[row + x] = Math.round(Math.max(0, Math.min(1, fused)) * 255)
    }
  }
  return out
}
