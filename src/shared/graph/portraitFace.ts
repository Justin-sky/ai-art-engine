/**
 * 人脸关键点契约与几何：canonical-68（iBUG/300W 顺序）为**内部统一坐标系**。
 *
 * 为什么统一到 68 点：
 * - 模型侧只负责「原生输出 → canonical-68」的转换（`src/main/yolo/faceLandmarks.ts`），
 *   本应用其余部分（区域蒙版、五官变形、妆容、牙齿、证件照裁切）只认一套索引，
 *   换模型 / 换点数不动下游；
 * - 手动模式（无模型或未检出）只需用户拖 5 点，用相似变换拟合模板即得 68 点，
 *   因此**手动模式下全部五官与妆容功能仍然可用**（精度下降但不缺功能）。
 *
 * 索引约定（canonical-68）：
 *   0–16 脸轮廓（0 左耳侧 → 8 下巴 → 16 右耳侧）
 *   17–21 左眉，22–26 右眉
 *   27–30 鼻梁（27 鼻根 → 30 鼻尖），31–35 鼻底
 *   36–41 左眼，42–47 右眼（36/45 外眼角，39/42 内眼角）
 *   48–59 外唇（48 左嘴角 → 54 右嘴角），60–67 内唇
 */

/** 内部坐标系标记；模型原生点数与来源记在 `modelId` */
export type PortraitFaceSchema = 'canonical68' | 'manual5'

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
  /**
   * 468 点派生的稠密区域蒙版（归一化 0..1）。
   * 只在 `schema: 'canonical68'`（真检出 FaceMesh）时才有；缺项表示该区域没通过几何自检，
   * 调用方回落到 `portraitRegionPolygon` 的 68 点多边形。
   */
  regions?: PortraitFaceRegions
  /** 归一化人脸框 */
  box: PortraitFaceBox
  /** 检出置信度 0..1（手动模式恒为 1） */
  score: number
  /** 来源模型 id（手动模式为 'manual'） */
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

/**
 * 手动锚点的指纹哨兵：用户在哪张图上拖的点只有他自己知道，
 * 因此手动分析不参与「源图变了就失效」的判定，永远复用（要重标就再拖一次）。
 */
export const PORTRAIT_MANUAL_HASH = 'manual'

/** 手动的 5 点（顺序固定）：左眼中心、右眼中心、鼻尖、左嘴角、右嘴角 */
export interface PortraitManual5 {
  leftEye: [number, number]
  rightEye: [number, number]
  noseTip: [number, number]
  leftMouth: [number, number]
  rightMouth: [number, number]
}

/** canonical-68 中与 5 点对应的索引 */
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

/** 模板上的 5 个锚点；与 `manual5ToCanonical68` 的拟合基准一致 */
export function templateAnchors(template = canonicalFaceTemplate()): {
  leftEye: [number, number]
  rightEye: [number, number]
  noseTip: [number, number]
  leftMouth: [number, number]
  rightMouth: [number, number]
} {
  return {
    leftEye: centroid(template, PORTRAIT_ANCHOR_INDICES.leftEye),
    rightEye: centroid(template, PORTRAIT_ANCHOR_INDICES.rightEye),
    noseTip: [...template[PORTRAIT_ANCHOR_INDICES.noseTip[0]]] as [number, number],
    leftMouth: [...template[PORTRAIT_ANCHOR_INDICES.leftMouth[0]]] as [number, number],
    rightMouth: [...template[PORTRAIT_ANCHOR_INDICES.rightMouth[0]]] as [number, number]
  }
}

/**
 * 手动 5 点 → canonical-68：用「两眼连线」定旋转与尺度、其余锚点定平移与纵向比例，
 * 对模板做相似变换。锚点不足或退化（三点共线 / 距离过小）时返回 null。
 */
export function manual5ToCanonical68(manual: PortraitManual5): Array<[number, number]> | null {
  const template = canonicalFaceTemplate()
  const anchors = templateAnchors(template)

  const eyeVec: [number, number] = [
    manual.rightEye[0] - manual.leftEye[0],
    manual.rightEye[1] - manual.leftEye[1]
  ]
  const tmplEyeVec: [number, number] = [
    anchors.rightEye[0] - anchors.leftEye[0],
    anchors.rightEye[1] - anchors.leftEye[1]
  ]
  const eyeDist = Math.hypot(eyeVec[0], eyeVec[1])
  const tmplEyeDist = Math.hypot(tmplEyeVec[0], tmplEyeVec[1])
  if (eyeDist < 1e-4 || tmplEyeDist < 1e-4) return null

  const angle = Math.atan2(eyeVec[1], eyeVec[0]) - Math.atan2(tmplEyeVec[1], tmplEyeVec[0])
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const scale = eyeDist / tmplEyeDist

  const observedEyeMid: [number, number] = [
    (manual.leftEye[0] + manual.rightEye[0]) / 2,
    (manual.leftEye[1] + manual.rightEye[1]) / 2
  ]
  const tmplEyeMid: [number, number] = [
    (anchors.leftEye[0] + anchors.rightEye[0]) / 2,
    (anchors.leftEye[1] + anchors.rightEye[1]) / 2
  ]

  // 纵向比例：用「鼻尖 / 嘴」相对两眼中点的距离修正（不同脸型的脸长差异）
  const observedNose = Math.hypot(
    manual.noseTip[0] - observedEyeMid[0],
    manual.noseTip[1] - observedEyeMid[1]
  )
  const tmplNose = Math.hypot(
    anchors.noseTip[0] - tmplEyeMid[0],
    anchors.noseTip[1] - tmplEyeMid[1]
  )
  const yScale = tmplNose > 1e-4 && observedNose > 1e-4 ? observedNose / tmplNose : scale

  const mouthScale = (() => {
    const observedMouth = Math.hypot(
      manual.rightMouth[0] - manual.leftMouth[0],
      manual.rightMouth[1] - manual.leftMouth[1]
    )
    const tmplMouth = Math.hypot(
      anchors.rightMouth[0] - anchors.leftMouth[0],
      anchors.rightMouth[1] - anchors.leftMouth[1]
    )
    return tmplMouth > 1e-4 && observedMouth > 1e-4 ? observedMouth / tmplMouth : scale
  })()
  // 横向尺度取眼角距与嘴角距的加权：单一眼角距容易被侧脸压扁
  const xScale = (scale + mouthScale) / 2

  return template.map(([x, y]) => {
    const rx = (x - tmplEyeMid[0]) * xScale
    const ry = (y - tmplEyeMid[1]) * yScale
    return [observedEyeMid[0] + rx * cos - ry * sin, observedEyeMid[1] + rx * sin + ry * cos] as [
      number,
      number
    ]
  })
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

// ── 区域蒙版 ───────────────────────────────────────────────────

export type PortraitFaceRegion =
  | 'faceOval'
  | 'faceSkin'
  | 'forehead'
  | 'leftEye'
  | 'rightEye'
  | 'leftBrow'
  | 'rightBrow'
  | 'nose'
  | 'outerLip'
  | 'innerLip'
  | 'teeth'
  | 'leftCheek'
  | 'rightCheek'
  | 'jaw'

/**
 * 稠密区域多边形集合（468 点派生）：缺项 = 该区域没通过几何自检，
 * 调用方一律回落到 `portraitRegionPolygon` 的 68 点多边形。
 */
export type PortraitFaceRegions = Partial<Record<PortraitFaceRegion, Array<[number, number]>>>

const REGION_INDICES: Partial<Record<PortraitFaceRegion, readonly number[]>> = {
  faceOval: Array.from({ length: 17 }, (_, i) => i),
  leftEye: [36, 37, 38, 39, 40, 41],
  rightEye: [42, 43, 44, 45, 46, 47],
  leftBrow: [17, 18, 19, 20, 21],
  rightBrow: [22, 23, 24, 25, 26],
  nose: [27, 28, 29, 30, 31, 32, 33, 34, 35],
  outerLip: [48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59],
  innerLip: [60, 61, 62, 63, 64, 65, 66, 67],
  jaw: [4, 5, 6, 7, 8, 9, 10, 11, 12]
}

/** 靠几何构造的派生区域（没有 68 点索引表），与 `portraitRegionPolygon` 的 switch 分支一一对应 */
const DERIVED_REGIONS: readonly PortraitFaceRegion[] = [
  'faceSkin',
  'forehead',
  'teeth',
  'leftCheek',
  'rightCheek'
]

/**
 * 全部区域的**单一事实来源**。
 *
 * 管线的蒙版清单（`pipeline.ts`）与编辑器调试叠加清单（`PortraitEditorDialog.vue`）
 * 都从这里派生，加区域只要改这一处 —— 以前两处各有一份手写列表，
 * 漏改一处的表现是「管线算了但看不见」或「看得见但没算」，都很难发现。
 *
 * 组成 = `REGION_INDICES` 的直接索引区域 + 上面的派生区域；
 * 顺序即调试叠加层的描边顺序（`REGION_INDICES` 的键按字面量插入序，稳定）。
 */
export const PORTRAIT_ALL_REGIONS: readonly PortraitFaceRegion[] = [
  ...(Object.keys(REGION_INDICES) as PortraitFaceRegion[]),
  ...DERIVED_REGIONS
]

/**
 * 额头矩形口径：底边 = 眉高线（`portraitFaceMetrics.browY`），左右 = 太阳穴内收
 * （耳侧轮廓点向中轴收 10%），顶边 = 由「眉线 → 下巴」的纵向距离外推的发际线。
 *
 * **单一事实来源**：`forehead` 与 `faceSkin` 的上沿共用这一份，避免两处口径漂移。
 */
function foreheadBounds(
  landmarks: Array<[number, number]>,
  m: PortraitFaceMetrics
): { left: number; right: number; top: number; browY: number } {
  const chinY = landmarks[8][1]
  return {
    left: landmarks[0][0] * 0.9 + m.center[0] * 0.1,
    right: landmarks[16][0] * 0.9 + m.center[0] * 0.1,
    // 旧口径 `min(jaw0.y, jaw16.y) − jawHeight × 0.28` 在 `canonicalFaceTemplate()` 上
    // 实测 top = 0.4649，比 browY = 0.395 还**低**（矩形高度为负、朝下翻过去），
    // 拿到的是眉骨 / 上睑那一条，根本不是额头。改成按「眉线 → 下巴」等比外推：
    // 模板上 top = 0.0953、高 0.2998、面积 0.1599，与 `faceOval` 多边形面积 0.1652 同量级。
    top: m.browY - (chinY - m.browY) * 0.55,
    browY: m.browY
  }
}

/** 区域多边形（归一化坐标）；派生区域用几何构造 */
export function portraitRegionPolygon(
  region: PortraitFaceRegion,
  landmarks: Array<[number, number]>
): Array<[number, number]> {
  const direct = REGION_INDICES[region]
  if (direct) return direct.map((i) => [landmarks[i][0], landmarks[i][1]] as [number, number])

  const m = portraitFaceMetrics(landmarks)
  switch (region) {
    case 'teeth': {
      // 内唇向内收缩 15%，只覆盖牙齿区域
      const inner = REGION_INDICES.innerLip!.map((i) => landmarks[i])
      const cx = inner.reduce((s, p) => s + p[0], 0) / inner.length
      const cy = inner.reduce((s, p) => s + p[1], 0) / inner.length
      return inner.map((p) => [cx + (p[0] - cx) * 0.85, cy + (p[1] - cy) * 0.8] as [number, number])
    }
    case 'forehead': {
      const { left, right, top, browY } = foreheadBounds(landmarks, m)
      return [
        [left, browY],
        [left, top],
        [right, top],
        [right, browY]
      ]
    }
    case 'faceSkin': {
      // 整张脸：下颌 0..16（左耳侧 → 下巴 → 右耳侧）+ 右太阳穴 → 顶边 → 左太阳穴 → 回到 jaw0。
      // 上沿的 x 与额头矩形同口径（太阳穴内收）、顶边同高，因此这个多边形
      // 是「下半脸 ∪ 额头 ∪ 两者之间那条原本没人管的带」的**简单多边形**外包络。
      const { left, right, top, browY } = foreheadBounds(landmarks, m)
      const ring: Array<[number, number]> = []
      for (let i = 0; i <= 16; i++) ring.push([landmarks[i][0], landmarks[i][1]])
      ring.push([right, browY], [right, top], [left, top], [left, browY])
      return ring
    }
    case 'leftCheek': {
      return [
        [landmarks[1][0], landmarks[1][1]],
        [landmarks[3][0], landmarks[3][1]],
        [landmarks[31][0], landmarks[31][1]],
        [landmarks[30][0], landmarks[30][1]],
        [landmarks[48][0], landmarks[48][1]],
        [landmarks[5][0], landmarks[5][1]]
      ]
    }
    case 'rightCheek': {
      return [
        [landmarks[15][0], landmarks[15][1]],
        [landmarks[13][0], landmarks[13][1]],
        [landmarks[35][0], landmarks[35][1]],
        [landmarks[30][0], landmarks[30][1]],
        [landmarks[54][0], landmarks[54][1]],
        [landmarks[11][0], landmarks[11][1]]
      ]
    }
    default:
      return []
  }
}

/** 区域羽化比例（相对区域外接框短边） */
export function portraitRegionFeather(region: PortraitFaceRegion): number {
  switch (region) {
    case 'faceOval':
    // `faceSkin` 与 `faceOval` 同档：都是脸缘级别的软过渡，硬边会在下巴/太阳穴留下色块
    case 'faceSkin':
      return 0.18
    case 'forehead':
    case 'jaw':
    case 'leftCheek':
    case 'rightCheek':
      return 0.45
    case 'teeth':
      return 0.35
    case 'outerLip':
      return 0.15
    case 'innerLip':
      return 0.1
    default:
      return 0.25
  }
}

// ── 五官 / 身形 → 变形控制点 ───────────────────────────────────

/** 一个变形控制点：把 (x,y) 处的像素推向 (dx,dy)（归一化坐标，按脸宽缩放前的比例） */
export interface PortraitWarpControl {
  x: number
  y: number
  dx: number
  dy: number
  /** 影响半径（归一化，按脸宽的比例） */
  radius: number
}

/** -100..100 → -1..1 */
function unit(value: number): number {
  return Math.min(1, Math.max(-1, value / 100))
}

function push(
  out: PortraitWarpControl[],
  point: [number, number],
  dx: number,
  dy: number,
  radius: number
): void {
  if (dx === 0 && dy === 0) return
  out.push({ x: point[0], y: point[1], dx, dy, radius })
}

/**
 * 五官参数 → 变形控制点。
 * 每个参数只推它该管的点，位移量以脸宽为单位，保证不同分辨率/不同脸大小观感一致。
 */
export function buildFaceWarpControls(
  state: Record<string, number>,
  landmarks: Array<[number, number]>
): PortraitWarpControl[] {
  const m = portraitFaceMetrics(landmarks)
  const w = Math.max(1e-4, m.width)
  const out: PortraitWarpControl[] = []

  const slim = unit(state.faceSlim ?? 0)
  if (slim) {
    const radius = w * 0.35
    for (let i = 4; i <= 12; i++) {
      const p = landmarks[i]
      const dir = Math.sign(p[0] - m.center[0]) || 1
      push(out, p, -dir * Math.abs(slim) * w * 0.06, 0, radius)
    }
  }

  const cheek = unit(state.cheekbone ?? 0)
  if (cheek) {
    const radius = w * 0.3
    for (const i of [2, 14]) {
      const p = landmarks[i]
      const dir = Math.sign(p[0] - m.center[0]) || 1
      push(out, p, -dir * Math.abs(cheek) * w * 0.05, 0, radius)
    }
  }

  const jaw = unit(state.jawline ?? 0)
  if (jaw) {
    const radius = w * 0.32
    for (let i = 4; i <= 12; i++) {
      const p = landmarks[i]
      const dir = Math.sign(p[0] - m.center[0]) || 1
      push(out, p, -dir * Math.abs(jaw) * w * 0.045, -Math.min(0, jaw) * m.height * 0.02, radius)
    }
  }

  const chinLen = unit(state.chinLength ?? 0)
  if (chinLen) {
    const radius = w * 0.3
    for (const i of [7, 8, 9]) {
      push(out, landmarks[i], 0, chinLen * m.height * 0.06, radius)
    }
  }

  const chinSharp = unit(state.chinSharp ?? 0)
  if (chinSharp) {
    const radius = w * 0.26
    for (const i of [6, 7, 9, 10]) {
      const p = landmarks[i]
      const dir = Math.sign(p[0] - m.center[0]) || 1
      push(out, p, -dir * Math.abs(chinSharp) * w * 0.035, chinSharp * m.height * 0.015, radius)
    }
  }

  const forehead = unit(state.foreheadHeight ?? 0)
  if (forehead) {
    const radius = w * 0.45
    for (const i of [0, 1, 15, 16]) {
      push(out, landmarks[i], 0, -forehead * m.height * 0.05, radius)
    }
  }

  const eyeSize = unit(state.eyeSize ?? 0)
  if (eyeSize) {
    const radius = w * 0.16
    for (const group of [PORTRAIT_ANCHOR_INDICES.leftEye, PORTRAIT_ANCHOR_INDICES.rightEye]) {
      const center = centroid(landmarks, group)
      for (const i of group) {
        const p = landmarks[i]
        push(
          out,
          p,
          (p[0] - center[0]) * eyeSize * 0.35,
          (p[1] - center[1]) * eyeSize * 0.55,
          radius
        )
      }
    }
  }

  const eyeSpacing = unit(state.eyeSpacing ?? 0)
  if (eyeSpacing) {
    const radius = w * 0.22
    for (const [inner, outer] of [
      [39, 36],
      [42, 45]
    ] as const) {
      const innerP = landmarks[inner]
      const dir = Math.sign(innerP[0] - m.center[0]) || -1
      push(out, innerP, dir * eyeSpacing * w * 0.03, 0, radius)
      const outerP = landmarks[outer]
      const outerDir = Math.sign(outerP[0] - m.center[0]) || -1
      push(out, outerP, -outerDir * eyeSpacing * w * 0.02, 0, radius)
    }
  }

  const eyeTail = unit(state.eyeTail ?? 0)
  if (eyeTail) {
    const radius = w * 0.16
    for (const i of [36, 45]) {
      push(out, landmarks[i], 0, -eyeTail * m.height * 0.02, radius)
    }
  }

  const noseBridge = unit(state.noseBridge ?? 0)
  if (noseBridge) {
    const radius = w * 0.14
    for (const i of [27, 28, 29]) {
      const p = landmarks[i]
      const dir = Math.sign(p[0] - m.center[0]) || 1
      push(out, p, -dir * Math.abs(noseBridge) * w * 0.02, 0, radius)
    }
  }

  const noseWing = unit(state.noseWing ?? 0)
  if (noseWing) {
    const radius = w * 0.12
    for (const i of [31, 35]) {
      const p = landmarks[i]
      const dir = Math.sign(p[0] - m.center[0]) || 1
      push(out, p, -dir * Math.abs(noseWing) * w * 0.025, 0, radius)
    }
  }

  const noseTip = unit(state.noseTip ?? 0)
  if (noseTip) {
    const radius = w * 0.14
    for (const i of [30, 32, 34]) {
      push(out, landmarks[i], 0, noseTip * m.height * 0.02, radius)
    }
    const dir = Math.sign(state.noseTip ?? 0) || 1
    push(out, landmarks[31], -dir * w * 0.012, 0, radius)
    push(out, landmarks[35], dir * w * 0.012, 0, radius)
  }

  const mouthSize = unit(state.mouthSize ?? 0)
  if (mouthSize) {
    const radius = w * 0.2
    for (const [corner, inner] of [
      [48, 60],
      [54, 66]
    ] as const) {
      const p = landmarks[corner]
      const dir = Math.sign(p[0] - m.center[0]) || 1
      push(out, p, dir * mouthSize * w * 0.035, 0, radius)
      const q = landmarks[inner]
      const qDir = Math.sign(q[0] - m.center[0]) || 1
      push(out, q, qDir * mouthSize * w * 0.025, 0, radius)
    }
  }

  const lip = unit(state.lipThickness ?? 0)
  if (lip) {
    const radius = w * 0.18
    for (const i of [50, 51, 52]) push(out, landmarks[i], 0, -lip * m.height * 0.022, radius)
    for (const i of [56, 57, 58]) push(out, landmarks[i], 0, lip * m.height * 0.022, radius)
  }

  const lipShape = unit(state.lipShape ?? 0)
  if (lipShape) {
    const radius = w * 0.16
    for (const i of [49, 53]) push(out, landmarks[i], 0, lipShape * m.height * 0.015, radius)
    for (const i of [55, 59]) push(out, landmarks[i], 0, -lipShape * m.height * 0.012, radius)
    push(out, landmarks[51], 0, lipShape * m.height * 0.018, radius)
    push(out, landmarks[57], 0, -lipShape * m.height * 0.015, radius)
  }

  const browHeight = unit(state.browHeight ?? 0)
  if (browHeight) {
    const radius = w * 0.24
    for (const i of [17, 18, 19, 20, 21, 22, 23, 24, 25, 26]) {
      push(out, landmarks[i], 0, -browHeight * m.height * 0.03, radius)
    }
  }

  const browThickness = unit(state.browThickness ?? 0)
  if (browThickness) {
    const radius = w * 0.2
    for (const i of [19, 20, 24, 25]) {
      push(out, landmarks[i], 0, -browThickness * m.height * 0.012, radius)
    }
    for (const i of [17, 21, 22, 26]) {
      push(out, landmarks[i], 0, browThickness * m.height * 0.008, radius)
    }
  }

  return out
}

/** COCO-17 姿态关键点（归一化）：0 鼻 1/2 眼 3/4 耳 5/6 肩 7/8 肘 9/10 腕 11/12 髋 13/14 膝 15/16 踝 */
export type PortraitPoseKeypoint = [number, number, number?]

export function buildBodyWarpControls(
  state: Record<string, number>,
  pose: PortraitPoseKeypoint[]
): PortraitWarpControl[] {
  const out: PortraitWarpControl[] = []
  if (pose.length < 17) return out
  const [ls, rs, lh, rh] = [pose[5], pose[6], pose[11], pose[12]]
  const shoulderWidth = Math.max(1e-3, Math.hypot(rs[0] - ls[0], rs[1] - ls[1]))
  const torsoTop = (ls[1] + rs[1]) / 2
  const torsoBottom = (lh[1] + rh[1]) / 2
  const torsoH = Math.max(1e-3, torsoBottom - torsoTop)
  const centerX = (ls[0] + rs[0] + lh[0] + rh[0]) / 4

  const body = unit(state.bodySlim ?? 0)
  if (body) {
    const steps = 6
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const y = torsoTop + torsoH * t
      // 腰部收得最多（t≈0.6），肩与髋收得少：一条平滑的收腰曲线
      const weight = Math.sin(Math.PI * t) * 0.6 + 0.4
      const amount = Math.abs(body) * shoulderWidth * 0.06 * weight
      for (const side of [-1, 1]) {
        const x = centerX + side * shoulderWidth * (0.5 + 0.08 * Math.sin(Math.PI * t))
        push(out, [x, y], -side * amount, 0, shoulderWidth * 0.45)
      }
    }
  }

  const waist = unit(state.waistSlim ?? 0)
  if (waist) {
    const y = torsoTop + torsoH * 0.62
    const amount = Math.abs(waist) * shoulderWidth * 0.07
    for (const side of [-1, 1]) {
      push(out, [centerX + side * shoulderWidth * 0.34, y], -side * amount, 0, shoulderWidth * 0.4)
    }
  }

  const hip = unit(state.hipLift ?? 0)
  if (hip) {
    for (const side of [-1, 1]) {
      push(
        out,
        [centerX + side * shoulderWidth * 0.3, torsoBottom],
        0,
        -hip * torsoH * 0.05,
        shoulderWidth * 0.4
      )
    }
  }

  const arm = unit(state.armSlim ?? 0)
  if (arm) {
    for (const [shoulder, elbow, wrist] of [
      [pose[5], pose[7], pose[9]],
      [pose[6], pose[8], pose[10]]
    ] as const) {
      const dir = Math.sign(shoulder[0] - centerX) || 1
      const len = Math.max(1e-3, Math.hypot(wrist[0] - shoulder[0], wrist[1] - shoulder[1]))
      const amount = Math.abs(arm) * len * 0.06
      push(out, [elbow[0], elbow[1]], -dir * amount, 0, len * 0.35)
      push(out, [wrist[0], wrist[1]], -dir * amount * 0.6, 0, len * 0.3)
    }
  }

  const shoulderBeauty = unit(state.shoulderBeauty ?? 0)
  if (shoulderBeauty) {
    for (const [shoulder, elbow] of [
      [pose[5], pose[7]],
      [pose[6], pose[8]]
    ] as const) {
      const dir = Math.sign(shoulder[0] - centerX) || 1
      const drop = shoulderBeauty * shoulderWidth * 0.03
      push(
        out,
        [shoulder[0], shoulder[1]],
        -dir * Math.abs(shoulderBeauty) * shoulderWidth * 0.02,
        drop,
        shoulderWidth * 0.3
      )
      push(out, [elbow[0], elbow[1]], 0, drop * 0.4, shoulderWidth * 0.25)
    }
  }

  const neck = unit(state.neckLengthen ?? 0)
  if (neck && pose[0]) {
    const headTop = pose[0][1] - torsoH * 0.55
    const amount = neck * torsoH * 0.05
    push(out, [pose[0][0], headTop], 0, -amount, torsoH * 0.5)
    push(out, [centerX, torsoTop - torsoH * 0.12], 0, -amount * 0.5, torsoH * 0.4)
  }

  const leg = unit(state.legLengthen ?? 0)
  if (leg) {
    const hipY = torsoBottom
    const ankleY = Math.max(pose[15][1], pose[16][1])
    const legH = Math.max(1e-3, ankleY - hipY)
    for (const side of [-1, 1]) {
      const knee = side < 0 ? pose[13] : pose[14]
      const ankle = side < 0 ? pose[15] : pose[16]
      push(out, [knee[0], knee[1]], 0, leg * legH * 0.06, legH * 0.4)
      push(out, [ankle[0], ankle[1]], 0, leg * legH * 0.12, legH * 0.5)
    }
  }

  const ratio = unit(state.headBodyRatio ?? 0)
  if (ratio && pose[0]) {
    const headTop = pose[0][1] - torsoH * 0.55
    push(out, [pose[0][0], headTop], 0, ratio * torsoH * 0.03, torsoH * 0.45)
    for (const side of [-1, 1]) {
      const hip = side < 0 ? pose[11] : pose[12]
      push(out, [hip[0], hip[1]], 0, -ratio * torsoH * 0.02, torsoH * 0.3)
    }
  }

  return out
}
