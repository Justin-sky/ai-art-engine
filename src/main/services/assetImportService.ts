import { randomUUID } from 'crypto'
import { lstatSync, readdirSync, statSync } from 'fs'
import { basename, join } from 'path'
import { normalizePathSegment } from '@shared/assetPackage/pathname'
import { resolveUniqueAssetName, type AssetFolder } from '@shared/domain'
import { isAssetPackagePath, isImportablePath } from '@shared/import'
import type { ImportedFolderSummary } from '@shared/ipc'
import { folderRepository } from '../repositories/folderRepository'
import { resolveFolderDirAbs, scanAssetTree } from '../repositories/assetTreeStore'

/** 单次拖入目录允许导入的最大文件数（防误拖数万文件的目录把工程刷爆） */
export const MAX_FOLDER_IMPORT_FILES = 2000
/** 目录递归深度上限（防病态深层嵌套） */
export const MAX_FOLDER_IMPORT_DEPTH = 32

export interface FolderImportFile {
  /** 相对被拖入目录的 POSIX 路径（如 `sub/a.png`） */
  relativePath: string
  /** 绝对路径 */
  absolutePath: string
}

export interface FolderImportScan {
  files: FolderImportFile[]
  /** 扩展名不支持导入的文件数（隐藏项不计入） */
  unsupportedCount: number
  /** 目录内的 `.aipackage` 资产包数 */
  packageCount: number
  /** 读取失败的条目数（权限 / 句柄占用等） */
  unreadableCount: number
  /** 命中文件数上限，未扫描完目录全部内容 */
  truncated: boolean
}

/**
 * 递归扫描「被拖入的目录」，收集可导入的媒体文件。
 *
 * 只做磁盘遍历与分类，不碰资产库（便于单测）。隐藏项（`.` 开头，含 `.DS_Store`、
 * `.asset.json` 等元数据）、符号链接一律忽略：前者是系统噪音，后者会绕出目录树成环。
 * 目录条目先排序，保证多次导入顺序稳定。
 */
export function scanImportableFolder(
  dirAbs: string,
  options?: { maxFiles?: number }
): FolderImportScan {
  const maxFiles = options?.maxFiles ?? MAX_FOLDER_IMPORT_FILES
  const files: FolderImportFile[] = []
  let unsupportedCount = 0
  let packageCount = 0
  let unreadableCount = 0
  let truncated = false

  const walk = (currentAbs: string, relDir: string, depth: number): void => {
    let names: string[]
    try {
      names = readdirSync(currentAbs).sort((a, b) => a.localeCompare(b))
    } catch {
      unreadableCount += 1
      return
    }
    for (const name of names) {
      if (truncated) return
      if (name.startsWith('.')) continue
      const abs = join(currentAbs, name)
      let st
      try {
        st = lstatSync(abs)
      } catch {
        unreadableCount += 1
        continue
      }
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) {
        if (depth + 1 > MAX_FOLDER_IMPORT_DEPTH) continue
        walk(abs, relDir ? `${relDir}/${name}` : name, depth + 1)
        continue
      }
      if (!st.isFile()) continue
      if (isAssetPackagePath(name)) {
        packageCount += 1
        continue
      }
      if (!isImportablePath(name)) {
        unsupportedCount += 1
        continue
      }
      if (files.length >= maxFiles) {
        truncated = true
        return
      }
      files.push({ relativePath: relDir ? `${relDir}/${name}` : name, absolutePath: abs })
    }
  }

  walk(dirAbs, '', 0)
  return { files, unsupportedCount, packageCount, unreadableCount, truncated }
}

/** 待导入项：文件直接导入；目录先扫出清单，再按源目录结构镜像 */
export type AssetImportPlanEntry =
  { kind: 'file'; path: string } | { kind: 'dir'; path: string; scan: FolderImportScan }

export interface AssetImportPlan {
  entries: AssetImportPlanEntry[]
  /** 待导入文件总数（进度条分母） */
  total: number
  /** 入参里无法导入的路径（不存在 / 非法），直接进 skipped */
  skipped: { path: string; reason: string }[]
}

/**
 * 第一遍：把拖入的路径分成「文件」与「目录（已扫出待导入清单）」，并给出文件总数。
 *
 * 目录在这里只做只读遍历：不建资产目录、不落文件 —— 进度条要先知道分母，
 * 也要避免「一个可导入文件都没有」时白建一堆空目录。
 */
export function planAssetImport(filePaths: string[]): AssetImportPlan {
  const entries: AssetImportPlanEntry[] = []
  const skipped: { path: string; reason: string }[] = []
  let total = 0

  for (const src of filePaths) {
    if (!src || typeof src !== 'string') {
      skipped.push({ path: String(src), reason: 'Invalid source path' })
      continue
    }
    let isDirectory = false
    try {
      isDirectory = statSync(src).isDirectory()
    } catch {
      skipped.push({ path: src, reason: 'Source file does not exist' })
      continue
    }
    if (!isDirectory) {
      entries.push({ kind: 'file', path: src })
      total += 1
      continue
    }
    const scan = scanImportableFolder(src)
    entries.push({ kind: 'dir', path: src, scan })
    total += scan.files.length
  }

  return { entries, total, skipped }
}

export interface ImportFolderTreeInput {
  /** 工程根目录 */
  root: string
  /** 被拖入的源目录绝对路径 */
  sourceDir: string
  /** 落点资产目录（拖到某目录行上时是该目录，否则为 null = Assets 根） */
  parentFolderId: string | null
  /** 预扫描结果（`planAssetImport` 已扫过时传入，省掉重复遍历源目录） */
  scan?: FolderImportScan
  /**
   * 导入单个文件；返回 false 表示该文件导入失败（调用方已记录原因）。
   * 允许返回 Promise：调用方借此在每个文件之间让出事件循环并推进进度。
   * `folderDirAbs` 是文件要落的目标目录绝对路径 —— 目录刚在这里建好，
   * 导入方直接用它，不必为解析目录再扫一遍资产树。
   */
  importFile: (
    absolutePath: string,
    folderId: string,
    folderDirAbs: string
  ) => boolean | Promise<boolean>
  /** 目录创建失败等、无法归到单文件导入链路的错误 */
  onEntryError?: (absolutePath: string, reason: string) => void
}

/**
 * 把「被拖入的目录」按源目录结构镜像进资产库，并逐个导入其中的媒体文件。
 *
 * 目录镜像复用语义：同父目录下已存在同名目录时直接复用它（重复拖入同一目录是合并，
 * 而不是每次都长出一份 `名称 2`），只有没有同名目录时才新建。目录按需创建——某个
 * 子目录里一个可导入文件都没有时不会落成空目录。
 *
 * 性能：整棵目录树只扫一遍资产库（`scanAssetTree`），新建目录时父目录绝对路径一路
 * 传下去；批量导入的单文件成本因此与工程规模无关（早期实现每文件两次全树扫描，
 * 几百个文件就会把主进程卡住）。
 */
export async function importFolderTree(
  input: ImportFolderTreeInput
): Promise<ImportedFolderSummary> {
  const { root, sourceDir, parentFolderId } = input
  const scan = input.scan ?? scanImportableFolder(sourceDir)
  const sourceName = basename(sourceDir)
  const summary: ImportedFolderSummary = {
    sourcePath: sourceDir,
    folderName: normalizePathSegment(sourceName) || sourceName,
    folderId: null,
    importedCount: 0,
    unsupportedCount: scan.unsupportedCount,
    packageCount: scan.packageCount,
    unreadableCount: scan.unreadableCount,
    truncated: scan.truncated
  }
  if (!scan.files.length) return summary

  const tree = scanAssetTree(root)
  const childrenByParent = new Map<string, AssetFolder[]>()
  const dirAbsByFolderId = new Map(tree.dirAbsByFolderId)
  for (const folder of tree.folders) {
    const key = folder.parentId ?? ''
    const siblings = childrenByParent.get(key)
    if (siblings) siblings.push(folder)
    else childrenByParent.set(key, [folder])
  }

  const siblingsOf = (parentId: string | null): AssetFolder[] =>
    childrenByParent.get(parentId ?? '') ?? []

  const register = (folder: AssetFolder, dirAbs: string): void => {
    dirAbsByFolderId.set(folder.id, dirAbs)
    const key = folder.parentId ?? ''
    const siblings = childrenByParent.get(key)
    if (siblings) siblings.push(folder)
    else childrenByParent.set(key, [folder])
  }

  /** 同父目录下按名查找（Windows 盘符不区分大小写，比较时统一小写） */
  const findSiblingByName = (parentId: string | null, name: string): AssetFolder | undefined => {
    const needle = name.toLowerCase()
    return siblingsOf(parentId).find((folder) => folder.name.toLowerCase() === needle)
  }

  const ensureChild = (
    parentId: string | null,
    parentDirAbs: string,
    rawName: string
  ): AssetFolder => {
    const name = normalizePathSegment(rawName) || rawName
    const existing = findSiblingByName(parentId, name)
    if (existing) return existing
    const ts = new Date().toISOString()
    const folder: AssetFolder = {
      id: randomUUID(),
      // 同一批里规范化后同名的目录（如 `a?` 与 `a*`）也要错开，避免撞名
      name: resolveUniqueAssetName(
        name,
        siblingsOf(parentId).map((sibling) => sibling.name)
      ),
      parentId,
      createdAt: ts,
      updatedAt: ts
    }
    // create 会按磁盘占用把 name 定稿（可能带「 2」后缀），返回值即真实目录
    const createdDirAbs = folderRepository.create(root, folder, parentDirAbs)
    register(folder, createdDirAbs)
    return folder
  }

  const parentDirAbs = resolveFolderDirAbs(root, parentFolderId, tree)
  /** 相对目录 → 目标目录（folderId + 绝对路径）。'' = 源目录本身 */
  const dirByRelDir = new Map<string, { folderId: string; dirAbs: string }>()
  const ensureSourceDir = (): { folderId: string; dirAbs: string } => {
    const cached = dirByRelDir.get('')
    if (cached) return cached
    const folder = ensureChild(parentFolderId, parentDirAbs, summary.folderName)
    const entry = { folderId: folder.id, dirAbs: dirAbsByFolderId.get(folder.id)! }
    dirByRelDir.set('', entry)
    return entry
  }

  const dirForRelDir = (relDir: string): { folderId: string; dirAbs: string } => {
    const cached = dirByRelDir.get(relDir)
    if (cached) return cached
    let current = ensureSourceDir()
    if (!relDir) return current
    let acc = ''
    for (const segment of relDir.split('/')) {
      acc = acc ? `${acc}/${segment}` : segment
      const hit = dirByRelDir.get(acc)
      if (hit) {
        current = hit
        continue
      }
      const folder = ensureChild(current.folderId, current.dirAbs, segment)
      current = { folderId: folder.id, dirAbs: dirAbsByFolderId.get(folder.id)! }
      dirByRelDir.set(acc, current)
    }
    return current
  }

  // 按目录分组：目录创建失败时整组的文件都要记账，不能静默丢
  const filesByDir = new Map<string, FolderImportFile[]>()
  for (const file of scan.files) {
    const slash = file.relativePath.lastIndexOf('/')
    const relDir = slash > 0 ? file.relativePath.slice(0, slash) : ''
    const bucket = filesByDir.get(relDir)
    if (bucket) bucket.push(file)
    else filesByDir.set(relDir, [file])
  }

  for (const [relDir, files] of filesByDir) {
    let target: { folderId: string; dirAbs: string }
    try {
      target = dirForRelDir(relDir)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      for (const file of files) input.onEntryError?.(file.absolutePath, reason)
      continue
    }
    for (const file of files) {
      if (await input.importFile(file.absolutePath, target.folderId, target.dirAbs)) {
        summary.importedCount += 1
      }
    }
  }

  summary.folderId = dirByRelDir.get('')?.folderId ?? null
  return summary
}
