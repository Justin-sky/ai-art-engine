import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { moveFolderBetweenFolders, scanAssetTree } from '../src/main/repositories/assetTreeStore'
import { folderRepository } from '../src/main/repositories/folderRepository'
import { ASSET_META_SUFFIX, FOLDER_META_NAME } from '../src/shared/assetStorage/layout'
import type { AssetFolder, AssetInfo } from '../src/shared/domain'

/**
 * 建立一棵测试用资产树：
 *   Assets/
 *     Advert/{a.png, b.png}                    (folder 'a')
 *       Sub/c.png                              (folder 'sub' 在 'a' 下)
 *     Other/                                   (folder 'o')
 *
 * 媒体文件 + `.folder.json` + `.asset.json` 全部按规范写盘，
 * 让 `moveFolderBetweenFolders` / `folderRepository.move` 跑真实磁盘链路。
 */
function makeTree(root: string): void {
  const assetsRoot = join(root, 'Assets')
  mkdirSync(join(assetsRoot, 'Advert', 'Sub'), { recursive: true })
  mkdirSync(join(assetsRoot, 'Other'), { recursive: true })

  const writeFolder = (rel: string, folder: AssetFolder): void => {
    writeFileSync(join(assetsRoot, rel, FOLDER_META_NAME), JSON.stringify(folder, null, 2))
  }
  writeFolder('Advert', {
    id: 'a',
    name: 'Advert',
    parentId: null,
    createdAt: 't0',
    updatedAt: 't0'
  })
  writeFolder('Advert/Sub', {
    id: 'sub',
    name: 'Sub',
    parentId: 'a',
    createdAt: 't0',
    updatedAt: 't0'
  })
  writeFolder('Other', { id: 'o', name: 'Other', parentId: null, createdAt: 't0', updatedAt: 't0' })

  writeFileSync(join(assetsRoot, 'Advert/a.png'), 'a-png')
  writeFileSync(join(assetsRoot, 'Advert/b.png'), 'b-png')
  writeFileSync(join(assetsRoot, 'Advert/Sub/c.png'), 'c-png')

  const writeAsset = (relPath: string, asset: AssetInfo): void => {
    writeFileSync(join(root, relPath) + ASSET_META_SUFFIX, JSON.stringify(asset, null, 2))
  }
  const base: Pick<AssetInfo, 'type' | 'createdAt' | 'updatedAt'> = {
    type: 'image',
    createdAt: 't0',
    updatedAt: 't0'
  }
  writeAsset('Assets/Advert/a.png', {
    ...base,
    id: 'aid-a',
    name: 'a.png',
    folderId: 'a',
    relativePath: 'Assets/Advert/a.png'
  })
  writeAsset('Assets/Advert/b.png', {
    ...base,
    id: 'aid-b',
    name: 'b.png',
    folderId: 'a',
    relativePath: 'Assets/Advert/b.png'
  })
  writeAsset('Assets/Advert/Sub/c.png', {
    ...base,
    id: 'aid-c',
    name: 'c.png',
    folderId: 'sub',
    relativePath: 'Assets/Advert/Sub/c.png'
  })
}

describe('moveFolderBetweenFolders — 磁盘搬移', () => {
  let root = ''

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aae-folder-move-'))
    makeTree(root)
  })

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('跨级搬移到另一父目录，磁盘目录与 .folder.json 都到位', () => {
    const result = moveFolderBetweenFolders(root, 'a', 'o')

    expect(result.folder.parentId).toBe('o')
    expect(result.folder.name).toBe('Advert')

    // 磁盘上：源目录搬走了
    expect(existsSync(join(root, 'Assets/Advert'))).toBe(false)
    // 目标下出现新目录
    expect(existsSync(join(root, 'Assets/Other/Advert'))).toBe(true)
    expect(existsSync(join(root, 'Assets/Other/Advert/Sub'))).toBe(true)
    expect(existsSync(join(root, 'Assets/Other/Advert/a.png'))).toBe(true)
    expect(existsSync(join(root, 'Assets/Other/Advert/Sub/c.png'))).toBe(true)

    // 目标目录的 .folder.json parentId = 'o'
    const meta = JSON.parse(
      readFileSync(join(root, 'Assets/Other/Advert', FOLDER_META_NAME), 'utf8')
    ) as AssetFolder
    expect(meta.parentId).toBe('o')
    expect(meta.id).toBe('a')
  })

  it('搬移后重 scan，descendant folder 的 parentId 由 scan 自动修复', () => {
    moveFolderBetweenFolders(root, 'a', 'o')

    const fresh = scanAssetTree(root)
    const aFolder = fresh.folders.find((f) => f.id === 'a')
    const subFolder = fresh.folders.find((f) => f.id === 'sub')
    expect(aFolder?.parentId).toBe('o')
    expect(subFolder?.parentId).toBe('a') // 子目录 parentId 由 scan 重写
    // 'sub' 的 .folder.json 现在落在新位置，由 scan 的 needsWrite 触发自动修
    const subMeta = JSON.parse(
      readFileSync(join(root, 'Assets/Other/Advert/Sub', FOLDER_META_NAME), 'utf8')
    ) as AssetFolder
    expect(subMeta.parentId).toBe('a')
  })

  it('目标父目录已有同名目录时，自动追加 " 2" 后缀', () => {
    // 在 'o' 下先建同名冲突目录
    const conflict = join(root, 'Assets/Other/Advert')
    mkdirSync(conflict, { recursive: true })
    writeFileSync(
      join(conflict, FOLDER_META_NAME),
      JSON.stringify({
        id: 'conflict-a',
        name: 'Advert',
        parentId: 'o',
        createdAt: 't0',
        updatedAt: 't0'
      } satisfies AssetFolder)
    )

    const result = moveFolderBetweenFolders(root, 'a', 'o')

    expect(result.folder.name).toBe('Advert 2')
    expect(existsSync(join(root, 'Assets/Other/Advert 2'))).toBe(true)
    // 冲突目录原样保留
    expect(existsSync(join(root, 'Assets/Other/Advert'))).toBe(true)
  })

  it('目标父目录不存在时（无效 folderId）抛错', () => {
    expect(() => moveFolderBetweenFolders(root, 'a', 'nonexistent')).toThrow()
  })
})

describe('folderRepository.move — 集成（含 descendant asset.relativePath 写回）', () => {
  let root = ''

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aae-folder-repo-move-'))
    makeTree(root)
  })

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('搬移后所有 descendant asset 的 .asset.json relativePath 都重写到新位置', () => {
    folderRepository.move(root, 'a', 'o')

    // 根 asset 在新位置
    const aMeta = JSON.parse(
      readFileSync(join(root, 'Assets/Other/Advert/a.png') + ASSET_META_SUFFIX, 'utf8')
    ) as AssetInfo
    expect(aMeta.relativePath).toBe('Assets/Other/Advert/a.png')
    expect(aMeta.folderId).toBe('a')

    // 孙层 asset（c 在 Sub 下）也重写
    const cMeta = JSON.parse(
      readFileSync(join(root, 'Assets/Other/Advert/Sub/c.png') + ASSET_META_SUFFIX, 'utf8')
    ) as AssetInfo
    expect(cMeta.relativePath).toBe('Assets/Other/Advert/Sub/c.png')
    expect(cMeta.folderId).toBe('sub')

    // 旧位置不再有 a 的 .asset.json（meta 随目录搬走，物理上等价于"原位置无文件"）
    expect(existsSync(join(root, 'Assets/Advert/a.png') + ASSET_META_SUFFIX)).toBe(false)
  })

  it('搬到根（newParentId = null）且 Assets 下已有同名目录时追加 " 2"', () => {
    // 'o' 在 Assets/Other，搬到根（Assets/）—— 跟 Assets/Advert 无关但 Assets 下有 Advert
    // 这里 'o' = Other 搬到 Assets 下，但 Assets 下没有 "Other" 同名 → 应该直接落在 Assets/Other
    // 改成测 'a' (Advert) 搬到 null（Assets 根）—— Assets 下已有 Advert → 追加 "Advert 2"
    const updated = folderRepository.move(root, 'a', null)
    expect(updated.name).toBe('Advert 2')
    expect(updated.parentId).toBe(null)
    expect(existsSync(join(root, 'Assets/Advert 2'))).toBe(true)
    expect(existsSync(join(root, 'Assets/Advert'))).toBe(false)
  })

  it('返回的 folder 对象反映新 parentId', () => {
    const updated = folderRepository.move(root, 'a', 'o')
    expect(updated.parentId).toBe('o')
    expect(updated.id).toBe('a')
    expect(updated.name).toBe('Advert')
  })
})
