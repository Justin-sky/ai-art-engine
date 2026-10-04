/**
 * 渲染层 YOLO 本地视觉 API 封装（薄壳，直接透传 window.studio）。
 * 后续功能（素材打标 / 智能构图 / 抠图 / 动捕）统一从这里取能力。
 */
import type {
  YoloDetectResult,
  YoloFaceResult,
  YoloImageInput,
  YoloInferenceInput,
  YoloPoseResult,
  YoloSegmentResult,
  YoloStatus
} from '@shared/yolo'

export function getYoloStatus(): Promise<YoloStatus> {
  return window.studio.getYoloStatus()
}

export function yoloDetect(input: YoloInferenceInput): Promise<YoloDetectResult> {
  return window.studio.yoloDetect(input)
}

export function yoloSegment(input: YoloInferenceInput): Promise<YoloSegmentResult> {
  return window.studio.yoloSegment(input)
}

export function yoloPose(input: YoloInferenceInput): Promise<YoloPoseResult> {
  return window.studio.yoloPose(input)
}

/**
 * 人脸关键点（两段式：BlazeFace 检测器 + FaceMesh 468 点）。
 * 两个模型缺一即 reject —— 调用方按「可选能力」处理（如人像烘焙退化为空脸）。
 */
export function yoloFace(input: YoloInferenceInput): Promise<YoloFaceResult> {
  return window.studio.yoloFace(input)
}

export function openYoloModelDir(): Promise<string | null> {
  return window.studio.openYoloModelDir()
}

/**
 * dataUrl → raw RGBA 输入（canvas 解码，webp 等解码器不支持的格式走这条路）。
 * 图片尺寸过大时建议先缩小（如 1280 内）再传，减少 IPC 与推理开销。
 */
export async function dataUrlToRawInput(
  dataUrl: string,
  maxSide = 1600
): Promise<Extract<YoloImageInput, { kind: 'raw' }>> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    // studio-media:// 带 ACAO:*，以 CORS 模式加载才可读像素（否则 canvas 被标记跨源污染，
    // getImageData 抛 SecurityError，姿态 / 蒙版类本地视觉能力会静默失效）
    el.crossOrigin = 'anonymous'
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('YOLO: failed to decode image'))
    el.src = dataUrl
  })
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
  const width = Math.max(1, Math.round(img.naturalWidth * scale))
  const height = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('YOLO: canvas 2d context unavailable')
  ctx.drawImage(img, 0, 0, width, height)
  const { data } = ctx.getImageData(0, 0, width, height)
  return { kind: 'raw', width, height, rgba: new Uint8Array(data) }
}
