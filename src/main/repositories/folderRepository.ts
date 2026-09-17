import { mkdirSync, renameSync, rmSync } from 'fs'
import { join } from 'path'
import { collectFolderSubtreeIds, compareNames } from '@shared/folderTree'
import type { AssetFolder } from '@shared/domain'
import { normalizePathSegment } from '@shared/assetPackage/pathname'
import { fail } from '@shared/errors/appError'
import { MAIN_ERRORS } from '../errors/messages'
import {
  hoistDirectoryContentsAndRemove,
  moveFolderBetweenFolders,
  reclaimAssetDirPath,
  resolveFolderDirAbs,
  scanAssetTree,
  writeAssetToTree,
  writeFolderMeta
} from './assetTreeStore'

export class FolderRepository {
  list(root: string): AssetFolder[] {
    return scanAssetTree(root).folders.sort((a, b) => compareNames(a.name, b.name))
  }

  read(root: string, folderId: string): AssetFolder {
    const scan = scanAssetTree(root)
    const folder = scan.folders.find((f) => f.id === folderId)
    if (!folder) throw fail(MAIN_ERRORS.dirNotFound)
    return folder
  }

  /** 在父目录下创建真实子目录并写入 .folder.json */
  create(root: string, folder: AssetFolder): void {
    const parentAbs = resolveFolderDirAbs(root, folder.parentId ?? null)
    const dirName = normalizePathSegment(folder.name)
    let dirAbs = join(parentAbs, dirName)
    if (!reclaimAssetDirPath(dirAbs)) {
      let i = 2
      while (!reclaimAssetDirPath(join(parentAbs, `${dirName} ${i}`))) i += 1
      folder.name = `${dirName} ${i}`
      dirAbs = join(parentAbs, folder.name)
    } else {
      folder.name = dirName
    }
    mkdirSync(dirAbs, { recursive: true })
    writeFolderMeta(dirAbs, folder)
  }

  write(root: string, folder: AssetFolder): void {
    const scan = scanAssetTree(root)
    const dirAbs = scan.dirAbsByFolderId.get(folder.id)
    if (!dirAbs) throw fail(MAIN_ERRORS.dirNotFound)
    writeFolderMeta(dirAbs, folder)
  }

  /**
   * 把文件夹搬到另一父目录（含磁盘搬移、`.folder.json` 更新、descendant
   * asset.relativePath 写回）。成环约束（newParentId 不能是 folderId 自身
   * 或其子孙）由 `projectService.moveFolder` 在调用前校验。
   */
  move(root: string, folderId: string, newParentId: string | null): AssetFolder {
    const before = scanAssetTree(root)
    const { folder } = moveFolderBetweenFolders(root, folderId, newParentId, before)
    // 重新扫描：磁盘树已变；把所有 descendant asset 的 .asset.json relativePath 写回
    // （descendant folder 的 .folder.json 由下次 scan 自动修，本次只搬资产）
    const fresh = scanAssetTree(root)
    const subtree = new Set(collectFolderSubtreeIds(fresh.folders, folderId))
    for (const asset of fresh.assets) {
      if (asset.folderId != null && subtree.has(asset.folderId)) {
        writeAssetToTree(root, asset, { scan: fresh })
      }
    }
    return folder
  }

  rename(root: string, folderId: string, name: string): AssetFolder {
    const scan = scanAssetTree(root)
    const dirAbs = scan.dirAbsByFolderId.get(folderId)
    const folder = scan.folders.find((f) => f.id === folderId)
    if (!dirAbs || !folder) throw fail(MAIN_ERRORS.dirNotFound)
    const parentAbs = resolveFolderDirAbs(root, folder.parentId ?? null, scan)
    const safe = normalizePathSegment(name.trim() || folder.name)
    let nextAbs = join(parentAbs, safe)
    if (nextAbs !== dirAbs) {
      if (!reclaimAssetDirPath(nextAbs)) {
        let i = 2
        while (!reclaimAssetDirPath(join(parentAbs, `${safe} ${i}`))) i += 1
        nextAbs = join(parentAbs, `${safe} ${i}`)
        folder.name = `${safe} ${i}`
      } else {
        folder.name = safe
      }
      renameSync(dirAbs, nextAbs)
    } else {
      folder.name = safe
    }
    folder.updatedAt = new Date().toISOString()
    writeFolderMeta(nextAbs === dirAbs ? dirAbs : nextAbs, folder)
    return folder
  }

  /**
   * 删除文件夹：将内容上移到父目录，再删空目录（不删除资产文件）。
   */
  remove(root: string, folderId: string): void {
    const scan = scanAssetTree(root)
    const dirAbs = scan.dirAbsByFolderId.get(folderId)
    const folder = scan.folders.find((f) => f.id === folderId)
    if (!dirAbs || !folder) throw fail(MAIN_ERRORS.dirNotFound)
    const parentAbs = resolveFolderDirAbs(root, folder.parentId ?? null, scan)
    hoistDirectoryContentsAndRemove(dirAbs, parentAbs)
  }

  /** 递归删除目录及其磁盘内容（调用方须先删光子树内资产） */
  removeRecursive(root: string, folderId: string): void {
    const scan = scanAssetTree(root)
    const dirAbs = scan.dirAbsByFolderId.get(folderId)
    if (!dirAbs) throw fail(MAIN_ERRORS.dirNotFound)
    rmSync(dirAbs, { recursive: true, force: true })
  }
}

export const folderRepository = new FolderRepository()
