/**
 * 渲染层一键抠图：本地 YOLO 实例分割 → 透明通道 PNG 资产。
 *
 * 几何换算与软边合成在 @shared/yoloCutout（纯函数，可单测），
 * 本文件只负责：源图解码、推理输入选择、结果合成与落盘。
 */
import {
  applyAlphaToRgba,
  buildCutoutAlpha,
  defringeRgba,
  resolveCutoutRegion,
  type CutoutRegion
} from '@shared/yoloCutout'
import {
  cocoLabelZh,
  type YoloBox,
  type YoloImageInput,
  type YoloLetterboxGeometry
} from '@shared/yolo'
import { yoloSegment } from './api'

/** 推理输入的最长边：模型本身只吃 640，再大只是浪费 IPC 与解码 */
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
function imageToRaw(
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
 * 跑一次本地实例分割，拿到可选实例与掩码。
 * png/jpeg 走 file 输入（主进程解码，掩码即原图分辨率）；
 * webp 等解码器不支持的格式由渲染层 canvas 解码成 raw 传入，
 * 此时掩码坐标系是缩小图，合成时按 outputScale 还原到原图分辨率。
 */
export async function analyzeCutout(
  source: CutoutSource,
  confThreshold: number
): Promise<{ analysis: CutoutAnalysis; image: HTMLImageElement }> {
  const image = await loadImageElement(source.url)

  const rel = source.relativePath?.trim() || ''
  let input: YoloImageInput
  let outputScale = 1
  if (rel && IMAGE_FILE_RE.test(rel)) {
    input = { kind: 'file', path: rel }
  } else {
    const raw = imageToRaw(image, MAX_INFER_SIDE)
    input = { kind: 'raw', width: raw.width, height: raw.height, rgba: raw.rgba }
    const naturalW = image.naturalWidth || image.width || raw.width
    outputScale = naturalW > 0 ? naturalW / raw.width : 1
  }

  const result = await yoloSegment({ image: input, confThreshold, softMask: true })
  const maskHw = result.masks[0]?.width ?? 0
  const instances: CutoutInstance[] = result.boxes.map((box, index) => ({
    index,
    label: box.label,
    labelZh: cocoLabelZh(box.label),
    confidence: box.confidence,
    box
  }))

  return {
    analysis: {
      srcWidth: result.width,
      srcHeight: result.height,
      outputScale,
      inferenceMs: result.inferenceMs,
      instances,
      masks: result.masks.map((m) => m.data),
      maskHw,
      soft: true,
      letterbox: result.letterbox
    },
    image
  }
}

export interface CutoutRenderParams {
  /** 已加载的源图（原分辨率，用于取色） */
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
}

export interface CutoutRenderResult {
  /** 可直接供 <img> 使用的资源 URL（blob，不阻塞主线程编码） */
  url: string
  width: number
  height: number
  /** 结果画布，保存导出时再转 dataUrl（仅一次，可接受） */
  canvas: HTMLCanvasElement
}

/**
 * 按当前参数合成透明 PNG（纯本地，不重新推理）。
 * 异步返回：PNG 编码经 toBlob 交给浏览器后台，避免同步 toDataURL 阻塞 UI。
 */
export async function renderCutoutPng(params: CutoutRenderParams): Promise<CutoutRenderResult> {
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
  const region =
    params.cropToSubject && boxes.length > 0
      ? resolveCutoutRegion({
          boxes,
          srcWidth: analysis.srcWidth,
          srcHeight: analysis.srcHeight,
          feather: params.feather,
          margin: 2
        })
      : fullRegion

  const outScale = analysis.outputScale
  const alpha = buildCutoutAlpha({
    masks,
    maskHw: analysis.maskHw,
    soft: analysis.soft,
    letterbox: analysis.letterbox,
    srcWidth: analysis.srcWidth,
    srcHeight: analysis.srcHeight,
    region,
    threshold: params.threshold,
    feather: params.feather,
    outScale
  })

  const outW = Math.max(1, Math.round(region.width * outScale))
  const outH = Math.max(1, Math.round(region.height * outScale))
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
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
  const imageData = ctx.getImageData(0, 0, outW, outH)
  applyAlphaToRgba(imageData.data, alpha)
  // 去除半透明边缘的背景色污染，消除发丝 / 轮廓四周的光晕
  defringeRgba(imageData.data, alpha, outW, outH)
  ctx.putImageData(imageData, 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('YOLO: failed to encode PNG'))),
      'image/png'
    )
  })
  return { url: URL.createObjectURL(blob), width: outW, height: outH, canvas }
}

/** 把抠图结果写入资产库目录，返回工程内相对路径 */
export async function saveCutoutAsset(dataUrl: string, name: string): Promise<string> {
  return window.studio.saveGraphRunMedia({
    dataUrl,
    key: name,
    outputDir: CUTOUT_OUTPUT_DIR
  })
}
