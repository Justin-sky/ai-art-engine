import type { AssetType } from './domain'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.psd', '.svg'])
/** 动画图片：预览必须读原文件，静态缩略图只剩首帧 */
const ANIMATED_IMAGE_EXT = new Set(['.gif'])
/**
 * 分层源文件图片格式（Photoshop PSD 等）。
 *
 * 这类文件仍归 image 家族——它们本质是图片资产，需要被素材库收录、检索、备份与
 * 引用；但内容是「未合成的图层文档」而非现成位图，Chromium 与 nativeImage 都直接
 * 读不出画面：预览必须先在主进程经 ag-psd 合成解码成 PNG（psdCompositeService）。
 *
 * 因此凡「把文件本身当图片用」的链路都要拦下：不能作 `<img src>` / 模型输入的像素来源，
 * 也不能按扩展名送进内置解码器（.psd 不是 png/jpg）；需要编辑图层时交系统默认程序打开。
 */
const LAYERED_SOURCE_IMAGE_EXT = new Set(['.psd'])
/**
 * 矢量图片格式（SVG）。
 *
 * 仍归 image 家族，但两个解码器各缺一半：Chromium 能直接把它当 `<img>` 渲染，
 * 而 Electron `nativeImage` 解不出它。因此凡「主进程先栅格化成位图」的链路
 * （缩略图、系统缩略图、视觉打标）都要让开，预览一律读原文件与
 * `isAnimatedImageFilePath`（GIF）同一口径——差别只在 GIF 退化的原因是丢掉动画，
 * SVG 退化的原因是根本没解出画面。
 */
const VECTOR_IMAGE_EXT = new Set(['.svg'])
const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm'])
const AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.m4a'])
const MODEL_EXT = new Set(['.glb', '.gltf', '.fbx'])
/** 剧本文本文件：导入为 screenplay 引用资产 */
const TEXT_EXT = new Set(['.txt', '.md'])

/** Extensions allowed via system drop or Import dialog (no leading dot) */
export const IMPORTABLE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'psd',
  'svg',
  'mp4',
  'mov',
  'webm',
  'mp3',
  'wav',
  'ogg',
  'm4a',
  'glb',
  'gltf',
  'fbx',
  'txt',
  'md'
] as const

export const IMPORTABLE_EXTENSION_LABEL =
  'Images · Videos · Audio · Models · Screenplays'

function fileExt(filePath: string): string {
  return filePath.includes('.') ? `.${filePath.split('.').pop()!.toLowerCase()}` : ''
}

export function isImageFilePath(filePath: string): boolean {
  return IMAGE_EXT.has(fileExt(filePath))
}

/**
 * 是否为分层源文件图片（PSD 等）。
 * 判 true 的路径不得直接进 `<img>` / 内置解码器 / 模型输入；预览需先经合成解码。
 */
export function isLayeredSourceImageFilePath(filePath: string): boolean {
  return LAYERED_SOURCE_IMAGE_EXT.has(fileExt(filePath))
}

/** 是否为动画图片（GIF）：预览必须走原文件，缩略图只保留首帧 */
export function isAnimatedImageFilePath(filePath: string): boolean {
  return ANIMATED_IMAGE_EXT.has(fileExt(filePath))
}

/**
 * 是否为矢量图片（SVG）。
 * 判 true 的路径不得进 nativeImage / 缩略图链路（解不出画面），
 * 预览与展示一律用原文件。
 */
export function isVectorImageFilePath(filePath: string): boolean {
  return VECTOR_IMAGE_EXT.has(fileExt(filePath))
}

export function isVideoFilePath(filePath: string): boolean {
  return VIDEO_EXT.has(fileExt(filePath))
}

export function isAudioFilePath(filePath: string): boolean {
  return AUDIO_EXT.has(fileExt(filePath))
}

export function isModelFilePath(filePath: string): boolean {
  return MODEL_EXT.has(fileExt(filePath))
}

export function isTextFilePath(filePath: string): boolean {
  return TEXT_EXT.has(fileExt(filePath))
}

export function detectImportAssetType(filePath: string): AssetType {
  const ext = filePath.includes('.')
    ? `.${filePath.split('.').pop()!.toLowerCase()}`
    : ''
  if (IMAGE_EXT.has(ext)) return 'image'
  if (VIDEO_EXT.has(ext)) return 'video'
  if (AUDIO_EXT.has(ext)) return 'voice'
  if (MODEL_EXT.has(ext)) return 'model'
  if (TEXT_EXT.has(ext)) return 'screenplay'
  throw new Error(`Unsupported file type: ${ext || '(no extension)'}`)
}

export function isImportablePath(filePath: string): boolean {
  try {
    detectImportAssetType(filePath)
    return true
  } catch {
    return false
  }
}

export function importFileFilter(): { name: string; extensions: string[] }[] {
  return [
    {
      name: 'Importable media',
      extensions: [...IMPORTABLE_EXTENSIONS]
    }
  ]
}

export function isAttachCompatible(
  assetType: AssetType,
  detectedType: AssetType,
  _filePath: string
): boolean {
  return (
    detectedType === assetType ||
    (assetType === 'voice' && detectedType === 'voice') ||
    (assetType === 'motion' &&
      (detectedType === 'video' ||
        detectedType === 'model' ||
        detectedType === 'image'))
  )
}
