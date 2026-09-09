/**
 * 图标包 manifest（icons.json）纯构建器。
 *
 * 「整版切格 → 采样色键控 → 统一画布对齐 → 按名单命名 PNG」后的交付载体：
 * 把每枚图标的名字（名单名）、cellKey 格位、磁盘文件名、像素尺寸、锚点
 * （统一画布中心）沉淀为机器可读清单，供引擎加载器直接消费。
 * 纯函数、无 IO，可单测。
 */

export const ICON_PACK_MANIFEST_VERSION = 1 as const

export interface IconPackIconEntry {
  /** 名单名（如 火焰斩），引擎展示 / 检索用 */
  name: string
  /** 磁盘文件名（含扩展名，如 火焰斩.png） */
  fileName: string
  /** 整版表格位 key，如 1-1（1-based、逐行排列） */
  cellKey: string
  /** 像素宽 / 高（统一画布尺寸） */
  width: number
  height: number
  /** 锚点像素（相对图片左上角；图标包统一取画布中心） */
  anchorX: number
  anchorY: number
}

export interface IconPackManifest {
  version: typeof ICON_PACK_MANIFEST_VERSION
  kind: 'icon-pack'
  /** 批量导出标识（打包目录 / 一次运行） */
  packId: string
  createdAt: string
  /** 统一画布边长（方形；条目尺寸等于画布尺寸） */
  canvasSize: number
  /** 键控采样背景色（r/g/b 为 0~255 浮点均值）；none 模式为 null */
  background: { r: number; g: number; b: number } | null
  /** 整版表网格（用于把 cellKey 与名单序号互译） */
  grid: { rows: number; cols: number }
  icons: IconPackIconEntry[]
}

export interface BuildIconPackManifestInput {
  packId?: string
  createdAt?: string
  canvasSize: number
  background: { r: number; g: number; b: number } | null
  rows: number
  cols: number
  icons: Array<{
    name: string
    fileName: string
    cellKey: string
    width?: number
    height?: number
  }>
}

/** 文件 stem 清理：仅保留可见字符与常用安全符号；空白折叠为下划线 */
export function sanitizeIconStem(name: string): string {
  const raw = String(name ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .trim()
  return raw || 'icon'
}

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(n) ? n : 0)))
}

/**
 * 构建图标包清单。
 * - 条目保持传入顺序（名单顺序即 cellKey 顺序）；
 * - 缺失 width/height 按统一画布补齐；
 * - 锚点统一取画布中心；空名条目剔除。
 */
export function buildIconPackManifest(input: BuildIconPackManifestInput): IconPackManifest {
  const canvasSize = clampInt(input.canvasSize, 1, 8192)
  const rows = clampInt(input.rows, 1, 16)
  const cols = clampInt(input.cols, 1, 16)
  const anchorX = Math.round(canvasSize / 2)
  const anchorY = anchorX
  const icons: IconPackIconEntry[] = (input.icons ?? [])
    .filter((entry) => entry && String(entry.name ?? '').trim() && entry.fileName)
    .map((entry) => ({
      name: String(entry.name).trim(),
      fileName: entry.fileName,
      cellKey: entry.cellKey,
      width: clampInt(entry.width ?? canvasSize, 1, 8192),
      height: clampInt(entry.height ?? canvasSize, 1, 8192),
      anchorX,
      anchorY
    }))
  return {
    version: ICON_PACK_MANIFEST_VERSION,
    kind: 'icon-pack',
    packId: input.packId || `icons-${Date.now().toString(36)}`,
    createdAt: input.createdAt ?? new Date().toISOString(),
    canvasSize,
    background: input.background
      ? {
          r: input.background.r,
          g: input.background.g,
          b: input.background.b
        }
      : null,
    grid: { rows, cols },
    icons
  }
}
