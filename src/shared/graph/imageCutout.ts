/**
 * 本地抠图节点参数：对上游图片做高精抠图 / YOLO 实例分割 → 透明通道 PNG。
 *
 * 与 `shared/yoloCutout.ts`（软边 alpha 几何、引导滤波精修、修补画笔）分离：本文件只管
 * 「节点参数形态」——从节点 params 读/写、做边界归一化；
 * 实际推理 + 合成由渲染层注入 `composeImageCutoutCanvas` 完成。
 */
import type { CutoutBrushStroke } from '../yoloCutout'

export interface ImageCutoutState {
  /** 检测置信度阈值 0~1（与一键抠图对话框口径一致） */
  confThreshold: number
  /** 掩码保留概率阈值 0~1（UI 以 5% 步进） */
  threshold: number
  /** 边缘羽化半径（输出像素） */
  feather: number
  /** 裁剪到选中主体外接框；关闭时保留整图构图（背景透明） */
  cropToSubject: boolean
  /** 只保留 person 类实例；false 保留全部检测实例 */
  personOnly: boolean
  /** 用户在抠图工具里勾选保留的检测实例下标；null/空 = 按 personOnly 默认规则 */
  selected: number[] | null
  /** 引导滤波边缘精修半径（0~16 像素；缺省 4） */
  edgeGuidedRadius?: number
  /** 边缘收缩/扩展（-10~+10；缺省 0） */
  edgeChoke?: number
  /** 自动穿透主体包围的封闭背景内洞（缺省 true） */
  holePunch?: boolean
  /** 用户在抠图工具里绘制的保留/擦除修补画笔轨迹（归一化原图坐标 0~1） */
  brushStrokes?: CutoutBrushStroke[]
}

export const DEFAULT_IMAGE_CUTOUT: ImageCutoutState = {
  confThreshold: 0.25,
  threshold: 0.5,
  feather: 2,
  cropToSubject: true,
  personOnly: true,
  selected: null
}

const MIN_FEATHER = 0
const MAX_FEATHER = 96

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function normalizeBrushStrokes(raw?: unknown): CutoutBrushStroke[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out: CutoutBrushStroke[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const stroke = item as Partial<CutoutBrushStroke>
    const mode = stroke.mode === 'erase' ? 'erase' : stroke.mode === 'keep' ? 'keep' : null
    if (!mode || !Array.isArray(stroke.points)) continue
    const points = stroke.points
      .filter(
        (p): p is { x: number; y: number } =>
          !!p && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y)
      )
      .map((p) => ({
        x: Math.round(clamp(Number(p.x), 0, 1) * 10000) / 10000,
        y: Math.round(clamp(Number(p.y), 0, 1) * 10000) / 10000
      }))
    if (points.length === 0) continue
    const radius = clamp(Number.isFinite(stroke.radius) ? Number(stroke.radius) : 0.03, 0.003, 0.25)
    out.push({
      mode,
      radius: Math.round(radius * 10000) / 10000,
      points
    })
  }
  return out.length > 0 ? out : undefined
}

export function normalizeImageCutout(raw?: Partial<ImageCutoutState> | null): ImageCutoutState {
  const base = { ...DEFAULT_IMAGE_CUTOUT, ...(raw ?? {}) }
  const selected = Array.isArray(base.selected)
    ? base.selected.filter((n) => Number.isFinite(n) && n >= 0).map((n) => Math.trunc(n))
    : null
  const normalized: ImageCutoutState = {
    confThreshold: clamp(Number(base.confThreshold), 0.05, 0.9),
    threshold: clamp(Number(base.threshold), 0.05, 1),
    feather: Math.round(clamp(Number(base.feather), MIN_FEATHER, MAX_FEATHER)),
    cropToSubject: base.cropToSubject !== false,
    personOnly: base.personOnly !== false,
    selected: selected && selected.length > 0 ? selected : null
  }
  if (raw?.edgeGuidedRadius !== undefined && Number.isFinite(Number(raw.edgeGuidedRadius))) {
    normalized.edgeGuidedRadius = Math.round(clamp(Number(raw.edgeGuidedRadius), 0, 16))
  }
  if (raw?.edgeChoke !== undefined && Number.isFinite(Number(raw.edgeChoke))) {
    normalized.edgeChoke = Math.round(clamp(Number(raw.edgeChoke), -10, 10))
  }
  if (raw?.holePunch !== undefined) {
    normalized.holePunch = Boolean(raw.holePunch)
  }
  const brushStrokes = normalizeBrushStrokes(raw?.brushStrokes)
  if (brushStrokes) {
    normalized.brushStrokes = brushStrokes
  }
  return normalized
}

export function readImageCutoutFromNode(params: {
  imageCutout?: Partial<ImageCutoutState>
}): ImageCutoutState {
  return normalizeImageCutout(params.imageCutout)
}

export function imageCutoutToNodePatch(state: ImageCutoutState): {
  imageCutout: ImageCutoutState
} {
  return { imageCutout: normalizeImageCutout(state) }
}
