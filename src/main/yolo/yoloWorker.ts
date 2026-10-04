/**
 * YOLO 推理子进程入口（Electron utilityProcess）。
 * 独立进程承载 onnxruntime-node：CPU 密集推理不阻塞主进程；原生模块崩溃不拖垮应用。
 * 生命周期由主进程 YoloService 管理；消息协议见 ./protocol.ts。
 *
 * 注意：onnxruntime-node 是 N-API 原生模块，必须动态 require——
 * 包未安装时子进程仍可启动并报告明确错误，而不是一启动就崩溃。
 */
import { basename } from 'path'
import {
  YOLO_COCO_LABELS,
  YOLO_DEFAULT_CONF,
  YOLO_DEFAULT_IOU,
  YOLO_INPUT_SIZE,
  type YoloDetectResult,
  type YoloFaceResult,
  type YoloPoseResult,
  type YoloSegmentResult,
  type YoloTaskKind
} from '@shared/yolo'
import { decodeImage } from './imageDecoder'
import { disposeFaceSessions, inferFaces } from './faceInfer'
import { rgbaToLetterboxTensor } from './preprocess'
import { composeMask, parseSegOutput, parseYoloOutput, type Candidate } from './postprocess'
import type {
  YoloWorkerFaceParams,
  YoloWorkerInferParams,
  YoloWorkerRequest,
  YoloWorkerResponse,
  YoloWorkerStatus
} from './protocol'

type OrtModule = typeof import('onnxruntime-node')

let ort: OrtModule | null = null
let ortLoadError: string | undefined

function loadOrt(): OrtModule {
  if (ort) return ort
  if (ortLoadError) throw new Error(ortLoadError)
  try {
    // dynamic require: keep worker alive even when the native dep is missing
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ort = require('onnxruntime-node') as OrtModule
    return ort
  } catch (err) {
    ortLoadError = `onnxruntime-node is not available: ${
      err instanceof Error ? err.message : String(err)
    }`
    throw new Error(ortLoadError)
  }
}

interface CachedSession {
  path: string
  kind: YoloTaskKind
  session: import('onnxruntime-node').InferenceSession
}

/**
 * 会话缓存：按「路径 + 任务类型」缓存。
 *
 * 人脸的**两个**模型不走这里（`faceInfer` 自带按路径的会话缓存），这里只服务
 * `infer` 的单模型请求。按 kind 分开缓存的价值：一次 Cook 里 detect → segment → pose
 * 交替跑时不必反复 create；同时**同一个 kind 只保留最新一份** —— 切换 s/m/l/x 档位时
 * 旧会话立刻失去引用，内存上界与原来的单槽实现一致（最多每 kind 一份）。
 */
const sessionCache = new Map<string, CachedSession>()
/** 最近一次创建/命中的会话，供 status 展示 */
let lastSession: CachedSession | null = null

async function getSession(
  mod: OrtModule,
  modelPath: string,
  kind: YoloTaskKind
): Promise<import('onnxruntime-node').InferenceSession> {
  const key = `${kind}\u0000${modelPath}`
  const cached = sessionCache.get(key)
  if (cached) {
    lastSession = cached
    return cached.session
  }
  const session = await mod.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all'
  })
  const entry: CachedSession = { path: modelPath, kind, session }
  sessionCache.set(key, entry)
  for (const [otherKey, other] of [...sessionCache]) {
    if (otherKey !== key && other.kind === kind) sessionCache.delete(otherKey)
  }
  lastSession = entry
  return session
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

function mapX(v640: number, padX: number, scale: number, width: number): number {
  return clamp((v640 - padX) / scale, 0, width)
}

function mapY(v640: number, padY: number, scale: number, height: number): number {
  return clamp((v640 - padY) / scale, 0, height)
}

function labelFor(classId: number): string {
  return classId >= 0 && classId < YOLO_COCO_LABELS.length
    ? YOLO_COCO_LABELS[classId]
    : `class-${classId}`
}

async function runInfer(
  params: YoloWorkerInferParams
): Promise<YoloDetectResult | YoloSegmentResult | YoloPoseResult> {
  const mod = loadOrt()
  const conf = params.confThreshold ?? YOLO_DEFAULT_CONF
  const iou = params.iouThreshold ?? YOLO_DEFAULT_IOU
  const started = Date.now()

  const decoded = await decodeImage(params.image)
  const lb = rgbaToLetterboxTensor(decoded.rgba, decoded.width, decoded.height, YOLO_INPUT_SIZE)

  const session = await getSession(mod, params.modelPath, params.kind)
  const inputName = session.inputNames[0]
  const feeds: Record<string, import('onnxruntime-node').Tensor> = {
    [inputName]: new mod.Tensor('float32', lb.tensor, [1, 3, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE])
  }
  const outputs = await session.run(feeds)

  const base = {
    width: decoded.width,
    height: decoded.height
  }

  if (params.kind === 'segment') {
    const detName = session.outputNames[0]
    const protoName = session.outputNames[1]
    const detDims = outputs[detName].dims
    const proto = outputs[protoName].data as Float32Array
    // proto 形状可能是 [1,32,H,W] 或 [1,32,H*W]，按元素总数反推边长最通用
    const maskHw = Math.round(Math.sqrt(proto.length / 32))
    const parsed = parseSegOutput(
      outputs[detName].data as Float32Array,
      detDims[1],
      detDims[2],
      proto,
      conf,
      iou
    )
    const result: YoloSegmentResult = {
      ...base,
      inferenceMs: Date.now() - started,
      boxes: parsed.candidates.map((c) => toBox(c, lb)),
      masks: parsed.candidates.map((c) => ({
        width: maskHw,
        height: maskHw,
        data: composeMask(c.maskWeights!, parsed.maskProto!, maskHw, params.softMask === true)
      })),
      // mask 覆盖整张 letterbox 画布，上层放大回原图需要这份几何
      letterbox: {
        size: YOLO_INPUT_SIZE,
        scale: lb.scale,
        padX: lb.padX,
        padY: lb.padY
      }
    }
    return result
  }

  const firstDims = outputs[session.outputNames[0]].dims
  const parsed = parseYoloOutput(
    outputs[session.outputNames[0]].data as Float32Array,
    firstDims[1],
    firstDims[2],
    params.kind,
    conf,
    iou
  )

  if (params.kind === 'pose') {
    const result: YoloPoseResult = {
      ...base,
      inferenceMs: Date.now() - started,
      boxes: parsed.candidates.map((c) => toBox(c, lb)),
      skeletons: parsed.candidates.map((c) => {
        const pts: YoloPoseResult['skeletons'][number] = []
        for (let k = 0; k < 17; k++) {
          pts.push({
            x: mapX(c.kpts![k * 3], lb.padX, lb.scale, decoded.width),
            y: mapY(c.kpts![k * 3 + 1], lb.padY, lb.scale, decoded.height),
            confidence: clamp(c.kpts![k * 3 + 2], 0, 1)
          })
        }
        return pts
      })
    }
    return result
  }

  const result: YoloDetectResult = {
    ...base,
    inferenceMs: Date.now() - started,
    boxes: parsed.candidates.map((c) => toBox(c, lb))
  }
  return result
}

function toBox(
  c: Candidate,
  lb: ReturnType<typeof rgbaToLetterboxTensor>
): YoloDetectResult['boxes'][number] {
  const [x1, y1, x2, y2] = c.box
  const ox1 = mapX(x1, lb.padX, lb.scale, lb.srcWidth)
  const oy1 = mapY(y1, lb.padY, lb.scale, lb.srcHeight)
  const ox2 = mapX(x2, lb.padX, lb.scale, lb.srcWidth)
  const oy2 = mapY(y2, lb.padY, lb.scale, lb.srcHeight)
  return {
    label: labelFor(c.classId),
    confidence: c.score,
    x: ox1,
    y: oy1,
    width: ox2 - ox1,
    height: oy2 - oy1
  }
}

/** 人脸关键点（两段式）：数学与张量装配全在 ./faceInfer，这里只做出口收敛 */
async function runFace(params: YoloWorkerFaceParams): Promise<YoloFaceResult> {
  return inferFaces(loadOrt(), params)
}

function currentStatus(): YoloWorkerStatus {
  if (!ort) {
    // 主动探测 onnxruntime，使 status 能如实反映就绪状态（而非等首次推理）
    try {
      loadOrt()
    } catch (err) {
      ortLoadError = err instanceof Error ? err.message : String(err)
    }
  }
  return {
    ready: !!ort,
    ortVersion: ort?.env?.versions?.node,
    backend: 'cpu',
    loadedSession: lastSession
      ? { modelId: basename(lastSession.path), kind: lastSession.kind }
      : undefined,
    error: ort ? undefined : (ortLoadError ?? 'onnxruntime-node not loaded yet')
  }
}

async function handleRequest(req: YoloWorkerRequest): Promise<void> {
  try {
    let result: unknown
    switch (req.method) {
      case 'ping':
        result = 'pong'
        break
      case 'status':
        result = currentStatus()
        break
      case 'infer':
        result = await runInfer(req.params as YoloWorkerInferParams)
        break
      case 'face':
        result = await runFace(req.params as YoloWorkerFaceParams)
        break
      default:
        throw new Error(
          `YOLO: unknown worker method: ${String((req as { method?: unknown }).method)}`
        )
    }
    const response: YoloWorkerResponse = { id: req.id, ok: true, result }
    process.parentPort?.postMessage(response)
  } catch (err) {
    const response: YoloWorkerResponse = {
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    }
    process.parentPort?.postMessage(response)
  }
}

process.parentPort?.on('message', (messageEvent: { data: unknown }) => {
  const req = messageEvent.data as YoloWorkerRequest
  if (!req || typeof req.id !== 'number') {
    console.error('[yolo-worker] received malformed request')
    return
  }
  void handleRequest(req)
})

/**
 * 退出前回收：
 * - 通用 YOLO 会话随进程结束自然释放（缓存表只存引用，无效化即可）；
 * - 人脸两段式会话由 faceInfer 内部持有，显式 dispose 与既有回收口径一致
 *   （`disposeFaceSessions` 是 faceInfer 唯一的释放入口）。
 */
process.on('exit', () => {
  sessionCache.clear()
  lastSession = null
  disposeFaceSessions()
})
