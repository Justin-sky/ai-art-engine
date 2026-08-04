import type { AssetType } from '../domain'

export const AIPACKAGE_FORMAT = 'com.aiartengine.asset-package' as const
export const AIPACKAGE_FORMAT_VERSION = 1 as const
export const AIPACKAGE_EXTENSION = 'aipackage'

export type AssetPackageEntryKind = 'asset' | 'folder'
export type AssetPackageEntryRole = 'selected' | 'dependency' | 'structural'

export interface AssetPackageManifestEntry {
  guid: string
  kind: AssetPackageEntryKind
  pathname: string
  role: AssetPackageEntryRole
  payloadSha256: string
  metaSha256: string
  payloadSize: number
}

/** 可选：包内 `generated/` 下的生成缓存文件（非资产库条目） */
export interface AssetPackageGeneratedFileEntry {
  relativePath: string
  sha256: string
  size: number
}

export interface AssetPackageManifest {
  format: typeof AIPACKAGE_FORMAT
  formatVersion: typeof AIPACKAGE_FORMAT_VERSION
  packageId: string
  name: string
  createdAt: string
  createdWith: { app: string; version: string }
  entries: AssetPackageManifestEntry[]
  /** 勾选「包含生成产物」时写入；旧版读取方可忽略 */
  generatedFiles?: AssetPackageGeneratedFileEntry[]
}

export interface AssetPackagePortableAsset {
  type: AssetType
  name: string
  prompt?: string
  notes?: string
  genParams?: Record<string, unknown>
  version: number
  createdAt: string
  updatedAt: string
}

export interface AssetPackageAssetMeta {
  schemaVersion: 1
  guid: string
  kind: 'asset'
  asset: AssetPackagePortableAsset
  folderGuid: string | null
  payload: {
    mode: 'binary' | 'empty'
    extension: string
    size: number
    sha256: string
  }
  dependencies: string[]
  /**
   * 脚本工作流携带的分镜快照（仅 type=script）。
   * 导入时写入 Storyboard/shots，并登记到 project.shotIds / genParams.shotIds。
   */
  shots?: import('../domain').Shot[]
}

export interface AssetPackageFolderMeta {
  schemaVersion: 1
  guid: string
  kind: 'folder'
  folder: {
    name: string
    createdAt: string
    updatedAt: string
  }
  parentGuid: string | null
}

export type AssetPackageMeta = AssetPackageAssetMeta | AssetPackageFolderMeta

export interface ExportAssetPackageInput {
  assetIds?: string[]
  folderIds?: string[]
  /** 默认 true：收集 genParams（及脚本分镜）内资产引用 */
  includeDependencies?: boolean
  /**
   * 默认 false：一并打包所选资产 genParams / 分镜中引用的生成缓存
   *（Cache/*、历史 Output/* 等，非资产库登记文件）
   */
  includeGeneratedOutputs?: boolean
  /** 另存为默认名 */
  defaultName?: string
}

export interface ExportAssetPackageResult {
  path: string | null
  exportedAssets: number
  exportedFolders: number
  /** 打入包的生成产物文件数 */
  exportedGenerated: number
  skipped: { id: string; reason: string }[]
}

export interface ImportAssetPackageInput {
  /** 省略则弹出打开对话框 */
  packPath?: string
  destinationFolderId?: string | null
  /**
   * 仅导入这些 guid（资产/文件夹）。
   * 省略则导入包内全部；会自动补齐所选资产的祖先文件夹。
   */
  selectedGuids?: string[]
  /** 默认 true：把包内声明的依赖一并纳入导入集合 */
  includeDependencies?: boolean
}

export type ImportAssetPackageAction = 'preserve' | 'reuse' | 'remap'

export interface ImportAssetPackageItemReport {
  guid: string
  kind: AssetPackageEntryKind
  action: ImportAssetPackageAction
  newGuid?: string
  pathname: string
}

export interface ImportAssetPackageResult {
  canceled: boolean
  importedAssets: number
  /** 新建或 remap 的文件夹数 */
  importedFolders: number
  /** 因 GUID/内容一致而复用的文件夹数 */
  reusedFolders: number
  reused: number
  remapped: number
  /** 还原到工程的生成产物文件数（已存在则跳过） */
  restoredGenerated: number
  items: ImportAssetPackageItemReport[]
}

/** 导入前预览（不写盘） */
export interface AssetPackagePreviewEntry {
  guid: string
  kind: AssetPackageEntryKind
  pathname: string
  name: string
  parentGuid: string | null
  assetType?: AssetType
  role: AssetPackageEntryRole
  dependencies?: string[]
}

export interface PreviewAssetPackageResult {
  packPath: string
  name: string
  entries: AssetPackagePreviewEntry[]
}

/** 可打包资产类型（媒体 + 文档型工作流） */
export const AIPACKAGE_ASSET_TYPES: ReadonlySet<AssetType> = new Set([
  'image',
  'video',
  'voice',
  'model',
  'script',
  'canvas',
  'world',
  'beat',
  'screenplay',
  'motion'
])

export function isAipackageAssetType(type: AssetType): boolean {
  return AIPACKAGE_ASSET_TYPES.has(type)
}
