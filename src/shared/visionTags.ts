/**
 * 素材视觉打标 — 资产旁挂 meta（写入 `.asset.json` 的 `visionTags` 字段）。
 *
 * 由主进程 `assetVisionTagger` 在资产入库 / 打开工程补漏时对图片与视频首帧
 * 跑本地 YOLO 检测生成；素材卡读取 `summary` 展示对象标签，
 * 「资产语义检索（P1）」可消费 `summary.label / labelZh` 作为本地标签数据源。
 *
 * 坐标一律为原图像素系（与 YoloBox 一致），配合 imageWidth / imageHeight
 * 可换算归一化主体位置，供后续智能构图 / 安全区等消费。
 */
import type { YoloBox } from './yolo'

/** 单个检测框（继承 YoloBox：label / confidence / x / y / width / height） */
export interface VisionDetectedObject extends YoloBox {
  /** COCO 英文标签，如 person */
  label: string
  /** 中文展示名，如 人物 */
  labelZh: string
}

/** 按标签聚合的摘要（素材卡 chip 与检索用） */
export interface VisionObjectTag {
  /** COCO 英文标签，如 person */
  label: string
  /** 中文展示名，如 人物 */
  labelZh: string
  /** 该标签检出的框数量 */
  count: number
  /** 该标签内最高置信度（0~1） */
  maxConfidence: number
}

/** ok=已成功检测；skipped=暂未检测（模型不可用 / 视频抽帧失败等，打开工程时会再尝试） */
export type VisionTagStatus = 'ok' | 'skipped'

/** skipped 后距下次自动重试的最小间隔（防批量永久失败逐次 open 全量空转） */
export const VISION_TAG_RETRY_INTERVAL_MS = 15 * 60 * 1000

/**
 * 「疑似 / 弱」标签置信度上限（不含）。
 * COCO 80 类没有蝴蝶、蜻蜓等细分类，模型会把它们强行归到最近语义类
 * （实测蝴蝶视频被判为 bird，置信度约 41%~64%），此时应弱化展示而非当成可靠结论。
 */
export const VISION_TAG_WEAK_CONF_MAX = 0.6

/** 置信度是否视为「疑似 / 弱」（素材卡 chip 与 Inspector 据此弱化展示） */
export function isWeakVisionTag(confidence: number): boolean {
  return (
    typeof confidence === 'number' &&
    Number.isFinite(confidence) &&
    confidence < VISION_TAG_WEAK_CONF_MAX
  )
}

export interface VisionAssetTags {
  /** meta 结构版本（当前 1） */
  v: 1
  status: VisionTagStatus
  /** skipped 时的原因说明 */
  error?: string
  /** 产出该标签的模型 id（如 yolo11n） */
  modelId?: string
  runAt: string
  /** 被检测图像宽（像素）；视频为首帧宽 */
  imageWidth?: number
  imageHeight?: number
  /** 按标签聚合摘要（无对象时为空数组） */
  summary: VisionObjectTag[]
  /** 全部检测框（置信度降序，最多 VISION_OBJECTS_CAP 个），供主体位置消费 */
  objects: VisionDetectedObject[]
}

/** objects 最多保留的框数（防超大场景 meta 膨胀） */
export const VISION_OBJECTS_CAP = 40
