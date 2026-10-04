/**
 * MediaPipe FaceMesh 的纯数学层：锚点生成 → 检测解码 → 加权 NMS → 对齐裁剪 → 468/68 映射。
 *
 * 为什么单独抽成 `src/shared` 的纯函数模块：
 * - 这几步只在数值上出错（框偏半格、镜像错、旋转方向反），肉眼「看起来只是有点歪」，
 *   必须能在 node 里用确定性输入锁住（`tests/faceMesh.test.ts`）；
 * - 不依赖 DOM / canvas / onnxruntime，主进程 worker 与渲染端都能直接调用。
 *
 * 本文件所有坐标默认是**归一化图像坐标**（0..1，y 向下），像素换算只在 `targetSize` 一处出现。
 */

// ── 类型 ───────────────────────────────────────────────────────

export interface FaceDetectionBox {
  xCenter: number
  yCenter: number
  w: number
  h: number
  score: number
}

export interface FaceKeypoint {
  x: number
  y: number
}

export interface FaceDetection {
  box: FaceDetectionBox
  keypoints: FaceKeypoint[]
}

export interface FaceAnchor {
  xCenter: number
  yCenter: number
  w: number
  h: number
}

export interface FaceCrop {
  /** 裁剪中心 x（图像归一化，按宽） */
  centerX: number
  /** 裁剪中心 y（图像归一化，按高） */
  centerY: number
  /** 裁剪边长，单位是**图像宽度的比例**（乘图像宽即像素边长） */
  size: number
  /** 像素空间旋转角（弧度）；旋转必须在各向同性空间里做，否则非方图会被切变 */
  rotationRad: number
  targetSize: number
  /** 图像宽高比 W/H：归一化空间各轴尺度不同，旋转/距离都要用它换算 */
  aspect: number
}

// ── BlazeFace short-range 锚点（SsdAnchorsCalculator 口径） ──────

/** 与官方 short-range 配置一致的常量，改动会让 896 个锚点与模型输出错位 */
const ANCHOR_CONFIG = {
  numLayers: 4,
  minScale: 0.1484375,
  maxScale: 0.75,
  inputWidth: 128,
  inputHeight: 128,
  anchorOffsetX: 0.5,
  anchorOffsetY: 0.5,
  strides: [8, 16, 16, 16],
  aspectRatios: [1.0],
  fixedAnchorSize: true,
  interpolatedScaleAspectRatio: 1.0,
  reduceBoxesInLowestLayer: false
} as const

export const BLAZEFACE_ANCHOR_COUNT = 896
/** 检测框宽高缩放（xScale=yScale=wScale=hScale）；与输入边长一致 */
const BLAZEFACE_BOX_SCALE = 128

function calculateScale(
  minScale: number,
  maxScale: number,
  strideIndex: number,
  numStrides: number
): number {
  if (numStrides === 1) return minScale
  return minScale + ((maxScale - minScale) * strideIndex) / (numStrides - 1)
}

/**
 * 生成 BlazeFace short-range 的 896 个锚点。
 * 逐层：同一 stride 的层共享 scale，先按 aspectRatios 生成，再补一个几何平均尺寸的插值锚。
 */
export function generateBlazeFaceAnchors(): FaceAnchor[] {
  const {
    numLayers,
    minScale,
    maxScale,
    inputWidth,
    inputHeight,
    anchorOffsetX,
    anchorOffsetY,
    strides,
    aspectRatios,
    fixedAnchorSize,
    interpolatedScaleAspectRatio
  } = ANCHOR_CONFIG

  const anchors: FaceAnchor[] = []
  for (let layer = 0; layer < numLayers; layer++) {
    const stride = strides[layer]
    const gridW = Math.ceil(inputWidth / stride)
    const gridH = Math.ceil(inputHeight / stride)
    const scale = calculateScale(minScale, maxScale, layer, numLayers)
    // 最后一层的下一档按 1.0 处理（官方实现里 scaleNext=1.0 收尾）
    const scaleNext =
      layer === numLayers - 1 ? 1.0 : calculateScale(minScale, maxScale, layer + 1, numLayers)

    for (let row = 0; row < gridH; row++) {
      for (let col = 0; col < gridW; col++) {
        const xCenter = (col + anchorOffsetX) / gridW
        const yCenter = (row + anchorOffsetY) / gridH
        /**
         * ⚠️ 每格两个锚点的**顺序**必须是「插值锚在前、固定锚在后」。
         *
         * MediaPipe 的 SsdAnchorsCalculator 在 `fixed_anchor_size` + `interpolated_scale_aspect_ratio`
         * 下的实际产出顺序是 [interpolated, fixed]；顺序反了不会报任何错，只会让解码把
         * 每个回归行配上另一套锚点边长，检测框整体缩到约 1/4～1/5
         * （实测 6 张人脸照里只有 1 张还能勉强命中，正确顺序是 5/6），
         * 上层表现为「几乎检测不到人脸」，五官 / 妆容静默失效。
         *
         * 另一处同类陷阱：`fixedAnchorSize` 的固定锚归一化宽高是 **1.0**（不是 scale），
         * 因为解码已经做了 `raw / scale * anchor.w`；填 scale 等于把 scale 乘两遍。
         */
        if (interpolatedScaleAspectRatio > 0) {
          const size = Math.sqrt(scale * scaleNext)
          anchors.push({ xCenter, yCenter, w: size, h: size })
        }
        for (const aspectRatio of aspectRatios) {
          const w = fixedAnchorSize ? 1 : scale * Math.sqrt(aspectRatio)
          const h = fixedAnchorSize ? 1 : scale / Math.sqrt(aspectRatio)
          anchors.push({ xCenter, yCenter, w, h })
        }
      }
    }
  }
  return anchors
}

// ── 解码（TensorsToDetectionsCalculator 口径） ──────────────────

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value))
}

/** 检测框的原始尺寸下限，避免 raw 为负/退化时得到零面积框 */
const MIN_BOX_RAW = 1e-6

/**
 * 解码 BlazeFace 输出为检测结果。
 *
 * `regressors` 按锚点顺序排列，每锚点 16 个值：raw[0..3] 是框中心偏移与宽高，
 * raw[4..15] 是 6 个关键点的偏移（右眼、左眼、鼻尖、嘴中心、右耳屏、左耳屏，图像视角）。
 * 全部按 anchor 的 w/h 反归一化后加 anchor 中心。
 */
export function decodeBlazeFaceDetections(input: {
  regressors: Float32Array | number[]
  classificators: Float32Array | number[]
  anchorCount?: number
  minScoreThreshold?: number
}): FaceDetection[] {
  const anchors = generateBlazeFaceAnchors()
  const anchorCount = input.anchorCount ?? anchors.length
  const minScoreThreshold = input.minScoreThreshold ?? 0.5
  const { regressors, classificators } = input

  const out: FaceDetection[] = []
  const limit = Math.min(anchorCount, anchors.length, Math.floor(regressors.length / 16))
  for (let i = 0; i < limit; i++) {
    const score = sigmoid(classificators[i] ?? Number.NEGATIVE_INFINITY)
    if (!(score >= minScoreThreshold)) continue

    const anchor = anchors[i]
    const base = i * 16
    const xCenter = (regressors[base] / BLAZEFACE_BOX_SCALE) * anchor.w + anchor.xCenter
    const yCenter = (regressors[base + 1] / BLAZEFACE_BOX_SCALE) * anchor.h + anchor.yCenter
    const w = (regressors[base + 2] / BLAZEFACE_BOX_SCALE) * anchor.w
    const h = (regressors[base + 3] / BLAZEFACE_BOX_SCALE) * anchor.h

    const keypoints: FaceKeypoint[] = []
    for (let k = 0; k < 6; k++) {
      keypoints.push({
        x: (regressors[base + 4 + 2 * k] / BLAZEFACE_BOX_SCALE) * anchor.w + anchor.xCenter,
        y: (regressors[base + 5 + 2 * k] / BLAZEFACE_BOX_SCALE) * anchor.h + anchor.yCenter
      })
    }

    out.push({
      box: { xCenter, yCenter, w: Math.max(w, MIN_BOX_RAW), h: Math.max(h, MIN_BOX_RAW), score },
      keypoints
    })
  }
  return out
}

// ── 加权 NMS（MediaPipe WeightedNonMaxSuppression） ─────────────

/** 检测框转 [xMin, yMin, xMax, yMax]（中心/宽高 → 角点，正负宽高都兼容） */
function boxCorners(box: FaceDetectionBox): [number, number, number, number] {
  const halfW = box.w / 2
  const halfH = box.h / 2
  return [box.xCenter - halfW, box.yCenter - halfH, box.xCenter + halfW, box.yCenter + halfH]
}

export function boxIoU(a: FaceDetectionBox, b: FaceDetectionBox): number {
  const [ax0, ay0, ax1, ay1] = boxCorners(a)
  const [bx0, by0, bx1, by1] = boxCorners(b)
  const interW = Math.max(0, Math.min(ax1, bx1) - Math.max(ax0, bx0))
  const interH = Math.max(0, Math.min(ay1, by1) - Math.max(ay0, by0))
  const inter = interW * interH
  if (inter <= 0) return 0
  const union =
    Math.max(0, ax1 - ax0) * Math.max(0, ay1 - ay0) +
    Math.max(0, bx1 - bx0) * Math.max(0, by1 - by0) -
    inter
  if (union <= 0) return 0
  return inter / union
}

/**
 * 加权 NMS：按 score 降序贪心分组，与组内任一条 IoU > 阈值即并入同组，
 * 每组输出按 score 加权的平均框/关键点，score 取组内最大值。
 * `detections` 需已按 minScoreThreshold 过滤（本函数不做分数过滤，只做抑制）。
 */
export function weightedNonMaxSuppression(
  detections: FaceDetection[],
  minSuppressionThreshold = 0.3
): FaceDetection[] {
  const indexed = detections.map((detection, index) => ({ detection, index }))
  indexed.sort((a, b) =>
    b.detection.box.score !== a.detection.box.score
      ? b.detection.box.score - a.detection.box.score
      : a.index - b.index
  )
  const sorted = indexed.map((entry) => entry.detection)

  const used = new Array<boolean>(sorted.length).fill(false)
  const out: FaceDetection[] = []

  for (let i = 0; i < sorted.length; i++) {
    if (used[i]) continue
    used[i] = true
    const group = [sorted[i]]
    for (let j = i + 1; j < sorted.length; j++) {
      if (used[j]) continue
      // 与组内任一条重叠即归入本组（并集式贪心，官方实现同此语义）
      if (group.some((member) => boxIoU(member.box, sorted[j].box) > minSuppressionThreshold)) {
        used[j] = true
        group.push(sorted[j])
      }
    }
    out.push(combineGroup(group))
  }
  return out
}

/** 组内加权平均：权重按 score 归一到和为 1；关键点按组内最小长度对齐后同样加权 */
function combineGroup(group: FaceDetection[]): FaceDetection {
  const totalScore = group.reduce((sum, detection) => sum + detection.box.score, 0)
  const weightSum = totalScore > 0 ? totalScore : group.length
  const weightAt = (detection: FaceDetection): number =>
    (totalScore > 0 ? detection.box.score : 1) / weightSum

  let xCenter = 0
  let yCenter = 0
  let w = 0
  let h = 0
  let score = Number.NEGATIVE_INFINITY
  for (const detection of group) {
    const weight = weightAt(detection)
    xCenter += detection.box.xCenter * weight
    yCenter += detection.box.yCenter * weight
    w += detection.box.w * weight
    h += detection.box.h * weight
    score = Math.max(score, detection.box.score)
  }

  const keypointCount = group.reduce(
    (min, detection) => Math.min(min, detection.keypoints.length),
    Number.POSITIVE_INFINITY
  )
  const count = Number.isFinite(keypointCount) ? keypointCount : 0
  const keypoints: FaceKeypoint[] = []
  for (let k = 0; k < count; k++) {
    let x = 0
    let y = 0
    for (const detection of group) {
      const weight = weightAt(detection)
      x += detection.keypoints[k].x * weight
      y += detection.keypoints[k].y * weight
    }
    keypoints.push({ x, y })
  }

  return {
    box: {
      xCenter,
      yCenter,
      w: Math.max(w, MIN_BOX_RAW),
      h: Math.max(h, MIN_BOX_RAW),
      score
    },
    keypoints
  }
}

// ── 对齐裁剪与投影 ─────────────────────────────────────────────

export const FACE_CROP_TARGET_SIZE = 192
export const FACE_CROP_SCALE = 1.5

/**
 * 由检测结果推 FaceMesh 的 192×192 对齐裁剪框：
 * 正方形（边长 max(w_px,h_px)*scale，含下巴与额头余量），绕框中心旋转到两眼水平。
 *
 * 注意各向异性：检测框与关键点都是「x 按宽、y 按高」的归一化坐标，
 * 直接在这个空间里旋转会把非方图切变，所以内部一律换算到像素空间
 * （用 `aspect = W/H`）再算角度与距离。
 */
export function computeFaceCrop(
  detection: FaceDetection,
  options?: { targetSize?: number; scale?: number; ignoreRotation?: boolean; aspect?: number }
): FaceCrop {
  const targetSize = options?.targetSize ?? FACE_CROP_TARGET_SIZE
  const scale = options?.scale ?? FACE_CROP_SCALE
  const ignoreRotation = options?.ignoreRotation ?? false
  const aspect = options?.aspect && options.aspect > 0 ? options.aspect : 1

  const box = detection.box
  // 统一到「图像宽度的比例」这一个等向单位：x 直接可用，y 要除以 aspect
  const widthFrac = box.w
  const heightFrac = box.h / aspect
  const size = Math.max(Math.max(widthFrac, heightFrac) * scale, MIN_BOX_RAW)

  let rotationRad = 0
  if (!ignoreRotation && detection.keypoints.length > 1) {
    const rightEye = detection.keypoints[0]
    const leftEye = detection.keypoints[1]
    // 关键点 0=右眼、1=左眼；用「左眼减右眼」得到像素空间里 x 轴向上的正角度
    const dx = leftEye.x - rightEye.x
    const dy = (leftEye.y - rightEye.y) / aspect
    rotationRad = Math.atan2(dy, dx)
  }

  return { centerX: box.xCenter, centerY: box.yCenter, size, rotationRad, targetSize, aspect }
}

/** 图像归一化坐标 → 裁剪图归一化坐标：换算到等向单位、平移、按 -rotation 旋转、除以边长 */
export function mapPointToCrop(point: FaceKeypoint, crop: FaceCrop): FaceKeypoint {
  const aspect = crop.aspect > 0 ? crop.aspect : 1
  const dx = point.x - crop.centerX
  const dy = (point.y - crop.centerY) / aspect
  const cos = Math.cos(-crop.rotationRad)
  const sin = Math.sin(-crop.rotationRad)
  const size = Math.max(crop.size, MIN_BOX_RAW)
  return {
    x: (dx * cos - dy * sin) / size + 0.5,
    y: (dx * sin + dy * cos) / size + 0.5
  }
}

/** `mapPointToCrop` 的逆变换：裁剪图归一化坐标 → 图像归一化坐标 */
export function mapPointFromCrop(point: FaceKeypoint, crop: FaceCrop): FaceKeypoint {
  const aspect = crop.aspect > 0 ? crop.aspect : 1
  const dx = (point.x - 0.5) * crop.size
  const dy = (point.y - 0.5) * crop.size
  const cos = Math.cos(crop.rotationRad)
  const sin = Math.sin(crop.rotationRad)
  return {
    x: crop.centerX + dx * cos - dy * sin,
    y: crop.centerY + (dx * sin + dy * cos) * aspect
  }
}

// ── 468 → 68 映射（iBUG/300W，与 src/shared/graph/portraitFace.ts 同序） ──

/**
 * MediaPipe FaceMesh 468 点 → canonical-68 的索引表（照抄官方映射约定）。
 * 顺序即 68 点顺序：0–16 脸轮廓、17–21 左眉、22–26 右眉、27–30 鼻梁、31–35 鼻底、
 * 36–41 左眼、42–47 右眼、48–59 外唇、60–67 内唇。
 */
export const FACEMESH_TO_68: readonly number[] = [
  127, 234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 70, 63, 105,
  66, 107, 336, 296, 334, 293, 300, 168, 6, 197, 195, 5, 4, 1, 19, 94, 33, 160, 158, 133, 153, 144,
  362, 385, 387, 263, 373, 380, 61, 39, 37, 0, 267, 269, 291, 405, 314, 17, 84, 181, 78, 82, 13,
  312, 308, 317, 14, 87
]

/** 按 `FACEMESH_TO_68` 取点，输出顺序即 canonical-68 */
export function landmarksTo68(landmarks468: ReadonlyArray<FaceKeypoint>): FaceKeypoint[] {
  return FACEMESH_TO_68.map((index) => {
    const point = landmarks468[index]
    return { x: point.x, y: point.y }
  })
}

/** 68 点的轴对齐包围盒（归一化坐标，宽高恒为正；与检测框/裁剪的坐标口径一致） */
export function boxFromLandmarks68(landmarks68: ReadonlyArray<FaceKeypoint>): {
  x: number
  y: number
  w: number
  h: number
} {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const point of landmarks68) {
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { x: 0, y: 0, w: 0, h: 0 }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
