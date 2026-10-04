/**
 * 人脸关键点契约与几何：canonical-68（iBUG/300W 顺序）为**内部统一坐标系**。
 *
 * 为什么统一到 68 点：模型侧只负责「原生输出 → canonical-68」的转换
 * （`src/main/yolo/faceInfer.ts` + `src/shared/faceMesh.ts`），本应用其余部分
 * （提示词门禁、局部回贴的脸蒙版、证件照裁切）只认一套索引，换模型 / 换点数不动下游。
 *
 * 索引约定（canonical-68）：
 *   0–16 脸轮廓（0 左耳侧 → 8 下巴 → 16 右耳侧）
 *   17–21 左眉，22–26 右眉
 *   27–30 鼻梁（27 鼻根 → 30 鼻尖），31–35 鼻底
 *   36–41 左眼，42–47 右眼（36/45 外眼角，39/42 内眼角）
 *   48–59 外唇（48 左嘴角 → 54 右嘴角），60–67 内唇
 */

/** 内部坐标系标记；模型原生点数与来源记在 `modelId` */
export type PortraitFaceSchema = 'canonical68'

export const PORTRAIT_LANDMARK_COUNT = 68

export interface PortraitFaceBox {
  x: number
  y: number
  w: number
  h: number
}

export interface PortraitFaceAnalysis {
  schema: PortraitFaceSchema
  /** 归一化 0..1（相对原图宽高）的 68 点 */
  landmarks: Array<[number, number]>
  /** 归一化人脸框 */
  box: PortraitFaceBox
  /** 检出置信度 0..1 */
  score: number
  /** 来源模型 id */
  modelId: string
}

export interface PortraitFacesPayload {
  v: number
  /** 源图指纹：源图变了就要重算 */
  sourceHash: string
  faces: PortraitFaceAnalysis[]
  /** 当前选中的脸（多人照） */
  picked: number
  at: string
}

export const PORTRAIT_FACES_VERSION = 2

/** canonical-68 中与 5 点对应的索引（`portraitFaceMetrics` 用眼角组算度量） */
export const PORTRAIT_ANCHOR_INDICES = {
  leftEye: [36, 37, 38, 39, 40, 41] as const,
  rightEye: [42, 43, 44, 45, 46, 47] as const,
  noseTip: [30] as const,
  leftMouth: [48] as const,
  rightMouth: [54] as const
}

// ── 模板 ───────────────────────────────────────────────────────

function ellipseArc(
  out: Array<[number, number]>,
  count: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  from: number,
  to: number
): void {
  const denom = Math.max(1, count - 1)
  for (let i = 0; i < count; i++) {
    const t = i / denom
    const angle = from + (to - from) * t
    out.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)])
  }
}

/**
 * 中性人脸模板（canonical-68，单位脸框 0..1 坐标）。
 * 用参数化几何构造而不是内嵌 68 点字面量表：可读、可调、可单测对称性。
 */
export function canonicalFaceTemplate(): Array<[number, number]> {
  const pts: Array<[number, number]> = []
  // 0–16 脸轮廓：左耳侧 → 下巴 → 右耳侧（半椭圆，θ 0.95π → 0.05π）
  ellipseArc(pts, 17, 0.5, 0.5, 0.3, 0.44, Math.PI * 0.95, Math.PI * 0.05)
  // 17–21 左眉 / 22–26 右眉（上凸弧，眼上方）
  ellipseArc(pts, 5, 0.355, 0.45, 0.105, 0.055, Math.PI * 1.05, Math.PI * 1.95)
  ellipseArc(pts, 5, 0.645, 0.45, 0.105, 0.055, Math.PI * 1.05, Math.PI * 1.95)
  // 27–30 鼻梁（鼻根 → 鼻尖）
  pts.push([0.5, 0.5], [0.5, 0.565], [0.5, 0.625], [0.5, 0.665])
  // 31–35 鼻底：左鼻翼 → 鼻小柱 → 右鼻翼
  pts.push([0.443, 0.673], [0.473, 0.683], [0.5, 0.678], [0.527, 0.683], [0.557, 0.673])
  // 36–41 左眼（外眼角 → 上睑 → 内眼角 → 下睑）
  pts.push(
    [0.322, 0.5],
    [0.352, 0.478],
    [0.395, 0.475],
    [0.432, 0.497],
    [0.393, 0.513],
    [0.352, 0.514]
  )
  // 42–47 右眼（内眼角 → 上睑 → 外眼角 → 下睑，与 iBUG 的 36 起点镜像）
  pts.push(
    [0.568, 0.497],
    [0.605, 0.475],
    [0.648, 0.478],
    [0.678, 0.5],
    [0.648, 0.514],
    [0.607, 0.513]
  )
  // 48–59 外唇
  pts.push(
    [0.408, 0.775],
    [0.44, 0.755],
    [0.472, 0.748],
    [0.5, 0.752],
    [0.528, 0.748],
    [0.56, 0.755],
    [0.592, 0.775],
    [0.56, 0.802],
    [0.528, 0.812],
    [0.5, 0.815],
    [0.472, 0.812],
    [0.44, 0.802]
  )
  // 60–67 内唇
  pts.push(
    [0.436, 0.777],
    [0.468, 0.766],
    [0.532, 0.766],
    [0.564, 0.777],
    [0.532, 0.792],
    [0.5, 0.797],
    [0.468, 0.792],
    [0.5, 0.783]
  )
  return pts
}

function centroid(points: Array<[number, number]>, indices: readonly number[]): [number, number] {
  let x = 0
  let y = 0
  for (const i of indices) {
    x += points[i][0]
    y += points[i][1]
  }
  const n = Math.max(1, indices.length)
  return [x / n, y / n]
}
// ── 几何度量 ───────────────────────────────────────────────────

export interface PortraitFaceMetrics {
  /** 脸宽（轮廓左右极值） */
  width: number
  /** 脸高（轮廓顶 → 下巴） */
  height: number
  center: [number, number]
  chin: [number, number]
  forehead: [number, number]
  leftEye: [number, number]
  rightEye: [number, number]
  eyeDistance: number
  noseTip: [number, number]
  mouthCenter: [number, number]
  leftMouth: [number, number]
  rightMouth: [number, number]
  browY: number
}

export function portraitFaceMetrics(landmarks: Array<[number, number]>): PortraitFaceMetrics {
  const jaw = landmarks.slice(0, 17)
  const xs = jaw.map((p) => p[0])
  const ys = jaw.map((p) => p[1])
  const width = Math.max(...xs) - Math.min(...xs)
  const height = Math.max(...ys) - Math.min(...ys)
  const chin = landmarks[8]
  const forehead: [number, number] = [
    (landmarks[0][0] + landmarks[16][0]) / 2,
    Math.min(landmarks[0][1], landmarks[16][1])
  ]
  const leftEye = centroid(landmarks, PORTRAIT_ANCHOR_INDICES.leftEye)
  const rightEye = centroid(landmarks, PORTRAIT_ANCHOR_INDICES.rightEye)
  const leftMouth = landmarks[48]
  const rightMouth = landmarks[54]
  const browY = (landmarks[19][1] + landmarks[24][1]) / 2
  return {
    width,
    height,
    center: [(forehead[0] + chin[0]) / 2, (forehead[1] + chin[1]) / 2],
    chin: [chin[0], chin[1]],
    forehead,
    leftEye,
    rightEye,
    eyeDistance: Math.hypot(rightEye[0] - leftEye[0], rightEye[1] - leftEye[1]),
    noseTip: landmarks[30],
    mouthCenter: [(leftMouth[0] + rightMouth[0]) / 2, (leftMouth[1] + rightMouth[1]) / 2],
    leftMouth,
    rightMouth,
    browY
  }
}

/** 由 68 点推人脸框（含额头，用眉眼与轮廓外推） */
export function portraitFaceBoxFromLandmarks(landmarks: Array<[number, number]>): PortraitFaceBox {
  const m = portraitFaceMetrics(landmarks)
  const top = Math.min(m.forehead[1], landmarks[19][1], landmarks[24][1]) - m.height * 0.35
  const bottom = m.chin[1] + m.height * 0.05
  const left = m.center[0] - m.width * 0.62
  const right = m.center[0] + m.width * 0.62
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/**
 * 人脸框面积（归一化单位）：多人照里挑「最大的一张脸」当默认编辑目标。
 * 检测器给了 box 就用 box，没有就用关键点包围盒推。
 */
export function portraitFaceArea(face: PortraitFaceAnalysis): number {
  const box = face.box
  if (box && box.w > 0 && box.h > 0) return box.w * box.h
  if (!face.landmarks?.length) return 0
  const derived = portraitFaceBoxFromLandmarks(face.landmarks)
  return derived.w * derived.h
}
