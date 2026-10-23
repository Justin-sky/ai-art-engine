/**
 * 2D 人体骨骼模板（5.5「2D 导演台」骨骼摆姿装配子项）。
 *
 * 按 COCO17 拓扑一次性建出“正面平视”的标准人形 rig：
 * 关节名/侧别使用 stage2dPoseSolve 约定的可识别写法（chest/shoulder/elbow/
 * wrist/hip/knee/ankle + L/R 后缀），故建好后可直接用「从图片反解姿势」驱动。
 *
 * 仅绑定几何、无 pose（= 中立站立 + T 臂）。返回的 rig 坐标在画布 px 上，
 * 可整体按 { x, groundY, height } 摆放；比例可按需二次微调。
 */
import {
  computeStage2dRigTransforms,
  normalizeStage2dRig,
  type Stage2dJoint,
  type Stage2dRig
} from './stage2dRig'
import { keypointsFromSkeleton, STAGE2D_POSE_MIN_CONF } from './stage2dPoseSolve'
import type { YoloSkeletonPoint } from '../yolo'

export interface HumanoidStage2dRigOptions {
  /** 角色中轴线 x（画布 px），默认 0 */
  x?: number
  /** 脚底 y（画布 px），默认 height */
  groundY?: number
  /** 特征身高（头顶到脚底 px），默认 100 */
  height?: number
}

/** 人形模板关节构造描述 */
interface TemplateJointSpec {
  id: string
  name: string
  parentId: string | null
  /** 相对父关节的偏移（单位：height 的倍数；y 向下为正） */
  dx: number
  dy: number
}

/** 模板（比例相对身高，便于整体缩放摆位） */
const TEMPLATE: Array<Omit<TemplateJointSpec, 'dx' | 'dy'> & { offset: [number, number] }> = [
  { id: 'pelvis', name: 'pelvis', parentId: null, offset: [0, -0.5] },
  { id: 'chest', name: 'chest', parentId: 'pelvis', offset: [0, -0.18] },
  { id: 'neck', name: 'neck', parentId: 'chest', offset: [0, -0.12] },
  { id: 'head', name: 'head', parentId: 'neck', offset: [0, -0.1] },
  { id: 'shoulderL', name: 'shoulderL', parentId: 'chest', offset: [-0.1, -0.05] },
  { id: 'elbowL', name: 'elbowL', parentId: 'shoulderL', offset: [-0.22, 0] },
  { id: 'wristL', name: 'wristL', parentId: 'elbowL', offset: [-0.15, 0] },
  { id: 'shoulderR', name: 'shoulderR', parentId: 'chest', offset: [0.1, -0.05] },
  { id: 'elbowR', name: 'elbowR', parentId: 'shoulderR', offset: [0.22, 0] },
  { id: 'wristR', name: 'wristR', parentId: 'elbowR', offset: [0.15, 0] },
  { id: 'hipL', name: 'hipL', parentId: 'pelvis', offset: [-0.085, 0] },
  { id: 'kneeL', name: 'kneeL', parentId: 'hipL', offset: [0, 0.25] },
  { id: 'ankleL', name: 'ankleL', parentId: 'kneeL', offset: [0, 0.25] },
  { id: 'hipR', name: 'hipR', parentId: 'pelvis', offset: [0.085, 0] },
  { id: 'kneeR', name: 'kneeR', parentId: 'hipR', offset: [0, 0.25] },
  { id: 'ankleR', name: 'ankleR', parentId: 'kneeR', offset: [0, 0.25] }
]

/**
 * 生成标准人形骨骼。
 *
 * @param options.x       角色中轴线（默认 0）
 * @param options.groundY 脚底 y（默认 = height，即 x 轴处落地）
 * @param options.height  特征身高 px（默认 100）
 */
export function createHumanoidStage2dRig(options: HumanoidStage2dRigOptions = {}): Stage2dRig {
  const h = Math.max(1, options.height ?? 100)
  const x = options.x ?? 0
  const groundY = options.groundY ?? h
  // 根点 = 脚底中轴（子代逐级向上/向下铺开）
  const joints: Stage2dJoint[] = TEMPLATE.map((spec) => ({
    id: spec.id,
    name: spec.name,
    parentId: spec.parentId,
    x: Math.round(spec.offset[0] * h * 1000) / 1000,
    y: Math.round(spec.offset[1] * h * 1000) / 1000,
    rotation: 0
  }))
  return normalizeStage2dRig({
    root: { x: Math.round(x), y: Math.round(groundY) },
    joints,
    attachments: []
  })
}

export interface Stage2dSpriteSilhouetteInput {
  /**
   * 角色非透明外接框区域的像素掩码：
   * - 若 length === width * height，按单通道 alpha 读取；
   * - 若 length === width * height * 4，按 RGBA 第 4 通道（offset + 3）读取。
   */
  data: Uint8Array | Uint8ClampedArray
  width: number
  height: number
  /** 图层在舞台上是否水平镜像（flipX） */
  flipX?: boolean
  /** 判定非透明的 alpha 阈值（默认 16） */
  alphaMin?: number
}

export interface Stage2dSilhouetteAnalysis {
  /** 16 个标准关节在舞台坐标系下的形态学先验落点 */
  joints: Record<string, { x: number; y: number }>
  /** 检测到的颈部收窄归一化高度 v ∈ (0, 1) */
  neckV: number
  /** 检测到的骨盆/分叉归一化高度 v ∈ (0, 1) */
  pelvisV: number
  /** 是否在下半身检测到清晰的双腿分叉 */
  hasLegSplit: boolean
  /** 估算的头身比（1 / neckV，Q 版通常为 2~3.5，正常立绘为 4~7.5） */
  headBodyRatio: number
  /** 校验舞台坐标点 (x, y) 是否落在角色非透明像素邻域内 */
  isNearOpaque: (stageX: number, stageY: number, radiusPx?: number) => boolean
  /** 将舞台坐标点水平吸附到对应扫描行最近的非透明像素段内部 */
  snapIntoOpaque: (
    stageX: number,
    stageY: number,
    preferSide?: 'L' | 'R' | 'center'
  ) => { x: number; y: number }
}

export interface FitHumanoidStage2dRigOptions {
  /** 单人 COCO17 关键点（已换算到舞台像素坐标系） */
  skeleton?: readonly YoloSkeletonPoint[] | null
  /** 角色图层在舞台上的落位外接框（舞台像素系），用于缺失关键点的比例回退与轮廓约束 */
  bounds?: { x: number; y: number; width: number; height: number } | null
  /** 角色图层非透明轮廓掩码（用于二次元/Q 版形态学先验定位与 YOLO 异常点过滤） */
  silhouette?: Stage2dSpriteSilhouetteInput | null
  /** 舞台画布宽（缺省 1024） */
  canvasWidth?: number
  /** 舞台画布高（缺省 1024） */
  canvasHeight?: number
  /** 地面基线 y（缺省取 bounds 底边或 canvasHeight * 0.94） */
  groundY?: number
  /** 关键点最小有效置信度（默认 STAGE2D_POSE_MIN_CONF = 0.2） */
  minConfidence?: number
}

export interface FitHumanoidStage2dRigResult {
  rig: Stage2dRig
  /** 实际采信的有效 COCO 关键点数量（已剔除飞出轮廓外或违背解剖学的异常点） */
  matchedKeypoints: number
  /** 是否至少有躯干核心关键点（肩或髋）直接由 AI 关键点驱动 */
  usedKeypoints: boolean
  /** 是否启用了 Alpha 轮廓形态学分析先验 */
  usedSilhouette: boolean
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

interface ScanRun {
  u0: number
  u1: number
  center: number
  width: number
}

interface ScanRow {
  v: number
  runs: ScanRun[]
  mass: number
  span: number
  uMin: number
  uMax: number
  centroidU: number
}

/**
 * 针对二次元/Q版/游戏透明立绘的 Alpha 轮廓形态学骨架先验分析：
 * 1) 逐行扫描非透明像素连通段（runs）、行密度（mass）与水平质心；
 * 2) 在上半身 [0.06, 0.44] 自动定位「头部峰值 → 颈部收窄谷值（或肩部突增階跃）」，自适应 2~8 头身；
 * 3) 在下半身 [0.46, 0.96] 检测双腿/双脚分叉连通段，精确定位骨盆高度与左右膝/踝中心；
 * 4) 在上肢带检测独立手臂连通段或外侧轮廓带，并暴露非透明邻域校验与水平吸附函数。
 */
export function analyzeStage2dSpriteSilhouette(
  silhouette: Stage2dSpriteSilhouetteInput,
  bounds: { x: number; y: number; width: number; height: number }
): Stage2dSilhouetteAnalysis | null {
  const w = Math.floor(silhouette.width)
  const h = Math.floor(silhouette.height)
  if (w < 4 || h < 4 || bounds.width <= 4 || bounds.height <= 4) return null
  const isRgba = silhouette.data.length >= w * h * 4
  if (!isRgba && silhouette.data.length < w * h) return null

  const alphaMin = silhouette.alphaMin ?? 16
  const flipX = Boolean(silhouette.flipX)
  const sampleAlpha = (px: number, py: number): number => {
    const cx = clamp(Math.floor(px), 0, w - 1)
    const cy = clamp(Math.floor(py), 0, h - 1)
    const sx = flipX ? w - 1 - cx : cx
    const idx = cy * w + sx
    return isRgba ? silhouette.data[idx * 4 + 3] : silhouette.data[idx]
  }

  const numRows = clamp(h, 32, 180)
  const rows: ScanRow[] = []

  for (let i = 0; i < numRows; i += 1) {
    const v = (i + 0.5) / numRows
    const py = clamp(Math.floor(v * h), 0, h - 1)
    const rawRuns: Array<{ x0: number; x1: number }> = []
    let inRun = false
    let startX = 0
    for (let x = 0; x < w; x += 1) {
      const opaque = sampleAlpha(x, py) >= alphaMin
      if (opaque && !inRun) {
        inRun = true
        startX = x
      } else if (!opaque && inRun) {
        inRun = false
        rawRuns.push({ x0: startX, x1: x - 1 })
      }
    }
    if (inRun) rawRuns.push({ x0: startX, x1: w - 1 })

    // 合并小于 2% 宽度的细碎内部缝隙（避免线稿断线或装饰镂空把同一肢体切碎）
    const minGapPx = Math.max(1, Math.round(w * 0.02))
    const merged: Array<{ x0: number; x1: number }> = []
    for (const r of rawRuns) {
      const prev = merged[merged.length - 1]
      if (prev && r.x0 - prev.x1 <= minGapPx) {
        prev.x1 = r.x1
      } else {
        merged.push({ ...r })
      }
    }

    const runs: ScanRun[] = merged
      .map((r) => {
        const u0 = r.x0 / w
        const u1 = (r.x1 + 1) / w
        return { u0, u1, center: (u0 + u1) * 0.5, width: u1 - u0 }
      })
      .filter((r) => r.width >= 0.012)

    if (!runs.length) {
      rows.push({ v, runs: [], mass: 0, span: 0, uMin: 0.5, uMax: 0.5, centroidU: 0.5 })
      continue
    }

    let mass = 0
    let weightedSum = 0
    for (const r of runs) {
      mass += r.width
      weightedSum += r.center * r.width
    }
    const uMin = runs[0].u0
    const uMax = runs[runs.length - 1].u1
    rows.push({
      v,
      runs,
      mass,
      span: uMax - uMin,
      uMin,
      uMax,
      centroidU: mass > 0 ? weightedSum / mass : 0.5
    })
  }

  // 5 点滑动平滑行质量，抑制发丝/头饰毛刺
  const smoothMass = rows.map((_, idx) => {
    let sum = 0
    let count = 0
    for (let d = -2; d <= 2; d += 1) {
      const r = rows[idx + d]
      if (r) {
        sum += r.mass
        count += 1
      }
    }
    return count > 0 ? sum / count : 0
  })

  const rowAtV = (v: number): ScanRow => {
    const idx = clamp(Math.floor(v * numRows), 0, numRows - 1)
    return rows[idx]
  }

  // 1. 定位头部峰值与颈部收窄点 neckV（兼容 2~3 头身 Q 版与 5~8 头身正常立绘）
  let headPeakIdx = Math.floor(0.12 * numRows)
  let headPeakMass = 0
  for (let i = Math.floor(0.05 * numRows); i <= Math.floor(0.28 * numRows); i += 1) {
    if (smoothMass[i] > headPeakMass) {
      headPeakMass = smoothMass[i]
      headPeakIdx = i
    }
  }

  const searchStart = Math.max(Math.floor(0.14 * numRows), headPeakIdx + 2)
  const searchEnd = Math.floor(0.42 * numRows)
  let neckIdx = Math.floor(0.24 * numRows)
  let minNeckScore = Number.POSITIVE_INFINITY
  for (let i = searchStart; i <= searchEnd; i += 1) {
    // 同时考量当前行收窄程度与下方肩部扩张趋势
    const nextIdx = Math.min(numRows - 1, i + Math.max(2, Math.round(numRows * 0.05)))
    const shoulderExpand = Math.max(0, smoothMass[nextIdx] - smoothMass[i])
    const score = smoothMass[i] - shoulderExpand * 0.45
    if (score < minNeckScore && rows[i].mass > 0.02) {
      minNeckScore = score
      neckIdx = i
    }
  }
  const neckV = clamp(rows[neckIdx]?.v ?? 0.24, 0.15, 0.42)
  const headBodyRatio = round3(1 / Math.max(0.12, neckV))

  // 头部中心：取 [0.03, neckV * 0.85] 的质量加权质心
  let headSumU = 0
  let headSumV = 0
  let headWeight = 0
  for (const r of rows) {
    if (r.v >= 0.02 && r.v <= neckV * 0.86 && r.mass > 0.01) {
      headSumU += r.centroidU * r.mass
      headSumV += r.v * r.mass
      headWeight += r.mass
    }
  }
  const headU = headWeight > 0 ? headSumU / headWeight : rowAtV(neckV * 0.5).centroidU
  const headV = headWeight > 0 ? clamp(headSumV / headWeight, 0.05, neckV * 0.78) : neckV * 0.52

  // 2. 扫描下半身 [0.46, 0.96] 双腿连通段分叉
  const torsoCenterU = rowAtV(clamp(neckV + 0.16, 0.25, 0.55)).centroidU
  interface LegSplitRow {
    v: number
    leftRun: ScanRun
    rightRun: ScanRun
    gapMid: number
  }
  const legSplits: LegSplitRow[] = []
  for (const r of rows) {
    if (r.v < 0.46 || r.v > 0.96 || r.runs.length < 2) continue
    // 找分列在中轴线两侧、宽度足够的左右主连通段
    const sorted = [...r.runs].sort((a, b) => b.width - a.width)
    if (sorted.length < 2 || sorted[0].width < 0.03 || sorted[1].width < 0.03) continue
    const [leftRun, rightRun] =
      sorted[0].center < sorted[1].center ? [sorted[0], sorted[1]] : [sorted[1], sorted[0]]
    const gap = rightRun.u0 - leftRun.u1
    const gapMid = (leftRun.u1 + rightRun.u0) * 0.5
    if (gap >= 0.012 && Math.abs(gapMid - torsoCenterU) < 0.24) {
      legSplits.push({ v: r.v, leftRun, rightRun, gapMid })
    }
  }

  const hasLegSplit = legSplits.length >= Math.max(2, Math.round(numRows * 0.04))
  const defaultPelvisV = clamp(neckV + (1 - neckV) * 0.42, 0.46, 0.64)
  const pelvisV = hasLegSplit
    ? clamp(Math.min(legSplits[0].v - 0.02, defaultPelvisV + 0.06), neckV + 0.2, 0.65)
    : defaultPelvisV

  const shoulderV = clamp(neckV + (pelvisV - neckV) * 0.22, neckV + 0.03, pelvisV - 0.12)
  const chestV = clamp(neckV + (pelvisV - neckV) * 0.56, shoulderV + 0.04, pelvisV - 0.05)

  const neckRow = rowAtV(neckV)
  const chestRow = rowAtV(chestV)
  const pelvisRow = rowAtV(pelvisV)
  const shoulderRow = rowAtV(shoulderV)

  const pelvisU = pelvisRow.mass > 0.02 ? pelvisRow.centroidU : torsoCenterU
  const chestU = chestRow.mass > 0.02 ? chestRow.centroidU : pelvisU
  const neckU = neckRow.mass > 0.02 ? neckRow.centroidU : chestU

  // 估算躯干核心半宽：取胸到骨盆段最小行质量的一半作为无手臂躯干估算
  let minTorsoMass = 1
  for (const r of rows) {
    if (r.v >= shoulderV && r.v <= pelvisV && r.mass > 0.04) {
      minTorsoMass = Math.min(minTorsoMass, r.mass)
    }
  }
  if (!Number.isFinite(minTorsoMass) || minTorsoMass >= 0.99) {
    minTorsoMass = Math.max(0.16, pelvisRow.mass * 0.65)
  }
  const coreHalfW = clamp(minTorsoMass * 0.36, 0.06, 0.22)

  // 肩膀水平位置：落在肩部行有效轮廓内侧（约从外缘向内缩 25%，对齐三角肌旋转枢轴）
  const shHalfSpanL = Math.max(0.06, shoulderRow.centroidU - shoulderRow.uMin)
  const shHalfSpanR = Math.max(0.06, shoulderRow.uMax - shoulderRow.centroidU)
  const shoulderLU = clamp(
    shoulderRow.centroidU - Math.max(coreHalfW, shHalfSpanL * 0.65),
    shoulderRow.uMin + 0.02,
    shoulderRow.centroidU - 0.04
  )
  const shoulderRU = clamp(
    shoulderRow.centroidU + Math.max(coreHalfW, shHalfSpanR * 0.65),
    shoulderRow.centroidU + 0.04,
    shoulderRow.uMax - 0.02
  )

  // 手臂（肘、腕）形态学定位：若该高度存在脱离躯干的外侧连通段，直接取外侧段中心；否则沿轮廓外侧带延伸
  const resolveArmPoint = (
    vTarget: number,
    side: 'L' | 'R',
    fallbackOffsetU: number
  ): { u: number; v: number } => {
    const r = rowAtV(vTarget)
    if (r.runs.length >= 2) {
      const candidate = side === 'L' ? r.runs[0] : r.runs[r.runs.length - 1]
      const distFromCenter =
        side === 'L' ? r.centroidU - candidate.center : candidate.center - r.centroidU
      if (distFromCenter > coreHalfW * 0.75) {
        return { u: candidate.center, v: vTarget }
      }
    }
    if (r.mass > 0.04) {
      const u =
        side === 'L'
          ? clamp(r.uMin + Math.min(0.06, r.span * 0.16), r.uMin + 0.01, r.centroidU - 0.04)
          : clamp(r.uMax - Math.min(0.06, r.span * 0.16), r.centroidU + 0.04, r.uMax - 0.01)
      return { u, v: vTarget }
    }
    const baseU = side === 'L' ? shoulderLU - fallbackOffsetU : shoulderRU + fallbackOffsetU
    return { u: clamp(baseU, 0.04, 0.96), v: vTarget }
  }

  const elbowV = clamp(shoulderV + (pelvisV - shoulderV) * 0.62, shoulderV + 0.08, 0.68)
  const wristV = clamp(pelvisV + 0.04, elbowV + 0.08, 0.82)
  const elbowL = resolveArmPoint(elbowV, 'L', 0.06)
  const elbowR = resolveArmPoint(elbowV, 'R', 0.06)
  const wristL = resolveArmPoint(wristV, 'L', 0.1)
  const wristR = resolveArmPoint(wristV, 'R', 0.1)

  // 髋、膝、踝形态学定位：优先使用下半身左右腿连通段中心
  const hipHalfW = clamp(coreHalfW * 0.78, 0.055, 0.16)
  const hipLU = clamp(pelvisU - hipHalfW, pelvisRow.uMin + 0.02, pelvisU - 0.03)
  const hipRU = clamp(pelvisU + hipHalfW, pelvisU + 0.03, pelvisRow.uMax - 0.02)

  const ankleV = 0.93
  const kneeV = clamp((pelvisV + ankleV) * 0.5, pelvisV + 0.1, ankleV - 0.1)

  const findSplitNearV = (vTarget: number, tolerance = 0.09): LegSplitRow | null => {
    let best: LegSplitRow | null = null
    let bestDist = tolerance
    for (const s of legSplits) {
      const d = Math.abs(s.v - vTarget)
      if (d <= bestDist) {
        bestDist = d
        best = s
      }
    }
    return best
  }

  const kneeSplit = findSplitNearV(kneeV, 0.1)
  const ankleSplit = findSplitNearV(ankleV, 0.12) ?? legSplits[legSplits.length - 1] ?? null

  const ankleLU = ankleSplit ? ankleSplit.leftRun.center : hipLU
  const ankleRU = ankleSplit ? ankleSplit.rightRun.center : hipRU
  const kneeLU = kneeSplit ? kneeSplit.leftRun.center : (hipLU + ankleLU) * 0.5
  const kneeRU = kneeSplit ? kneeSplit.rightRun.center : (hipRU + ankleRU) * 0.5

  const toStage = (u: number, v: number): { x: number; y: number } => ({
    x: bounds.x + clamp(u, 0, 1) * bounds.width,
    y: bounds.y + clamp(v, 0, 1) * bounds.height
  })

  const joints: Record<string, { x: number; y: number }> = {
    pelvis: toStage(pelvisU, pelvisV),
    chest: toStage(chestU, chestV),
    neck: toStage(neckU, neckV),
    head: toStage(headU, headV),
    shoulderL: toStage(shoulderLU, shoulderV),
    elbowL: toStage(elbowL.u, elbowL.v),
    wristL: toStage(wristL.u, wristL.v),
    shoulderR: toStage(shoulderRU, shoulderV),
    elbowR: toStage(elbowR.u, elbowR.v),
    wristR: toStage(wristR.u, wristR.v),
    hipL: toStage(hipLU, pelvisV),
    kneeL: toStage(kneeLU, kneeV),
    ankleL: toStage(ankleLU, ankleV),
    hipR: toStage(hipRU, pelvisV),
    kneeR: toStage(kneeRU, kneeV),
    ankleR: toStage(ankleRU, ankleV)
  }

  const isNearOpaque = (stageX: number, stageY: number, radiusPx?: number): boolean => {
    const u = (stageX - bounds.x) / bounds.width
    const v = (stageY - bounds.y) / bounds.height
    if (u < -0.05 || u > 1.05 || v < -0.05 || v > 1.05) return false
    const cx = Math.round(u * (w - 1))
    const cy = Math.round(v * (h - 1))
    const rPx = Math.max(1, Math.round(((radiusPx ?? bounds.height * 0.025) / bounds.height) * h))
    for (let dy = -rPx; dy <= rPx; dy += Math.max(1, Math.floor(rPx / 2))) {
      for (let dx = -rPx; dx <= rPx; dx += Math.max(1, Math.floor(rPx / 2))) {
        if (sampleAlpha(cx + dx, cy + dy) >= alphaMin) return true
      }
    }
    return false
  }

  const snapIntoOpaque = (
    stageX: number,
    stageY: number,
    preferSide: 'L' | 'R' | 'center' = 'center'
  ): { x: number; y: number } => {
    const v = clamp((stageY - bounds.y) / bounds.height, 0.02, 0.98)
    const u = clamp((stageX - bounds.x) / bounds.width, 0.02, 0.98)
    const r = rowAtV(v)
    if (!r.runs.length) return { x: stageX, y: stageY }
    // 如果已经在某个非透明段内部（留 1% 边距），直接保持
    for (const run of r.runs) {
      if (u >= run.u0 && u <= run.u1) {
        const margin = Math.min(0.015, run.width * 0.25)
        const clampedU = clamp(u, run.u0 + margin, run.u1 - margin)
        return toStage(clampedU, v)
      }
    }
    if (preferSide === 'center') {
      return toStage(r.centroidU, v)
    }
    // 找距离 u 最近的非透明段并吸附到其内部
    let bestRun = r.runs[0]
    let bestDist = Number.POSITIVE_INFINITY
    for (const run of r.runs) {
      const d = u < run.u0 ? run.u0 - u : u > run.u1 ? u - run.u1 : 0
      if (d < bestDist) {
        bestDist = d
        bestRun = run
      }
    }
    return toStage(bestRun.center, v)
  }

  return {
    joints,
    neckV,
    pelvisV,
    hasLegSplit,
    headBodyRatio,
    isNearOpaque,
    snapIntoOpaque
  }
}

/**
 * 将标准 16 关节人形骨骼自动对齐到 AI（YOLO Pose COCO17）识别出的关节点与立绘 Alpha 轮廓：
 * - 支持传入 `silhouette`（透明立绘 Alpha 掩码），先通过形态学扫描定位头身比、颈部收窄、肩宽與双腿分叉先验；
 * - 对 YOLO 关键点执行「非透明像素命中校验 + 人体解剖学拓扑过滤」，自动剔除二次元/Q 版立绘上常见的飞点、倒置点与裙摆误检点；
 * - 将通过校验的 YOLO 关键点与轮廓形态学先验按置信度融合，并吸附回角色非透明像素内部；
 * - 所有关节绑定旋转保持 0°，使绑定姿势（pose = {}）100% 贴合原图，可直接无缝衔接自动拆件与动作采样。
 */
export function fitHumanoidStage2dRigToSkeleton(
  options: FitHumanoidStage2dRigOptions = {}
): FitHumanoidStage2dRigResult {
  const cw = Math.max(16, Number(options.canvasWidth) || 1024)
  const ch = Math.max(16, Number(options.canvasHeight) || 1024)
  const b = options.bounds
  const hasValidBounds =
    !!b &&
    Number.isFinite(b.x) &&
    Number.isFinite(b.y) &&
    Number.isFinite(b.width) &&
    Number.isFinite(b.height) &&
    b.width > 4 &&
    b.height > 4

  const bottomY = hasValidBounds
    ? b!.y + b!.height
    : Number.isFinite(options.groundY) && Number(options.groundY) > 0
      ? Number(options.groundY)
      : Math.round(ch * 0.94)
  const topY = hasValidBounds ? b!.y : bottomY - Math.round(Math.min(bottomY - 8, ch * 0.85))
  const charHeight = Math.max(32, bottomY - topY)
  const charWidth = hasValidBounds ? Math.max(16, b!.width) : charHeight * 0.55
  const centerX = hasValidBounds ? b!.x + b!.width * 0.5 : Math.round(cw * 0.5)
  const leftX = centerX - charWidth * 0.5

  // 1. 先用 Alpha 轮廓形态学分析（若有）或外接框比例建立基准世界坐标表
  const sil =
    hasValidBounds && options.silhouette
      ? analyzeStage2dSpriteSilhouette(options.silhouette, b!)
      : null

  const baseRig = createHumanoidStage2dRig({
    x: centerX,
    groundY: bottomY,
    height: charHeight
  })
  const world: Record<string, { x: number; y: number }> = {}
  for (const tf of computeStage2dRigTransforms(baseRig, null)) {
    world[tf.jointId] = sil?.joints[tf.jointId]
      ? { ...sil.joints[tf.jointId] }
      : { x: tf.x, y: tf.y }
  }
  const prior: Record<string, { x: number; y: number }> = {}
  for (const [k, pt] of Object.entries(world)) {
    prior[k] = { ...pt }
  }

  const minConf = options.minConfidence ?? STAGE2D_POSE_MIN_CONF
  const named = options.skeleton?.length ? keypointsFromSkeleton(options.skeleton) : {}

  // 校验关键点是否落在角色合理包络与非透明轮廓邻域内
  const validRawKp = (key: string, vRange?: [number, number]): YoloSkeletonPoint | null => {
    const pt = named[key]
    if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return null
    if (Number.isFinite(pt.confidence) && pt.confidence < minConf) return null
    if (hasValidBounds) {
      const u = (pt.x - leftX) / charWidth
      const v = (pt.y - topY) / charHeight
      if (u < -0.15 || u > 1.15 || v < -0.08 || v > 1.08) return null
      if (vRange && (v < vRange[0] || v > vRange[1])) return null
    }
    if (sil && !sil.isNearOpaque(pt.x, pt.y, charHeight * 0.04)) {
      return null
    }
    return pt
  }

  const rawLS = validRawKp('left_shoulder', [0.08, 0.56])
  const rawRS = validRawKp('right_shoulder', [0.08, 0.56])
  const rawLH = validRawKp('left_hip', [0.3, 0.82])
  const rawRH = validRawKp('right_hip', [0.3, 0.82])

  // 正面立绘中，COCO 的 left_shoulder（角色自身左肩）位于画面右侧（x 更大），
  // 而 stage2dHumanoid 约定 *L 在画面左侧、*R 在画面右侧：自动按屏幕左右配对。
  const swapLeftRight =
    (rawLS && rawRS && rawLS.x > rawRS.x) ||
    ((!rawLS || !rawRS) && rawLH && rawRH && rawLH.x > rawRH.x)
  const prefixL = swapLeftRight ? 'right' : 'left'
  const prefixR = swapLeftRight ? 'left' : 'right'

  const sideKp = (
    side: 'L' | 'R',
    part: 'eye' | 'ear' | 'shoulder' | 'elbow' | 'wrist' | 'hip' | 'knee' | 'ankle',
    vRange?: [number, number]
  ): YoloSkeletonPoint | null => validRawKp(`${side === 'L' ? prefixL : prefixR}_${part}`, vRange)

  let kpShoulderL = sideKp('L', 'shoulder', [0.08, 0.56])
  let kpShoulderR = sideKp('R', 'shoulder', [0.08, 0.56])
  // 若双肩水平间距过窄（YOLO 在二次元图上把双肩缩成同一点）则拒绝双肩异常值
  if (kpShoulderL && kpShoulderR && kpShoulderR.x - kpShoulderL.x < charHeight * 0.05) {
    kpShoulderL = null
    kpShoulderR = null
  }

  let kpHipL = sideKp('L', 'hip', [0.3, 0.82])
  let kpHipR = sideKp('R', 'hip', [0.3, 0.82])
  if (kpHipL && kpHipR && kpHipR.x - kpHipL.x < charHeight * 0.04) {
    kpHipL = null
    kpHipR = null
  }

  const shoulderMid =
    kpShoulderL && kpShoulderR
      ? { x: (kpShoulderL.x + kpShoulderR.x) * 0.5, y: (kpShoulderL.y + kpShoulderR.y) * 0.5 }
      : kpShoulderL
        ? { x: kpShoulderL.x + charHeight * 0.1, y: kpShoulderL.y }
        : kpShoulderR
          ? { x: kpShoulderR.x - charHeight * 0.1, y: kpShoulderR.y }
          : null

  let hipMid =
    kpHipL && kpHipR
      ? { x: (kpHipL.x + kpHipR.x) * 0.5, y: (kpHipL.y + kpHipR.y) * 0.5 }
      : kpHipL
        ? { x: kpHipL.x + charHeight * 0.085, y: kpHipL.y }
        : kpHipR
          ? { x: kpHipR.x - charHeight * 0.085, y: kpHipR.y }
          : null

  // 解剖学拓扑守卫：髋部必须显著低于肩部（防止二次元大裙摆或 Q 版把髋部猜到胸口以上）
  if (shoulderMid && hipMid && hipMid.y < shoulderMid.y + charHeight * 0.12) {
    kpHipL = null
    kpHipR = null
    hipMid = null
  }

  const headCandidates = [
    validRawKp('nose', [0.01, 0.45]),
    sideKp('L', 'eye', [0.01, 0.45]),
    sideKp('R', 'eye', [0.01, 0.45]),
    sideKp('L', 'ear', [0.01, 0.45]),
    sideKp('R', 'ear', [0.01, 0.45])
  ].filter((pt): pt is YoloSkeletonPoint => {
    if (!pt) return false
    if (shoulderMid && pt.y > shoulderMid.y - charHeight * 0.02) return false
    return true
  })

  const headPt = headCandidates.length
    ? {
        x: headCandidates.reduce((acc, p) => acc + p.x, 0) / headCandidates.length,
        y: headCandidates.reduce((acc, p) => acc + p.y, 0) / headCandidates.length,
        confidence:
          headCandidates.reduce((acc, p) => acc + (p.confidence ?? 0.6), 0) / headCandidates.length
      }
    : null

  // 将通过检验的 YOLO 点与轮廓形态学先验按置信度融合（无轮廓掩码时 100% 采信有效关键点）
  const blendWithPrior = (
    jointId: string,
    target: { x: number; y: number },
    conf = 0.75,
    preferSide: 'L' | 'R' | 'center' = 'center'
  ): { x: number; y: number } => {
    if (!sil) return target
    const p = prior[jointId] ?? target
    const wYolo = clamp((conf - 0.15) / 0.65, 0.4, 0.88)
    const blended = {
      x: p.x * (1 - wYolo) + target.x * wYolo,
      y: p.y * (1 - wYolo) + target.y * wYolo
    }
    return sil.snapIntoOpaque(blended.x, blended.y, preferSide)
  }

  let matchedKeypoints = headCandidates.length
  if (kpShoulderL) matchedKeypoints += 1
  if (kpShoulderR) matchedKeypoints += 1
  if (kpHipL) matchedKeypoints += 1
  if (kpHipR) matchedKeypoints += 1

  const usedKeypoints = Boolean(shoulderMid || hipMid)
  if (usedKeypoints) {
    if (hipMid) {
      const conf = Math.max(kpHipL?.confidence ?? 0.6, kpHipR?.confidence ?? 0.6)
      world.pelvis = blendWithPrior('pelvis', hipMid, conf, 'center')
    } else if (shoulderMid && !sil) {
      world.pelvis = { x: shoulderMid.x, y: shoulderMid.y + charHeight * 0.28 }
    }

    const effShoulderMid = shoulderMid ?? {
      x: (prior.shoulderL.x + prior.shoulderR.x) * 0.5,
      y: (prior.shoulderL.y + prior.shoulderR.y) * 0.5
    }
    world.chest = blendWithPrior(
      'chest',
      {
        x: world.pelvis.x + (effShoulderMid.x - world.pelvis.x) * 0.65,
        y: world.pelvis.y + (effShoulderMid.y - world.pelvis.y) * 0.65
      },
      0.7,
      'center'
    )

    if (shoulderMid && headPt) {
      world.neck = blendWithPrior(
        'neck',
        {
          x: shoulderMid.x + (headPt.x - shoulderMid.x) * 0.28,
          y: shoulderMid.y + (headPt.y - shoulderMid.y) * 0.28
        },
        headPt.confidence,
        'center'
      )
    } else if (shoulderMid && !sil) {
      world.neck = { x: shoulderMid.x, y: shoulderMid.y - charHeight * 0.05 }
    }

    if (headPt) {
      world.head = blendWithPrior('head', headPt, headPt.confidence, 'center')
    } else if (!sil) {
      world.head = { x: world.neck.x, y: world.neck.y - charHeight * 0.1 }
    }

    for (const side of ['L', 'R'] as const) {
      const sign = side === 'L' ? -1 : 1
      const sh = side === 'L' ? kpShoulderL : kpShoulderR
      if (sh) {
        world[`shoulder${side}`] = blendWithPrior(`shoulder${side}`, sh, sh.confidence, side)
      } else if (!sil) {
        world[`shoulder${side}`] = {
          x: world.chest.x + sign * charHeight * 0.1,
          y: world.chest.y - charHeight * 0.04
        }
      }
      const shPos = world[`shoulder${side}`]

      const rawEl = sideKp(side, 'elbow', [0.12, 0.78])
      const elDist = rawEl ? Math.hypot(rawEl.x - shPos.x, rawEl.y - shPos.y) : 0
      const el = rawEl && elDist >= charHeight * 0.04 && elDist <= charHeight * 0.46 ? rawEl : null
      if (el) matchedKeypoints += 1

      const rawWr = sideKp(side, 'wrist', [0.12, 0.92])
      const refForWr = el ?? shPos
      const wrDist = rawWr ? Math.hypot(rawWr.x - refForWr.x, rawWr.y - refForWr.y) : 0
      const wr = rawWr && wrDist >= charHeight * 0.04 && wrDist <= charHeight * 0.55 ? rawWr : null
      if (wr) matchedKeypoints += 1

      if (el) {
        world[`elbow${side}`] = blendWithPrior(`elbow${side}`, el, el.confidence, side)
      } else if (wr) {
        world[`elbow${side}`] = blendWithPrior(
          `elbow${side}`,
          { x: (shPos.x + wr.x) * 0.5, y: (shPos.y + wr.y) * 0.5 },
          wr.confidence,
          side
        )
      } else if (!sil) {
        world[`elbow${side}`] = {
          x: shPos.x + sign * charHeight * 0.16,
          y: shPos.y + charHeight * 0.11
        }
      }
      const elPos = world[`elbow${side}`]

      if (wr) {
        world[`wrist${side}`] = blendWithPrior(`wrist${side}`, wr, wr.confidence, side)
      } else if (el || !sil) {
        const udx = elPos.x - shPos.x
        const udy = elPos.y - shPos.y
        world[`wrist${side}`] = {
          x: elPos.x + udx * 0.72,
          y: elPos.y + udy * 0.72
        }
      }

      const hp = side === 'L' ? kpHipL : kpHipR
      if (hp) {
        world[`hip${side}`] = blendWithPrior(`hip${side}`, hp, hp.confidence, side)
      } else if (!sil) {
        world[`hip${side}`] = {
          x: world.pelvis.x + sign * charHeight * 0.085,
          y: world.pelvis.y
        }
      }
      const hpPos = world[`hip${side}`]

      const rawKn = sideKp(side, 'knee', [0.42, 0.94])
      const kn =
        rawKn &&
        rawKn.y >= hpPos.y + charHeight * 0.06 &&
        Math.hypot(rawKn.x - hpPos.x, rawKn.y - hpPos.y) <= charHeight * 0.48
          ? rawKn
          : null
      if (kn) matchedKeypoints += 1

      const rawAn = sideKp(side, 'ankle', [0.6, 1.05])
      const minAnY = (kn ? kn.y : hpPos.y) + charHeight * 0.06
      const an =
        rawAn &&
        rawAn.y >= minAnY &&
        Math.hypot(rawAn.x - (kn ?? hpPos).x, rawAn.y - (kn ?? hpPos).y) <= charHeight * 0.55
          ? rawAn
          : null
      if (an) matchedKeypoints += 1

      if (kn) {
        world[`knee${side}`] = blendWithPrior(`knee${side}`, kn, kn.confidence, side)
      } else if (an) {
        world[`knee${side}`] = blendWithPrior(
          `knee${side}`,
          { x: (hpPos.x + an.x) * 0.5, y: (hpPos.y + an.y) * 0.5 },
          an.confidence,
          side
        )
      } else if (!sil) {
        world[`knee${side}`] = {
          x: hpPos.x,
          y: Math.min(bottomY - charHeight * 0.12, hpPos.y + charHeight * 0.22)
        }
      }
      const knPos = world[`knee${side}`]

      if (an) {
        world[`ankle${side}`] = blendWithPrior(`ankle${side}`, an, an.confidence, side)
      } else if (!sil) {
        world[`ankle${side}`] = {
          x: knPos.x,
          y: Math.max(knPos.y + charHeight * 0.12, bottomY - charHeight * 0.03)
        }
      }
    }
  }

  const rootX = Math.round(world.pelvis.x)
  const rootY = Math.round(Math.max(bottomY, world.ankleL.y, world.ankleR.y))
  const joints: Stage2dJoint[] = TEMPLATE.map((spec) => {
    const cur = world[spec.id]
    const parent = spec.parentId ? world[spec.parentId] : { x: rootX, y: rootY }
    return {
      id: spec.id,
      name: spec.name,
      parentId: spec.parentId,
      x: round3(cur.x - parent.x),
      y: round3(cur.y - parent.y),
      rotation: 0
    }
  })

  return {
    rig: normalizeStage2dRig({
      root: { x: rootX, y: rootY },
      joints,
      attachments: []
    }),
    matchedKeypoints,
    usedKeypoints,
    usedSilhouette: Boolean(sil)
  }
}
