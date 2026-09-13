/**
 * 本地抠图节点参数：对上游图片做 YOLO 实例分割 → 透明通道 PNG。
 *
 * 与 `shared/yoloCutout.ts`（软边 alpha 几何）分离：本文件只管
 * 「节点参数形态」——从节点 params 读/写、做边界归一化；
 * 实际推理 + 合成由渲染层注入 `composeImageCutoutCanvas` 完成。
 */

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

export function normalizeImageCutout(raw?: Partial<ImageCutoutState> | null): ImageCutoutState {
  const base = { ...DEFAULT_IMAGE_CUTOUT, ...(raw ?? {}) }
  const selected = Array.isArray(base.selected)
    ? base.selected.filter((n) => Number.isFinite(n) && n >= 0).map((n) => Math.trunc(n))
    : null
  return {
    confThreshold: clamp(Number(base.confThreshold), 0.05, 0.9),
    threshold: clamp(Number(base.threshold), 0.05, 1),
    feather: Math.round(clamp(Number(base.feather), MIN_FEATHER, MAX_FEATHER)),
    cropToSubject: base.cropToSubject !== false,
    personOnly: base.personOnly !== false,
    selected: selected && selected.length > 0 ? selected : null
  }
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
