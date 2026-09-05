/**
 * 智能构图节点：对已解码的源图现场检测「人物主体」并换算到原图像素系。
 *
 * 无需资产 visionTags：上游任意图（含其它节点产出）都能构图。
 * 只在 raw 解码的缩小图上推理以省 IPC，命中框再按 natural 尺寸还原。
 */
import type { ComposeSubjectBox } from '@shared/graph'
import { yoloSegment } from './api'
import { imageToRaw } from './cutout'

/** 与一键抠图推理一致：模型只吃 640，再大只是浪费 IPC 与解码 */
const MAX_INFER_SIDE = 1600

export interface ComposeSubjectHit {
  /** 原图像素系人物框 */
  box: ComposeSubjectBox
  imageWidth: number
  imageHeight: number
}

/** 检测到的一位人物候选（原图像素系，供工具页多选） */
export interface ComposePersonHit {
  confidence: number
  box: ComposeSubjectBox
}

export interface ComposePersonsHit {
  /** 置信度降序的人物候选 */
  persons: ComposePersonHit[]
  imageWidth: number
  imageHeight: number
}

/** 检测画面中全部人物；未检出返回 null */
export async function detectPersons(
  image: HTMLImageElement,
  confThreshold: number
): Promise<ComposePersonsHit | null> {
  const imageWidth = image.naturalWidth || image.width
  const imageHeight = image.naturalHeight || image.height
  if (imageWidth <= 0 || imageHeight <= 0) return null

  const raw = imageToRaw(image, MAX_INFER_SIDE)
  // 与一键抠图共用实例分割通道（segment 模型已随抠图部署验证）；
  // detect 通道需要额外的普通检测模型，缺失时此任务会直接失败。
  // 只取 boxes 里的 person，掩码不参与构图，softMask=false 省去概率化开销。
  const result = await yoloSegment({
    image: { kind: 'raw', ...raw },
    confThreshold,
    softMask: false
  })
  const sx = imageWidth / raw.width
  const sy = imageHeight / raw.height
  const persons: ComposePersonHit[] = []
  for (const box of result.boxes) {
    if (box.label !== 'person') continue
    persons.push({
      confidence: box.confidence,
      box: {
        x: box.x * sx,
        y: box.y * sy,
        width: box.width * sx,
        height: box.height * sy
      }
    })
  }
  if (!persons.length) return null
  persons.sort((a, b) => b.confidence - a.confidence)
  return { persons, imageWidth, imageHeight }
}

/** 检测置信度最高的 person；未检出返回 null */
export async function detectComposeSubject(
  image: HTMLImageElement,
  confThreshold: number
): Promise<ComposeSubjectHit | null> {
  const hit = await detectPersons(image, confThreshold)
  if (!hit) return null
  const top = hit.persons[0]!
  return {
    box: top.box,
    imageWidth: hit.imageWidth,
    imageHeight: hit.imageHeight
  }
}
