/**
 * 智能构图节点：对已解码的源图现场检测「人物主体」并换算到原图像素系。
 *
 * 无需资产 visionTags：上游任意图（含其它节点产出）都能构图。
 * 只在 raw 解码的缩小图上推理以省 IPC，命中框再按 natural 尺寸还原。
 */
import type { ComposeSubjectBox } from '@shared/graph'
import type { YoloBox } from '@shared/yolo'
import { yoloDetect } from './api'
import { imageToRaw } from './cutout'

/** 与一键抠图推理一致：模型只吃 640，再大只是浪费 IPC 与解码 */
const MAX_INFER_SIDE = 1600

export interface ComposeSubjectHit {
  /** 原图像素系人物框 */
  box: ComposeSubjectBox
  imageWidth: number
  imageHeight: number
}

/** 检测置信度最高的 person；未检出返回 null */
export async function detectComposeSubject(
  image: HTMLImageElement,
  confThreshold: number
): Promise<ComposeSubjectHit | null> {
  const imageWidth = image.naturalWidth || image.width
  const imageHeight = image.naturalHeight || image.height
  if (imageWidth <= 0 || imageHeight <= 0) return null

  const raw = imageToRaw(image, MAX_INFER_SIDE)
  const result = await yoloDetect({
    image: { kind: 'raw', ...raw },
    confThreshold
  })
  let best: YoloBox | null = null
  for (const box of result.boxes) {
    if (box.label !== 'person') continue
    if (!best || box.confidence > best.confidence) best = box
  }
  if (!best) return null

  const sx = imageWidth / raw.width
  const sy = imageHeight / raw.height
  return {
    box: {
      x: best.x * sx,
      y: best.y * sy,
      width: best.width * sx,
      height: best.height * sy
    },
    imageWidth,
    imageHeight
  }
}
