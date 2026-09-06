import type { YoloBox, YoloModelInfo, YoloSkeletonPoint } from '@shared/yolo'

/**
 * AI 姿势「识别质量与默认值」的纯函数层。
 *
 * 定位：把三件决策做成无 DOM/IPC 依赖的可测函数——
 * 1. 关键点置信度下限：低于该值的点视为不可信，叠加层不画、解算不驱动，
 *    保证「所见即所驱」；
 * 2. 多人候选排序 / 主体识别：默认选中面积最大的人，避免每次命中顺序抖动；
 * 3. pose 模型档位选择：解析模型 id 的 scale（n<s<m<l<x）挑最准的可用模型。
 */

/** 关键点参与叠加显示与骨骼驱动的统一置信度下限（YOLO pose 关键点 0~1） */
export const POSE_KEYPOINT_MIN_CONF = 0.2

export interface Bounds2D {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function isUsable(p: YoloSkeletonPoint | undefined, minConf: number): boolean {
  if (!p) return false
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false
  if (!Number.isFinite(p.confidence)) return true
  return p.confidence >= minConf
}

/** 骨架中高于置信度下限的点数 */
export function skeletonKeypointCount(
  skeleton: readonly YoloSkeletonPoint[] | undefined,
  minConf = POSE_KEYPOINT_MIN_CONF
): number {
  if (!skeleton) return 0
  let count = 0
  for (const p of skeleton) {
    if (isUsable(p, minConf)) count++
  }
  return count
}

/** 骨架可见点的包围盒；无可见点时返回 null */
export function skeletonBounds(
  skeleton: readonly YoloSkeletonPoint[] | undefined,
  minConf = POSE_KEYPOINT_MIN_CONF
): Bounds2D | null {
  if (!skeleton) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let count = 0
  for (const p of skeleton) {
    if (!isUsable(p, minConf)) continue
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
    count++
  }
  if (count < 2) return null
  return { minX, minY, maxX, maxY }
}

/** 骨架可见点中心；无可见点时返回 null */
export function skeletonCentroid(
  skeleton: readonly YoloSkeletonPoint[] | undefined,
  minConf = POSE_KEYPOINT_MIN_CONF
): { x: number; y: number } | null {
  const b = skeletonBounds(skeleton, minConf)
  if (!b) return null
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
}

function boundsDiag(b: Bounds2D): number {
  return Math.hypot(b.maxX - b.minX, b.maxY - b.minY)
}

/**
 * 主体打分：以人物框的对角线为主、可见点散度兜底，再用框置信度微调。
 * 用途是「默认选谁」，只需相对大小排序稳定即可。
 */
export function poseSubjectScore(
  skeleton: readonly YoloSkeletonPoint[] | undefined,
  box?: Pick<YoloBox, 'x' | 'y' | 'width' | 'height' | 'confidence'>,
  minConf = POSE_KEYPOINT_MIN_CONF
): number {
  const boxDiag =
    box && box.width > 0 && box.height > 0 ? Math.hypot(box.width, box.height) : 0
  const skelDiag = (() => {
    const b = skeletonBounds(skeleton, minConf)
    return b ? boundsDiag(b) : 0
  })()
  const diag = boxDiag > 0 ? boxDiag : skelDiag
  if (diag <= 0) return 0
  const conf =
    box && Number.isFinite(box.confidence)
      ? Math.min(1, Math.max(0, box.confidence))
      : 1
  return diag * (0.6 + 0.4 * conf)
}

/** 人物在画面中的横向位置（框 x 或骨架左缘），稳定排序的次级键 */
function leftEdgeOf(
  skeleton: readonly YoloSkeletonPoint[] | undefined,
  box?: Pick<YoloBox, 'x' | 'width'>,
  minConf = POSE_KEYPOINT_MIN_CONF
): number {
  if (box && Number.isFinite(box.x)) return box.x
  const b = skeletonBounds(skeleton, minConf)
  return b ? b.minX : 0
}

/**
 * 把多人候选按「主体优先」稳定排序（并列时左者在前），skeletons 与 boxes 保持一一对应。
 * 使每次重新检测的命中顺序确定，UI 的默认选中与「人物 N」标签不再随 YOLO 输出顺序抖动。
 */
export function sortPosePeople(
  skeletons: readonly YoloSkeletonPoint[][],
  boxes: readonly YoloBox[]
): { skeletons: YoloSkeletonPoint[][]; boxes: YoloBox[] } {
  const count = skeletons.length
  const order = Array.from({ length: count }, (_, i) => i)
  order.sort((a, b) => {
    const scoreDiff = poseSubjectScore(skeletons[b], boxes[b]) - poseSubjectScore(skeletons[a], boxes[a])
    if (scoreDiff !== 0) return scoreDiff
    return leftEdgeOf(skeletons[a], boxes[a]) - leftEdgeOf(skeletons[b], boxes[b])
  })
  return {
    skeletons: order.map((i) => skeletons[i]),
    boxes: order.map((i) => boxes[i])
  }
}

/**
 * 重新检测后保持「用户原先选的人」：用中心点相对人物尺寸的归一距离找最近候选。
 * 找不到（人物消失 / 大幅移动）返回 null，由调用方回落默认主体（index 0）。
 */
export function followUpSelectedIndex(
  previous: readonly YoloSkeletonPoint[] | undefined,
  candidates: readonly (readonly YoloSkeletonPoint[])[] | undefined,
  minConf = POSE_KEYPOINT_MIN_CONF
): number | null {
  if (!previous || !candidates || candidates.length === 0) return null
  const prevCentroid = skeletonCentroid(previous, minConf)
  if (!prevCentroid) return null
  const prevBounds = skeletonBounds(previous, minConf)
  if (!prevBounds) return null
  const prevDiag = Math.max(1e-3, boundsDiag(prevBounds))
  let bestIndex: number | null = null
  let bestRatio = 0.5
  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i]
    const c = skeletonCentroid(cand, minConf)
    if (!c) continue
    const candDiag = (() => {
      const b = skeletonBounds(cand, minConf)
      return b ? Math.max(1e-3, boundsDiag(b)) : prevDiag
    })()
    const dist = Math.hypot(c.x - prevCentroid.x, c.y - prevCentroid.y)
    const ratio = dist / Math.min(prevDiag, candDiag)
    if (ratio < bestRatio) {
      bestRatio = ratio
      bestIndex = i
    }
  }
  return bestIndex
}

// ── pose 模型档位选择 ─────────────────────────────────────────────

/** 官方命名 scale 的质量档（文件越大参数越多，越准但越慢） */
const POSE_SCALE_RANK: Record<string, number> = { n: 1, s: 2, m: 3, l: 4, x: 5 }

/** 按 id 解析档位：yolo11x-pose / yolo11n-pose → 数字；无法识别的 id 返回 0 */
export function poseModelRank(id: string): number {
  const m = /^yolo11([nsmlx])/i.exec(id.trim())
  if (!m) return 0
  return POSE_SCALE_RANK[m[1].toLowerCase()] ?? 0
}

/** 在可用 pose 模型里挑档位最高的（同档位取体积大者）；无可用模型返回 null */
export function bestPoseModel(models: readonly YoloModelInfo[]): YoloModelInfo | null {
  let best: YoloModelInfo | null = null
  let bestScore = -1
  for (const model of models) {
    const score = poseModelRank(model.id) * 1_000_000 + model.sizeMb
    if (score > bestScore) {
      bestScore = score
      best = model
    }
  }
  return best
}
