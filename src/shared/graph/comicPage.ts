/**
 * 漫画页数据模型：把「分镜格」排成网格，每格绑定一张图 + 若干台词气泡。
 * 布局是纯几何计算（网格 + gutter + padding + 斜切多边形），不依赖渲染环境；序列化存 genParams（键 COMIC_PAGE_PARAM_KEY）。
 * 与 beatParse / worldElementParse 同属「结构化产出」数据模型，落盘 .asset.json。
 */
import { stripJsonCodeFence } from './jsonFence'

/** genParams 中存放漫画页的键 */
export const COMIC_PAGE_PARAM_KEY = 'comicPage'

/** 气泡尾巴朝向：锚点吸附在哪一角，向外（上/下）伸出 */
export type ComicBubbleTail = 'tl' | 'tr' | 'bl' | 'br'

/** 气泡矢量形状：圆角矩形 / 传统日漫椭圆 / 爆炸呐喊框 / 云朵心理框 / 旁白方框 / 拟声词特效字 */
export type ComicBubbleShape = 'rounded' | 'oval' | 'shout' | 'thought' | 'narration' | 'sfx'

/** 台词排版方向：横排 / 传统漫画竖排（从右向左） */
export type ComicBubbleWritingMode = 'horizontal-tb' | 'vertical-rl'

/** 分镜格漫画滤镜：原图 / 黑白高反差日漫 / 网点纸 / 怀旧泛黄 / 戏剧暗调 */
export type ComicPanelFilter = 'none' | 'manga-bw' | 'halftone' | 'sepia' | 'dramatic'

/** 分镜格漫画镜头氛围特效：无 / 集中线 / 平行速度线 / 情绪暗角 / 网点边框 */
export type ComicPanelEffectType =
  'none' | 'focus-lines' | 'speed-lines' | 'vignette' | 'halftone-frame'

/** 分镜格斜切预设 */
export type ComicPanelSlantPreset =
  | 'none'
  | 'slash-left'
  | 'slash-right'
  | 'trapezoid-top'
  | 'trapezoid-bottom'
  | 'parallelogram-left'
  | 'parallelogram-right'

/** 四角斜切顶点相对偏移：[tlX, tlY, trX, trY, brX, brY, blX, blY]，归一化范围 [-0.45, 0.45] */
export type ComicCornerOffsets = [number, number, number, number, number, number, number, number]

/** 台词气泡：锚定在格内归一化位置（0~1），支持多形状、竖排、自由尾巴尖端与描边样式 */
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
  /** 显示缩放（字号与整体尺寸等比）；缺省 1 */
  scale?: number
  /** 气泡形状；缺省 'rounded' */
  shape?: ComicBubbleShape
  /** 文字排版方向；缺省 'horizontal-tb' */
  writingMode?: ComicBubbleWritingMode
  /** 自由拖拽的尾巴尖端在分镜格内的归一化横坐标（-0.5~1.5） */
  tailTipX?: number
  /** 自由拖拽的尾巴尖端在分镜格内的归一化纵坐标（-0.5~1.5） */
  tailTipY?: number
  /** 气泡填充底色 */
  backgroundColor?: string
  /** 气泡描边颜色 */
  borderColor?: string
  /** 台词文字颜色 */
  textColor?: string
  /** 描边粗细（像素倍率，0~12） */
  strokeWidth?: number
  /** 旋转角度（-60 ~ 60 度） */
  rotation?: number
  /** 字重 */
  fontWeight?: 'normal' | 'bold' | 'black'
}

/** 气泡缩放允许范围 */
export const COMIC_BUBBLE_MIN_SCALE = 0.5
export const COMIC_BUBBLE_MAX_SCALE = 4

/** 分镜格：占据网格矩形，支持格内构图取景、斜切刀口线、镜头速度线特效与气泡集合 */
export interface ComicPanel {
  id: string
  /** 网格行（从 0 起） */
  row: number
  /** 网格列（从 0 起） */
  col: number
  rowSpan: number
  colSpan: number
  /** 分镜格背景色（任意 CSS 颜色）；缺省用默认占位灰 */
  backgroundColor?: string
  /** 图片 URL（data:/http(s)/工程相对路径） */
  imageUrl?: string
  title?: string
  bubbles: ComicSpeechBubble[]
  /** 格内图片构图：水平焦点偏移（-1 ~ 1，0 居中） */
  imagePanX?: number
  /** 格内图片构图：垂直焦点偏移（-1 ~ 1，0 居中） */
  imagePanY?: number
  /** 格内图片构图：缩放特写倍率（0.5 ~ 4，缺省 1） */
  imageZoom?: number
  /** 格内图片构图：旋转角度（-180 ~ 180，缺省 0） */
  imageRotation?: number
  /** 格内图片构图：水平翻转镜像 */
  imageFlipX?: boolean
  /** 格内图片适配方式：cover（缺省）| contain */
  imageFit?: 'cover' | 'contain'
  /** 格内漫画色调滤镜 */
  imageFilter?: ComicPanelFilter
  /** 四角斜切偏移 [tlX, tlY, trX, trY, brX, brY, blX, blY] */
  cornerOffsets?: ComicCornerOffsets
  /** 漫画镜头氛围特效类型 */
  effectType?: ComicPanelEffectType
  /** 特效强度/密度（0.1 ~ 1） */
  effectIntensity?: number
  /** 速度线角度（0 ~ 360） */
  effectAngle?: number
  /** 集中线中心点归一化 X（0 ~ 1） */
  effectFocusX?: number
  /** 集中线中心点归一化 Y（0 ~ 1） */
  effectFocusY?: number
  /** 特效线条颜色 */
  effectColor?: string
  /** 叠格层级（用于画中画/破框格，缺省 0） */
  zIndex?: number
  /** 单格边框粗细覆写（0 表示无框出血） */
  borderWidth?: number
  /** 单格边框颜色覆写 */
  borderColor?: string
  /** 分镜底部/顶部旁白字幕条 */
  caption?: string
}

/** 漫画页：网格规格 + 像素尺寸 + 页面边距/框线风格 + 面板集合 */
export interface ComicPage {
  title?: string
  /** 页面背景色（任意 CSS 颜色）；缺省透明 */
  backgroundColor?: string
  columns: number
  rows: number
  /** 格间距（页面像素坐标系） */
  gutter: number
  width: number
  height: number
  /** 页面四周安全留白边距（像素，缺省 0） */
  padding?: number
  /** 全局分镜框线粗细（像素，缺省 undefined 使用渲染默认） */
  borderWidth?: number
  /** 全局分镜框线颜色 */
  borderColor?: string
  /** 全局分镜框圆角半径（像素） */
  borderRadius?: number
  /** 阅读顺序：ltr（左到右，缺省）| rtl（传统日漫右到左） */
  readingDirection?: 'ltr' | 'rtl'
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

const VALID_BUBBLE_SHAPES = new Set<ComicBubbleShape>([
  'rounded',
  'oval',
  'shout',
  'thought',
  'narration',
  'sfx'
])

const VALID_PANEL_FILTERS = new Set<ComicPanelFilter>([
  'none',
  'manga-bw',
  'halftone',
  'sepia',
  'dramatic'
])

const VALID_PANEL_EFFECTS = new Set<ComicPanelEffectType>([
  'none',
  'focus-lines',
  'speed-lines',
  'vignette',
  'halftone-frame'
])

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

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
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

function normalizeCornerOffsets(raw: unknown): ComicCornerOffsets | undefined {
  if (!Array.isArray(raw) || raw.length !== 8) return undefined
  const out = raw.map((v) => round3(clampFloat(v, -0.45, 0.45, 0))) as ComicCornerOffsets
  if (out.every((v) => Math.abs(v) < 0.001)) return undefined
  return out
}

function normalizeBubble(raw: unknown, index: number, panelId: string): ComicSpeechBubble | null {
  if (!raw || typeof raw !== 'object') return null
  const bubble = raw as Record<string, unknown>
  const text = typeof bubble.text === 'string' ? bubble.text.trim() : ''
  if (!text) return null
  const id =
    typeof bubble.id === 'string' && bubble.id.trim()
      ? bubble.id.trim()
      : `${panelId}-bubble-${index + 1}`
  const tailRaw = bubble.tail
  const tail: ComicBubbleTail =
    tailRaw === 'tr' || tailRaw === 'bl' || tailRaw === 'br' ? tailRaw : 'tl'
  const speaker = typeof bubble.speaker === 'string' ? bubble.speaker.trim() : ''
  const scale = clampFloat(bubble.scale, COMIC_BUBBLE_MIN_SCALE, COMIC_BUBBLE_MAX_SCALE, 1)
  const shapeRaw = bubble.shape as ComicBubbleShape | undefined
  const shape: ComicBubbleShape =
    shapeRaw && VALID_BUBBLE_SHAPES.has(shapeRaw) ? shapeRaw : 'rounded'
  const writingMode: ComicBubbleWritingMode =
    bubble.writingMode === 'vertical-rl' ? 'vertical-rl' : 'horizontal-tb'
  const hasTailTip =
    (typeof bubble.tailTipX === 'number' && Number.isFinite(bubble.tailTipX)) ||
    (typeof bubble.tailTipY === 'number' && Number.isFinite(bubble.tailTipY))
  const tailTipX = hasTailTip ? round3(clampFloat(bubble.tailTipX, -0.5, 1.5, 0.5)) : undefined
  const tailTipY = hasTailTip ? round3(clampFloat(bubble.tailTipY, -0.5, 1.5, 0.5)) : undefined
  const backgroundColor =
    typeof bubble.backgroundColor === 'string' ? bubble.backgroundColor.trim() : ''
  const borderColor = typeof bubble.borderColor === 'string' ? bubble.borderColor.trim() : ''
  const textColor = typeof bubble.textColor === 'string' ? bubble.textColor.trim() : ''
  const strokeWidth =
    bubble.strokeWidth !== undefined && bubble.strokeWidth !== null && bubble.strokeWidth !== ''
      ? clampFloat(bubble.strokeWidth, 0, 12, 2)
      : undefined
  const rotation =
    bubble.rotation !== undefined && bubble.rotation !== null && bubble.rotation !== ''
      ? Math.round(clampFloat(bubble.rotation, -60, 60, 0))
      : 0
  const fontWeight =
    bubble.fontWeight === 'bold' || bubble.fontWeight === 'black' ? bubble.fontWeight : undefined

  return {
    id,
    text,
    ...(speaker ? { speaker } : {}),
    x: clampFloat(bubble.x, 0, 1, 0.5),
    y: clampFloat(bubble.y, 0, 1, 0.5),
    tail,
    ...(scale !== 1 ? { scale } : {}),
    ...(shape !== 'rounded' ? { shape } : {}),
    ...(writingMode !== 'horizontal-tb' ? { writingMode } : {}),
    ...(tailTipX !== undefined && tailTipY !== undefined ? { tailTipX, tailTipY } : {}),
    ...(backgroundColor ? { backgroundColor } : {}),
    ...(borderColor ? { borderColor } : {}),
    ...(textColor ? { textColor } : {}),
    ...(strokeWidth !== undefined ? { strokeWidth } : {}),
    ...(rotation !== 0 ? { rotation } : {}),
    ...(fontWeight ? { fontWeight } : {})
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
  const id =
    typeof panel.id === 'string' && panel.id.trim() ? panel.id.trim() : `panel-${index + 1}`
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
  const panelBg = typeof panel.backgroundColor === 'string' ? panel.backgroundColor.trim() : ''
  const caption = typeof panel.caption === 'string' ? panel.caption.trim() : ''
  const rawBubbles = Array.isArray(panel.bubbles) ? panel.bubbles : []
  const bubbles: ComicSpeechBubble[] = []
  for (let i = 0; i < rawBubbles.length; i++) {
    const bubble = normalizeBubble(rawBubbles[i], i, id)
    if (bubble) bubbles.push(bubble)
  }

  const imagePanX = round3(clampFloat(panel.imagePanX, -1, 1, 0))
  const imagePanY = round3(clampFloat(panel.imagePanY, -1, 1, 0))
  const imageZoom = round3(clampFloat(panel.imageZoom, 0.5, 4, 1))
  const imageRotation = Math.round(clampFloat(panel.imageRotation, -180, 180, 0))
  const imageFlipX = panel.imageFlipX === true
  const imageFit = panel.imageFit === 'contain' ? 'contain' : undefined
  const filterRaw = panel.imageFilter as ComicPanelFilter | undefined
  const imageFilter =
    filterRaw && VALID_PANEL_FILTERS.has(filterRaw) && filterRaw !== 'none' ? filterRaw : undefined

  const cornerOffsets = normalizeCornerOffsets(panel.cornerOffsets)

  const effectRaw = panel.effectType as ComicPanelEffectType | undefined
  const effectType =
    effectRaw && VALID_PANEL_EFFECTS.has(effectRaw) && effectRaw !== 'none' ? effectRaw : undefined
  const effectIntensity = effectType
    ? round3(clampFloat(panel.effectIntensity, 0.1, 1, 0.6))
    : undefined
  const effectAngle =
    effectType === 'speed-lines' ? Math.round(clampFloat(panel.effectAngle, 0, 360, 0)) : undefined
  const effectFocusX =
    effectType === 'focus-lines' ? round3(clampFloat(panel.effectFocusX, 0, 1, 0.5)) : undefined
  const effectFocusY =
    effectType === 'focus-lines' ? round3(clampFloat(panel.effectFocusY, 0, 1, 0.5)) : undefined
  const effectColor =
    effectType && typeof panel.effectColor === 'string' ? panel.effectColor.trim() : ''

  const zIndex = clampInt(panel.zIndex, -10, 0)
  const borderWidth =
    panel.borderWidth !== undefined && panel.borderWidth !== null && panel.borderWidth !== ''
      ? clampFloat(panel.borderWidth, 0, 24, 2)
      : undefined
  const borderColor = typeof panel.borderColor === 'string' ? panel.borderColor.trim() : ''

  return {
    id,
    row,
    col,
    rowSpan,
    colSpan,
    ...(imageUrl ? { imageUrl } : {}),
    ...(title ? { title } : {}),
    ...(panelBg ? { backgroundColor: panelBg } : {}),
    ...(caption ? { caption } : {}),
    ...(imagePanX !== 0 ? { imagePanX } : {}),
    ...(imagePanY !== 0 ? { imagePanY } : {}),
    ...(imageZoom !== 1 ? { imageZoom } : {}),
    ...(imageRotation !== 0 ? { imageRotation } : {}),
    ...(imageFlipX ? { imageFlipX: true } : {}),
    ...(imageFit ? { imageFit } : {}),
    ...(imageFilter ? { imageFilter } : {}),
    ...(cornerOffsets ? { cornerOffsets } : {}),
    ...(effectType ? { effectType } : {}),
    ...(effectIntensity !== undefined ? { effectIntensity } : {}),
    ...(effectAngle !== undefined ? { effectAngle } : {}),
    ...(effectFocusX !== undefined ? { effectFocusX } : {}),
    ...(effectFocusY !== undefined ? { effectFocusY } : {}),
    ...(effectColor ? { effectColor } : {}),
    ...(zIndex !== 0 ? { zIndex } : {}),
    ...(borderWidth !== undefined ? { borderWidth } : {}),
    ...(borderColor ? { borderColor } : {}),
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
  const padding = clampFloat(input?.padding, 0, 240, 0)
  const borderWidth =
    input?.borderWidth !== undefined && input.borderWidth !== null
      ? clampFloat(input.borderWidth, 0, 24, 1)
      : undefined
  const borderColor = typeof input?.borderColor === 'string' ? input.borderColor.trim() : ''
  const borderRadius =
    input?.borderRadius !== undefined && input.borderRadius !== null
      ? clampFloat(input.borderRadius, 0, 64, 6)
      : undefined
  const readingDirection = input?.readingDirection === 'rtl' ? 'rtl' : undefined

  const rawPanels = Array.isArray(input?.panels) ? input.panels : []
  const panels: ComicPanel[] = []
  for (let i = 0; i < rawPanels.length; i++) {
    const panel = normalizePanel(rawPanels[i], i, columns, rows)
    if (panel) panels.push(panel)
  }
  const title = typeof input?.title === 'string' ? input.title.trim() : ''
  const backgroundColor =
    typeof input?.backgroundColor === 'string' ? input.backgroundColor.trim() : ''
  return {
    ...(title ? { title } : {}),
    ...(backgroundColor ? { backgroundColor } : {}),
    columns,
    rows,
    gutter,
    width,
    height,
    ...(padding > 0 ? { padding } : {}),
    ...(borderWidth !== undefined ? { borderWidth } : {}),
    ...(borderColor ? { borderColor } : {}),
    ...(borderRadius !== undefined ? { borderRadius } : {}),
    ...(readingDirection ? { readingDirection } : {}),
    panels
  }
}

/** 创建默认漫画页 */
export function createComicPage(options?: Partial<ComicPage>): ComicPage {
  return normalizeComicPage(options ?? {})
}

/** 计算单格宽高与有效内容起点（支持页面外边距 padding） */
export function comicGridMetrics(page: ComicPage): {
  pad: number
  colW: number
  rowH: number
  columns: number
  rows: number
  gutter: number
  width: number
  height: number
} {
  const normalized = normalizeComicPage(page)
  const { columns, rows, gutter, width, height } = normalized
  const pad = Math.min(normalized.padding ?? 0, Math.floor(Math.min(width, height) * 0.25))
  const innerW = Math.max(1, width - pad * 2)
  const innerH = Math.max(1, height - pad * 2)
  const colW = Math.max(1, (innerW - (columns - 1) * gutter) / columns)
  const rowH = Math.max(1, (innerH - (rows - 1) * gutter) / rows)
  return { pad, colW, rowH, columns, rows, gutter, width, height }
}

/** 面板 → 页面像素矩形。colW/rowH 夹到 >=1px，避免病态 gutter 产生负尺寸。 */
export function comicPanelRects(page: ComicPage): Map<string, ComicPanelRect> {
  const normalized = normalizeComicPage(page)
  const { pad, colW, rowH, columns, rows, gutter } = comicGridMetrics(normalized)
  const out = new Map<string, ComicPanelRect>()
  for (const panel of normalized.panels) {
    const { row, col, rowSpan, colSpan } = panelPlacement(panel, columns, rows)
    out.set(panel.id, {
      x: pad + col * (colW + gutter),
      y: pad + row * (rowH + gutter),
      width: colSpan * colW + (colSpan - 1) * gutter,
      height: rowSpan * rowH + (rowSpan - 1) * gutter
    })
  }
  return out
}

/** 计算分镜格四角多边形顶点（支持斜切 cornerOffsets） */
export function comicPanelPolygon(
  rect: ComicPanelRect,
  panel?: Pick<ComicPanel, 'cornerOffsets'> | null
): [
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number }
] {
  const o = panel?.cornerOffsets
  if (!o) {
    return [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
      { x: rect.x, y: rect.y + rect.height }
    ]
  }
  return [
    { x: rect.x + o[0] * rect.width, y: rect.y + o[1] * rect.height },
    { x: rect.x + rect.width + o[2] * rect.width, y: rect.y + o[3] * rect.height },
    { x: rect.x + rect.width + o[4] * rect.width, y: rect.y + rect.height + o[5] * rect.height },
    { x: rect.x + o[6] * rect.width, y: rect.y + rect.height + o[7] * rect.height }
  ]
}

/** 斜切预设转 cornerOffsets */
export function slantPresetToCornerOffsets(
  preset: ComicPanelSlantPreset,
  amount = 0.12
): ComicCornerOffsets | undefined {
  const a = round3(clampFloat(amount, 0.02, 0.35, 0.12))
  switch (preset) {
    case 'slash-left':
      return [0, a, 0, -a, 0, -a, 0, a]
    case 'slash-right':
      return [0, -a, 0, a, 0, a, 0, -a]
    case 'trapezoid-top':
      return [0, 0, 0, 0, 0, -a, 0, a]
    case 'trapezoid-bottom':
      return [0, a, 0, -a, 0, 0, 0, 0]
    case 'parallelogram-left':
      return [a, 0, 0, 0, -a, 0, 0, 0]
    case 'parallelogram-right':
      return [0, 0, -a, 0, 0, 0, a, 0]
    default:
      return undefined
  }
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

/** 气泡尾巴尖端在页面像素坐标系中的位置（支持自由拖拽尖端或默认四角朝向） */
export function comicBubbleTailTipPagePoint(
  page: ComicPage,
  panelId: string,
  bubbleId: string
): { x: number; y: number } | null {
  const rect = comicPanelRects(page).get(panelId)
  if (!rect) return null
  const panel = normalizeComicPage(page).panels.find((item) => item.id === panelId)
  const bubble = panel?.bubbles.find((item) => item.id === bubbleId)
  if (!bubble) return null
  if (bubble.tailTipX !== undefined && bubble.tailTipY !== undefined) {
    return {
      x: rect.x + bubble.tailTipX * rect.width,
      y: rect.y + bubble.tailTipY * rect.height
    }
  }
  const anchorX = rect.x + bubble.x * rect.width
  const anchorY = rect.y + bubble.y * rect.height
  const s = bubble.scale ?? 1
  const dx = (bubble.tail === 'tl' || bubble.tail === 'bl' ? -36 : 36) * s
  const dy = (bubble.tail === 'tl' || bubble.tail === 'tr' ? -34 : 34) * s
  return { x: anchorX + dx, y: anchorY + dy }
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

/** 移动分镜格到指定网格起点 */
export function moveComicPanel(
  page: ComicPage,
  panelId: string,
  row: number,
  col: number
): ComicPage {
  const normalized = normalizeComicPage(page)
  const panel = normalized.panels.find((item) => item.id === panelId)
  if (!panel) return normalized
  return upsertComicPanel(normalized, { ...panel, row, col })
}

/** 交换两个分镜格的绑定图片与构图参数（拖拽换图体验） */
export function swapComicPanelContents(
  page: ComicPage,
  panelIdA: string,
  panelIdB: string
): ComicPage {
  if (panelIdA === panelIdB) return normalizeComicPage(page)
  const normalized = normalizeComicPage(page)
  const a = normalized.panels.find((p) => p.id === panelIdA)
  const b = normalized.panels.find((p) => p.id === panelIdB)
  if (!a || !b) return normalized
  const pickMedia = (p: ComicPanel) => ({
    imageUrl: p.imageUrl,
    imagePanX: p.imagePanX,
    imagePanY: p.imagePanY,
    imageZoom: p.imageZoom,
    imageRotation: p.imageRotation,
    imageFlipX: p.imageFlipX,
    imageFit: p.imageFit,
    imageFilter: p.imageFilter
  })
  const mediaA = pickMedia(a)
  const mediaB = pickMedia(b)
  let next = upsertComicPanel(normalized, { ...a, ...mediaB })
  next = upsertComicPanel(next, { ...b, ...mediaA })
  return next
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

/** 复制某格内的一个气泡（轻微偏移便于拖拽） */
export function duplicateComicBubble(
  page: ComicPage,
  panelId: string,
  bubbleId: string
): { page: ComicPage; newBubbleId: string | null } {
  const normalized = normalizeComicPage(page)
  const panel = normalized.panels.find((item) => item.id === panelId)
  const bubble = panel?.bubbles.find((item) => item.id === bubbleId)
  if (!panel || !bubble) return { page: normalized, newBubbleId: null }
  const next = addComicBubble(normalized, panelId, {
    ...bubble,
    id: undefined,
    x: Math.min(0.92, bubble.x + 0.08),
    y: Math.min(0.92, bubble.y + 0.08)
  })
  const updatedPanel = next.panels.find((item) => item.id === panelId)
  const added = updatedPanel?.bubbles[updatedPanel.bubbles.length - 1]
  return { page: next, newBubbleId: added?.id ?? null }
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
  const merged: Record<string, unknown> = { ...panel.bubbles[bIdx], ...patch, id: bubbleId }
  if ('tailTipX' in patch && patch.tailTipX === undefined) delete merged.tailTipX
  if ('tailTipY' in patch && patch.tailTipY === undefined) delete merged.tailTipY
  const next = normalizeBubble(merged, bIdx, panel.id)
  const panels = [...normalized.panels]
  const bubbles = [...panel.bubbles]
  // 无台词则移除该气泡，否则原位替换
  if (!next) bubbles.splice(bIdx, 1)
  else bubbles[bIdx] = next
  panels[idx] = { ...panel, bubbles }
  return { ...normalized, panels }
}

/** 删除某格内一个台词气泡 */
export function removeComicBubble(page: ComicPage, panelId: string, bubbleId: string): ComicPage {
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

export function readingOrderPanels(page: ComicPage): ComicPanel[] {
  const rtl = page.readingDirection === 'rtl'
  return [...page.panels].sort((a, b) => a.row - b.row || (rtl ? b.col - a.col : a.col - b.col))
}

/** 按 zIndex 升序排列面板（渲染与命中测试使用） */
export function zOrderedPanels(page: ComicPage): ComicPanel[] {
  return [...page.panels]
    .map((panel, index) => ({ panel, index }))
    .sort((a, b) => (a.panel.zIndex ?? 0) - (b.panel.zIndex ?? 0) || a.index - b.index)
    .map((item) => item.panel)
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

/** 页面像素点 → 网格单元（落在 gutter 或 padding 上返回 null） */
export function findComicCellAtPagePoint(
  page: ComicPage,
  x: number,
  y: number
): { row: number; col: number } | null {
  const normalized = normalizeComicPage(page)
  const { pad, colW, rowH, columns, rows, gutter, width, height } = comicGridMetrics(normalized)
  if (x < pad || y < pad || x > width - pad || y > height - pad) return null
  for (let col = 0; col < columns; col++) {
    const left = pad + col * (colW + gutter)
    if (x < left || x > left + colW) continue
    for (let row = 0; row < rows; row++) {
      const top = pad + row * (rowH + gutter)
      if (y >= top && y <= top + rowH) return { row, col }
    }
  }
  return null
}

/** 判断点是否落在凸/简单四边形内（支持斜切分镜命中测试） */
function pointInQuad(
  px: number,
  py: number,
  quad: [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number }
  ]
): boolean {
  let inside = false
  for (let i = 0, j = 3; i < 4; j = i++) {
    const xi = quad[i]!.x
    const yi = quad[i]!.y
    const xj = quad[j]!.x
    const yj = quad[j]!.y
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-9) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/** 页面像素点命中的分镜格（高 zIndex 及后添加的优先） */
export function findComicPanelAtPagePoint(
  page: ComicPage,
  x: number,
  y: number
): ComicPanel | null {
  const normalized = normalizeComicPage(page)
  const rects = comicPanelRects(normalized)
  const ordered = zOrderedPanels(normalized)
  for (let i = ordered.length - 1; i >= 0; i--) {
    const panel = ordered[i]!
    const rect = rects.get(panel.id)
    if (!rect) continue
    if (panel.cornerOffsets) {
      const poly = comicPanelPolygon(rect, panel)
      if (pointInQuad(x, y, poly)) return panel
    } else if (
      x >= rect.x &&
      x <= rect.x + rect.width &&
      y >= rect.y &&
      y <= rect.y + rect.height
    ) {
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

/** 页面像素点 → 格内尾巴尖端归一化坐标（允许超出 [0,1] 指向边缘角色） */
export function pagePointToTailTipNorm(
  page: ComicPage,
  panelId: string,
  x: number,
  y: number
): { tailTipX: number; tailTipY: number } | null {
  const rect = comicPanelRects(page).get(panelId)
  if (!rect || rect.width <= 0 || rect.height <= 0) return null
  return {
    tailTipX: round3(Math.min(1.5, Math.max(-0.5, (x - rect.x) / rect.width))),
    tailTipY: round3(Math.min(1.5, Math.max(-0.5, (y - rect.y) / rect.height)))
  }
}

const BUBBLE_HIT_RADIUS = 48

/** 页面像素点命中的气泡（最近锚点，半径随气泡 scale 自适应放大） */
export function findComicBubbleAtPagePoint(
  page: ComicPage,
  x: number,
  y: number,
  hitRadius = BUBBLE_HIT_RADIUS
): { panelId: string; bubbleId: string } | null {
  const normalized = normalizeComicPage(page)
  let best: { panelId: string; bubbleId: string; dist: number } | null = null
  const baseRadius = Math.max(8, hitRadius)
  for (const panel of zOrderedPanels(normalized)) {
    for (const bubble of panel.bubbles) {
      const pt = comicBubblePagePoint(normalized, panel.id, bubble.id)
      if (!pt) continue
      const radius = baseRadius * Math.max(0.85, bubble.scale ?? 1)
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
  patch: Partial<
    Pick<
      ComicPage,
      | 'title'
      | 'backgroundColor'
      | 'columns'
      | 'rows'
      | 'gutter'
      | 'width'
      | 'height'
      | 'padding'
      | 'borderWidth'
      | 'borderColor'
      | 'borderRadius'
      | 'readingDirection'
    >
  >
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
 * 按阅读顺序（先行后列或右到左）把上游图片填进分镜格。
 * Cook 默认只填空格；Dive 里手动绑的图优先，或可传 fillEmptyOnly: false 强制重排。
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

/** 预设分镜布局模板结构 */
export interface ComicLayoutTemplate {
  id: string
  category: 'manga' | 'action' | 'strip' | 'grid'
  name: { zh: string; en: string }
  desc: { zh: string; en: string }
  page: Omit<ComicPage, 'panels'> & {
    panels: Array<
      Omit<ComicPanel, 'id' | 'bubbles'> & { id?: string; bubbles?: ComicSpeechBubble[] }
    >
  }
}

/** 内置 12 款专业漫画分镜模板库 */
export const COMIC_LAYOUT_TEMPLATES: readonly ComicLayoutTemplate[] = [
  {
    id: 'manga-standard-5',
    category: 'manga',
    name: { zh: '日漫叙事 5 格', en: 'Manga Narrative 5-Panel' },
    desc: {
      zh: '顶部远景建立镜头 + 中段对切 + 底部情绪落幅', // cjk-ok
      en: 'Top establishing shot + mid rhythm + bottom closure'
    },
    page: {
      columns: 6,
      rows: 6,
      gutter: 18,
      padding: 36,
      width: 1080,
      height: 1520,
      backgroundColor: '#ffffff',
      borderWidth: 3,
      borderColor: '#111111',
      borderRadius: 0,
      panels: [
        { row: 0, col: 0, rowSpan: 2, colSpan: 6 },
        { row: 2, col: 0, rowSpan: 2, colSpan: 3 },
        { row: 2, col: 3, rowSpan: 2, colSpan: 3 },
        { row: 4, col: 0, rowSpan: 2, colSpan: 2 },
        { row: 4, col: 2, rowSpan: 2, colSpan: 4 }
      ]
    }
  },
  {
    id: 'manga-action-slash',
    category: 'action',
    name: { zh: '热血斜切分镜', en: 'Dynamic Slash Action' },
    desc: {
      zh: '高速斜向刀口线 + 集中线冲击格', // cjk-ok
      en: 'Diagonal slash gutters with impact focus lines'
    },
    page: {
      columns: 6,
      rows: 6,
      gutter: 18,
      padding: 36,
      width: 1080,
      height: 1520,
      backgroundColor: '#ffffff',
      borderWidth: 3.5,
      borderColor: '#111111',
      borderRadius: 0,
      panels: [
        {
          row: 0,
          col: 0,
          rowSpan: 2,
          colSpan: 4,
          cornerOffsets: [0, 0, 0.12, 0, -0.06, 0.08, 0, 0]
        },
        {
          row: 0,
          col: 4,
          rowSpan: 2,
          colSpan: 2,
          cornerOffsets: [0.16, 0, 0, 0, 0, -0.08, -0.1, 0.08]
        },
        {
          row: 2,
          col: 0,
          rowSpan: 2,
          colSpan: 6,
          cornerOffsets: [0, 0.06, 0, -0.08, 0, 0.08, 0, -0.06],
          effectType: 'speed-lines',
          effectIntensity: 0.65,
          effectAngle: 12
        },
        {
          row: 4,
          col: 0,
          rowSpan: 2,
          colSpan: 3,
          cornerOffsets: [0, -0.06, 0.08, 0.02, -0.08, 0, 0, 0]
        },
        {
          row: 4,
          col: 3,
          rowSpan: 2,
          colSpan: 3,
          cornerOffsets: [0.08, 0.02, 0, 0.08, 0, 0, -0.08, 0],
          effectType: 'focus-lines',
          effectIntensity: 0.7,
          effectFocusX: 0.5,
          effectFocusY: 0.45
        }
      ]
    }
  },
  {
    id: 'manga-climax-inset',
    category: 'action',
    name: { zh: '高潮跨格画中画', en: 'Climax Inset Overlay' },
    desc: {
      zh: '巨幅主视觉 + 浮动眼神特写叠格（带留白衬边）', // cjk-ok
      en: 'Hero background panel + floating close-up inset panel'
    },
    page: {
      columns: 6,
      rows: 6,
      gutter: 16,
      padding: 32,
      width: 1080,
      height: 1520,
      backgroundColor: '#ffffff',
      borderWidth: 3,
      borderColor: '#111111',
      borderRadius: 0,
      panels: [
        { row: 0, col: 0, rowSpan: 1, colSpan: 3 },
        { row: 0, col: 3, rowSpan: 1, colSpan: 3 },
        {
          row: 1,
          col: 0,
          rowSpan: 5,
          colSpan: 6,
          effectType: 'focus-lines',
          effectIntensity: 0.55,
          effectFocusX: 0.5,
          effectFocusY: 0.4,
          zIndex: 0
        },
        {
          row: 4,
          col: 3,
          rowSpan: 2,
          colSpan: 3,
          zIndex: 2,
          borderWidth: 4,
          borderColor: '#111111'
        }
      ]
    }
  },
  {
    id: 'classic-4koma',
    category: 'strip',
    name: { zh: '经典四格漫 (起承转合)', en: 'Classic 4-Koma Strip' },
    desc: {
      zh: '标准竖向四格条漫，适合日常幽默与短剧节奏', // cjk-ok
      en: 'Vertical 4-panel strip for gag and slice-of-life'
    },
    page: {
      columns: 1,
      rows: 4,
      gutter: 22,
      padding: 44,
      width: 900,
      height: 2400,
      backgroundColor: '#ffffff',
      borderWidth: 3,
      borderColor: '#111111',
      borderRadius: 2,
      panels: [
        { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 2, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 3, col: 0, rowSpan: 1, colSpan: 1 }
      ]
    }
  },
  {
    id: 'webtoon-vertical',
    category: 'strip',
    name: { zh: '条漫长图 (Webtoon)', en: 'Webtoon Vertical Scroll' },
    desc: {
      zh: '竖屏流式大留白排版，专为手机端韩漫/国漫打造', // cjk-ok
      en: 'Mobile vertical scroll layout with cinematic spacing'
    },
    page: {
      columns: 2,
      rows: 7,
      gutter: 32,
      padding: 48,
      width: 1080,
      height: 3200,
      backgroundColor: '#0f1115',
      borderWidth: 2,
      borderColor: '#2a2e39',
      borderRadius: 8,
      panels: [
        { row: 0, col: 0, rowSpan: 2, colSpan: 2 },
        { row: 2, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 2, col: 1, rowSpan: 1, colSpan: 1 },
        { row: 3, col: 0, rowSpan: 2, colSpan: 2 },
        { row: 5, col: 0, rowSpan: 2, colSpan: 2 }
      ]
    }
  },
  {
    id: 'manga-dialogue-6',
    category: 'manga',
    name: { zh: '紧凑对话 6 格', en: 'Dialogue 6-Panel' },
    desc: {
      zh: '正反打镜头交替，适合多角色对手戏', // cjk-ok
      en: 'Shot-reverse-shot rhythm for character dialogue'
    },
    page: {
      columns: 6,
      rows: 6,
      gutter: 16,
      padding: 36,
      width: 1080,
      height: 1520,
      backgroundColor: '#ffffff',
      borderWidth: 3,
      borderColor: '#111111',
      borderRadius: 0,
      panels: [
        { row: 0, col: 0, rowSpan: 2, colSpan: 4 },
        { row: 0, col: 4, rowSpan: 2, colSpan: 2 },
        { row: 2, col: 0, rowSpan: 2, colSpan: 2 },
        { row: 2, col: 2, rowSpan: 2, colSpan: 4 },
        { row: 4, col: 0, rowSpan: 2, colSpan: 3 },
        { row: 4, col: 3, rowSpan: 2, colSpan: 3 }
      ]
    }
  },
  {
    id: 'cinematic-widescreen',
    category: 'manga',
    name: { zh: '电影宽银幕 3 幕', en: 'Cinematic Widescreen 3-Act' },
    desc: {
      zh: '2.35:1 电影感横幅分镜，极具史诗氛围', // cjk-ok
      en: 'Anamorphic widescreen horizontal panels'
    },
    page: {
      columns: 1,
      rows: 3,
      gutter: 24,
      padding: 40,
      width: 1080,
      height: 1440,
      backgroundColor: '#121316',
      borderWidth: 2,
      borderColor: '#ffffff',
      borderRadius: 4,
      panels: [
        { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 2, col: 0, rowSpan: 1, colSpan: 1 }
      ]
    }
  },
  {
    id: 'hero-top-split',
    category: 'manga',
    name: { zh: '上半主视觉 + 下三格', en: 'Top Hero + 3 Sub-Panels' },
    desc: {
      zh: '上半页宏大场景，下半页连续三格细节反应', // cjk-ok
      en: 'Large top scene with three reaction panels below'
    },
    page: {
      columns: 3,
      rows: 3,
      gutter: 18,
      padding: 36,
      width: 1080,
      height: 1440,
      backgroundColor: '#ffffff',
      borderWidth: 3,
      borderColor: '#111111',
      borderRadius: 0,
      panels: [
        { row: 0, col: 0, rowSpan: 2, colSpan: 3 },
        { row: 2, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 2, col: 1, rowSpan: 1, colSpan: 1 },
        { row: 2, col: 2, rowSpan: 1, colSpan: 1 }
      ]
    }
  },
  {
    id: 'dynamic-z-flow',
    category: 'action',
    name: { zh: 'Z 字视觉流刀口页', en: 'Z-Flow Diagonal Page' },
    desc: {
      zh: '引导读者视线呈 Z 字高速滑落的分镜编排', // cjk-ok
      en: 'Z-pattern eye-tracking diagonal layout'
    },
    page: {
      columns: 6,
      rows: 6,
      gutter: 18,
      padding: 36,
      width: 1080,
      height: 1520,
      backgroundColor: '#ffffff',
      borderWidth: 3.5,
      borderColor: '#111111',
      borderRadius: 0,
      panels: [
        {
          row: 0,
          col: 0,
          rowSpan: 2,
          colSpan: 6,
          cornerOffsets: [0, 0, 0, 0, 0, 0.14, 0, -0.06]
        },
        {
          row: 2,
          col: 0,
          rowSpan: 2,
          colSpan: 3,
          cornerOffsets: [0, -0.06, 0, 0.04, 0, -0.04, 0, 0.08]
        },
        {
          row: 2,
          col: 3,
          rowSpan: 2,
          colSpan: 3,
          cornerOffsets: [0, 0.04, 0, 0.14, 0, -0.1, 0, -0.04],
          effectType: 'speed-lines',
          effectIntensity: 0.55,
          effectAngle: 160
        },
        {
          row: 4,
          col: 0,
          rowSpan: 2,
          colSpan: 6,
          cornerOffsets: [0, 0.08, 0, -0.1, 0, 0, 0, 0]
        }
      ]
    }
  },
  {
    id: 'grid-2x2',
    category: 'grid',
    name: { zh: '对称四宫格 (2×2)', en: 'Symmetric 2×2 Grid' },
    desc: { zh: '均衡四格对比或平行叙事', en: 'Balanced 2×2 grid layout' },
    page: {
      columns: 2,
      rows: 2,
      gutter: 20,
      padding: 36,
      width: 1080,
      height: 1440,
      backgroundColor: '#ffffff',
      borderWidth: 3,
      borderColor: '#111111',
      borderRadius: 4,
      panels: [
        { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 0, col: 1, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 1, rowSpan: 1, colSpan: 1 }
      ]
    }
  },
  {
    id: 'grid-3x3',
    category: 'grid',
    name: { zh: '九宫格分镜表 (3×3)', en: '3×3 Storyboard Grid' },
    desc: { zh: '高密度九宫格分镜展示页', en: 'High-density 9-panel storyboard grid' },
    page: {
      columns: 3,
      rows: 3,
      gutter: 16,
      padding: 32,
      width: 1080,
      height: 1440,
      backgroundColor: '#ffffff',
      borderWidth: 2.5,
      borderColor: '#111111',
      borderRadius: 4,
      panels: Array.from({ length: 9 }, (_, i) => ({
        row: Math.floor(i / 3),
        col: i % 3,
        rowSpan: 1,
        colSpan: 1
      }))
    }
  }
]

/**
 * 套用预设分镜模板：按阅读顺序自动迁移当前页已有的图片、构图参数与台词气泡，绝不丢失用户创作内容。
 */
export function applyComicLayoutTemplate(page: ComicPage, templateId: string): ComicPage {
  const tpl = COMIC_LAYOUT_TEMPLATES.find((item) => item.id === templateId)
  if (!tpl) return normalizeComicPage(page)

  const oldOrdered = readingOrderPanels(normalizeComicPage(page))
  const nextPanels: ComicPanel[] = tpl.page.panels.map((tplPanel, idx) => {
    const donor = oldOrdered[idx]
    return {
      ...tplPanel,
      id: donor?.id || `panel-${idx + 1}`,
      ...(donor?.imageUrl ? { imageUrl: donor.imageUrl } : {}),
      ...(donor?.title ? { title: donor.title } : {}),
      ...(donor?.caption ? { caption: donor.caption } : {}),
      ...(donor?.imagePanX !== undefined ? { imagePanX: donor.imagePanX } : {}),
      ...(donor?.imagePanY !== undefined ? { imagePanY: donor.imagePanY } : {}),
      ...(donor?.imageZoom !== undefined ? { imageZoom: donor.imageZoom } : {}),
      ...(donor?.imageRotation !== undefined ? { imageRotation: donor.imageRotation } : {}),
      ...(donor?.imageFlipX ? { imageFlipX: donor.imageFlipX } : {}),
      ...(donor?.imageFilter ? { imageFilter: donor.imageFilter } : {}),
      bubbles: donor?.bubbles ?? []
    }
  })

  return normalizeComicPage({
    ...tpl.page,
    ...(page.title ? { title: page.title } : {}),
    panels: nextPanels
  })
}
