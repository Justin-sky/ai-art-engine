/**
 * 节点图智能构图合成（渲染层）：检测人物主体 → 画幅/策略 → 裁剪。
 *
 * 与 AssetInspector 的「一键构图」对话框同算法（composeSubjectCrop），
 * 只是主体框不再依赖资产 visionTags：运行未命中缓存时现场做一次
 * YOLO detect，因此上游任意图片（含其它节点产出）都能构图。
 */
import {
  COMPOSE_FRAME_PRESETS,
  composeSubjectCrop,
  normalizeImageCompose,
  type ImageComposeState
} from '@shared/graph'
import { loadImageElement } from '../../yolo/cutout'
import { detectComposeSubject } from '../../yolo/detectComposeSubject'
import { composeImageCropCanvas } from './composeImageCropCanvas'

export async function composeImageComposeCanvas(input: {
  sourceDataUrl: string
  state: ImageComposeState
}): Promise<{
  dataUrl: string
  width: number
  height: number
  state?: Partial<ImageComposeState>
}> {
  const state = normalizeImageCompose(input.state)
  const image = await loadImageElement(input.sourceDataUrl)
  const imageWidth = image.naturalWidth || image.width
  const imageHeight = image.naturalHeight || image.height
  if (imageWidth <= 0 || imageHeight <= 0) {
    throw new Error('COMPOSE_BAD_IMAGE')
  }

  // 源图尺寸与检测阈值一致时复用上次命中的主体框，免重复推理
  let subjectBox = state.subjectBox
  if (
    !subjectBox ||
    state.detectedWidth !== imageWidth ||
    state.detectedHeight !== imageHeight ||
    Math.abs(state.detectedConf - state.confThreshold) > 1e-6
  ) {
    const hit = await detectComposeSubject(image, state.confThreshold)
    if (!hit) {
      throw new Error('COMPOSE_NO_PERSON')
    }
    subjectBox = hit.box
  }

  const frame =
    COMPOSE_FRAME_PRESETS.find((f) => f.id === state.aspectId) ?? COMPOSE_FRAME_PRESETS[0]!
  const geometry = composeSubjectCrop({
    imageWidth,
    imageHeight,
    subject: subjectBox,
    target: frame,
    strategy: state.strategy
  })

  const crop = await composeImageCropCanvas({
    sourceDataUrl: input.sourceDataUrl,
    state: {
      cropX: geometry.crop.cropX,
      cropY: geometry.crop.cropY,
      cropW: geometry.crop.cropW,
      cropH: geometry.crop.cropH,
      aspectId: 'custom'
    }
  })
  return {
    dataUrl: crop.dataUrl,
    width: crop.width,
    height: crop.height,
    state: {
      subjectBox,
      detectedWidth: imageWidth,
      detectedHeight: imageHeight,
      detectedConf: state.confThreshold
    }
  }
}
