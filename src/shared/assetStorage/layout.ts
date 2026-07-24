import { normalizePathSegment } from '../assetPackage/pathname'

/** 每个真实目录内的文件夹元数据文件名 */
export const FOLDER_META_NAME = '.folder.json'

/** 资产旁挂后缀：Hero.png → Hero.png.asset.json */
export const ASSET_META_SUFFIX = '.asset.json'

/** 工程资产布局版本：1=扁平 UUID；2=真实目录树 + 旁挂 meta */
export const PROJECT_ASSET_LAYOUT_VERSION = 2

export function toPosix(p: string): string {
  return p.replace(/\\/g, '/')
}

export function isAssetMetaFileName(name: string): boolean {
  return name.endsWith(ASSET_META_SUFFIX) && name !== FOLDER_META_NAME
}

/** Hero.png.asset.json → Hero.png；Opening.script.asset.json → Opening.script */
export function mediaNameFromMetaFileName(metaFileName: string): string | null {
  if (!isAssetMetaFileName(metaFileName)) return null
  const base = metaFileName.slice(0, -ASSET_META_SUFFIX.length)
  return base || null
}

export function metaFileNameForMedia(mediaFileName: string): string {
  return `${mediaFileName}${ASSET_META_SUFFIX}`
}

export function metaFileNameForDocument(name: string, type: string): string {
  return `${normalizePathSegment(name)}.${type}${ASSET_META_SUFFIX}`
}
