/**
 * 宫格切分：将图按 rows×cols 纯裁切为各宫格，不调用大模型。
 * 选中格用 "r-c"（1-based）表示，与 UI 标签一致。
 */

export interface ImageGridSplitState {
  rows: number
  cols: number
  /** 选中的宫格，如 "1-1"；空数组表示运行时处理全部 */
  selected: string[]
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
  selected: []
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
    selected: normalizeGridSelected(base.selected, rows, cols)
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
