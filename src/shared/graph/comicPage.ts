/**
 * 漫画页数据模型：把「分镜格」排成网格，每格绑定一张图 + 若干台词气泡。
 * 布局是纯几何计算（网格 + gutter），不依赖渲染环境；序列化存 genParams（键 COMIC_PAGE_PARAM_KEY）。
 * 与 beatParse / worldElementParse 同属「结构化产出」数据模型，落盘 .asset.json。
 */
import { stripJsonCodeFence } from './jsonFence'

/** genParams 中存放漫画页的键 */
export const COMIC_PAGE_PARAM_KEY = 'comicPage'

/** 气泡尾巴朝向：锚点吸附在哪一角，向外（上/下）伸出 */
export type ComicBubbleTail = 'tl' | 'tr' | 'bl' | 'br'

/** 台词气泡：锚定在格内归一化位置（0~1），带朝向 */
export interface ComicSpeechBubble {
  id: string
  text: string
  /** 说话人，可选 */
  speaker?: string
  /** 锚点相对格左上角的归一化横坐标（0~1） */
  x: number
  /** 锚点相对格左上角的归一化纵坐标（0~1） */
  y: number
  tail: ComicBubbleTail
}

/** 分镜格：占据网格矩形，绑定一张图 + 若干气泡 */
export interface ComicPanel {
  id: string
  /** 网格行（从 0 起） */
  row: number
  /** 网格列（从 0 起） */
  col: number
  rowSpan: number
  colSpan: number
  /** 图片 URL（data:/http(s)/工程相对路径） */
  imageUrl?: string
  title?: string
  bubbles: ComicSpeechBubble[]
}

/** 漫画页：网格规格 + 像素尺寸 + 面板集合 */
export interface ComicPage {
  title?: string
  columns: number
  rows: number
  /** 格间距（页面像素坐标系） */
  gutter: number
  width: number
  height: number
  panels: ComicPanel[]
}

/** 格在页面像素坐标系中的矩形 */
export interface ComicPanelRect {
  x: number
  y: number
  width: number
  height: number
}

export const COMIC_PAGE_DEFAULTS = {
  columns: 3,
  rows: 3,
  gutter: 16,
  width: 1080,
  height: 1440
} as const

function clampInt(value: unknown, min: number, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.round(n))
}

function clampFloat(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** 面板在网格内的合法摆放：起点夹到 [0, columns-1]×[0, rows-1]，跨度夹到不越界 */
function panelPlacement(
  panel: Pick<ComicPanel, 'row' | 'col' | 'rowSpan' | 'colSpan'>,
  columns: number,
  rows: number
): { row: number; col: number; rowSpan: number; colSpan: number } {
  const cols = Math.max(1, Math.round(columns))
  const rowCount = Math.max(1, Math.round(rows))
  const col = Math.min(cols - 1, Math.max(0, Math.round(panel.col)))
  const row = Math.min(rowCount - 1, Math.max(0, Math.round(panel.row)))
  const colSpan = Math.min(cols - col, Math.max(1, Math.round(panel.colSpan)))
  const rowSpan = Math.min(rowCount - row, Math.max(1, Math.round(panel.rowSpan)))
  return { row, col, rowSpan, colSpan }
}

function normalizeBubble(
  raw: unknown,
  index: number,
  panelId: string
): ComicSpeechBubble | null {
  if (!raw || typeof raw !== 'object') return null
  const bubble = raw as Record<string, unknown>
  const text = typeof bubble.text === 'string' ? bubble.text.trim() : ''
  if (!text) return null
  const id = typeof bubble.id === 'string' && bubble.id.trim() ? bubble.id.trim() : `${panelId}-bubble-${index + 1}`
  const tailRaw = bubble.tail
  const tail: ComicBubbleTail =
    tailRaw === 'tr' || tailRaw === 'bl' || tailRaw === 'br' ? tailRaw : 'tl'
  const speaker = typeof bubble.speaker === 'string' ? bubble.speaker.trim() : ''
  return {
    id,
    text,
    ...(speaker ? { speaker } : {}),
    x: clampFloat(bubble.x, 0, 1, 0.5),
    y: clampFloat(bubble.y, 0, 1, 0.5),
    tail
  }
}

function normalizePanel(
  raw: unknown,
  index: number,
  columns: number,
  rows: number
): ComicPanel | null {
  if (!raw || typeof raw !== 'object') return null
  const panel = raw as Record<string, unknown>
  const id = typeof panel.id === 'string' && panel.id.trim() ? panel.id.trim() : `panel-${index + 1}`
  const { row, col, rowSpan, colSpan } = panelPlacement(
    {
      row: clampInt(panel.row, 0, 0),
      col: clampInt(panel.col, 0, 0),
      rowSpan: clampInt(panel.rowSpan, 1, 1),
      colSpan: clampInt(panel.colSpan, 1, 1)
    },
    columns,
    rows
  )
  const imageUrl = typeof panel.imageUrl === 'string' ? panel.imageUrl.trim() : ''
  const title = typeof panel.title === 'string' ? panel.title.trim() : ''
  const rawBubbles = Array.isArray(panel.bubbles) ? panel.bubbles : []
  const bubbles: ComicSpeechBubble[] = []
  for (let i = 0; i < rawBubbles.length; i++) {
    const bubble = normalizeBubble(rawBubbles[i], i, id)
    if (bubble) bubbles.push(bubble)
  }
  return {
    id,
    row,
    col,
    rowSpan,
    colSpan,
    ...(imageUrl ? { imageUrl } : {}),
    ...(title ? { title } : {}),
    bubbles
  }
}

/** 规范化输入：夹取合法尺寸 / 网格 / 面板；不合法项被过滤。 */
export function normalizeComicPage(input: Partial<ComicPage> | null | undefined): ComicPage {
  const columns = clampInt(input?.columns, 1, COMIC_PAGE_DEFAULTS.columns)
  const rows = clampInt(input?.rows, 1, COMIC_PAGE_DEFAULTS.rows)
  const gutter = clampFloat(input?.gutter, 0, Number.MAX_SAFE_INTEGER, COMIC_PAGE_DEFAULTS.gutter)
  const width = clampFloat(input?.width, 1, Number.MAX_SAFE_INTEGER, COMIC_PAGE_DEFAULTS.width)
  const height = clampFloat(input?.height, 1, Number.MAX_SAFE_INTEGER, COMIC_PAGE_DEFAULTS.height)
  const rawPanels = Array.isArray(input?.panels) ? input.panels : []
  const panels: ComicPanel[] = []
  for (let i = 0; i < rawPanels.length; i++) {
    const panel = normalizePanel(rawPanels[i], i, columns, rows)
    if (panel) panels.push(panel)
  }
  const title = typeof input?.title === 'string' ? input.title.trim() : ''
  return {
    ...(title ? { title } : {}),
    columns,
    rows,
    gutter,
    width,
    height,
    panels
  }
}

/** 创建默认漫画页 */
export function createComicPage(options?: Partial<ComicPage>): ComicPage {
  return normalizeComicPage(options ?? {})
}

/** 面板 → 页面像素矩形。colW/rowH 夹到 >=1px，避免病态 gutter 产生负尺寸。 */
export function comicPanelRects(page: ComicPage): Map<string, ComicPanelRect> {
  const normalized = normalizeComicPage(page)
  const { columns, rows, gutter, width, height } = normalized
  const colW = Math.max(1, (width - (columns - 1) * gutter) / columns)
  const rowH = Math.max(1, (height - (rows - 1) * gutter) / rows)
  const out = new Map<string, ComicPanelRect>()
  for (const panel of normalized.panels) {
    const { row, col, rowSpan, colSpan } = panelPlacement(panel, columns, rows)
    out.set(panel.id, {
      x: col * (colW + gutter),
      y: row * (rowH + gutter),
      width: colSpan * colW + (colSpan - 1) * gutter,
      height: rowSpan * rowH + (rowSpan - 1) * gutter
    })
  }
  return out
}

/** 气泡锚点在页面像素坐标系中的位置 */
export function comicBubblePagePoint(
  page: ComicPage,
  panelId: string,
  bubbleId: string
): { x: number; y: number } | null {
  const rect = comicPanelRects(page).get(panelId)
  if (!rect) return null
  const panel = normalizeComicPage(page).panels.find((item) => item.id === panelId)
  const bubble = panel?.bubbles.find((item) => item.id === bubbleId)
  if (!bubble) return null
  return { x: rect.x + bubble.x * rect.width, y: rect.y + bubble.y * rect.height }
}

function uniqueId(existing: Set<string>, base: string): string {
  if (!existing.has(base)) return base
  let i = 2
  while (existing.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

/** 追加一个分镜格（缺省落在 0,0，可再用 upsertComicPanel 调整位置） */
export function addComicPanel(page: ComicPage, panel?: Partial<ComicPanel>): ComicPage {
  const normalized = normalizeComicPage(page)
  const baseId = panel?.id?.trim() || `panel-${normalized.panels.length + 1}`
  const id = uniqueId(new Set(normalized.panels.map((item) => item.id)), baseId)
  const next = normalizePanel(
    { ...panel, id },
    normalized.panels.length,
    normalized.columns,
    normalized.rows
  )
  if (!next) return normalized
  return { ...normalized, panels: [...normalized.panels, next] }
}

/** 按 id 新增或替换分镜格 */
export function upsertComicPanel(page: ComicPage, panel: ComicPanel): ComicPage {
  const normalized = normalizeComicPage(page)
  const id = panel.id?.trim() || `panel-${normalized.panels.length + 1}`
  const next = normalizePanel(
    { ...panel, id },
    normalized.panels.length,
    normalized.columns,
    normalized.rows
  )
  if (!next) return normalized
  const idx = normalized.panels.findIndex((item) => item.id === next.id)
  if (idx < 0) return { ...normalized, panels: [...normalized.panels, next] }
  const panels = [...normalized.panels]
  panels[idx] = next
  return { ...normalized, panels }
}

/** 删除一个分镜格 */
export function removeComicPanel(page: ComicPage, panelId: string): ComicPage {
  const normalized = normalizeComicPage(page)
  return { ...normalized, panels: normalized.panels.filter((item) => item.id !== panelId) }
}

/** 给某格追加一个台词气泡 */
export function addComicBubble(
  page: ComicPage,
  panelId: string,
  bubble?: Partial<ComicSpeechBubble>
): ComicPage {
  const normalized = normalizeComicPage(page)
  const idx = normalized.panels.findIndex((item) => item.id === panelId)
  if (idx < 0) return normalized
  const panel = normalized.panels[idx]!
  const baseId = bubble?.id?.trim() || `${panel.id}-bubble-${panel.bubbles.length + 1}`
  const id = uniqueId(new Set(panel.bubbles.map((item) => item.id)), baseId)
  const next = normalizeBubble({ ...bubble, id }, panel.bubbles.length, panel.id)
  if (!next) return normalized
  const panels = [...normalized.panels]
  panels[idx] = { ...panel, bubbles: [...panel.bubbles, next] }
  return { ...normalized, panels }
}

/** 更新某格内一个台词气泡（patch 合并；无台词则丢弃该气泡） */
export function updateComicBubble(
  page: ComicPage,
  panelId: string,
  bubbleId: string,
  patch: Partial<ComicSpeechBubble>
): ComicPage {
  const normalized = normalizeComicPage(page)
  const idx = normalized.panels.findIndex((item) => item.id === panelId)
  if (idx < 0) return normalized
  const panel = normalized.panels[idx]!
  const bIdx = panel.bubbles.findIndex((item) => item.id === bubbleId)
  if (bIdx < 0) return normalized
  const next = normalizeBubble({ ...panel.bubbles[bIdx], ...patch, id: bubbleId }, bIdx, panel.id)
  const panels = [...normalized.panels]
  const bubbles = [...panel.bubbles]
  // 无台词则移除该气泡，否则原位替换
  if (!next) bubbles.splice(bIdx, 1)
  else bubbles[bIdx] = next
  panels[idx] = { ...panel, bubbles }
  return { ...normalized, panels }
}

/** 删除某格内一个台词气泡 */
export function removeComicBubble(
  page: ComicPage,
  panelId: string,
  bubbleId: string
): ComicPage {
  const normalized = normalizeComicPage(page)
  const idx = normalized.panels.findIndex((item) => item.id === panelId)
  if (idx < 0) return normalized
  const panel = normalized.panels[idx]!
  const panels = [...normalized.panels]
  panels[idx] = { ...panel, bubbles: panel.bubbles.filter((item) => item.id !== bubbleId) }
  return { ...normalized, panels }
}

/** 序列化（含规范化）为 JSON 文本 */
export function serializeComicPage(page: ComicPage): string {
  return `${JSON.stringify(normalizeComicPage(page), null, 2)}\n`
}

/** 解析 JSON 文本（兼容代码块包裹）；失败或空返回 null */
export function parseComicPage(raw: string | null | undefined): ComicPage | null {
  if (!raw?.trim()) return null
  const text = stripJsonCodeFence(raw)
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return normalizeComicPage(parsed as Partial<ComicPage>)
  } catch {
    return null
  }
}

/** 从 genParams 读取漫画页（键 COMIC_PAGE_PARAM_KEY，兼容对象或 JSON 文本） */
export function readComicPageFromGenParams(
  genParams?: { comicPage?: unknown } | null
): ComicPage | null {
  const raw = genParams?.comicPage
  if (typeof raw === 'string') return parseComicPage(raw)
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return normalizeComicPage(raw as Partial<ComicPage>)
  }
  return null
}

/** 把漫画页写回 genParams（返回新对象） */
export function withComicPage(
  genParams: Record<string, unknown> | null | undefined,
  page: ComicPage
): Record<string, unknown> {
  return {
    ...(genParams ?? {}),
    [COMIC_PAGE_PARAM_KEY]: serializeComicPage(page)
  }
}

function cellKey(row: number, col: number): string {
  return `${row},${col}`
}

function readingOrderPanels(page: ComicPage): ComicPanel[] {
  return [...page.panels].sort((a, b) => a.row - b.row || a.col - b.col)
}

/** 被分镜格占用的网格单元（含跨格） */
export function comicOccupiedCellKeys(page: ComicPage): Set<string> {
  const normalized = normalizeComicPage(page)
  const keys = new Set<string>()
  for (const panel of normalized.panels) {
    const { row, col, rowSpan, colSpan } = panelPlacement(
      panel,
      normalized.columns,
      normalized.rows
    )
    for (let r = row; r < row + rowSpan; r++) {
      for (let c = col; c < col + colSpan; c++) {
        keys.add(cellKey(r, c))
      }
    }
  }
  return keys
}

/** 阅读顺序下第一个空格；满则 null */
export function findEmptyComicCell(page: ComicPage): { row: number; col: number } | null {
  const normalized = normalizeComicPage(page)
  const occupied = comicOccupiedCellKeys(normalized)
  for (let row = 0; row < normalized.rows; row++) {
    for (let col = 0; col < normalized.columns; col++) {
      if (!occupied.has(cellKey(row, col))) return { row, col }
    }
  }
  return null
}

/** 页面像素点 → 网格单元（落在 gutter 上返回 null） */
export function findComicCellAtPagePoint(
  page: ComicPage,
  x: number,
  y: number
): { row: number; col: number } | null {
  const normalized = normalizeComicPage(page)
  const { columns, rows, gutter, width, height } = normalized
  if (x < 0 || y < 0 || x > width || y > height) return null
  const colW = Math.max(1, (width - (columns - 1) * gutter) / columns)
  const rowH = Math.max(1, (height - (rows - 1) * gutter) / rows)
  for (let col = 0; col < columns; col++) {
    const left = col * (colW + gutter)
    if (x < left || x > left + colW) continue
    for (let row = 0; row < rows; row++) {
      const top = row * (rowH + gutter)
      if (y >= top && y <= top + rowH) return { row, col }
    }
  }
  return null
}

/** 页面像素点命中的分镜格（后添加的优先） */
export function findComicPanelAtPagePoint(
  page: ComicPage,
  x: number,
  y: number
): ComicPanel | null {
  const normalized = normalizeComicPage(page)
  const rects = comicPanelRects(normalized)
  for (let i = normalized.panels.length - 1; i >= 0; i--) {
    const panel = normalized.panels[i]!
    const rect = rects.get(panel.id)
    if (!rect) continue
    if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
      return panel
    }
  }
  return null
}

/** 页面像素点 → 格内气泡归一化坐标 */
export function pagePointToBubbleNorm(
  page: ComicPage,
  panelId: string,
  x: number,
  y: number
): { x: number; y: number } | null {
  const rect = comicPanelRects(page).get(panelId)
  if (!rect || rect.width <= 0 || rect.height <= 0) return null
  return {
    x: Math.min(1, Math.max(0, (x - rect.x) / rect.width)),
    y: Math.min(1, Math.max(0, (y - rect.y) / rect.height))
  }
}

const BUBBLE_HIT_RADIUS = 48

/** 页面像素点命中的气泡（最近锚点，半径约 48px） */
export function findComicBubbleAtPagePoint(
  page: ComicPage,
  x: number,
  y: number,
  hitRadius = BUBBLE_HIT_RADIUS
): { panelId: string; bubbleId: string } | null {
  const normalized = normalizeComicPage(page)
  let best: { panelId: string; bubbleId: string; dist: number } | null = null
  const radius = Math.max(8, hitRadius)
  for (const panel of normalized.panels) {
    for (const bubble of panel.bubbles) {
      const pt = comicBubblePagePoint(normalized, panel.id, bubble.id)
      if (!pt) continue
      const dist = Math.hypot(pt.x - x, pt.y - y)
      if (dist > radius) continue
      if (!best || dist < best.dist) best = { panelId: panel.id, bubbleId: bubble.id, dist }
    }
  }
  return best ? { panelId: best.panelId, bubbleId: best.bubbleId } : null
}

/** 改网格/画布规格；分镜格会被 clamp 进新网格 */
export function withComicPageLayout(
  page: ComicPage,
  patch: Partial<Pick<ComicPage, 'title' | 'columns' | 'rows' | 'gutter' | 'width' | 'height'>>
): ComicPage {
  return normalizeComicPage({ ...normalizeComicPage(page), ...patch })
}

export interface FillComicPageFromImageUrlsOptions {
  /** 只填尚未绑图的格（默认 true）；已有图保留 */
  fillEmptyOnly?: boolean
  /** 没有分镜格时按网格自动建格并填图（默认 true） */
  createMissingPanels?: boolean
}

/**
 * 按阅读顺序（先行后列）把上游图片填进分镜格。
 * Cook 默认只填空格；Dive 里手动绑的图优先。
 */
export function fillComicPageFromImageUrls(
  page: ComicPage,
  urls: string[],
  options?: FillComicPageFromImageUrlsOptions
): ComicPage {
  const fillEmptyOnly = options?.fillEmptyOnly !== false
  const createMissingPanels = options?.createMissingPanels !== false
  const clean = urls.map((url) => url.trim()).filter(Boolean)
  let next = normalizeComicPage(page)
  if (!next.panels.length && createMissingPanels && clean.length) {
    const cap = next.columns * next.rows
    const count = Math.min(clean.length, cap)
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / next.columns)
      const col = i % next.columns
      next = addComicPanel(next, { row, col, imageUrl: clean[i] })
    }
    return next
  }
  const assigned = new Map<string, string>()
  let index = 0
  for (const panel of readingOrderPanels(next)) {
    if (index >= clean.length) break
    if (fillEmptyOnly && panel.imageUrl) continue
    assigned.set(panel.id, clean[index]!)
    index += 1
  }
  if (!assigned.size) return next
  return {
    ...next,
    panels: next.panels.map((panel) => {
      const url = assigned.get(panel.id)
      return url ? { ...panel, imageUrl: url } : panel
    })
  }
}
