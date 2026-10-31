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

export interface PixelPoint {
  x: number
  y: number
}

/** 元素被上层遮挡时的修补路由（对标知乎方案 2.2.1）：image=走生图/图集补全；surface=纯色/简单渐变材质本地延续；none=最顶层无遮挡 */
export type UiElementRepairMode = 'image' | 'surface' | 'none'

/** 全画布底图的修补路由（对标知乎方案 2.2.1）：scene=复杂场景走生图补全；surface=纯色/简单渐变底板走本地补全；none=无需补全 */
export type UiBackgroundRepairMode = 'scene' | 'surface' | 'none'

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
  /** VLM 规划的前景正向锚点（画布像素坐标，供 SAM 2.1 / 实例分割提示） */
  positivePoints?: PixelPoint[]
  /** VLM 规划的背景/竞争元素负向排除点（画布像素坐标） */
  negativePoints?: PixelPoint[]
  /** 元素被遮挡时的修补模式（image = 生图/图集补全；surface = 纯色/渐变本地延续；none = 顶层无遮挡） */
  repairMode?: UiElementRepairMode
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
  /** 实例分割前景二值掩码（1 = 属于该元素前景），用于非矩形控件精准剥层与抠图约束 */
  instanceMask?: { rect: PixelRect; mask: Uint8Array }
  /** 容器/槽位的内腔矩形（扣除四周外边框与底部品质条），用于限制子元素补底范围 */
  slotInnerRect?: PixelRect
}

export interface UiLayoutTree {
  canvasWidth: number
  canvasHeight: number
  /** 画面类型（popup / fullscreen / hud / component），仅用于命名与提示词 */
  screenKind?: string
  /** VLM 复核判定需要按图形像素保留（恢复回去字图）的 OCR 0-based 下标集合 */
  rasterTextIds?: number[]
  /** 底层全画布背景修补模式 */
  backgroundRepairMode?: UiBackgroundRepairMode
  elements: UiElementNode[]
}

export interface PreciseSplitSam2Candidate {
  /** 与请求图像同尺寸（width * height）的二值掩码（1 = 前景） */
  mask: Uint8Array
  /** SAM 模型预测的 IoU 置信度分数 (0..1) */
  samScore: number
}

export interface PreciseSplitSam2Request {
  image: RgbaImage
  box: PixelRect
  positivePoints: PixelPoint[]
  negativePoints: PixelPoint[]
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
  /** 同一预制体（重复控件，如 3 个奖励槽）共享的分组键；导出时可只保留一份素材 */
  prefabKey?: string
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
  /** 逐图层质检（边缘光晕 / 底板残留 / 遮挡区未补全 / 抠缺）；旧调用方可忽略 */
  qa?: import('./qa').UiSplitQaReport
  /** 遮挡区确定性补全统计（多实例 / 镜像 / 行列插值）与预制体分组 */
  completion?: import('./completion').CompletionReport
  /** 复杂画面遮挡区单图层生成式补全统计 */
  generativeCompletion?: import('./generativeCompletion').GenerativeCompletionReport
  notes: string[]
}

export interface PreciseSplitVlmRequest {
  system: string
  prompt: string
  /** data URL（支持双图输入：[原图, 初步去字图]） */
  images: string[]
}

export interface PreciseSplitEditRequest {
  prompt: string
  /** data URL */
  image: string
  /** 可选：二值掩码图 data URL（白色=待修补空洞，黑色=保持不变，供图集/局部修补参考） */
  maskImage?: string
  aspectRatio?: string
}

/** 流水线的全部外部能力（执行器 / 测试各自注入） */
export interface PreciseSplitIo {
  /** 多模态大模型：返回原始文本（JSON） */
  vlm: (req: PreciseSplitVlmRequest) => Promise<string>
  /** 生图模型指令编辑（剥层补底用）；缺省时全部走本地补底 */
  editImage?: (req: PreciseSplitEditRequest) => Promise<RgbaImage | null>
  /** 可选本地 SAM 2.1 点+框提示实例分割（返回 3 个多尺度候选掩码及置信度） */
  segmentSam2?: (req: PreciseSplitSam2Request) => Promise<PreciseSplitSam2Candidate[] | null>
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
  /** 复杂画面遮挡区单图层生成式补全的最多调用次数（默认 4；0 = 关闭） */
  maxLayerCompletions?: number
  /** 元素上限 */
  maxElements?: number
}
