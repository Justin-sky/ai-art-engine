/**
 * 渲染层高精抠图：本地高精抠图模型（BiRefNet / RMBG / MODNet）+ YOLO 实例分割
 * + 引导图像滤波（Guided Image Filter）+ 封闭内洞穿透 + 保留/擦除修补画笔 → 透明通道 PNG 资产。
 *
 * 几何换算与软边合成在 @shared/yoloCutout（纯函数，可单测），
 * 本文件负责：源图解码、推理输入选择、零样本显著性兜底、结果合成与落盘。
 */
import {
  applyAlphaToRgba,
  buildCutoutAlpha,
  buildSalientSubjectMask,
  defringeRgba,
  featherAlpha,
  punchInteriorBackgroundHoles,
  refineCutoutAlphaGuided,
  resolveCutoutRegion,
  stampCutoutBrushSegment,
  type CutoutBrushPoint,
  type CutoutBrushStroke,
  type CutoutRegion
} from '@shared/yoloCutout'
import {
  cocoLabelZh,
  type YoloBox,
  type YoloImageInput,
  type YoloLetterboxGeometry
} from '@shared/yolo'
import { yoloSegment } from './api'

/** 推理输入的最长边：兼顾 1024 高精抠图模型与 IPC 传输效率 */
const MAX_INFER_SIDE = 1600
/** 抠图产物目录（落在资产库内，保存后自动登记为资产） */
export const CUTOUT_OUTPUT_DIR = 'Assets/Cutouts'

/** 分析出的一个可保留实例 */
export interface CutoutInstance {
  /** 对应 result.boxes / masks 的下标 */
  index: number
  label: string
  labelZh: string
  confidence: number
  box: YoloBox
}

export interface CutoutAnalysis {
  /** 掩码坐标系尺寸（即推理输入尺寸） */
  srcWidth: number
  srcHeight: number
  /** 原图 / 推理图的分辨率倍率，合成时按原图分辨率输出 */
  outputScale: number
  inferenceMs: number
  instances: CutoutInstance[]
  /** 合成阶段用到的掩码数据 */
  masks: Uint8Array[]
  maskHw: number
  /** mask 是否为 0~255 概率（softMask 请求） */
  soft: boolean
  letterbox?: YoloLetterboxGeometry
  /** 本次使用的本地高精抠图模型 id（未安装时为空，走内置 YOLO + 引导滤波） */
  mattingModelId?: string
}

export interface CutoutSource {
  /** 可直接给 <img> / canvas 使用的地址 */
  url: string
  /** 工程内相对路径；png/jpeg 时交给主进程直接解码，省一次大数组 IPC */
  relativePath?: string
  name?: string
}

const IMAGE_FILE_RE = /\.(png|jpe?g)$/i

export function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous' // studio-media:// 带 ACAO:*，以 CORS 模式加载才可读像素
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('YOLO: failed to load source image'))
    img.src = url
  })
}

/** 把 <img> 画到 canvas 取 RGBA；超过上限时等比缩小以省 IPC */
export function imageToRaw(
  img: HTMLImageElement,
  maxSide: number
): { width: number; height: number; rgba: Uint8Array } {
  const naturalW = img.naturalWidth || img.width
  const naturalH = img.naturalHeight || img.height
  const scale = Math.min(1, maxSide / Math.max(naturalW, naturalH))
  const width = Math.max(1, Math.round(naturalW * scale))
  const height = Math.max(1, Math.round(naturalH * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('YOLO: canvas 2d context unavailable')
  ctx.drawImage(img, 0, 0, width, height)
  return { width, height, rgba: new Uint8Array(ctx.getImageData(0, 0, width, height).data) }
}

/**
 * 跑一次本地高精抠图 / 实例分割，拿到可选实例与掩码。
 * - 若已安装高精抠图模型（RMBG / BiRefNet / MODNet），主进程自动注入并返回高精主体掩码；
 * - 若未安装高精模型且图片为非 COCO 类别（如游戏武器/图标/药水/奇幻立绘）导致检出 0 实例，
 *   自动回退到零样本显著性色彩抠图（buildSalientSubjectMask），彻底杜绝「未检出主体」失败。
 */
export async function analyzeCutout(
  source: CutoutSource,
  confThreshold: number
): Promise<{ analysis: CutoutAnalysis; image: HTMLImageElement }> {
  const image = await loadImageElement(source.url)

  const rel = source.relativePath?.trim() || ''
  let input: YoloImageInput
  let outputScale = 1
  let cachedRaw: { width: number; height: number; rgba: Uint8Array } | null = null
  if (rel && IMAGE_FILE_RE.test(rel)) {
    input = { kind: 'file', path: rel }
  } else {
    cachedRaw = imageToRaw(image, MAX_INFER_SIDE)
    input = { kind: 'raw', width: cachedRaw.width, height: cachedRaw.height, rgba: cachedRaw.rgba }
    const naturalW = image.naturalWidth || image.width || cachedRaw.width
    outputScale = naturalW > 0 ? naturalW / cachedRaw.width : 1
  }

  let boxes: YoloBox[] = []
  let masks: Uint8Array[] = []
  let maskHw = 0
  let srcWidth = image.naturalWidth || image.width || 1
  let srcHeight = image.naturalHeight || image.height || 1
  let inferenceMs = 0
  let letterbox: YoloLetterboxGeometry | undefined
  let mattingModelId: string | undefined

  try {
    const result = await yoloSegment({
      image: input,
      confThreshold,
      softMask: true,
      useMatting: true
    })
    boxes = result.boxes
    masks = result.masks.map((m) => m.data)
    maskHw = result.masks[0]?.width ?? 0
    srcWidth = result.width
    srcHeight = result.height
    inferenceMs = result.inferenceMs
    letterbox = result.letterbox
    mattingModelId = result.mattingModelId
  } catch (err) {
    console.warn('[cutout] yoloSegment failed, falling back to salient subject extraction:', err)
  }

  // 零样本显著性主体兜底：当 COCO 80 类未命中任何实例时，用图像色彩分布+内洞穿透构造主体实例
  if (boxes.length === 0 || masks.length === 0 || maskHw <= 0) {
    const started = performance.now()
    const raw = cachedRaw ?? imageToRaw(image, 1024)
    const naturalW = image.naturalWidth || image.width || raw.width
    srcWidth = raw.width
    srcHeight = raw.height
    outputScale = naturalW > 0 ? naturalW / raw.width : 1
    const salient = buildSalientSubjectMask(raw.rgba, raw.width, raw.height)
    if (salient) {
      boxes = [salient.box]
      masks = [salient.mask]
      maskHw = salient.maskHw
      letterbox = salient.letterbox
      if (!inferenceMs) inferenceMs = Math.max(1, Math.round(performance.now() - started))
    }
  }

  const instances: CutoutInstance[] = boxes.map((box, index) => ({
    index,
    label: box.label,
    labelZh: cocoLabelZh(box.label),
    confidence: box.confidence,
    box
  }))

  return {
    analysis: {
      srcWidth,
      srcHeight,
      outputScale,
      inferenceMs,
      instances,
      masks,
      maskHw,
      soft: true,
      letterbox,
      mattingModelId
    },
    image
  }
}

export interface CutoutRenderParams {
  /** 已加载的源图（原分辨率，用于取色与引导滤波） */
  image: HTMLImageElement
  analysis: CutoutAnalysis
  /** 要保留的实例下标 */
  selected: number[]
  /** 掩码概率阈值 0~1 */
  threshold: number
  /** 边缘羽化半径（输出像素） */
  feather: number
  /** 裁剪到主体外接框；关闭时保持原图构图（背景透明） */
  cropToSubject: boolean
  /** 引导图像滤波边缘精修半径（0~16，默认 4） */
  edgeGuidedRadius?: number
  /** 边缘收缩/扩展（-10~+10，默认 0） */
  edgeChoke?: number
  /** 自动穿透封闭背景内洞（默认 true） */
  holePunch?: boolean
  /** 保留/擦除修补画笔轨迹 */
  brushStrokes?: readonly CutoutBrushStroke[] | null
}

export interface CutoutRenderResult {
  /** 可直接供 <img> 使用的资源 URL（blob，不阻塞主线程编码） */
  url: string
  width: number
  height: number
  /** 结果画布，保存导出时再转 dataUrl（仅一次，可接受） */
  canvas: HTMLCanvasElement
  /** 本次渲染对应的源图坐标系区域（供结果视图画笔反算归一化原图坐标） */
  region: CutoutRegion
}

/**
 * 交互式抠图基础会话缓存：
 * 将耗时的引导滤波、内洞穿透与去污染结果缓存在 baseAlpha / baseDefringedRgba 中，
 * 使橡皮擦 / 恢复画笔在拖动涂抹、撤销、清空时仅需微秒级局部像素更新（无需重复执行全图滤波与 toBlob 编码）。
 */
export interface CutoutInteractiveSession {
  width: number
  height: number
  srcWidth: number
  srcHeight: number
  outScale: number
  region: CutoutRegion
  rawSourceRgba: Uint8ClampedArray
  baseDefringedRgba: Uint8ClampedArray
  baseAlpha: Float32Array
  workingAlpha: Float32Array
  workingImageData: ImageData
}

export function buildCutoutInteractiveSession(
  params: CutoutRenderParams
): CutoutInteractiveSession {
  const { analysis } = params
  const boxes = params.selected
    .map((i) => analysis.instances.find((it) => it.index === i)?.box)
    .filter((b): b is YoloBox => !!b)
  const masks = params.selected
    .map((i) => analysis.masks[analysis.instances.findIndex((it) => it.index === i)])
    .filter((m): m is Uint8Array => !!m)

  const fullRegion: CutoutRegion = {
    x: 0,
    y: 0,
    width: analysis.srcWidth,
    height: analysis.srcHeight
  }
  const hasKeepStrokes = (params.brushStrokes ?? []).some(
    (s) => s.mode === 'keep' && s.points.length > 0
  )
  const region =
    params.cropToSubject && (boxes.length > 0 || hasKeepStrokes)
      ? resolveCutoutRegion({
          boxes,
          srcWidth: analysis.srcWidth,
          srcHeight: analysis.srcHeight,
          feather: Math.max(params.feather, params.edgeGuidedRadius ?? 4),
          margin: 4,
          brushStrokes: params.brushStrokes
        })
      : fullRegion

  const outScale = analysis.outputScale
  const outW = Math.max(1, Math.round(region.width * outScale))
  const outH = Math.max(1, Math.round(region.height * outScale))

  const tmpCanvas = document.createElement('canvas')
  tmpCanvas.width = outW
  tmpCanvas.height = outH
  const ctx = tmpCanvas.getContext('2d')
  if (!ctx) throw new Error('YOLO: canvas 2d context unavailable')
  ctx.drawImage(
    params.image,
    region.x * outScale,
    region.y * outScale,
    region.width * outScale,
    region.height * outScale,
    0,
    0,
    outW,
    outH
  )
  const workingImageData = ctx.getImageData(0, 0, outW, outH)
  const rawSourceRgba = new Uint8ClampedArray(workingImageData.data)

  const guidedRadius = Math.max(0, Math.round(params.edgeGuidedRadius ?? 4))
  const edgeChoke = params.edgeChoke ?? 0

  let baseAlpha = buildCutoutAlpha({
    masks,
    maskHw: analysis.maskHw,
    soft: analysis.soft,
    letterbox: analysis.letterbox,
    srcWidth: analysis.srcWidth,
    srcHeight: analysis.srcHeight,
    region,
    threshold: params.threshold,
    feather: guidedRadius > 0 ? 0 : params.feather,
    outScale,
    continuousAlpha: guidedRadius > 0 || Boolean(analysis.mattingModelId),
    edgeChoke
  })

  if (params.holePunch !== false) {
    baseAlpha = punchInteriorBackgroundHoles(rawSourceRgba, baseAlpha, outW, outH)
  }

  if (guidedRadius > 0 || edgeChoke !== 0) {
    baseAlpha = refineCutoutAlphaGuided(rawSourceRgba, baseAlpha, outW, outH, {
      radius: guidedRadius,
      edgeChoke,
      colorMattingStrength: analysis.mattingModelId ? 0.35 : 0.6
    })
    const postFeather = Math.max(0, Math.round(params.feather ?? 0))
    if (guidedRadius > 0 && postFeather > 0) {
      baseAlpha = featherAlpha(baseAlpha, outW, outH, postFeather)
    }
  }

  const baseDefringedRgba = new Uint8ClampedArray(rawSourceRgba)
  applyAlphaToRgba(baseDefringedRgba, baseAlpha)
  defringeRgba(baseDefringedRgba, baseAlpha, outW, outH)

  const workingAlpha = new Float32Array(baseAlpha)
  workingImageData.data.set(baseDefringedRgba)

  const session: CutoutInteractiveSession = {
    width: outW,
    height: outH,
    srcWidth: analysis.srcWidth,
    srcHeight: analysis.srcHeight,
    outScale,
    region,
    rawSourceRgba,
    baseDefringedRgba,
    baseAlpha,
    workingAlpha,
    workingImageData
  }

  if (params.brushStrokes && params.brushStrokes.length > 0) {
    replayStrokesOnSession(session, params.brushStrokes)
  }

  return session
}

/**
 * 在已缓存的基础抠图会话上重放全部画笔轨迹并可选刷新到目标 Canvas（撤销 / 清空时仅需 ~1ms，无需重跑滤波）。
 */
export function replayStrokesOnSession(
  session: CutoutInteractiveSession,
  strokes: readonly CutoutBrushStroke[] | null | undefined,
  targetCanvas?: HTMLCanvasElement | null
): void {
  session.workingAlpha.set(session.baseAlpha)
  session.workingImageData.data.set(session.baseDefringedRgba)

  if (strokes && strokes.length > 0) {
    for (const stroke of strokes) {
      if (!stroke.points || stroke.points.length === 0) continue
      const segCount = Math.max(1, stroke.points.length - 1)
      for (let s = 0; s < segCount; s++) {
        const p0 = stroke.points[s]!
        const p1 = stroke.points[Math.min(stroke.points.length - 1, s + 1)]!
        stampCutoutBrushSegment({
          workingAlpha: session.workingAlpha,
          workingRgba: session.workingImageData.data,
          rawSourceRgba: session.rawSourceRgba,
          mode: stroke.mode,
          radiusNorm: stroke.radius,
          p0,
          p1,
          srcWidth: session.srcWidth,
          srcHeight: session.srcHeight,
          region: session.region,
          outScale: session.outScale,
          outWidth: session.width,
          outHeight: session.height
        })
      }
    }
  }

  if (targetCanvas) {
    if (targetCanvas.width !== session.width) targetCanvas.width = session.width
    if (targetCanvas.height !== session.height) targetCanvas.height = session.height
    const ctx = targetCanvas.getContext('2d')
    ctx?.putImageData(session.workingImageData, 0, 0)
  }
}

/**
 * 指针拖动过程中增量涂抹单段轨迹 (p0 -> p1)，并仅将脏矩形局部刷新到目标 Canvas（耗时 < 0.1ms，60/120fps 丝滑跟手）。
 */
export function stampSegmentOnSession(
  session: CutoutInteractiveSession,
  mode: 'keep' | 'erase',
  radiusNorm: number,
  p0: CutoutBrushPoint,
  p1: CutoutBrushPoint,
  targetCanvas?: HTMLCanvasElement | null
): void {
  const dirty = stampCutoutBrushSegment({
    workingAlpha: session.workingAlpha,
    workingRgba: session.workingImageData.data,
    rawSourceRgba: session.rawSourceRgba,
    mode,
    radiusNorm,
    p0,
    p1,
    srcWidth: session.srcWidth,
    srcHeight: session.srcHeight,
    region: session.region,
    outScale: session.outScale,
    outWidth: session.width,
    outHeight: session.height
  })
  if (dirty && targetCanvas) {
    const ctx = targetCanvas.getContext('2d')
    ctx?.putImageData(
      session.workingImageData,
      0,
      0,
      dirty.minX,
      dirty.minY,
      dirty.dirtyW,
      dirty.dirtyH
    )
  }
}

/**
 * 按当前参数合成透明 PNG（纯本地，不重新推理）。
 * 异步返回：PNG 编码经 toBlob 交给浏览器后台，避免同步 toDataURL 阻塞 UI。
 */
export async function renderCutoutPng(params: CutoutRenderParams): Promise<CutoutRenderResult> {
  const session = buildCutoutInteractiveSession(params)
  const canvas = document.createElement('canvas')
  canvas.width = session.width
  canvas.height = session.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('YOLO: canvas 2d context unavailable')
  ctx.putImageData(session.workingImageData, 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('YOLO: failed to encode PNG'))),
      'image/png'
    )
  })
  return {
    url: URL.createObjectURL(blob),
    width: session.width,
    height: session.height,
    canvas,
    region: session.region
  }
}

/** 把抠图结果写入资产库目录，返回工程内相对路径 */
export async function saveCutoutAsset(dataUrl: string, name: string): Promise<string> {
  return window.studio.saveGraphRunMedia({
    dataUrl,
    key: name,
    outputDir: CUTOUT_OUTPUT_DIR
  })
}
