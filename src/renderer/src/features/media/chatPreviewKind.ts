import {
  AUDIO_FILE_EXTENSIONS,
  IMAGE_FILE_EXTENSIONS,
  MODEL_FILE_EXTENSIONS,
  VIDEO_FILE_EXTENSIONS
} from '@shared/mediaFileExtensions'
import { SPLAT_EXTENSIONS } from '../director/splatMesh'

/**
 * 对话产物卡按什么渲染。
 *
 * 泼溅（`.ply` / `.spz`）**必须归 `model`**：`ModelPreview` 已经能把它们交给 Spark
 * 渲染（`loadModelScene` 内部按 `isSplatPath` 分流），但预览类型原先只按
 * `['glb', 'gltf']` 判断 —— 于是泼溅落成 `file`，对话里只显示一行路径文本，
 * 明明能预览却什么都不显示。
 *
 * 扩展名清单统一从 `@shared/mediaFileExtensions` 取（单一来源）。
 */
export type ChatPreviewKind = 'image' | 'video' | 'audio' | 'model' | 'file'

const IMAGE_EXTS = new Set<string>(IMAGE_FILE_EXTENSIONS)
const VIDEO_EXTS = new Set<string>(VIDEO_FILE_EXTENSIONS)
const AUDIO_EXTS = new Set<string>(AUDIO_FILE_EXTENSIONS)
const MODEL_EXTS = new Set<string>(MODEL_FILE_EXTENSIONS)

function extensionOf(relativePath: string): string {
  const name = (relativePath ?? '').split(/[?#]/)[0] ?? ''
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** 是否高斯泼溅产物（`ModelPreview` 会交给 Spark 渲染） */
export function isSplatPreviewPath(relativePath: string): boolean {
  const ext = extensionOf(relativePath)
  return SPLAT_EXTENSIONS.some((splatExt) => splatExt.slice(1) === ext)
}

/** 按文件扩展名推断预览类型；未知类型降级为纯文本路径 */
export function chatPreviewKind(relativePath: string): ChatPreviewKind {
  const ext = extensionOf(relativePath)
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (AUDIO_EXTS.has(ext)) return 'audio'
  if (MODEL_EXTS.has(ext)) return 'model'
  return 'file'
}

/**
 * 产物卡左上角类型徽标用的 **`AssetType`**（交给 `assetTypeLabel()` 转文案）。
 *
 * 3D 要**区分网格与泼溅**：两者登记的都是 `model` 资产，但一个是可进 DCC 的网格，
 * 一个是只在 Spark 里能看的高斯泼溅 —— 用同一个「模型」标签会让人以为拿到的
 * 是能直接用的网格资产。泼溅归到 `asset.type.splat`。
 *
 * 未知类型返回 `null`（卡上不显示徽标，而不是显示一个没意义的词）。
 */
export function chatPreviewAssetType(relativePath: string): string | null {
  const kind = chatPreviewKind(relativePath)
  if (kind === 'file') return null
  if (kind === 'model' && isSplatPreviewPath(relativePath)) return 'splat'
  return kind
}
