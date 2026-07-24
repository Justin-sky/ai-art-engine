import type { AssetType } from './domain'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
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
