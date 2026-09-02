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
  type YoloPoseResult,
  type YoloSegmentResult,
  type YoloTaskKind
} from '@shared/yolo'
import { decodeImage } from './imageDecoder'
import { rgbaToLetterboxTensor } from './preprocess'
import { composeMask, parseSegOutput, parseYoloOutput, type Candidate } from './postprocess'
import type {
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

let cachedSession: CachedSession | null = null

async function getSession(
  mod: OrtModule,
  modelPath: string,
  kind: YoloTaskKind
): Promise<import('onnxruntime-node').InferenceSession> {
  if (cachedSession && cachedSession.path === modelPath && cachedSession.kind === kind) {
    return cachedSession.session
  }
  const session = await mod.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all'
  })
  cachedSession = { path: modelPath, kind, session }
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
        data: composeMask(c.maskWeights!, parsed.maskProto!, maskHw)
      }))
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
    loadedSession: cachedSession
      ? { modelId: basename(cachedSession.path), kind: cachedSession.kind }
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
      default:
        throw new Error(`YOLO: unknown worker method: ${String((req as { method?: unknown }).method)}`)
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
