/**
 * 精准 UI 拆层（OCR + 多模态大模型 + 逐级剥层）的公共类型。
 *
 * 整条流水线只在纯 RGBA 缓冲区上工作（不依赖 DOM / canvas），
 * 图片解码、PNG 编码、OCR、VLM、生图都通过 `PreciseSplitIo` 注入，
 * 因此可以在执行器（shared）里编排、在 vitest 里用合成图端到端测试。
 */

import type {
  LocalOcrTextBox,
  UiControlPartRole,
  UiControlType,
  UiEditableTextMeta
} from '../uiControlSpec'

export interface RgbaImage {
  width: number
  height: number
  /** 长度 = width * height * 4，非预乘 RGBA */
  data: Uint8ClampedArray
}

export interface PixelRect {
  left: number
  top: number
  width: number
  height: number
}

/** VLM 输出的元素语义类别（比 UiControlType 更贴近美工切图口径） */
export const UI_ELEMENT_KINDS = [
  'panel',
  'frame',
  'banner',
  'button',
  'close-button',
  'arrow',
  'tab',
  'item-slot',
  'icon',
  'badge',
  'avatar',
  'illustration',
  'progress-bar',
  'divider',
  'decoration',
  'effect',
  'text',
  'art-text',
  'other'
] as const

export type UiElementKind = (typeof UI_ELEMENT_KINDS)[number]

/** 这些类别的控件主体通常是实心的：抠图后内部空洞视为误差，自动补实 */
export const OPAQUE_UI_ELEMENT_KINDS: ReadonlySet<UiElementKind> = new Set<UiElementKind>([
  'panel',
  'frame',
  'banner',
  'button',
  'close-button',
  'tab',
  'item-slot',
  'badge',
  'avatar',
  'progress-bar'
])

export interface UiElementNode {
  id: string
  name: string
  kind: UiElementKind
  /** 画布像素框（经 OCR 融合 / 边缘吸附后的最终框） */
  box: PixelRect
  /** VLM 原始框（像素），用于诊断 */
  rawBox?: PixelRect
  parentId: string | null
  /** 同级绘制顺序（越大越靠上） */
  order: number
  /** 可编辑文字内容（text / art-text） */
  text?: string
  /** 关联的 OCR 框下标 */
  ocrIndices?: number[]
  /** true = 普通文字（导出可编辑文字层，在本地去字）；false = 艺术字，按普通元素剥层 */
  plainText?: boolean
  /** 绘制顺序（DFS）序号，从 1 开始 */
  paintIndex?: number
  /** 剥层级别：1 = 最底层元素；文字固定在最顶层单独处理 */
  level?: number
}

export interface UiLayoutTree {
  canvasWidth: number
  canvasHeight: number
  /** 画面类型（popup / fullscreen / hud / component），仅用于命名与提示词 */
  screenKind?: string
  elements: UiElementNode[]
}

export interface PreciseSplitLayer {
  id: string
  elementId: string
  name: string
  kind: UiElementKind
  parentElementId: string | null
  /** 绘制顺序（1 起） */
  paintIndex: number
  left: number
  top: number
  width: number
  height: number
  rgba: Uint8ClampedArray
  uiControlType?: UiControlType
  uiPartRole?: UiControlPartRole
  editableText?: UiEditableTextMeta
}

export interface PreciseSplitResult {
  canvasWidth: number
  canvasHeight: number
  base: RgbaImage
  layers: PreciseSplitLayer[]
  tree: UiLayoutTree
  /** 底图 + 全部图层叠回去与原图的平均绝对误差（0..255，越小越好） */
  reconstructionError: number
  /** 每一级剥层用的方法，便于日志诊断 */
  peelReport: Array<{
    level: number
    method: 'generative' | 'local' | 'transparent'
    elementCount: number
  }>
  notes: string[]
}

export interface PreciseSplitVlmRequest {
  system: string
  prompt: string
  /** data URL */
  images: string[]
}

export interface PreciseSplitEditRequest {
  prompt: string
  /** data URL */
  image: string
  aspectRatio?: string
}

/** 流水线的全部外部能力（执行器 / 测试各自注入） */
export interface PreciseSplitIo {
  /** 多模态大模型：返回原始文本（JSON） */
  vlm: (req: PreciseSplitVlmRequest) => Promise<string>
  /** 生图模型指令编辑（剥层补底用）；缺省时全部走本地补底 */
  editImage?: (req: PreciseSplitEditRequest) => Promise<RgbaImage | null>
  /** 把 RGBA 编码为 PNG data URL（送 VLM / 生图模型用） */
  encodePng: (img: RgbaImage) => Promise<string>
  /** 本地 OCR；缺省时只靠 VLM 读字 */
  ocr?: (img: RgbaImage) => Promise<LocalOcrTextBox[]>
  /** 进度日志 */
  log?: (message: string) => void
  signal?: AbortSignal | null
}

export interface PreciseSplitOptions {
  locale?: string
  /** 用户补充说明（拆分重点 / 界面背景） */
  userHint?: string
  sourceTitle?: string
  /** 最多生成式剥层级数（默认 3） */
  maxPeelLevels?: number
  /** 局部放大复检（大容器内再跑一次 VLM，提升小元素召回与框精度），默认 true */
  zoomRefine?: boolean
  /** 生成式剥层；false 时全部用本地补底（零生图费用） */
  generativePeel?: boolean
  /** 元素上限 */
  maxElements?: number
}
