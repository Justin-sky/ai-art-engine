/**
 * 宫格切分：将图划分为 rows×cols，可选多格做局部高清放大。
 * 选中格用 "r-c"（1-based）表示，与 UI 标签一致。
 */

import { normalizeUpscaleScale, upscaleScaleToResolution, type UpscaleScale } from './imageUpscale'

export interface ImageGridSplitState {
  rows: number
  cols: number
  /** 选中的宫格，如 "1-1"；空数组表示运行时处理全部 */
  selected: string[]
  /** 局部放大倍数 */
  scale: UpscaleScale
  /** 输出分辨率档（如 1K / 2K / 4K / 1080p）；缺省按 scale 推导 */
  resolution?: string
}

export const GRID_SPLIT_PRESETS: readonly { rows: number; cols: number; labelKey: string }[] = [
  { rows: 2, cols: 2, labelKey: 'p4' },
  { rows: 3, cols: 3, labelKey: 'p9' },
  { rows: 4, cols: 4, labelKey: 'p16' },
  { rows: 5, cols: 5, labelKey: 'p25' }
] as const

export const GRID_SPLIT_MAX = 5
export const GRID_SPLIT_MIN = 1

export const DEFAULT_IMAGE_GRID_SPLIT: ImageGridSplitState = {
  rows: 3,
  cols: 3,
  selected: [],
  scale: 2
}

function clampDim(n: unknown): number {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v)) return 3
  return Math.min(GRID_SPLIT_MAX, Math.max(GRID_SPLIT_MIN, v))
}

export function cellKey(row1: number, col1: number): string {
  return `${row1}-${col1}`
}

export function parseCellKey(key: string): { row: number; col: number } | null {
  const m = /^(\d+)-(\d+)$/.exec(String(key).trim())
  if (!m) return null
  const row = Number(m[1])
  const col = Number(m[2])
  if (!Number.isFinite(row) || !Number.isFinite(col) || row < 1 || col < 1) return null
  return { row, col }
}

export function normalizeGridSelected(
  raw: unknown,
  rows: number,
  cols: number
): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const parsed = parseCellKey(String(item))
    if (!parsed) continue
    if (parsed.row > rows || parsed.col > cols) continue
    const k = cellKey(parsed.row, parsed.col)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

export function normalizeImageGridSplit(
  raw?: Partial<ImageGridSplitState> | null
): ImageGridSplitState {
  const base = { ...DEFAULT_IMAGE_GRID_SPLIT, ...(raw ?? {}) }
  const rows = clampDim(base.rows)
  const cols = clampDim(base.cols)
  return {
    rows,
    cols,
    selected: normalizeGridSelected(base.selected, rows, cols),
    scale: normalizeUpscaleScale(base.scale),
    ...(typeof base.resolution === 'string' && base.resolution.trim()
      ? { resolution: base.resolution.trim() }
      : {})
  }
}

/** 运行目标格：有选中用选中，否则全部 */
export function resolveGridSplitTargets(state: ImageGridSplitState): string[] {
  const s = normalizeImageGridSplit(state)
  if (s.selected.length) return [...s.selected]
  const all: string[] = []
  for (let r = 1; r <= s.rows; r++) {
    for (let c = 1; c <= s.cols; c++) {
      all.push(cellKey(r, c))
    }
  }
  return all
}

/** 宫格在原图上的归一化裁切框（0–1） */
export function gridCellCropRect(
  rows: number,
  cols: number,
  row1: number,
  col1: number
): { cropX: number; cropY: number; cropW: number; cropH: number } {
  const r = Math.max(1, Math.min(rows, row1))
  const c = Math.max(1, Math.min(cols, col1))
  const cropW = 1 / Math.max(1, cols)
  const cropH = 1 / Math.max(1, rows)
  return {
    cropX: (c - 1) * cropW,
    cropY: (r - 1) * cropH,
    cropW,
    cropH
  }
}

export function buildGridCellUpscalePrompt(cellLabel: string, scale: UpscaleScale): string {
  return [
    `Faithfully upscale the entire reference image (grid cell ${cellLabel}) by ${scale}x`,
    'this reference IS the full tile to enlarge — keep the exact same framing and composition',
    'enhance sharpness and local detail only',
    'preserve texture, edges, identity, colors and relative subject sizes',
    'no zoom-in, no crop, no reframe, no focus shift to a single object',
    'no restyling, no added objects, no borders, no text'
  ].join(', ')
}

/** 按裁切格像素比贴近模型常用宽高比，避免默认方图导致模型二次构图 */
export function nearestApiAspectRatio(
  width: number,
  height: number,
  candidates: readonly string[] = [
    '1:1',
    '5:4',
    '4:5',
    '4:3',
    '3:4',
    '3:2',
    '2:3',
    '16:9',
    '9:16',
    '2:1',
    '1:2',
    '21:9',
    '9:21'
  ]
): string {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  const target = w / h
  let best = '1:1'
  let bestScore = Number.POSITIVE_INFINITY
  for (const raw of candidates) {
    const m = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(String(raw).trim())
    if (!m) continue
    const aw = Number(m[1])
    const ah = Number(m[2])
    if (!(aw > 0) || !(ah > 0)) continue
    const score = Math.abs(Math.log(target) - Math.log(aw / ah))
    if (score < bestScore) {
      bestScore = score
      best = `${Math.round(aw)}:${Math.round(ah)}`
    }
  }
  return best
}

export function gridSplitScaleToResolution(scale: UpscaleScale): string {
  return upscaleScaleToResolution(scale)
}

/** 宫格放大输出分辨率：优先用节点显式 resolution，否则按 scale 推导 */
export function gridSplitOutputResolution(state: ImageGridSplitState): string {
  return state.resolution?.trim() || gridSplitScaleToResolution(state.scale)
}

export function readImageGridSplitFromNode(params: {
  imageGridSplit?: Partial<ImageGridSplitState>
}): ImageGridSplitState {
  return normalizeImageGridSplit(params.imageGridSplit)
}

export function imageGridSplitToNodePatch(state: ImageGridSplitState): {
  imageGridSplit: ImageGridSplitState
} {
  return { imageGridSplit: normalizeImageGridSplit(state) }
}
