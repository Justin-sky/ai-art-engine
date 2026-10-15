/**
 * 精灵统一对齐节点参数：把透明 PNG（承接本地抠图）按统一画布缩放摆放，
 * 以「中心 / 脚底」锚点就位，输出引擎可直接消费的 2D 游戏资产。
 *
 * 几何算法见 `../gameAssets/spriteGeometry.ts`（extractAlphaBounds +
 * computeSpriteAlignPlan，纯函数可单测）。本文件只管节点参数形态；
 * 像素合成由渲染层注入 `composeImageAlignCanvas` 完成。
 */

export type ImageAlignAnchor = 'center' | 'ground'
export type ImageAlignBgKey = '' | 'auto' | 'black' | 'white'

export interface ImageAlignSizePreset {
  id: string
  width: number
  height: number
  label: string
}

export const IMAGE_ALIGN_SIZE_PRESETS: readonly ImageAlignSizePreset[] = [
  { id: '64x64', width: 64, height: 64, label: '64×64' },
  { id: '128x128', width: 128, height: 128, label: '128×128' },
  { id: '256x256', width: 256, height: 256, label: '256×256' },
  { id: '512x512', width: 512, height: 512, label: '512×512' },
  { id: '1024x1024', width: 1024, height: 1024, label: '1024×1024' },
  { id: '512x768', width: 512, height: 768, label: '512×768' },
  { id: '1024x1536', width: 1024, height: 1536, label: '1024×1536' }
] as const

export interface ImageAlignState {
  /** 统一画布宽（px） */
  canvasWidth: number
  /** 统一画布高（px） */
  canvasHeight: number
  /** 锚点方式：center=主体中心 / ground=脚底压地面基线 */
  anchor: ImageAlignAnchor
  /** 主体外接框高度占画布高度的比例（0.1~1） */
  contentHeightRatio: number
  /** anchor='ground' 时，基线距画布底边的比例（0~0.5） */
  groundRatio: number
  /** 等比缩放后主体宽度超画布时，是否收缩到画布内 */
  fitWithinWidth: boolean
  /** 水平像素偏移微调（px，右为正，缺省 0） */
  offsetX?: number
  /** 垂直像素偏移微调（px，下为正，缺省 0） */
  offsetY?: number
  /** 水平翻转镜像（2D 角色左右朝向切换，缺省 false） */
  flipX?: boolean
  /** 背景快捷抠除模式：''=已透明 / auto=四角采样色 / black=黑底 / white=白底 */
  bgKey?: ImageAlignBgKey
  /** 背景键控容差阈值（5~180，默认 42） */
  bgThreshold?: number
  /** 边缘反混合去白边 / 去暗边（恢复半透明轮廓前景色，默认 false） */
  defringe?: boolean
  /** 2D 瓦片无缝平铺（对边余弦边缘融合，消除四边拼缝，默认 false） */
  tileSeamless?: boolean
  /** 无缝平铺融合带宽度占画布比例（0.05~0.35，默认 0.15） */
  tileBlendRatio?: number
  /** 九宫格（9-slice）内边距参考线（px，0~512，0=关闭） */
  nineSlice?: number
}

export const DEFAULT_IMAGE_ALIGN: ImageAlignState = {
  canvasWidth: 1024,
  canvasHeight: 1024,
  anchor: 'ground',
  contentHeightRatio: 0.9,
  groundRatio: 0.06,
  fitWithinWidth: true
}

const MIN_CANVAS = 16
const MAX_CANVAS = 8192

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function clampInt(n: number, min: number, max: number): number {
  const v = Number.isFinite(n) ? n : DEFAULT_IMAGE_ALIGN.canvasWidth
  return Math.round(clamp(v, min, max))
}

export function normalizeImageAlignBgKey(raw: unknown): ImageAlignBgKey {
  return raw === 'auto' || raw === 'black' || raw === 'white' ? raw : ''
}

export function normalizeImageAlign(raw?: Partial<ImageAlignState> | null): ImageAlignState {
  const base = { ...DEFAULT_IMAGE_ALIGN, ...(raw ?? {}) }
  const offsetXRaw = Number(raw?.offsetX)
  const offsetYRaw = Number(raw?.offsetY)
  const offsetX = Number.isFinite(offsetXRaw)
    ? Math.round(clamp(offsetXRaw, -MAX_CANVAS, MAX_CANVAS))
    : 0
  const offsetY = Number.isFinite(offsetYRaw)
    ? Math.round(clamp(offsetYRaw, -MAX_CANVAS, MAX_CANVAS))
    : 0
  const flipX = raw?.flipX === true
  const bgKey = normalizeImageAlignBgKey(raw?.bgKey)
  const bgThresholdRaw = Number(raw?.bgThreshold)
  const bgThreshold = Number.isFinite(bgThresholdRaw)
    ? Math.round(clamp(bgThresholdRaw, 5, 180))
    : 42
  const defringe = raw?.defringe === true
  const tileSeamless = raw?.tileSeamless === true
  const tileBlendRaw = Number(raw?.tileBlendRatio)
  const tileBlendRatio = Number.isFinite(tileBlendRaw)
    ? Math.round(clamp(tileBlendRaw, 0.05, 0.35) * 100) / 100
    : 0.15
  const nineSliceRaw = Number(raw?.nineSlice)
  const nineSlice = Number.isFinite(nineSliceRaw) ? Math.round(clamp(nineSliceRaw, 0, 512)) : 0

  return {
    canvasWidth: clampInt(base.canvasWidth, MIN_CANVAS, MAX_CANVAS),
    canvasHeight: clampInt(base.canvasHeight, MIN_CANVAS, MAX_CANVAS),
    anchor: base.anchor === 'center' ? 'center' : 'ground',
    contentHeightRatio: clamp(Number(base.contentHeightRatio), 0.1, 1),
    groundRatio: clamp(Number(base.groundRatio), 0, 0.5),
    fitWithinWidth: base.fitWithinWidth !== false,
    ...(offsetX !== 0 ? { offsetX } : {}),
    ...(offsetY !== 0 ? { offsetY } : {}),
    ...(flipX ? { flipX: true } : {}),
    ...(bgKey ? { bgKey, bgThreshold } : {}),
    ...(defringe ? { defringe: true } : {}),
    ...(tileSeamless ? { tileSeamless: true, tileBlendRatio } : {}),
    ...(nineSlice > 0 ? { nineSlice } : {})
  }
}

/**
 * 2D 瓦片无缝平铺（Toroidal Cosine Edge Blending）：
 * 对左右边缘带（宽度 `width * blendRatio`）与上下边缘带（高度 `height * blendRatio`）
 * 采用余弦平滑曲线将对边像素原地融合，使 `x=0` 与 `x=width-1`、`y=0` 与 `y=height-1`
 * 严格相等且一阶导数连续，同时保持瓦片中心区域 100% 原始细节不走样。
 */
export function applySeamlessTileWrap(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  blendRatio = 0.15
): void {
  if (width < 4 || height < 4 || rgba.length < width * height * 4) return
  const ratio = clamp(Number.isFinite(blendRatio) ? blendRatio : 0.15, 0.04, 0.45)
  const bx = Math.max(1, Math.min(Math.floor(width / 2), Math.round(width * ratio)))
  const by = Math.max(1, Math.min(Math.floor(height / 2), Math.round(height * ratio)))

  // Pass 1: 水平对边余弦平滑融合
  for (let d = 0; d < bx; d++) {
    const w = 0.25 * (1 + Math.cos((Math.PI * d) / bx))
    const invW = 1 - w
    const xR = width - 1 - d
    for (let y = 0; y < height; y++) {
      const iL = (y * width + d) * 4
      const iR = (y * width + xR) * 4
      for (let c = 0; c < 4; c++) {
        const vL = rgba[iL + c]
        const vR = rgba[iR + c]
        rgba[iL + c] = Math.round(invW * vL + w * vR)
        rgba[iR + c] = Math.round(invW * vR + w * vL)
      }
    }
  }

  // Pass 2: 垂直对边余弦平滑融合
  for (let d = 0; d < by; d++) {
    const w = 0.25 * (1 + Math.cos((Math.PI * d) / by))
    const invW = 1 - w
    const yB = height - 1 - d
    for (let x = 0; x < width; x++) {
      const iT = (d * width + x) * 4
      const iB = (yB * width + x) * 4
      for (let c = 0; c < 4; c++) {
        const vT = rgba[iT + c]
        const vB = rgba[iB + c]
        rgba[iT + c] = Math.round(invW * vT + w * vB)
        rgba[iB + c] = Math.round(invW * vB + w * vT)
      }
    }
  }
}

export function readImageAlignFromNode(params: {
  imageAlign?: Partial<ImageAlignState>
}): ImageAlignState {
  return normalizeImageAlign(params.imageAlign)
}

export function imageAlignToNodePatch(state: ImageAlignState): {
  imageAlign: ImageAlignState
} {
  return { imageAlign: normalizeImageAlign(state) }
}
