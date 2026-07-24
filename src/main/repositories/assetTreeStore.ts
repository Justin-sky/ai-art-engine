import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  copyFileSync
} from 'fs'
import { randomUUID } from 'crypto'
import { dirname, extname, join, relative, resolve } from 'path'
import type { AssetFolder, AssetInfo } from '@shared/domain'
import { normalizeAssetType } from '@shared/domain'
import { normalizeFolders } from '@shared/folderTree'
import { normalizePathSegment } from '@shared/assetPackage/pathname'
import { readJsonFile, writeJsonAtomic } from './jsonFile'
import {
  ASSET_META_SUFFIX,
  FOLDER_META_NAME,
  isAssetMetaFileName,
  mediaNameFromMetaFileName,
  metaFileNameForDocument,
  metaFileNameForMedia,
  toPosix
} from '@shared/assetStorage/layout'
import {
  isRealThumbnailPath,
  thumbRelativePathFor
} from '@shared/media/thumbnailPath'

export interface AssetTreeScan {
  assets: AssetInfo[]
  folders: AssetFolder[]
  /** assetId → meta file absolute path */
  metaAbsByAssetId: Map<string, string>
  /** folderId → directory absolute path */
  dirAbsByFolderId: Map<string, string>
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true })
}

function normalizeAsset(asset: AssetInfo): AssetInfo {
  const type = normalizeAssetType(asset.type as string)
  return type === asset.type ? asset : { ...asset, type }
}

/**
 * 递归扫描 Assets/ 真实目录树。
 * 子目录应有 .folder.json；缺失或损坏时自动修复（写入/重建元数据）。
 */
export function scanAssetTree(root: string): AssetTreeScan {
  const assetsRoot = join(root, 'Assets')
  const assets: AssetInfo[] = []
  const folders: AssetFolder[] = []
  const metaAbsByAssetId = new Map<string, string>()
  const dirAbsByFolderId = new Map<string, string>()

  if (!existsSync(assetsRoot)) {
    return { assets, folders, metaAbsByAssetId, dirAbsByFolderId }
  }

  const walk = (dirAbs: string, folderId: string | null): void => {
    let entries: string[]
    try {
      entries = readdirSync(dirAbs)
    } catch {
      return
    }

    for (const name of entries) {
      if (name === FOLDER_META_NAME || name.startsWith('.')) continue
      const abs = join(dirAbs, name)
      let st
      try {
        st = statSync(abs)
      } catch {
        continue
      }

      if (st.isDirectory()) {
        try {
          const folder = ensureDirFolderMeta(abs, name, folderId)
          folder.parentId = folderId
          folders.push(folder)
          dirAbsByFolderId.set(folder.id, abs)
          walk(abs, folder.id)
        } catch {
          /* skip unwritable / broken dir */
        }
        continue
      }

      if (!st.isFile() || !isAssetMetaFileName(name)) continue
      try {
        const asset = normalizeAsset(readJsonFile<AssetInfo>(abs))
        asset.folderId = folderId
        const mediaLeaf = mediaNameFromMetaFileName(name)
        let mediaAbs: string | null = null
        if (mediaLeaf && existsSync(join(dirAbs, mediaLeaf))) {
          mediaAbs = join(dirAbs, mediaLeaf)
        } else if (asset.relativePath) {
          const claimed = join(root, asset.relativePath)
          if (existsSync(claimed)) mediaAbs = claimed
        }
        if (mediaAbs) {
          const rel = toPosix(relative(root, mediaAbs))
          asset.relativePath = rel
          if (asset.type === 'image' || asset.type === 'video') {
            // 保留已写入的真缩略图；遗留「thumb===原图」统一改成约定路径
            if (!isRealThumbnailPath(asset.thumbnailPath, rel)) {
              asset.thumbnailPath = thumbRelativePathFor(rel)
            }
          }
        } else {
          asset.relativePath = ''
        }
        assets.push(asset)
        metaAbsByAssetId.set(asset.id, abs)
      } catch {
        /* skip */
      }
    }
  }

  walk(assetsRoot, null)

  return {
    assets: assets.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    folders: normalizeFolders(folders),
    metaAbsByAssetId,
    dirAbsByFolderId
  }
}

export function resolveFolderDirAbs(
  root: string,
  folderId: string | null,
  scan?: AssetTreeScan
): string {
  if (!folderId) return join(root, 'Assets')
  const cached = scan?.dirAbsByFolderId.get(folderId)
  if (cached) return cached
  const fresh = scanAssetTree(root)
  const hit = fresh.dirAbsByFolderId.get(folderId)
  if (!hit) throw new Error('目录不存在')
  return hit
}

export function writeFolderMeta(dirAbs: string, folder: AssetFolder): void {
  ensureDir(dirAbs)
  writeJsonAtomic(join(dirAbs, FOLDER_META_NAME), folder)
}

/**
 * 读取或重建目录的 `.folder.json`（缺失 / 损坏 / parentId·name 不一致时写入）。
 */
export function ensureDirFolderMeta(
  dirAbs: string,
  name: string,
  parentId: string | null
): AssetFolder {
  ensureDir(dirAbs)
  const metaPath = join(dirAbs, FOLDER_META_NAME)
  if (existsSync(metaPath)) {
    try {
      const folder = readJsonFile<AssetFolder>(metaPath)
      if (typeof folder.id === 'string' && folder.id) {
        const needsWrite =
          (folder.parentId ?? null) !== parentId ||
          folder.name !== name ||
          typeof folder.createdAt !== 'string' ||
          typeof folder.updatedAt !== 'string'
        if (!needsWrite) return folder
        const next: AssetFolder = {
          id: folder.id,
          name,
          parentId,
          createdAt: typeof folder.createdAt === 'string' ? folder.createdAt : new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
        writeFolderMeta(dirAbs, next)
        return next
      }
    } catch {
      /* 损坏则重建 */
    }
  }
  const ts = new Date().toISOString()
  const folder: AssetFolder = {
    id: randomUUID(),
    name,
    parentId,
    createdAt: ts,
    updatedAt: ts
  }
  writeFolderMeta(dirAbs, folder)
  return folder
}

/**
 * 确保工程相对路径 `Assets/...` 上每一级目录都有 `.folder.json`。
 * 生成落盘等只 mkdir 的场景调用，使资产窗口能立刻扫到这些目录。
 * 非 Assets 前缀路径忽略（资产窗口只展示 Assets/）。
 */
export function ensureAssetRelativeFolderChain(root: string, relativeDir: string): void {
  const posix = toPosix(relativeDir)
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '')
    .trim()
  if (!posix.startsWith('Assets/') && posix !== 'Assets') return

  const segments =
    posix === 'Assets' ? [] : posix.slice('Assets/'.length).split('/').filter(Boolean)
  let parentId: string | null = null
  let abs = join(root, 'Assets')
  ensureDir(abs)

  for (const segment of segments) {
    abs = join(abs, segment)
    const folder = ensureDirFolderMeta(abs, segment, parentId)
    parentId = folder.id
  }
}

/**
 * 修复 `Assets/`（或子路径）下所有真实目录的 `.folder.json`。
 * 供重新导入等显式修复入口调用。
 */
export function repairAssetFolderMetas(root: string, relativeDir = 'Assets'): AssetFolder[] {
  const posix = toPosix(relativeDir)
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '')
    .trim()
  if (!posix.startsWith('Assets/') && posix !== 'Assets') return []

  const startAbs = join(root, ...posix.split('/'))
  if (!existsSync(startAbs)) return []

  const folders: AssetFolder[] = []

  let startParentId: string | null = null
  if (posix !== 'Assets') {
    const parentRel = posix.includes('/') ? posix.slice(0, posix.lastIndexOf('/')) : 'Assets'
    ensureAssetRelativeFolderChain(root, parentRel)
    if (parentRel !== 'Assets') {
      try {
        startParentId = readJsonFile<AssetFolder>(join(root, parentRel, FOLDER_META_NAME)).id
      } catch {
        startParentId = null
      }
    }
    const startName = posix.slice(posix.lastIndexOf('/') + 1)
    const self = ensureDirFolderMeta(startAbs, startName, startParentId)
    folders.push(self)
    startParentId = self.id
  }

  const walk = (dirAbs: string, folderId: string | null): void => {
    let entries: string[]
    try {
      entries = readdirSync(dirAbs)
    } catch {
      return
    }
    for (const name of entries) {
      if (name === FOLDER_META_NAME || name.startsWith('.')) continue
      const abs = join(dirAbs, name)
      let st
      try {
        st = statSync(abs)
      } catch {
        continue
      }
      if (!st.isDirectory()) continue
      try {
        const folder = ensureDirFolderMeta(abs, name, folderId)
        folders.push(folder)
        walk(abs, folder.id)
      } catch {
        /* skip unwritable */
      }
    }
  }

  walk(startAbs, posix === 'Assets' ? null : startParentId)
  return normalizeFolders(folders)
}

export function readFolderMeta(dirAbs: string): AssetFolder {
  return readJsonFile<AssetFolder>(join(dirAbs, FOLDER_META_NAME))
}

export function uniqueFileName(dirAbs: string, desiredName: string): string {
  const safe = normalizePathSegment(desiredName)
  if (!existsSync(join(dirAbs, safe))) return safe
  if (safe.endsWith(ASSET_META_SUFFIX)) {
    const without = safe.slice(0, -ASSET_META_SUFFIX.length)
    let i = 2
    while (existsSync(join(dirAbs, `${without} ${i}${ASSET_META_SUFFIX}`))) i += 1
    return `${without} ${i}${ASSET_META_SUFFIX}`
  }
  const dot = safe.lastIndexOf('.')
  const stem = dot > 0 ? safe.slice(0, dot) : safe
  const ext = dot > 0 ? safe.slice(dot) : ''
  let i = 2
  while (existsSync(join(dirAbs, `${stem} ${i}${ext}`))) i += 1
  return `${stem} ${i}${ext}`
}

export function writeAssetToTree(
  root: string,
  asset: AssetInfo,
  options?: { mediaAbs?: string | null; scan?: AssetTreeScan }
): void {
  let metaAbs: string
  if (asset.relativePath) {
    // 媒体旁挂：路径由 relativePath 决定，不依赖 folderId（避免目录 id 暂不一致时写元数据失败）
    const mediaAbs = options?.mediaAbs?.trim()
      ? options.mediaAbs
      : join(root, asset.relativePath)
    const mediaName = mediaAbs.split(/[/\\]/).pop()!
    metaAbs = join(dirname(mediaAbs), metaFileNameForMedia(mediaName))
    ensureDir(dirname(metaAbs))
  } else {
    const dirAbs = resolveFolderDirAbs(root, asset.folderId ?? null, options?.scan)
    ensureDir(dirAbs)
    const leaf = metaFileNameForDocument(asset.name, asset.type)
    metaAbs = join(dirAbs, leaf)
  }

  // Remove previous meta if relocated
  const prev = options?.scan?.metaAbsByAssetId.get(asset.id)
  if (prev && prev !== metaAbs && existsSync(prev)) {
    try {
      rmSync(prev)
    } catch {
      /* ignore */
    }
  }

  const toWrite: AssetInfo = {
    ...asset,
    folderId: asset.folderId ?? null
  }
  writeJsonAtomic(metaAbs, toWrite)
}

export function removeAssetFromTree(root: string, assetId: string, scan?: AssetTreeScan): void {
  const tree = scan ?? scanAssetTree(root)
  const metaAbs = tree.metaAbsByAssetId.get(assetId)
  const asset = tree.assets.find((a) => a.id === assetId)
  if (asset?.relativePath) {
    const media = join(root, asset.relativePath)
    if (existsSync(media)) rmSync(media)
    // 清理旁挂缩略图
    const thumbRel = isRealThumbnailPath(asset.thumbnailPath, asset.relativePath)
      ? asset.thumbnailPath!.replace(/\\/g, '/')
      : thumbRelativePathFor(asset.relativePath)
    const thumbAbs = join(root, thumbRel)
    if (existsSync(thumbAbs)) {
      try {
        rmSync(thumbAbs)
      } catch {
        /* ignore */
      }
    }
  }
  if (metaAbs && existsSync(metaAbs)) rmSync(metaAbs)
}

function relocateFile(src: string, dest: string): void {
  if (src === dest) return
  ensureDir(dirname(dest))
  if (existsSync(dest)) {
    try {
      rmSync(dest)
    } catch {
      /* overwrite via copy below */
    }
  }
  try {
    renameSync(src, dest)
  } catch {
    copyFileSync(src, dest)
    try {
      rmSync(src)
    } catch {
      /* source may stay locked on Windows; dest is authoritative */
    }
  }
}

export function moveAssetBetweenFolders(
  root: string,
  asset: AssetInfo,
  newFolderId: string | null,
  scan?: AssetTreeScan
): AssetInfo {
  const tree = scan ?? scanAssetTree(root)
  const destDir = resolveFolderDirAbs(root, newFolderId, tree)
  ensureDir(destDir)

  let metaAbs = tree.metaAbsByAssetId.get(asset.id) ?? null
  if (!metaAbs && asset.relativePath) {
    const companion = join(root, `${asset.relativePath}${ASSET_META_SUFFIX}`)
    if (existsSync(companion)) metaAbs = companion
  }
  if (!metaAbs || !existsSync(metaAbs)) {
    throw new Error(`资产元数据不存在: ${asset.name || asset.id}`)
  }

  const next: AssetInfo = {
    ...asset,
    folderId: newFolderId,
    updatedAt: new Date().toISOString()
  }

  if (asset.relativePath) {
    const srcMedia = join(root, asset.relativePath)
    const ext = extname(asset.relativePath) || (srcMedia.includes('.') ? extname(srcMedia) : '')
    const baseName = normalizePathSegment(asset.name.replace(new RegExp(`${ext.replace('.', '\\.')}$`, 'i'), '') || asset.name)
    const desired = `${baseName}${ext}`
    // Avoid renaming into a name that only conflicts with the file we are moving out of another folder
    let fileName = desired
    const candidate = join(destDir, fileName)
    if (existsSync(candidate) && resolve(candidate) !== resolve(srcMedia)) {
      fileName = uniqueFileName(destDir, desired)
    }
    const destMedia = join(destDir, fileName)
    if (existsSync(srcMedia)) {
      relocateFile(srcMedia, destMedia)
    } else if (!existsSync(destMedia)) {
      throw new Error(`媒体文件缺失: ${asset.relativePath}`)
    }
    next.relativePath = toPosix(relative(root, destMedia))
    if (next.type === 'image' || next.type === 'video') {
      next.thumbnailPath = thumbRelativePathFor(next.relativePath)
    }

    const destMeta = join(destDir, metaFileNameForMedia(fileName))
    if (resolve(metaAbs) !== resolve(destMeta)) {
      if (existsSync(destMeta)) rmSync(destMeta)
      relocateFile(metaAbs, destMeta)
    }
    writeJsonAtomic(destMeta, next)
  } else {
    const leaf = metaFileNameForDocument(asset.name, asset.type)
    let destMeta = join(destDir, leaf)
    if (existsSync(destMeta) && resolve(destMeta) !== resolve(metaAbs)) {
      destMeta = join(destDir, uniqueFileName(destDir, leaf))
    }
    if (resolve(metaAbs) !== resolve(destMeta)) {
      relocateFile(metaAbs, destMeta)
    }
    writeJsonAtomic(destMeta, next)
  }
  return next
}

/** 将目录内容（除 .folder.json）上移到父目录后删除空目录 */
export function hoistDirectoryContentsAndRemove(dirAbs: string, parentAbs: string): void {
  const entries = readdirSync(dirAbs)
  for (const name of entries) {
    if (name === FOLDER_META_NAME) continue
    const src = join(dirAbs, name)
    let destName = name
    let dest = join(parentAbs, destName)
    if (existsSync(dest)) {
      destName = uniqueFileName(parentAbs, name)
      dest = join(parentAbs, destName)
    }
    renameSync(src, dest)
    // If we renamed a media file, also fix companion meta name if it was moved as-is with unique name
    if (isAssetMetaFileName(name) && destName !== name) {
      // meta moved with unique name already via rename of the meta file itself
    }
  }
  rmSync(dirAbs, { recursive: true, force: true })
}

export function copyBufferToTreeMedia(
  root: string,
  folderId: string | null,
  preferredName: string,
  data: Buffer,
  scan?: AssetTreeScan
): { relativePath: string; abs: string; fileName: string } {
  const dirAbs = resolveFolderDirAbs(root, folderId, scan)
  ensureDir(dirAbs)
  const fileName = uniqueFileName(dirAbs, preferredName)
  const abs = join(dirAbs, fileName)
  writeFileSync(abs, data)
  return { relativePath: toPosix(relative(root, abs)), abs, fileName }
}

export function detectFlatLayout(root: string): boolean {
  const assetsRoot = join(root, 'Assets')
  if (!existsSync(assetsRoot)) return false
  const entries = readdirSync(assetsRoot)
  return entries.some(
    (name) => name.endsWith('.folder.json') && name !== FOLDER_META_NAME
  )
}
