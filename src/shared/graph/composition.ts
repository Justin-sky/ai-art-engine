/**
 * 智能构图 — 主体检测框 → 目标画幅裁剪框（纯几何，可单测）。
 *
 * 数据源是资产旁挂的 `asset.visionTags.objects`（原图像素系人物框，
 * 由本地 YOLO 入库自动打标生成），无需再次推理；
 * 画幅预设复用导出平台安全区体系的口径（9:16 ≈ 抖音竖屏、16:9 ≈ YouTube 横屏）。
 *
 * 输出为相对原图的归一化裁剪框（cropX/Y/W/H ∈ [0,1]），
 * 可直接交给渲染层 canvas 裁图（如 `composeImageCropCanvas` / 抠图同款落盘链路）。
 */

export type ComposeStrategy = 'center' | 'headroom'

/** 目标画幅（width/height 只决定宽高比，safeAreaRatio 用于参考线可视化） */
export interface ComposeTargetFrame {
  id: string
  width: number
  height: number
  /** 四周安全区比例（0~0.5），与 exportPlatforms 同口径 */
  safeAreaRatio: number
}

/** 构图可选画幅：竖屏（参考抖音 / 快手）/ 方形 / 横屏（参考 YouTube） */
export const COMPOSE_FRAME_PRESETS: readonly ComposeTargetFrame[] = [
  { id: '9:16', width: 1080, height: 1920, safeAreaRatio: 0.1 },
  { id: '1:1', width: 1024, height: 1024, safeAreaRatio: 0.08 },
  { id: '16:9', width: 1920, height: 1080, safeAreaRatio: 0.05 }
] as const

export const DEFAULT_COMPOSE_FRAME = '9:16'

/** 主体检测框（原图像素系，与 YoloBox / VisionDetectedObject 一致） */
export interface ComposeSubjectBox {
  x: number
  y: number
  width: number
  height: number
}

/** 归一化裁剪框（像素相对源图，0~1） */
export interface ComposeCropRect {
  cropX: number
  cropY: number
  cropW: number
  cropH: number
}

/** 单次构图结果 */
export interface ComposeGeometry {
  crop: ComposeCropRect
  /** 主体是否完整处于裁剪框内；false 表示构图会裁掉部分主体（多为脚部 / 侧边） */
  subjectFullyVisible: boolean
  /** 目标画幅宽高比（宽/高） */
  targetAspect: number
}

/**
 * headroom（头部留边）策略下，头顶上方预留的留白占「裁切框高」的比例。
 * 0.22 ≈ 头顶落在画面上部约 1/5~1/4 处，构图惯例的“上三分留白”。
 */
export const COMPOSE_HEADROOM_FRACTION = 0.22

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/**
 * 依据一个主体框 + 目标画幅，求归一化裁剪框。
 *
 * 算法要点：
 * - 先求能完整装入源图的最大目标比例框（maxBox）；
 * - 横向始终以主体中心对齐（必要时钳制不越界）；
 * - 纵向由策略决定锚点：
 *   - center：主体中心与画框中心对齐；
 *   - headroom：头顶上方预留 COMPOSE_HEADROOM_FRACTION 框高的留白，
 *     主体沉到画面下部——竖屏人像构图的“头顶留白 / 下部退让”。
 * - 锚点越界时兜底平移，保证头部（或中心）不被裁出框外。
 */
export function composeSubjectCrop(params: {
  imageWidth: number
  imageHeight: number
  subject: ComposeSubjectBox
  target: Pick<ComposeTargetFrame, 'width' | 'height'>
  strategy: ComposeStrategy
}): ComposeGeometry {
  const W = Math.max(1, params.imageWidth)
  const H = Math.max(1, params.imageHeight)
  const ta = params.target.width / params.target.height
  const sa = W / H

  // 主体归一化并钳制在 [0,1]
  const s = {
    x: clamp(params.subject.x / W, 0, 1),
    y: clamp(params.subject.y / H, 0, 1),
    w: clamp(params.subject.width / W, 0, 1),
    h: clamp(params.subject.height / H, 0, 1)
  }
  const cx = clamp(s.x + s.w / 2, 0, 1)
  const cy = s.y + s.h / 2

  // 能完整装入源图的最大目标比例框（归一化）
  let bw: number
  let bh: number
  if (sa >= ta) {
    // 源更宽：高度铺满源高，宽按比例收窄
    bh = 1
    bw = (H * ta) / W
  } else {
    // 源更窄（如竖源裁方 / 横画幅）：宽度铺满源宽，高按比例收窄
    bw = 1
    bh = W / (ta * H)
  }
  bw = clamp(bw, 0.01, 1)
  bh = clamp(bh, 0.01, 1)

  // 纵向锚点（框内理想位置比例）
  let anchorY: number
  let anchorFrac: number
  if (params.strategy === 'headroom') {
    anchorY = s.y // 头顶
    anchorFrac = COMPOSE_HEADROOM_FRACTION // 头顶落在距框顶留白比例处
  } else {
    anchorY = cy
    anchorFrac = 0.5
  }

  let y0 = anchorY - bh * anchorFrac
  y0 = clamp(y0, 0, 1 - bh)
  // 兜底：锚点被钳制挤出框外时，平移回框内中部附近（优先保住头部 / 中心）
  if (anchorY < y0) y0 = Math.max(0, anchorY - bh * 0.5)
  if (anchorY > y0 + bh) y0 = Math.min(1 - bh, anchorY - bh * 0.5)

  // 横向以主体中心对齐
  let x0 = clamp(cx - bw / 2, 0, 1 - bw)

  const crop: ComposeCropRect = {
    cropX: x0,
    cropY: y0,
    cropW: bw,
    cropH: bh
  }

  const subjectFullyVisible =
    s.x >= x0 &&
    s.x + s.w <= x0 + bw &&
    s.y >= y0 &&
    s.y + s.h <= y0 + bh

  return { crop, subjectFullyVisible, targetAspect: ta }
}

/** 目标画幅内的安全区矩形（归一化，相对 crop 框内坐标系，供参考线可视化） */
export function composeSafeRect(
  ratio: number
): { top: number; bottom: number; left: number; right: number } {
  const r = clamp(ratio, 0, 0.5)
  return { top: r, bottom: r, left: r, right: r }
}
