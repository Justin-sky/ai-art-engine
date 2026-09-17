import {
  cpSync,
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
  ORPHAN_MARKER_NAME,
  toPosix
} from '@shared/assetStorage/layout'
import { isRealThumbnailPath, thumbRelativePathFor } from '@shared/media/thumbnailPath'
import { fail, defErr } from '@shared/errors/appError'
import { MAIN_ERRORS } from '../errors/messages'

// ── 资产树迁移个性错误 ──
const E_ASSET_TREE_META_MISSING = defErr<{ asset: string }>(
  'assetTree.metaMissing',
  ({ asset }) => `资产元数据不存在: ${asset}`,
  ({ asset }) => `Asset metadata not found: ${asset}`
)
const E_ASSET_TREE_MEDIA_MISSING = defErr<{ path: string }>(
  'assetTree.mediaMissing',
  ({ path }) => `媒体文件缺失: ${path}`,
  ({ path }) => `Media file is missing: ${path}`
)

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

/**
 * 目录是否已被标记为搬移残留。
 *
 * 搬走后源目录删不掉、也改不了名时（Windows 上被资源管理器 / 杀软 / 索引器占用），
 * 里面会留下一个标记文件。没有它，`scanAssetTree` 会给残留的空目录补一份新
 * `.folder.json`，旧位置就会凭空多出一个同名空文件夹。
 */
export function isOrphanedAssetDir(dirAbs: string): boolean {
  return existsSync(join(dirAbs, ORPHAN_MARKER_NAME))
}

/** 写入弃用标记。目录本身被锁住时写文件通常仍能成功；失败则返回 false。 */
function markAssetDirOrphaned(dirAbs: string): boolean {
  try {
    writeFileSync(join(dirAbs, ORPHAN_MARKER_NAME), `${new Date().toISOString()}\n`)
    return true
  } catch {
    return false
  }
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
  // 进入扫描前先尝试回收上次搬移残留的源目录（限流 30s）
  runPendingCleanup(root)
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
        if (isOrphanedAssetDir(abs)) continue
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
  if (!hit) throw fail(MAIN_ERRORS.dirNotFound)
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
          createdAt:
            typeof folder.createdAt === 'string' ? folder.createdAt : new Date().toISOString(),
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
      if (!st.isDirectory() || isOrphanedAssetDir(abs)) continue
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
    const mediaAbs = options?.mediaAbs?.trim() ? options.mediaAbs : join(root, asset.relativePath)
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
    throw fail(E_ASSET_TREE_META_MISSING, { asset: asset.name || asset.id })
  }

  const next: AssetInfo = {
    ...asset,
    folderId: newFolderId,
    updatedAt: new Date().toISOString()
  }

  if (asset.relativePath) {
    const srcMedia = join(root, asset.relativePath)
    const ext = extname(asset.relativePath) || (srcMedia.includes('.') ? extname(srcMedia) : '')
    const baseName = normalizePathSegment(
      asset.name.replace(new RegExp(`${ext.replace('.', '\\.')}$`, 'i'), '') || asset.name
    )
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
      throw fail(E_ASSET_TREE_MEDIA_MISSING, { path: asset.relativePath })
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
  removeDirWithRetry(dirAbs, 'hoistDirectoryContentsAndRemove')
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
  return entries.some((name) => name.endsWith('.folder.json') && name !== FOLDER_META_NAME)
}

// ── 文件夹跨目录搬移 ──

// 待清理目录清单（处理 Windows 上 rm + rename 同时被堵死的硬 EPERM）。
// 源目录彻底删不掉时把绝对路径写进 <项目根>/.asset-engine-pending-cleanup.json，
// 下次 scanAssetTree 或下次启动继续试；应用开着时再发一个 45s unref 定时器。
const PENDING_CLEANUP_FILENAME = '.asset-engine-pending-cleanup.json'
const PENDING_GLOBAL_THROTTLE_MS = 30_000
const PENDING_ENTRY_THROTTLE_MS = 30_000
const BG_RETRY_DELAY_MS = 45_000
const MAX_BG_RETRY_ATTEMPTS = 4

interface PendingEntry {
  path: string
  lastAttempt: number
  attempts: number
}
interface PendingCleanupFile {
  entries: PendingEntry[]
}

let lastPendingRunAt = 0
const backgroundRetryPaths = new Set<string>()
const backgroundRetryTimers = new Set<ReturnType<typeof setTimeout>>()
const backgroundRetryAttempts = new Map<string, number>()

/** 从 dirAbs 向上找含 Assets 的祖先作为项目根（待清理清单写在这里） */
function findProjectRoot(dirAbs: string): string {
  let p = resolve(dirAbs)
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(p, 'Assets'))) return p
    const parent = dirname(p)
    if (parent === p) break
    p = parent
  }
  return ''
}

function readPendingCleanupFile(root: string): PendingCleanupFile {
  const file = join(root, PENDING_CLEANUP_FILENAME)
  if (!existsSync(file)) return { entries: [] }
  try {
    const parsed = readJsonFile<Partial<PendingCleanupFile>>(file)
    const entries = Array.isArray(parsed.entries) ? parsed.entries : []
    return {
      entries: entries.filter(
        (e): e is PendingEntry =>
          typeof e?.path === 'string' &&
          typeof e?.lastAttempt === 'number' &&
          typeof e?.attempts === 'number'
      )
    }
  } catch {
    return { entries: [] }
  }
}

function writePendingCleanupFile(root: string, data: PendingCleanupFile): void {
  try {
    writeJsonAtomic(join(root, PENDING_CLEANUP_FILENAME), data)
  } catch (err) {
    console.warn('[assetTree] write pending cleanup file failed:', root, err)
  }
}

function addPendingCleanup(root: string, dirAbs: string): void {
  if (!root) return
  const data = readPendingCleanupFile(root)
  if (data.entries.some((e) => e.path === dirAbs)) return
  data.entries.push({ path: dirAbs, lastAttempt: 0, attempts: 0 })
  writePendingCleanupFile(root, data)
}

function removePendingCleanup(root: string, dirAbs: string): void {
  if (!root) return
  const data = readPendingCleanupFile(root)
  const next = data.entries.filter((e) => e.path !== dirAbs)
  if (next.length !== data.entries.length) writePendingCleanupFile(root, { entries: next })
}

/**
 * 尝试清理待清理清单里的目录。全局限流 30 秒一次（避免每次 scan 都读盘），
 * 单条限流 30 秒一次，单次 rm 用 fast 模式（不重试），把"等久一点"
 * 交给后台定时器 / 下次 scan / 下次应用启动。
 */
function runPendingCleanup(root: string): void {
  if (!root) return
  const now = Date.now()
  if (now - lastPendingRunAt < PENDING_GLOBAL_THROTTLE_MS) return
  lastPendingRunAt = now
  const data = readPendingCleanupFile(root)
  if (data.entries.length === 0) return
  const retained: PendingEntry[] = []
  let dirty = false
  for (const entry of data.entries) {
    if (now - entry.lastAttempt < PENDING_ENTRY_THROTTLE_MS) {
      retained.push(entry)
      continue
    }
    if (!existsSync(entry.path)) {
      // 已被外部清理（用户手动删除 / 上次后台重试成功但文件没及时刷掉）
      dirty = true
      continue
    }
    let ok = false
    try {
      rmSync(entry.path, { recursive: true, force: true, maxRetries: 1 })
      ok = !existsSync(entry.path)
    } catch (err) {
      console.warn('[assetTree] pending cleanup attempt failed:', entry.path, err)
    }
    if (ok) {
      console.info('[assetTree] pending cleanup succeeded:', entry.path)
      dirty = true
    } else {
      retained.push({ path: entry.path, lastAttempt: now, attempts: entry.attempts + 1 })
      dirty = true
    }
  }
  if (dirty) writePendingCleanupFile(root, { entries: retained })
}

/** 后台定时再试一次删除（unref，不阻塞进程退出）。同路径有上限，避免日志轰炸。 */
function scheduleBackgroundRetry(dirAbs: string, root: string, context: string): void {
  if (backgroundRetryPaths.has(dirAbs)) return
  if ((backgroundRetryAttempts.get(dirAbs) ?? 0) >= MAX_BG_RETRY_ATTEMPTS) return
  backgroundRetryPaths.add(dirAbs)
  const t = setTimeout(() => {
    backgroundRetryTimers.delete(t)
    backgroundRetryPaths.delete(dirAbs)
    const attempts = (backgroundRetryAttempts.get(dirAbs) ?? 0) + 1
    backgroundRetryAttempts.set(dirAbs, attempts)
    if (!existsSync(dirAbs)) {
      removePendingCleanup(root, dirAbs)
      backgroundRetryAttempts.delete(dirAbs)
      return
    }
    const removed = removeDirWithRetry(dirAbs, `${context}-bg`)
    if (removed) {
      removePendingCleanup(root, dirAbs)
      backgroundRetryAttempts.delete(dirAbs)
      return
    }
    // 仍删不掉：removeDirWithRetry 已把它重新入队，由 scan / 下次启动继续试
    if (attempts >= MAX_BG_RETRY_ATTEMPTS) {
      console.warn(
        '[assetTree] background cleanup gave up after',
        attempts,
        'attempts. Please delete manually:',
        dirAbs,
        context
      )
    }
  }, BG_RETRY_DELAY_MS)
  t.unref?.()
  backgroundRetryTimers.add(t)
}

/**
 * 删除目录（带多轮重试 + 改名收尾 + 持久化兜底）。
 *
 * Windows 上 `rmSync` / `renameSync` 会因目录句柄被占用（资源管理器、杀软、
 * 缩略图/预览、文件监听）而失败。上一轮只加了改名成 `.orphan-*` 的收尾，
 * 但遇到 `rm` 和 `rename` 两条路同时被堵死（EPERM/EBUSY，常见于杀软实时扫描）
 * 的极端情况时，旧路径整目录原封不动留在原地，导致同名同 ID 的鬼影。
 *
 * 处理顺序：
 *   1) 内置重试的 `rmSync`
 *   2) 退避更长的多轮重试
 *   3) 仍删不掉则把目录改名成 `.orphan-<ts>`，让 `scanAssetTree` 跳过；
 *      rename 本身也有几轮退避重试
 *   4) rename 成功后尝试 rm orphan；rm 失败则 orphan 进待清理清单
 *   5) rename 也失败 → 把原路径写进待清理清单 + 45s 后台再试 + 明确告警
 *
 * 返回 `true` 表示 dirAbs 已不存在（无鬼影），`false` 表示原路径仍残留。
 */
export function removeDirWithRetry(dirAbs: string, context: string): boolean {
  if (!existsSync(dirAbs)) return true
  const root = findProjectRoot(dirAbs)

  // 1) 内置重试的 rmSync
  try {
    rmSync(dirAbs, { recursive: true, force: true, maxRetries: 6, retryDelay: 400 })
  } catch (err) {
    console.warn('[assetTree] remove dir failed, retrying later:', dirAbs, context, err)
  }
  if (!existsSync(dirAbs)) return true

  // 2) 退避更长的多轮重试
  for (let i = 1; i <= 3; i++) {
    sleepSync(300 * i)
    try {
      rmSync(dirAbs, { recursive: true, force: true })
      if (!existsSync(dirAbs)) return true
    } catch {
      /* ignore */
    }
  }

  // 3) 改名成 ".orphan-<ts>"，让 scan 跳过，避免鬼影
  const parent = dirname(dirAbs)
  const ts = Date.now()
  let orphanName = `.orphan-${ts}`
  let n = 0
  while (existsSync(join(parent, orphanName))) {
    n += 1
    orphanName = `.orphan-${ts}-${n}`
  }
  const orphanAbs = join(parent, orphanName)
  let renamed = false
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) sleepSync(500 * attempt)
    try {
      renameSync(dirAbs, orphanAbs)
      renamed = true
      break
    } catch {
      /* retry */
    }
  }
  if (!renamed) {
    // 4) rm + rename 都失败 → 标记弃用 + 持久化兜底 + 后台定时再试。
    // 标记必须有：目录改不了名，扫描只能靠它跳过，否则旧位置会重新长出一个空文件夹。
    const marked = markAssetDirOrphaned(dirAbs)
    if (root) {
      addPendingCleanup(root, dirAbs)
      scheduleBackgroundRetry(dirAbs, root, context)
    }
    console.warn(
      '[assetTree] source dir locked (rm + rename both failed). Queued for pending cleanup + 45s background retry.',
      '\n  path:',
      dirAbs,
      '\n  context:',
      context,
      '\n  orphan marker:',
      marked ? 'written (hidden from asset tree)' : 'FAILED (dir may reappear as an empty folder)',
      '\n  If it persists, close any program holding the directory and delete it manually, or wait for next app launch.'
    )
    return false
  }
  console.warn(
    '[assetTree] source dir locked, renamed to orphan:',
    dirAbs,
    '->',
    orphanAbs,
    context
  )
  // rename 成功后多试几次 rm orphan
  for (let i = 1; i <= 2; i++) {
    sleepSync(300 * i)
    try {
      rmSync(orphanAbs, { recursive: true, force: true })
      if (!existsSync(orphanAbs)) return true
    } catch {
      /* ignore */
    }
  }
  if (existsSync(orphanAbs)) {
    // orphan 本身以 "." 开头，scan 不会看到，但占着磁盘；交给待清理清单兜底
    if (root) addPendingCleanup(root, orphanAbs)
    console.warn('[assetTree] orphan dir kept, queued for later cleanup:', orphanAbs, context)
  }
  return true
}

/**
 * 判断目录路径是否可用；被搬移残留目录占着时先试着回收。
 *
 * 残留目录对资产树不可见，但仍占着磁盘上的名字。不回收的话同一个文件夹每搬回
 * 原位置一次就多一截 " 2" 后缀（Images 3 → Images 3 2 → Images 3 2 2），而且这个
 * 名字会被永久占死。走到这里时占用通常已经释放（杀软扫完 / 资源管理器关了），
 * 直接删就能把名字让出来；删不掉则返回 false，调用方退回追加后缀。
 */
export function reclaimAssetDirPath(dirAbs: string): boolean {
  if (!existsSync(dirAbs)) return true
  if (!isOrphanedAssetDir(dirAbs)) return false
  try {
    rmSync(dirAbs, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 })
  } catch {
    /* 仍被占用 */
  }
  if (existsSync(dirAbs)) return false
  const root = findProjectRoot(dirAbs)
  if (root) removePendingCleanup(root, dirAbs)
  console.info('[assetTree] reclaimed orphaned dir, name is free again:', dirAbs)
  return true
}

function sleepSync(ms: number): void {
  const end = Date.now() + ms
  while (Date.now() < end) {
    /* busy wait — 主进程同步路径，避免引入 async */
  }
}

function isRetryableMoveError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  // Windows 上目录被占用/杀软扫描/句柄未释放时，rename 会报 EIO/EPERM/EBUSY，
  // 先重试，比直接 cpSync+rmSync 更稳；EXDEV（跨卷）不重试。
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY' || code === 'EIO'
}

/** 把磁盘目录搬到另一位置；同卷优先 rename，跨卷或重试失败后回退到 cpSync + rmSync */
function relocateDir(src: string, dest: string): void {
  if (resolve(src) === resolve(dest)) return
  ensureDir(dirname(dest))
  if (existsSync(dest)) {
    throw new Error(`目标目录已存在: ${dest}`) // cjk-ok: 中文文案仅抛向主进程日志，未对外
  }

  // Windows 上对占用目录 rename 常为临时错误，先退避重试
  let lastError: unknown
  for (let i = 0; i < 5; i++) {
    try {
      renameSync(src, dest)
      return
    } catch (err) {
      lastError = err
      if (!isRetryableMoveError(err)) break
      sleepSync(50 * (i + 1))
    }
  }

  // 跨卷或重试失败：复制过去后再清掉源目录
  try {
    cpSync(src, dest, { recursive: true, errorOnExist: true })
  } catch (err) {
    // 复制失败时把原始 rename 错误抛出去（通常更有信息量）
    throw lastError ?? err
  }
  removeDirWithRetry(src, 'relocateDir')
}

/**
 * 把文件夹搬到另一父目录（含磁盘搬移 + 写回根 `.folder.json`）。
 * **不**主动重写子孙 asset 的 `.asset.json` relativePath——调用方按需触发
 * `scanAssetTree` + `writeAssetToTree`；descendant folder 的 `.folder.json`
 * 由下次 `scanAssetTree` 自动修复（parentId 与磁盘树不一致会触发 needsWrite）。
 *
 * 名字冲突按 `renameFolder` 同一规则处理：末尾追加 ` 2` / ` 3` …
 *
 * `newParentId` **必须不是** folderId 自身或其子孙——这一约束由
 * `projectService.moveFolder` 在调用前用 `collectFolderSubtreeIds` 校验。
 */
export function moveFolderBetweenFolders(
  root: string,
  folderId: string,
  newParentId: string | null,
  scan?: AssetTreeScan
): { folder: AssetFolder; destDirAbs: string } {
  const tree = scan ?? scanAssetTree(root)
  const srcDir = tree.dirAbsByFolderId.get(folderId)
  const folder = tree.folders.find((f) => f.id === folderId)
  if (!srcDir || !folder) throw fail(MAIN_ERRORS.dirNotFound)

  const destParentAbs = resolveFolderDirAbs(root, newParentId, tree)
  const srcNorm = resolve(srcDir)
  const destParentNorm = resolve(destParentAbs)

  // 目标父目录就是自身所在目录 → 仅更新 .folder.json，不搬磁盘
  if (srcNorm === destParentNorm) {
    const updated: AssetFolder = {
      ...folder,
      parentId: newParentId,
      updatedAt: new Date().toISOString()
    }
    writeFolderMeta(srcDir, updated)
    return { folder: updated, destDirAbs: srcDir }
  }

  // 先规范化名字（去首尾空格、非法字符、Windows 保留名、尾点等），再处理冲突
  let targetName = normalizePathSegment(folder.name)
  let destDirAbs = join(destParentAbs, targetName)
  if (!reclaimAssetDirPath(destDirAbs)) {
    const safe = targetName
    let i = 2
    while (!reclaimAssetDirPath(join(destParentAbs, `${safe} ${i}`))) i += 1
    targetName = `${safe} ${i}`
    destDirAbs = join(destParentAbs, targetName)
  }

  if (resolve(srcDir) !== resolve(destDirAbs)) {
    relocateDir(srcDir, destDirAbs)
  }

  const updated: AssetFolder = {
    ...folder,
    parentId: newParentId,
    name: targetName,
    updatedAt: new Date().toISOString()
  }
  writeFolderMeta(destDirAbs, updated)

  return { folder: updated, destDirAbs }
}
