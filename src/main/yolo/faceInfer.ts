/**
 * 人脸关键点推理（主进程 worker 内执行）：BlazeFace short-range 检测 + MediaPipe FaceMesh 468 点。
 *
 * 两段式与 MediaPipe 官方一致：
 *   1) 检测器（输入 128×128，letterbox，归一化到 [-1,1]）给出人脸框与 6 个关键点；
 *   2) 按两眼连线定旋角裁一个 192×192 的对齐方块（归一化到 [0,1]）喂给 FaceMesh；
 *   3) 468 点按裁剪变换逆投影回原图，再映射成 canonical-68 供上层直接用。
 *
 * 纯数学（锚点 / 解码 / 加权 NMS / 裁剪投影 / 468→68）在 `@shared/faceMesh`，
 * 那里有单测；本文件只负责张量装配、会话缓存与图像重采样。
 */

import type { InferenceSession, Tensor } from 'onnxruntime-node'
import type { YoloFace, YoloFaceLandmark, YoloFaceResult } from '@shared/yolo'
import { YOLO_FACE_DETECT_INPUT, YOLO_FACE_LANDMARK_INPUT } from '@shared/yolo'
import {
  computeFaceCrop,
  decodeBlazeFaceDetections,
  FACEMESH_TO_68,
  generateBlazeFaceAnchors,
  mapPointFromCrop,
  weightedNonMaxSuppression,
  type FaceAnchor,
  type FaceDetection,
  type FaceKeypoint
} from '@shared/faceMesh'
import { decodeImage } from './imageDecoder'
import type { YoloWorkerFaceParams } from './protocol'

type OrtModule = typeof import('onnxruntime-node')

/** 单次请求最多返回的人脸数（多人大合照也只取前几张，避免无谓开销） */
const MAX_FACES = 5
/** 检测分数阈值：低于此值直接丢弃 */
const DETECT_SCORE_THRESHOLD = 0.5
/** 加权 NMS 的抑制阈值 */
const NMS_IOU_THRESHOLD = 0.3

let anchors: FaceAnchor[] | null = null
function blazefaceAnchors(): FaceAnchor[] {
  if (!anchors) anchors = generateBlazeFaceAnchors()
  return anchors
}

const sessions = new Map<string, InferenceSession>()

async function getSession(mod: OrtModule, path: string): Promise<InferenceSession> {
  const cached = sessions.get(path)
  if (cached) return cached
  const session = await mod.InferenceSession.create(path, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all'
  })
  sessions.set(path, session)
  return session
}

/** 会话释放（服务停止 / 崩溃时调用，避免句柄泄漏） */
export function disposeFaceSessions(): void {
  sessions.clear()
}

// ── 张量装配 ───────────────────────────────────────────────────

/** ONNX 转换器可能把 NHWC 转成 NCHW：按输入维度里 3 的位置决定数据顺序 */
function inputChannelFirst(session: InferenceSession): boolean {
  const name = session.inputNames[0]
  if (!name) return false
  const meta = session.inputMetadata?.[name] as unknown as { dims?: number[] } | undefined
  const dims = meta?.dims ?? []
  return dims.length === 4 && dims[1] === 3
}

/** NHWC [h,w,3] 的重采样结果 → 模型输入张量（按布局决定是否转 CHW） */
function imageTensor(
  mod: OrtModule,
  session: InferenceSession,
  hwc: Float32Array,
  width: number,
  height: number
): Tensor {
  if (inputChannelFirst(session)) {
    const chw = new Float32Array(3 * width * height)
    for (let i = 0; i < width * height; i++) {
      chw[i] = hwc[i * 3]!
      chw[width * height + i] = hwc[i * 3 + 1]!
      chw[2 * width * height + i] = hwc[i * 3 + 2]!
    }
    return new mod.Tensor('float32', chw, [1, 3, height, width])
  }
  return new mod.Tensor('float32', hwc, [1, height, width, 3])
}

// ── 预处理 ─────────────────────────────────────────────────────

interface Decoded {
  /** 解码结果是 Uint8Array（见 imageDecoder）；这里只读采样，无需 clamp 语义 */
  data: Uint8Array
  width: number
  height: number
}

function sampleBilinear(
  image: Decoded,
  x: number,
  y: number,
  out: Float32Array,
  offset: number
): void {
  const cx = Math.min(image.width - 1, Math.max(0, x))
  const cy = Math.min(image.height - 1, Math.max(0, y))
  const x0 = Math.floor(cx)
  const y0 = Math.floor(cy)
  const x1 = Math.min(image.width - 1, x0 + 1)
  const y1 = Math.min(image.height - 1, y0 + 1)
  const fx = cx - x0
  const fy = cy - y0
  const i00 = (y0 * image.width + x0) * 4
  const i10 = (y0 * image.width + x1) * 4
  const i01 = (y1 * image.width + x0) * 4
  const i11 = (y1 * image.width + x1) * 4
  for (let c = 0; c < 3; c++) {
    const top = image.data[i00 + c]! + (image.data[i10 + c]! - image.data[i00 + c]!) * fx
    const bottom = image.data[i01 + c]! + (image.data[i11 + c]! - image.data[i01 + c]!) * fx
    out[offset + c] = top + (bottom - top) * fy
  }
}

/**
 * 检测器输入：整图等比缩放到 128×128（余下补 0），归一化 (v-127.5)/127.5。
 * 与 MediaPipe `ImageToTensorCalculator{keep_aspect_ratio:true, range:[-1,1]}` 同口径。
 */
function detectorInput(image: Decoded): Float32Array {
  const size = YOLO_FACE_DETECT_INPUT
  const scale = Math.min(size / image.width, size / image.height)
  const drawW = Math.max(1, Math.round(image.width * scale))
  const drawH = Math.max(1, Math.round(image.height * scale))
  const out = new Float32Array(size * size * 3)
  const pixel = new Float32Array(3)
  for (let y = 0; y < drawH; y++) {
    for (let x = 0; x < drawW; x++) {
      sampleBilinear(
        image,
        ((x + 0.5) * image.width) / drawW - 0.5,
        ((y + 0.5) * image.height) / drawH - 0.5,
        pixel,
        0
      )
      const o = (y * size + x) * 3
      for (let c = 0; c < 3; c++) out[o + c] = (pixel[c]! - 127.5) / 127.5
    }
  }
  return out
}

/** 检测框/关键点从 letterbox 归一化坐标 → 原图归一化坐标 */
function unletterbox(detection: FaceDetection, image: Decoded): FaceDetection {
  const size = YOLO_FACE_DETECT_INPUT
  const scale = Math.min(size / image.width, size / image.height)
  const drawW = image.width * scale
  const drawH = image.height * scale
  const padX = (size - drawW) / 2
  const padY = (size - drawH) / 2
  const toImage = (point: FaceKeypoint): FaceKeypoint => ({
    x: (point.x * size - padX) / drawW,
    y: (point.y * size - padY) / drawH
  })
  const center = toImage({ x: detection.box.xCenter, y: detection.box.yCenter })
  const w = (detection.box.w * size) / drawW
  const h = (detection.box.h * size) / drawH
  return {
    box: {
      xCenter: center.x,
      yCenter: center.y,
      w: Math.min(1, w),
      h: Math.min(1, h),
      score: detection.box.score
    },
    keypoints: detection.keypoints.map(toImage)
  }
}

/**
 * 对齐裁剪：按 crop 的旋转/中心/边长在**像素空间**做双线性采样，归一化到 [0,1]。
 * 越界补 0（与 MediaPipe `BORDER_ZERO` 一致）。
 */
function landmarkInput(image: Decoded, crop: ReturnType<typeof computeFaceCrop>): Float32Array {
  const size = YOLO_FACE_LANDMARK_INPUT
  const out = new Float32Array(size * size * 3)
  const aspect = crop.aspect > 0 ? crop.aspect : 1
  const cos = Math.cos(crop.rotationRad)
  const sin = Math.sin(crop.rotationRad)
  const pixel = new Float32Array(3)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 裁剪图归一化 → 相对裁剪中心、以「图像宽度比例」为单位的偏移
      const rx = ((x + 0.5) / size - 0.5) * crop.size
      const ry = ((y + 0.5) / size - 0.5) * crop.size
      // 逆旋转（等向单位）→ 图像归一化坐标
      const dx = rx * cos - ry * sin
      const dy = rx * sin + ry * cos
      const nx = crop.centerX + dx
      const ny = crop.centerY + dy * aspect
      const px = nx * image.width - 0.5
      const py = ny * image.height - 0.5
      const o = (y * size + x) * 3
      if (px < -1 || py < -1 || px > image.width || py > image.height) {
        out[o] = 0
        out[o + 1] = 0
        out[o + 2] = 0
        continue
      }
      sampleBilinear(image, px, py, pixel, 0)
      for (let c = 0; c < 3; c++) out[o + c] = Math.min(1, Math.max(0, pixel[c]! / 255))
    }
  }
  return out
}

// ── 输出解析 ───────────────────────────────────────────────────

interface DecodedOutputs {
  regressors: Float32Array
  classificators: Float32Array
}

/** 按元素总数认领两个输出（不依赖转换器保留的节点名） */
function pickDetectionOutputs(outputs: Record<string, Tensor>): DecodedOutputs | null {
  const entries = Object.values(outputs)
  const expected = blazefaceAnchors().length
  let regressors: Float32Array | null = null
  let classificators: Float32Array | null = null
  for (const tensor of entries) {
    const data = tensor.data as Float32Array
    if (data.length === expected * 16) regressors = data
    else if (data.length === expected) classificators = data
  }
  if (!regressors || !classificators) return null
  return { regressors, classificators }
}

/** FaceMesh 输出 [1,1,1,1404] → 468×3；命名与维度都不保证，按元素数认领 */
function pickLandmarks(outputs: Record<string, Tensor>): Float32Array | null {
  for (const tensor of Object.values(outputs)) {
    const data = tensor.data as Float32Array
    if (data.length === 468 * 3) return data
  }
  return null
}

/**
 * 模型契约自检。
 *
 * 两个约定文件（`face-detect.onnx` / `face-landmark.onnx`）**放反了或装错模型**时，
 * 在推理之前不会有任何报错：只会抛一句维度不符的 ORT 错误，渲染层再按「可选能力」
 * 降级成空脸，表现为「五官 / 妆容 / 证件照悄悄不生效」。这里在会话创建后立刻核对
 * 输入/输出尺寸，把这种情况变成一条能直接定位的报错。
 *
 * **动态维（-1/0）一律跳过校验**：导出器可能给 NCHW `[1,3,H,W]`、NHWC `[1,H,W,3]`
 * 或全动态维，动态时无从判断 —— 宁可漏报，也不能误报把整条人脸链掐死。
 */
function hasDynamicDim(dims: readonly number[]): boolean {
  return dims.some((dim) => !Number.isFinite(dim) || dim <= 0)
}

function assertFaceModelContract(
  session: InferenceSession,
  role: 'detector' | 'landmark',
  path: string
): void {
  const expected = role === 'detector' ? YOLO_FACE_DETECT_INPUT : YOLO_FACE_LANDMARK_INPUT
  const inputName = session.inputNames[0] ?? ''
  const dims =
    (session.inputMetadata?.[inputName] as unknown as { dims?: number[] } | undefined)?.dims ?? []
  const spatial = dims.filter((dim) => dim > 1)
  if (dims.length && !hasDynamicDim(dims) && spatial.length && !spatial.includes(expected)) {
    throw new Error(
      `face: "${role}" model expects input ${dims.join('x')}, expected ${expected}x${expected}` +
        ` (${path}) — check that face-detect.onnx / face-landmark.onnx are not swapped`
    )
  }
  if (role !== 'landmark') return
  const outputName = session.outputNames[0] ?? ''
  const outDims =
    (session.outputMetadata?.[outputName] as unknown as { dims?: number[] } | undefined)?.dims ?? []
  if (!outDims.length || hasDynamicDim(outDims)) return
  const total = outDims.reduce((product, dim) => product * dim, 1)
  if (total !== 468 * 3) {
    throw new Error(
      `face: landmark model outputs ${outDims.join('x')} (${total} values), expected 468x3 = 1404` +
        ` (${path})`
    )
  }
}

// ── 主流程 ─────────────────────────────────────────────────────

export async function inferFaces(
  mod: OrtModule,
  params: YoloWorkerFaceParams
): Promise<YoloFaceResult> {
  const started = Date.now()
  const decoded = await decodeImage(params.image)
  const image: Decoded = { data: decoded.rgba, width: decoded.width, height: decoded.height }

  const detector = await getSession(mod, params.detectorPath)
  assertFaceModelContract(detector, 'detector', params.detectorPath)
  const detectTensor = imageTensor(
    mod,
    detector,
    detectorInput(image),
    YOLO_FACE_DETECT_INPUT,
    YOLO_FACE_DETECT_INPUT
  )
  const detectOut = (await detector.run({
    [detector.inputNames[0]!]: detectTensor
  })) as Record<string, Tensor>
  const detectionOutputs = pickDetectionOutputs(detectOut)
  if (!detectionOutputs) {
    throw new Error('face: detector outputs not recognised (expected 896×16 + 896×1)')
  }

  const detections = weightedNonMaxSuppression(
    decodeBlazeFaceDetections({
      regressors: detectionOutputs.regressors,
      classificators: detectionOutputs.classificators,
      minScoreThreshold: DETECT_SCORE_THRESHOLD
    }),
    NMS_IOU_THRESHOLD
  )
    .slice(0, MAX_FACES)
    .map((detection) => unletterbox(detection, image))

  if (!detections.length) {
    return {
      width: image.width,
      height: image.height,
      faces: [],
      inferenceMs: Date.now() - started
    }
  }

  const landmark = await getSession(mod, params.landmarkPath)
  assertFaceModelContract(landmark, 'landmark', params.landmarkPath)
  const faces: YoloFace[] = []
  for (const detection of detections) {
    const crop = computeFaceCrop(detection)
    const tensor = imageTensor(
      mod,
      landmark,
      landmarkInput(image, crop),
      YOLO_FACE_LANDMARK_INPUT,
      YOLO_FACE_LANDMARK_INPUT
    )
    const out = (await landmark.run({
      [landmark.inputNames[0]!]: tensor
    })) as Record<string, Tensor>
    const raw = pickLandmarks(out)
    if (!raw) continue
    /**
     * ⚠️ FaceMesh（官方 `face_landmark.tflite` 及其 478 点变体）输出的 x/y/z 是
     * **裁剪图内的像素量纲**（0~输入边长，实测 z 也一样），不是 0~1。
     *
     * MediaPipe 自己在 `LandmarksToTensor`/Tasks 包装里做这一步归一化，所以文档与
     * 网上示例看到的都是 0~1；照抄「输出即归一化」会让 468 点整体偏出裁剪框
     * （实测 x∈[41,146]、y∈[32,160] 被当成 0~1 用），五官定位与妆容分区全错且不报错。
     */
    const toCrop = (value: number): number => value / YOLO_FACE_LANDMARK_INPUT
    const landmarks468: YoloFaceLandmark[] = []
    for (let i = 0; i < 468; i++) {
      const inCrop = { x: toCrop(raw[i * 3]!), y: toCrop(raw[i * 3 + 1]!) }
      const point = mapPointFromCrop(inCrop, crop)
      landmarks468.push({
        x: point.x * image.width,
        y: point.y * image.height,
        z: toCrop(raw[i * 3 + 2]!) * image.width
      })
    }
    const landmarks68 = FACEMESH_TO_68.map((index) => ({
      x: landmarks468[index]!.x,
      y: landmarks468[index]!.y
    }))
    faces.push({
      score: detection.box.score,
      box: {
        x: detection.box.xCenter * image.width - (detection.box.w * image.width) / 2,
        y: detection.box.yCenter * image.height - (detection.box.h * image.height) / 2,
        width: detection.box.w * image.width,
        height: detection.box.h * image.height
      },
      keypoints: detection.keypoints.map((point) => ({
        x: point.x * image.width,
        y: point.y * image.height
      })),
      landmarks468,
      landmarks68
    })
  }

  return { width: image.width, height: image.height, faces, inferenceMs: Date.now() - started }
}
