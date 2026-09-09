/**
 * UI 资产包（5.4「2D 游戏资产版」— UI 资产包（部件化 / 九宫格））共享纯函数层。
 *
 * 从 gameUi 的「整屏效果图」中提取引擎可拼装 UI kit：把面板底 / 按钮 / 输入框 /
 * 页签 / 弹窗等可复用控件记为一个部件（源图像素框选 + 9-slice 切边 + 安全边距），
 * 导出为透明 PNG + uiKit manifest。本文件只承载数据模型 / 归一化 / 命名规范 /
 * 九宫格拉伸网格几何 / manifest 构建，均无 DOM / IO 依赖，交互标注与导出工具
 * （素材库图片资产入口）另在 renderer 层接线。
 */

/** uiKit 部件清单文档结构版本；切边 / 命名 / 几何契约变化时递增 */
export const UI_KIT_DOCUMENT_VERSION = 1

/** 可复用控件类型：引擎按该类型决定九宫格用法（面板底可整块拉伸、弹窗拆边框+内容区…） */
export const UI_KIT_PART_KINDS = ['panel', 'button', 'input', 'tab', 'popup'] as const

export type UiKitPartKind = (typeof UI_KIT_PART_KINDS)[number]

/** 命名规范：部件落资产库的文件名前缀，统一小写 kebab-case，避免引擎按类型归类时命名漂移 */
export const UI_KIT_PART_KIND_PREFIXES: Record<UiKitPartKind, string> = {
  panel: 'panel',
  button: 'btn',
  input: 'input',
  tab: 'tab',
  popup: 'popup'
}

export function isUiKitPartKind(value: unknown): value is UiKitPartKind {
  return UI_KIT_PART_KINDS.includes(value as UiKitPartKind)
}

/** 通用像素矩形（源图坐标系） */
export interface UiKitRect {
  x: number
  y: number
  width: number
  height: number
}

/** 四向等距注记：9-slice 切边 / 安全边距均用同一结构 */
export interface UiKitInset {
  left: number
  top: number
  right: number
  bottom: number
}

/** 单个 UI 部件标注：矩形在源整屏图上的像素位置 + 可拉伸切边 + 文字安全边距 */
export interface UiKitPart {
  /** 部件唯一 id（仅用于编辑器定位，不参与落盘文件名） */
  id: string
  kind: UiKitPartKind
  /** 文件名主干（不含前缀与扩展名），编辑器给出默认值后可改，仅允许安全字符 */
  name: string
  /** 源图裁剪矩形（像素，整数，已夹取在源图内） */
  rect: UiKitRect
  /** 9-slice 切边（像素）：四边不参与拉伸的部分 */
  border: UiKitInset
  /** 安全边距（像素）：引擎叠本地化文字时建议的内容留白 */
  safe: UiKitInset
}

/** uiKit 文档：一次整屏提取的全部部件 + 源图信息 */
export interface UiKitDocument {
  version: number
  sourceName: string
  sourceWidth: number
  sourceHeight: number
  parts: UiKitPart[]
}

/** manifest 条目（落盘后文件名不含目录） */
export interface UiKitManifestPart {
  id: string
  name: string
  kind: UiKitPartKind
  /** 建议落盘文件名，如 btn-close.png */
  fileName: string
  /** 源整屏图中的裁剪矩形 */
  rect: UiKitRect
  border: UiKitInset
  safe: UiKitInset
}

/** UI kit 交付清单：引擎 / 自动化管线按它把透明 PNG 部件装成可拼装 UI */
export interface UiKitManifest {
  version: number
  kind: 'ui-kit'
  sourceName: string
  sourceWidth: number
  sourceHeight: number
  parts: UiKitManifestPart[]
}

export interface UiKitManifestInput {
  sourceName: string
  sourceWidth: number
  sourceHeight: number
  parts: UiKitPart[]
}

export function emptyUiKitInset(): UiKitInset {
  return { left: 0, top: 0, right: 0, bottom: 0 }
}

export function emptyUiKitRect(): UiKitRect {
  return { x: 0, y: 0, width: 0, height: 0 }
}

function toFiniteInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : NaN
  return Number.isFinite(n) ? n : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeInset(value: unknown): UiKitInset {
  if (!value || typeof value !== 'object') return emptyUiKitInset()
  const raw = value as Record<string, unknown>
  return {
    left: Math.max(0, toFiniteInt(raw.left, 0)),
    top: Math.max(0, toFiniteInt(raw.top, 0)),
    right: Math.max(0, toFiniteInt(raw.right, 0)),
    bottom: Math.max(0, toFiniteInt(raw.bottom, 0))
  }
}

/** 把切边 / 安全边距夹取到部件矩形内：左右合计不越界、上下合计不越界 */
export function clampInsetToSize(inset: UiKitInset, width: number, height: number): UiKitInset {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  const maxSide = (side: number, limit: number): number => Math.min(limit, Math.max(0, side))
  // 双边合计最多占满部件（允许中心拉伸区为 0）；单边不超过一半避免另一侧被完全吞掉
  const left = maxSide(inset.left, w)
  const right = maxSide(inset.right, w - left)
  const top = maxSide(inset.top, h)
  const bottom = maxSide(inset.bottom, h - top)
  return { left, top, right, bottom }
}

/** 把矩形夹取进源图并取整；全空 / 越界过大时兜底为全图 */
export function clampUiKitRect(
  raw: unknown,
  sourceWidth: number,
  sourceHeight: number
): UiKitRect {
  const w = Math.max(1, sourceWidth)
  const h = Math.max(1, sourceHeight)
  if (!raw || typeof raw !== 'object') return { x: 0, y: 0, width: w, height: h }
  const rect = raw as Record<string, unknown>
  let x = toFiniteInt(rect.x, 0)
  let y = toFiniteInt(rect.y, 0)
  let width = toFiniteInt(rect.width, 0)
  let height = toFiniteInt(rect.height, 0)
  if (width <= 0 || height <= 0) return { x: 0, y: 0, width: w, height: h }
  x = clamp(x, 0, w - 1)
  y = clamp(y, 0, h - 1)
  width = clamp(width, 1, w - x)
  height = clamp(height, 1, h - y)
  return { x, y, width, height }
}

/** 部件默认命名：按类型前缀 + 序号递增（btn-1 / panel-2…），编辑器可再改成业务名 */
export function defaultUiKitPartName(kind: UiKitPartKind, index: number): string {
  return `${UI_KIT_PART_KIND_PREFIXES[kind]}-${Math.max(1, index + 1)}`
}

/** 文件主干安全化：小写 + 仅保留字母数字连字符，去掉首尾连字符，限长 */
export function sanitizeUiKitPartName(raw: string, fallback: string): string {
  const stem = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return stem || fallback
}

/**
 * 解析 / 归一化单个部件。矩形自动夹取进源图，切边与安全边距夹取进部件内，
 * 文件名主干去掉非法字符并保证与已用集合不重名。
 */
export function normalizeUiKitPart(
  raw: unknown,
  index: number,
  source: { width: number; height: number },
  usedNames?: Set<string>
): UiKitPart | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const kind = isUiKitPartKind(rec.kind) ? rec.kind : 'panel'
  const rect = clampUiKitRect(rec.rect ?? rec, source.width, source.height)
  const baseName = typeof rec.name === 'string' ? rec.name.trim() : ''
  const defaultName = defaultUiKitPartName(kind, index)
  const sanitized = sanitizeUiKitPartName(baseName, defaultName)
  const used = usedNames ?? new Set<string>()
  let name = sanitized
  let suffix = 2
  while (used.has(name)) {
    name = `${sanitized}-${suffix}`
    suffix += 1
  }
  used.add(name)
  const border = clampInsetToSize(normalizeInset(rec.border), rect.width, rect.height)
  const safe = clampInsetToSize(normalizeInset(rec.safe), rect.width, rect.height)
  const id = typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim() : `${kind}-${index + 1}`
  return { id, kind, name, rect, border, safe }
}

/**
 * 归一化一份 uiKit 文档：源尺寸兜底、部件逐条归一化，缺失 / 非法部件丢弃。
 * 纯函数不查磁盘 / 不生成 id 依赖随机源。
 */
export function normalizeUiKitDocument(
  raw: unknown,
  source: { name?: string; width?: number; height?: number }
): UiKitDocument {
  const sourceWidth = Math.max(1, toFiniteInt(source.width ?? (raw as Record<string, unknown>)?.sourceWidth, 1))
  const sourceHeight = Math.max(1, toFiniteInt(source.height ?? (raw as Record<string, unknown>)?.sourceHeight, 1))
  const fallbackParts: unknown[] = []
  let rawParts: unknown[] = fallbackParts
  if (raw && typeof raw === 'object') {
    const rec = raw as Record<string, unknown>
    if (Array.isArray(rec.parts)) rawParts = rec.parts
    else if (Array.isArray(rec)) rawParts = rec
  }
  const usedNames = new Set<string>()
  const parts: UiKitPart[] = []
  for (let i = 0; i < rawParts.length; i += 1) {
    const part = normalizeUiKitPart(rawParts[i], i, { width: sourceWidth, height: sourceHeight }, usedNames)
    if (part) parts.push(part)
  }
  const sourceName = sanitizeUiKitPartName(
    typeof source.name === 'string' ? source.name : '',
    'ui-kit'
  )
  return {
    version: UI_KIT_DOCUMENT_VERSION,
    sourceName,
    sourceWidth,
    sourceHeight,
    parts
  }
}

/** 部件文件名主干（含类型前缀后落盘）。name 统一再做一次安全化，防止脏数据入库 */
function uiKitPartStem(part: Pick<UiKitPart, 'kind' | 'name'>): string {
  return sanitizeUiKitPartName(part.name, UI_KIT_PART_KIND_PREFIXES[part.kind])
}

/** 建议落盘文件名：`<类型前缀>-<name>.png` */
export function uiKitPartFileName(part: Pick<UiKitPart, 'kind' | 'name'>): string {
  return `${UI_KIT_PART_KIND_PREFIXES[part.kind]}-${uiKitPartStem(part)}.png`
}

/**
 * 计算某部件的九宫格拉伸网格：目标尺寸下的 9 宫格（源矩形 + 目标矩形）。
 *
 * 规则：四角 / 四边像素块从源图原样搬入，中央区拉伸铺满目标；目标过小不足以
 * 容纳双边切边时按比例收缩外圈（角块随目标缩小），保证中央区宽度不为负。
 * 顺序约定：[左上, 上中, 右上, 左中, 正中, 右中, 左下, 下中, 右下]。
 *
 * 引擎 / 预览端只需按每组 src/dst 做 drawImage 即可实现「任意缩放不变形」。
 */
export interface UiKitNineSliceCell {
  /** 源图中的一块像素矩形 */
  src: UiKitRect
  /** 目标画布中的落点矩形 */
  dst: UiKitRect
}

function splitColumns(
  total: number,
  leftInset: number,
  rightInset: number
): [number, number, number] {
  const t = Math.max(1, total)
  // 角块先各分一半宽度的上限，避免双边合计超过目标导致中央区为负
  const half = Math.floor(t / 2)
  const left = Math.min(Math.max(0, leftInset), half)
  const right = Math.min(Math.max(0, rightInset), t - left)
  const center = t - left - right
  return [left, center, right]
}

function splitRows(
  total: number,
  topInset: number,
  bottomInset: number
): [number, number, number] {
  const t = Math.max(1, total)
  const half = Math.floor(t / 2)
  const top = Math.min(Math.max(0, topInset), half)
  const bottom = Math.min(Math.max(0, bottomInset), t - top)
  const center = t - top - bottom
  return [top, center, bottom]
}

export function computeNineSliceCells(
  sourceWidth: number,
  sourceHeight: number,
  border: UiKitInset,
  targetWidth: number,
  targetHeight: number
): UiKitNineSliceCell[] {
  const srcW = Math.max(1, sourceWidth)
  const srcH = Math.max(1, sourceHeight)
  const dstW = Math.max(1, targetWidth)
  const dstH = Math.max(1, targetHeight)
  const src = clampInsetToSize(border, srcW, srcH)
  const [dstLeft, dstCenter, dstRight] = splitColumns(dstW, src.left, src.right)
  const [dstTop, dstMiddle, dstBottom] = splitRows(dstH, src.top, src.bottom)
  // 源侧外圈取原切边（已夹取），中央为余量
  const srcLeft = src.left
  const srcRight = src.right
  const srcTop = src.top
  const srcBottom = src.bottom
  const srcCenterW = srcW - srcLeft - srcRight
  const srcCenterH = srcH - srcTop - srcBottom
  const srcX2 = srcLeft + srcCenterW
  const srcY2 = srcTop + srcCenterH
  const dstX2 = dstLeft + dstCenter
  const dstY2 = dstTop + dstMiddle

  const cell = (
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number
  ): UiKitNineSliceCell => ({ src: { x: sx, y: sy, width: sw, height: sh }, dst: { x: dx, y: dy, width: dw, height: dh } })

  return [
    // top row
    cell(0, 0, srcLeft, srcTop, 0, 0, dstLeft, dstTop),
    cell(srcLeft, 0, srcCenterW, srcTop, dstLeft, 0, dstCenter, dstTop),
    cell(srcX2, 0, srcRight, srcTop, dstX2, 0, dstRight, dstTop),
    // middle row
    cell(0, srcTop, srcLeft, srcCenterH, 0, dstTop, dstLeft, dstMiddle),
    cell(srcLeft, srcTop, srcCenterW, srcCenterH, dstLeft, dstTop, dstCenter, dstMiddle),
    cell(srcX2, srcTop, srcRight, srcCenterH, dstX2, dstTop, dstRight, dstMiddle),
    // bottom row
    cell(0, srcY2, srcLeft, srcBottom, 0, dstY2, dstLeft, dstBottom),
    cell(srcLeft, srcY2, srcCenterW, srcBottom, dstLeft, dstY2, dstCenter, dstBottom),
    cell(srcX2, srcY2, srcRight, srcBottom, dstX2, dstY2, dstRight, dstBottom)
  ]
}

/** 部件裁剪矩形（已归一化，直接取 rect 即可）；保留别名便于语义化调用 */
export function uiKitPartCropRect(part: UiKitPart): UiKitRect {
  return { x: part.rect.x, y: part.rect.y, width: part.rect.width, height: part.rect.height }
}

/** 构建交付清单：条目保序、矩形 / 切边 / 安全边距与部件一致，文件名按命名规范生成 */
export function buildUiKitManifest(input: UiKitManifestInput): UiKitManifest {
  return {
    version: UI_KIT_DOCUMENT_VERSION,
    kind: 'ui-kit',
    sourceName: sanitizeUiKitPartName(input.sourceName, 'ui-kit'),
    sourceWidth: Math.max(1, Math.round(input.sourceWidth)),
    sourceHeight: Math.max(1, Math.round(input.sourceHeight)),
    parts: input.parts.map((part) => ({
      id: part.id,
      name: uiKitPartStem(part),
      kind: part.kind,
      fileName: uiKitPartFileName(part),
      rect: uiKitPartCropRect(part),
      border: { ...part.border },
      safe: { ...part.safe }
    }))
  }
}
