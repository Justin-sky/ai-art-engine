/**
 * 图标包导出（image.iconPack）：整版图标表 → 逐格（cellKey r-c）裁切 →
 * 采样色键控透明 → 统一画布对齐打包 → 按名单命名 PNG + icons manifest。
 * 纯本地处理、不调用大模型；与 2D 特效 anim2d 的「逐格 compose」同构。
 */

export type IconPackKeyMode = 'auto' | 'black' | 'white' | 'none'

export interface IconPackState {
  /** 整版表网格行数（1~5） */
  rows: number
  /** 整版表网格列数（1~5） */
  cols: number
  /** 裁切后向内收缩像素，削格线/黑边；`'auto'` 按格子尺寸估算 */
  edgeInset: number | 'auto'
  /**
   * 键控模式：
   * - `auto`：从整版空白格（名单未占满时）或版面外框采样纯色底再键控；
   * - `black` / `white`：固定黑 / 白底快捷键控；
   * - `none`：不抠透明，原样打包。
   */
  keyColor: IconPackKeyMode
  /** 采样色键控距离阈值（0~255，默认 40） */
  distance: number
  /** 键控软过渡羽化（0~255，默认 34） */
  feather: number
  /**
   * 统一画布边长（方形，1~2048）；0 = 按本批键控后主体最大外接框自动定边
   * （锚点统一为画布中心）。
   */
  canvasSize: number
}

export const ICON_PACK_DEFAULT_ROWS = 3
export const ICON_PACK_DEFAULT_COLS = 3
export const ICON_PACK_DEFAULT_DISTANCE = 40
export const ICON_PACK_DEFAULT_FEATHER = 34

export const DEFAULT_ICON_PACK: IconPackState = {
  rows: ICON_PACK_DEFAULT_ROWS,
  cols: ICON_PACK_DEFAULT_COLS,
  edgeInset: 'auto',
  keyColor: 'auto',
  distance: ICON_PACK_DEFAULT_DISTANCE,
  feather: ICON_PACK_DEFAULT_FEATHER,
  canvasSize: 0
}

export const ICON_PACK_GRID_MAX = 5
export const ICON_PACK_GRID_MIN = 1

function clampDim(n: unknown): number {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v)) return 3
  return Math.min(ICON_PACK_GRID_MAX, Math.max(ICON_PACK_GRID_MIN, v))
}

export function normalizeIconPackKeyMode(raw: unknown): IconPackKeyMode {
  const v = String(raw ?? '')
  if (v === 'black' || v === 'white' || v === 'none') return v
  return 'auto'
}

export function normalizeIconPackState(raw?: Partial<IconPackState> | null): IconPackState {
  const base = { ...DEFAULT_ICON_PACK, ...(raw ?? {}) }
  const rows = clampDim(base.rows)
  const cols = clampDim(base.cols)
  const edgeInsetRaw = base.edgeInset
  const edgeInset: IconPackState['edgeInset'] =
    edgeInsetRaw === 'auto'
      ? 'auto'
      : Math.max(0, Math.min(64, Math.floor(Number(edgeInsetRaw) || 0)))
  const distance = Math.max(0, Math.min(255, Math.round(Number(base.distance) || 0)))
  const feather = Math.max(0, Math.min(255, Math.round(Number(base.feather) || 0)))
  const canvasSize = Math.max(0, Math.min(2048, Math.round(Number(base.canvasSize) || 0)))
  return {
    rows,
    cols,
    edgeInset,
    keyColor: normalizeIconPackKeyMode(base.keyColor),
    distance: distance > 0 ? distance : ICON_PACK_DEFAULT_DISTANCE,
    feather,
    canvasSize
  }
}

export function readIconPackFromNode(params: { iconPack?: Partial<IconPackState> }): IconPackState {
  return normalizeIconPackState(params.iconPack)
}

export function iconPackToNodePatch(state: IconPackState): { iconPack: IconPackState } {
  return { iconPack: normalizeIconPackState(state) }
}

/** 整版表逐行格位 key 序列（row-major，1-based）：如 3×3 → 1-1…3-3 */
export function iconPackCellKeys(rows: number, cols: number): string[] {
  const r = Math.max(1, Math.floor(rows))
  const c = Math.max(1, Math.floor(cols))
  const out: string[] = []
  for (let row = 1; row <= r; row++) {
    for (let col = 1; col <= c; col++) {
      out.push(`${row}-${col}`)
    }
  }
  return out
}

/** 名单行 → 格位 key：顺序即整版表 row-major 顺序 */
export function iconPackCellKeyAt(rows: number, cols: number, index0: number): string {
  const cap = Math.max(1, rows * cols)
  const i = Math.max(0, Math.min(cap - 1, index0))
  return `${Math.floor(i / cols) + 1}-${(i % cols) + 1}`
}

/** 文本名单解析：每行一枚；空行与注释行（以 # / // 开头）忽略 */
export function parseIconNameLines(rawText: string): string[] {
  return String(rawText ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('//'))
}

/** 解析格位 key（1-1 → row1/col1）；非法输入返回 null */
export function parseIconCellKey(cellKey: string): { row1: number; col1: number } | null {
  const m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(String(cellKey ?? ''))
  if (!m) return null
  const row1 = Number(m[1])
  const col1 = Number(m[2])
  if (!Number.isInteger(row1) || !Number.isInteger(col1) || row1 < 1 || col1 < 1) return null
  return { row1, col1 }
}

/**
 * 单枚回炉覆盖（「逐枚精修」）：cellKey → 该枚的精修后方形卡片图 dataURL。
 * 挂 image.iconPack 节点参数 `iconPackCellRefines`，再跑打包即用精修图
 * 顶替对应格位重出该枚透明 PNG；其余格仍从整版裁切，互不影响。
 */
export interface IconPackCellRefine {
  cellKey: string
  dataUrl: string
  /** 回炉时间（ISO）；用于区分多轮精修 */
  updatedAt?: string
}

export type IconPackCellRefines = Record<string, IconPackCellRefine>

const ICON_DATA_URL_PREFIX = 'data:image/'

/** 归一化回炉覆盖参数：仅保留格位 key 合法且 dataUrl 以 data:image/ 开头的条目 */
export function normalizeIconPackCellRefines(
  raw?: Partial<Record<string, string | Partial<IconPackCellRefine>>> | null
): IconPackCellRefines {
  const out: IconPackCellRefines = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [key, value] of Object.entries(raw)) {
    if (!parseIconCellKey(key)) continue
    const dataUrl =
      typeof value === 'string'
        ? value.trim()
        : typeof value?.dataUrl === 'string'
          ? value.dataUrl.trim()
          : ''
    if (!dataUrl.startsWith(ICON_DATA_URL_PREFIX)) continue
    out[key] = {
      cellKey: key,
      dataUrl,
      updatedAt: typeof value === 'object' && typeof value.updatedAt === 'string' ? value.updatedAt : undefined
    }
  }
  return out
}

export function readIconPackRefinesFromNode(params: {
  iconPackCellRefines?: Partial<Record<string, string | Partial<IconPackCellRefine>>>
}): IconPackCellRefines {
  return normalizeIconPackCellRefines(params.iconPackCellRefines)
}

/** 回炉覆盖 → 画布合成入参（cellKey → 精修图 dataURL） */
export function iconPackCellRefinesToOverrides(
  refines: IconPackCellRefines
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [cellKey, refine] of Object.entries(refines ?? {})) {
    if (refine?.dataUrl) out[cellKey] = refine.dataUrl
  }
  return out
}
