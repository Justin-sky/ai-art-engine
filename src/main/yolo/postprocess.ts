/**
 * YOLOv8 / YOLO11 后处理：从 ONNX 原始输出解析候选框、关键点、mask 权重，并做类内 NMS。
 * 输出坐标为 640 像素系（letterbox 后），由调用方用 scale / pad 逆映射回原图。
 *
 * 输出张量布局（batch=1，第一输出，row-major）：
 *   dims = [1, nRows, N]，内存 = data[row * N + col]
 * - detect: nRows = 4 + nc,         N = 8400
 * - pose:   nRows = 4 + nc + 51,    N = 8400
 * - seg:    nRows = 4 + nc + 32,    N = 8400  +  第二输出 [1, 32, 25600]（proto）
 */
import type { YoloTaskKind } from '@shared/yolo'

export interface Candidate {
  classId: number
  score: number
  /** [x1, y1, x2, y2] 640 坐标（含 letterbox padding） */
  box: [number, number, number, number]
  /** pose：COCO 17 关键点，[x, y, conf] 交错（相对 640 坐标） */
  kpts?: Float32Array
  /** seg：32 维 mask 系数 */
  maskWeights?: Float32Array
}

export interface ParsedOutput {
  candidates: Candidate[]
  /** seg：proto masks 扁平数组 [32, 25600]，候选 maskWeights 与之点乘后 sigmoid */
  maskProto?: Float32Array
}

/** row-major 读取：[row][col] */
function at(data: Float32Array, nCols: number, row: number, col: number): number {
  return data[row * nCols + col]
}

/** 扫描 class 分数区域，若存在 > 1 的值说明输出是 logits，需要 sigmoid */
function scoresNeedSigmoid(data: Float32Array, nCols: number, n: number, nc: number): boolean {
  for (let col = 0; col < n; col++) {
    for (let c = 0; c < nc; c++) {
      if (at(data, nCols, 4 + c, col) > 1) return true
    }
  }
  return false
}

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x))

export function parseYoloOutput(
  data: Float32Array,
  nRows: number,
  n: number,
  kind: YoloTaskKind,
  confThr: number,
  iouThr: number
): ParsedOutput {
  const nc = nRows - 4 - (kind === 'pose' ? 51 : 0) - (kind === 'segment' ? 32 : 0)
  const nkpt = kind === 'pose' ? 17 : 0
  const nmask = kind === 'segment' ? 32 : 0

  // 部分导出变体的 class 输出是未过 sigmoid 的 logits（值可远超 1），检测后统一映射回 0~1
  const needsSigmoid = scoresNeedSigmoid(data, n, n, nc)
  const scoreAt = (c: number, col: number): number => {
    const raw = at(data, n, 4 + c, col)
    return needsSigmoid ? sigmoid(raw) : raw
  }

  const candidates: Candidate[] = []
  for (let col = 0; col < n; col++) {
    let bestCls = -1
    let bestScore = 0
    for (let c = 0; c < nc; c++) {
      const s = scoreAt(c, col)
      if (s > bestScore) {
        bestScore = s
        bestCls = c
      }
    }
    if (bestCls < 0 || bestScore < confThr) continue

    const cx = at(data, n, 0, col)
    const cy = at(data, n, 1, col)
    const w = at(data, n, 2, col)
    const h = at(data, n, 3, col)
    // 退化框（面积≈0）直接丢弃，避免污染 NMS 结果
    if (w < 0.5 || h < 0.5) continue

    const cand: Candidate = {
      classId: bestCls,
      score: bestScore,
      box: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]
    }
    if (nkpt > 0) {
      const kpts = new Float32Array(nkpt * 3)
      for (let k = 0; k < nkpt * 3; k++) kpts[k] = at(data, n, 4 + nc + k, col)
      cand.kpts = kpts
    }
    if (nmask > 0) {
      const weights = new Float32Array(nmask)
      for (let m = 0; m < nmask; m++) weights[m] = at(data, n, 4 + nc + m, col)
      cand.maskWeights = weights
    }
    candidates.push(cand)
  }

  if (kind === 'segment') {
    throw new Error('YOLO: segment output needs proto tensor, use parseSegOutput instead')
  }
  return { candidates: nms(candidates, iouThr) }
}

/**
 * 分割专用：第一输出（候选 + mask 系数）与第二输出（proto）都已知时走这里。
 * proto 张量 [1, 32, 25600] 扁平化后为 [32, 25600]（row-major）。
 */
export function parseSegOutput(
  detData: Float32Array,
  nRows: number,
  n: number,
  proto: Float32Array,
  confThr: number,
  iouThr: number
): ParsedOutput {
  const nc = nRows - 4 - 32
  const needsSigmoid = scoresNeedSigmoid(detData, n, n, nc)
  const scoreAt = (c: number, col: number): number => {
    const raw = at(detData, n, 4 + c, col)
    return needsSigmoid ? sigmoid(raw) : raw
  }
  const candidates: Candidate[] = []
  for (let col = 0; col < n; col++) {
    let bestCls = -1
    let bestScore = 0
    for (let c = 0; c < nc; c++) {
      const s = scoreAt(c, col)
      if (s > bestScore) {
        bestScore = s
        bestCls = c
      }
    }
    if (bestCls < 0 || bestScore < confThr) continue
    const cx = at(detData, n, 0, col)
    const cy = at(detData, n, 1, col)
    const w = at(detData, n, 2, col)
    const h = at(detData, n, 3, col)
    if (w < 0.5 || h < 0.5) continue
    const weights = new Float32Array(32)
    for (let m = 0; m < 32; m++) weights[m] = at(detData, n, 4 + nc + m, col)
    candidates.push({
      classId: bestCls,
      score: bestScore,
      box: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2],
      maskWeights: weights
    })
  }
  return { candidates: nms(candidates, iouThr), maskProto: proto }
}

/** 把 32 维 mask 系数与 proto 合成为 [maskHw²] 的 0/1 mask（sigmoid > 0.5） */
export function composeMask(
  maskWeights: Float32Array,
  proto: Float32Array,
  maskHw: number
): Uint8Array {
  const area = maskHw * maskHw
  const out = new Uint8Array(area)
  for (let i = 0; i < area; i++) {
    let acc = 0
    for (let m = 0; m < 32; m++) acc += maskWeights[m] * proto[m * area + i]
    out[i] = sigmoid(acc) > 0.5 ? 1 : 0
  }
  return out
}

/** 类内 NMS（按分数降序，保留 IoU < iouThr 的候选） */
function nms(candidates: Candidate[], iouThr: number): Candidate[] {
  const picked: Candidate[] = []
  const sorted = [...candidates].sort((a, b) => b.score - a.score)
  while (sorted.length > 0) {
    const best = sorted.shift()!
    picked.push(best)
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].classId === best.classId && iou(sorted[i].box, best.box) >= iouThr) {
        sorted.splice(i, 1)
      }
    }
  }
  return picked
}

function iou(a: [number, number, number, number], b: [number, number, number, number]): number {
  const x1 = Math.max(a[0], b[0])
  const y1 = Math.max(a[1], b[1])
  const x2 = Math.min(a[2], b[2])
  const y2 = Math.min(a[3], b[3])
  const interW = Math.max(0, x2 - x1)
  const interH = Math.max(0, y2 - y1)
  const inter = interW * interH
  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1])
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1])
  const union = areaA + areaB - inter
  return union <= 0 ? 0 : inter / union
}
