import { existsSync, mkdirSync, renameSync, rmSync } from 'fs'
import { join } from 'path'
import { compareNames } from '@shared/folderTree'
import type { AssetFolder } from '@shared/domain'
import { normalizePathSegment } from '@shared/assetPackage/pathname'
import {
  hoistDirectoryContentsAndRemove,
  resolveFolderDirAbs,
  scanAssetTree,
  writeFolderMeta
} from './assetTreeStore'

export class FolderRepository {
  list(root: string): AssetFolder[] {
    return scanAssetTree(root).folders.sort((a, b) => compareNames(a.name, b.name))
  }

  read(root: string, folderId: string): AssetFolder {
    const scan = scanAssetTree(root)
    const folder = scan.folders.find((f) => f.id === folderId)
    if (!folder) throw new Error('目录不存在')
    return folder
  }

  /** 在父目录下创建真实子目录并写入 .folder.json */
  create(root: string, folder: AssetFolder): void {
    const parentAbs = resolveFolderDirAbs(root, folder.parentId ?? null)
    const dirName = normalizePathSegment(folder.name)
    let dirAbs = join(parentAbs, dirName)
    if (existsSync(dirAbs)) {
      let i = 2
      while (existsSync(join(parentAbs, `${dirName} ${i}`))) i += 1
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
    if (!dirAbs) throw new Error('目录不存在')
    writeFolderMeta(dirAbs, folder)
  }

  rename(root: string, folderId: string, name: string): AssetFolder {
    const scan = scanAssetTree(root)
    const dirAbs = scan.dirAbsByFolderId.get(folderId)
    const folder = scan.folders.find((f) => f.id === folderId)
    if (!dirAbs || !folder) throw new Error('目录不存在')
    const parentAbs = resolveFolderDirAbs(root, folder.parentId ?? null, scan)
    const safe = normalizePathSegment(name.trim() || folder.name)
    let nextAbs = join(parentAbs, safe)
    if (nextAbs !== dirAbs) {
      if (existsSync(nextAbs)) {
        let i = 2
        while (existsSync(join(parentAbs, `${safe} ${i}`))) i += 1
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
    if (!dirAbs || !folder) throw new Error('目录不存在')
    const parentAbs = resolveFolderDirAbs(root, folder.parentId ?? null, scan)
    hoistDirectoryContentsAndRemove(dirAbs, parentAbs)
  }

  /** 递归删除目录及其磁盘内容（调用方须先删光子树内资产） */
  removeRecursive(root: string, folderId: string): void {
    const scan = scanAssetTree(root)
    const dirAbs = scan.dirAbsByFolderId.get(folderId)
    if (!dirAbs) throw new Error('目录不存在')
    rmSync(dirAbs, { recursive: true, force: true })
  }
}

export const folderRepository = new FolderRepository()
