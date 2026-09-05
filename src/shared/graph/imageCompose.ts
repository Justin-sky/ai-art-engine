/**
 * 智能构图节点参数：对上游图片自动检测人物主体 →
 * 按目标画幅 + 留白策略求归一化裁剪框 → 裁出 PNG。
 *
 * 几何算法见 `./composition.ts`（composeSubjectCrop，纯函数可单测）。
 * 本文件只管节点参数形态；检测主体由渲染层注入 `composeImageComposeCanvas` 完成。
 */

import {
  COMPOSE_FRAME_PRESETS,
  DEFAULT_COMPOSE_FRAME,
  type ComposeStrategy,
  type ComposeSubjectBox
} from './composition'

export interface ImageComposeState {
  /** 目标画幅 id（COMPOSE_FRAME_PRESETS） */
  aspectId: string
  /** 构图策略：center=主体居中，headroom=头部上方留白 */
  strategy: ComposeStrategy
  /** 人物检测置信度阈值 0~1 */
  confThreshold: number
  /** 上次运行命中并缓存的主体框（原图像素系）；源图尺寸匹配时免重复推理 */
  subjectBox: ComposeSubjectBox | null
  /** subjectBox 所在原图尺寸（缓存校验） */
  detectedWidth: number
  detectedHeight: number
  /** 缓存框对应的检测置信度阈值 */
  detectedConf: number
}

export const DEFAULT_IMAGE_COMPOSE: ImageComposeState = {
  aspectId: DEFAULT_COMPOSE_FRAME,
  strategy: 'headroom',
  confThreshold: 0.5,
  subjectBox: null,
  detectedWidth: 0,
  detectedHeight: 0,
  detectedConf: 0
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function isValidSubjectBox(v: unknown): v is ComposeSubjectBox {
  if (!v || typeof v !== 'object') return false
  const b = v as ComposeSubjectBox
  return (
    Number.isFinite(b.x) &&
    Number.isFinite(b.y) &&
    Number.isFinite(b.width) &&
    Number.isFinite(b.height) &&
    b.width > 0 &&
    b.height > 0
  )
}

export function normalizeImageCompose(
  raw?: Partial<ImageComposeState> | null
): ImageComposeState {
  const base = { ...DEFAULT_IMAGE_COMPOSE, ...(raw ?? {}) }
  const aspectId = String(base.aspectId ?? '').trim()
  const strategy: ComposeStrategy =
    base.strategy === 'center' ? 'center' : 'headroom'
  const detectedWidth = Math.max(0, Math.round(Number(base.detectedWidth) || 0))
  const detectedHeight = Math.max(0, Math.round(Number(base.detectedHeight) || 0))
  return {
    aspectId:
      aspectId && COMPOSE_FRAME_PRESETS.some((f) => f.id === aspectId)
        ? aspectId
        : DEFAULT_IMAGE_COMPOSE.aspectId,
    strategy,
    confThreshold: clamp(Number(base.confThreshold), 0.2, 0.9) || DEFAULT_IMAGE_COMPOSE.confThreshold,
    subjectBox:
      isValidSubjectBox(base.subjectBox) &&
      detectedWidth > 0 &&
      detectedHeight > 0
        ? (base.subjectBox as ComposeSubjectBox)
        : null,
    detectedWidth,
    detectedHeight,
    detectedConf:
      clamp(Number(base.detectedConf), 0.2, 0.9) || DEFAULT_IMAGE_COMPOSE.detectedConf
  }
}

export function readImageComposeFromNode(params: {
  imageCompose?: Partial<ImageComposeState>
}): ImageComposeState {
  return normalizeImageCompose(params.imageCompose)
}

export function imageComposeToNodePatch(state: ImageComposeState): {
  imageCompose: ImageComposeState
} {
  return { imageCompose: normalizeImageCompose(state) }
}
