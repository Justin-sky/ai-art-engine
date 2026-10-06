import { SPLAT_EXTENSIONS } from '../director/splatMesh'

/**
 * 对话产物卡按什么渲染。
 *
 * 泼溅（`.ply` / `.spz`）**必须归 `model`**：`ModelPreview` 已经能把它们交给 Spark
 * 渲染（`loadModelScene` 内部按 `isSplatPath` 分流），但预览类型原先只按
 * `['glb', 'gltf']` 判断 —— 于是泼溅落成 `file`，对话里只显示一行路径文本，
 * 明明能预览却什么都不显示。
 */
export type ChatPreviewKind = 'image' | 'video' | 'audio' | 'model' | 'file'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'mkv', 'm4v'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'])
/** 泼溅扩展名从 `splatMesh` 取，避免两处各写一份而漂移 */
const MODEL_EXTS = new Set(['glb', 'gltf', 'fbx', ...SPLAT_EXTENSIONS.map((ext) => ext.slice(1))])

export function isSplatPreviewPath(relativePath: string): boolean {
  const ext = extensionOf(relativePath)
  return SPLAT_EXTENSIONS.some((splatExt) => splatExt.slice(1) === ext)
}

function extensionOf(relativePath: string): string {
  const name = (relativePath ?? '').split(/[?#]/)[0] ?? ''
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
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
