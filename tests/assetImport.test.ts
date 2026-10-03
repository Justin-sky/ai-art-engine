import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { folderRepository } from '../src/main/repositories/folderRepository'
import {
  importFolderTree,
  planAssetImport,
  scanImportableFolder,
  type FolderImportScan
} from '../src/main/services/assetImportService'
import type { AssetFolder } from '../src/shared/domain'

/**
 * 拖入文件 / 文件夹导入：源目录 → 资产目录镜像 + 媒体登记 + 进度分母。
 *
 * 跑真实的临时磁盘链路（`folderRepository.create` 写 `.folder.json`、
 * `scanAssetTree` 重新扫描），`importFile` 用回调替身记录「哪个文件落到了哪个目录」，
 * 从而在不拉起 Electron 主进程的前提下覆盖目录镜像语义与两趟导入的分母。
 */
let projectRoot = ''
let sourceParent = ''
/** 被拖入的目录：临时父目录下名为 `Pack` 的目录（镜像出的资产目录会沿用该名） */
let sourceDir = ''

/** 在源目录下建文件（自动补父目录） */
function sourceFile(rel: string, content = 'x'): void {
  const abs = join(sourceDir, ...rel.split('/'))
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content)
}

/** folderId → `父/子` 路径 */
function folderPathOf(folders: AssetFolder[], folderId: string): string {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const parts: string[] = []
  let cursor: string | null = folderId
  while (cursor) {
    const folder = byId.get(cursor)
    if (!folder) break
    parts.unshift(folder.name)
    cursor = folder.parentId
  }
  return parts.join('/')
}

/** 资产目录树的路径清单（排序） */
function folderPaths(folders: AssetFolder[]): string[] {
  return folders.map((f) => folderPathOf(folders, f.id)).sort()
}

function baseName(abs: string): string {
  return abs.split(/[\\/]/).pop() ?? abs
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'aae-folder-import-root-'))
  sourceParent = mkdtempSync(join(tmpdir(), 'aae-folder-import-src-'))
  sourceDir = join(sourceParent, 'Pack')
  mkdirSync(sourceDir, { recursive: true })
})

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true })
  rmSync(sourceParent, { recursive: true, force: true })
})

describe('scanImportableFolder', () => {
  it('递归收集可导入文件，并分类统计不支持 / 资产包 / 隐藏项', () => {
    sourceFile('a.png')
    sourceFile('b.txt')
    sourceFile('notes.pdf')
    sourceFile('pack.aipackage')
    sourceFile('.hidden.png')
    sourceFile('sub/c.mp4')
    sourceFile('sub/.DS_Store')
    sourceFile('sub/deep/d.glb')
    sourceFile('sub/empty/readme')

    const scan = scanImportableFolder(sourceDir)

    expect(scan.files.map((f) => f.relativePath)).toEqual([
      'a.png',
      'b.txt',
      'sub/c.mp4',
      'sub/deep/d.glb'
    ])
    expect(scan.unsupportedCount).toBe(2) // notes.pdf + sub/empty/readme
    expect(scan.packageCount).toBe(1)
    expect(scan.unreadableCount).toBe(0)
    expect(scan.truncated).toBe(false)
    // 绝对路径可直接交给导入链路
    expect(scan.files[0].absolutePath).toBe(join(sourceDir, 'a.png'))
  })

  it('命中文件数上限时 truncated=true，只返回前 N 个', () => {
    sourceFile('a.png')
    sourceFile('b.png')
    sourceFile('c.png')

    const scan = scanImportableFolder(sourceDir, { maxFiles: 2 })

    expect(scan.files).toHaveLength(2)
    expect(scan.truncated).toBe(true)
  })

  it('忽略符号链接（不绕出目录树成环）', () => {
    sourceFile('a.png')
    try {
      symlinkSync(sourceDir, join(sourceDir, 'loop'), 'dir')
    } catch {
      // Windows 未开启开发者模式时建不了符号链接：跳过该断言
      return
    }

    const scan = scanImportableFolder(sourceDir)
    expect(scan.files.map((f) => f.relativePath)).toEqual(['a.png'])
  })
})

describe('planAssetImport — 第一趟：给出进度分母', () => {
  it('文件与目录混拖：总数含目录内文件，目录沿用扫描结果', () => {
    const loose = join(sourceParent, 'loose.png')
    writeFileSync(loose, 'x')
    sourceFile('a.png')
    sourceFile('sub/c.mp4')
    sourceFile('notes.pdf')

    const plan = planAssetImport([loose, sourceDir])

    expect(plan.total).toBe(3) // loose.png + Pack/a.png + Pack/sub/c.mp4
    expect(plan.skipped).toEqual([])
    expect(plan.entries.map((e) => e.kind)).toEqual(['file', 'dir'])
    const dirEntry = plan.entries[1]
    expect(dirEntry.kind === 'dir' && dirEntry.scan.unsupportedCount).toBe(1)
  })

  it('不存在的路径与非法入参进 skipped，不计入总数', () => {
    const plan = planAssetImport([join(sourceParent, 'nope.png'), '', null as unknown as string])

    expect(plan.total).toBe(0)
    expect(plan.entries).toEqual([])
    expect(plan.skipped.map((s) => s.reason)).toEqual([
      'Source file does not exist',
      'Invalid source path',
      'Invalid source path'
    ])
  })
})

describe('importFolderTree — 目录结构镜像', () => {
  it('按源目录结构建资产目录，并把文件导到对应目录', async () => {
    sourceFile('a.png')
    sourceFile('sub/c.mp4')
    sourceFile('sub/deep/d.glb')
    sourceFile('sub/empty/readme')

    const imported: { file: string; folderId: string; dirAbs: string }[] = []
    const summary = await importFolderTree({
      root: projectRoot,
      sourceDir,
      parentFolderId: null,
      importFile: (absolutePath, folderId, folderDirAbs) => {
        imported.push({ file: absolutePath, folderId, dirAbs: folderDirAbs })
        return true
      }
    })

    const folders = folderRepository.list(projectRoot)
    // 只建「有文件要落」的目录：sub/empty 不会变成空资产目录
    expect(folderPaths(folders)).toEqual(['Pack', 'Pack/sub', 'Pack/sub/deep'])
    expect(imported.map((i) => folderPathOf(folders, i.folderId)).sort()).toEqual([
      'Pack',
      'Pack/sub',
      'Pack/sub/deep'
    ])
    expect(imported.map((i) => baseName(i.file)).sort()).toEqual(['a.png', 'c.mp4', 'd.glb'])
    // 目标目录绝对路径由创建方给出（导入方不再自己解析、省掉一次全树扫描）
    const assetsRoot = join(projectRoot, 'Assets')
    expect(
      imported.map((i) => i.dirAbs.replace(assetsRoot, '').replace(/\\/g, '/')).sort()
    ).toEqual(['/Pack', '/Pack/sub', '/Pack/sub/deep'])
    expect(summary).toMatchObject({
      folderName: 'Pack',
      importedCount: 3,
      unsupportedCount: 1,
      packageCount: 0,
      unreadableCount: 0,
      truncated: false
    })
    expect(summary.folderId).toBe(folders.find((f) => folderPathOf(folders, f.id) === 'Pack')?.id)
  })

  it('传入预扫描结果时按它导入（不重复遍历源目录）', async () => {
    sourceFile('a.png')
    sourceFile('b.png')
    const scan = scanImportableFolder(sourceDir)
    const onlyFirst: FolderImportScan = { ...scan, files: scan.files.slice(0, 1) }

    const imported: string[] = []
    const summary = await importFolderTree({
      root: projectRoot,
      sourceDir,
      parentFolderId: null,
      scan: onlyFirst,
      importFile: (absolutePath) => {
        imported.push(baseName(absolutePath))
        return true
      }
    })

    expect(imported).toEqual(['a.png'])
    expect(summary.importedCount).toBe(1)
  })

  it('按顺序 await 异步 importFile（进度推进依赖它串行）', async () => {
    sourceFile('a.png')
    sourceFile('b.png')
    sourceFile('c.png')

    const order: string[] = []
    await importFolderTree({
      root: projectRoot,
      sourceDir,
      parentFolderId: null,
      importFile: async (absolutePath) => {
        await Promise.resolve()
        order.push(baseName(absolutePath))
        return true
      }
    })

    expect(order).toEqual(['a.png', 'b.png', 'c.png'])
  })

  it('重复拖入同名目录时复用已有目录，不产生「Pack 2」', async () => {
    sourceFile('a.png')
    const noop = (): boolean => true

    await importFolderTree({ root: projectRoot, sourceDir, parentFolderId: null, importFile: noop })
    const second = await importFolderTree({
      root: projectRoot,
      sourceDir,
      parentFolderId: null,
      importFile: noop
    })

    const folders = folderRepository.list(projectRoot)
    expect(folderPaths(folders)).toEqual(['Pack'])
    expect(second.folderId).toBe(folders[0].id)
    expect(second.folderName).toBe('Pack')
  })

  it('落到指定资产目录下（拖到目录行上的场景）', async () => {
    const target = {
      id: 'target',
      name: 'Advert',
      parentId: null,
      createdAt: 't0',
      updatedAt: 't0'
    }
    folderRepository.create(projectRoot, target)
    sourceFile('a.png')
    let capturedFolderId = ''
    await importFolderTree({
      root: projectRoot,
      sourceDir,
      parentFolderId: target.id,
      importFile: (_abs, folderId) => {
        capturedFolderId = folderId
        return true
      }
    })

    const folders = folderRepository.list(projectRoot)
    expect(folderPaths(folders)).toEqual(['Advert', 'Advert/Pack'])
    expect(capturedFolderId).toBe(folders.find((f) => f.name === 'Pack')?.id)
  })

  it('没有可导入文件时不建任何目录，并如实汇报统计', async () => {
    sourceFile('notes.pdf')
    sourceFile('pack.aipackage')

    const summary = await importFolderTree({
      root: projectRoot,
      sourceDir,
      parentFolderId: null,
      importFile: () => true
    })

    expect(folderRepository.list(projectRoot)).toEqual([])
    expect(summary).toMatchObject({
      importedCount: 0,
      unsupportedCount: 1,
      packageCount: 1,
      folderId: null
    })
  })

  it('落点目录不存在时整体抛错（由调用方记成一条跳过，不静默丢）', async () => {
    sourceFile('a.png')

    await expect(
      importFolderTree({
        root: projectRoot,
        sourceDir,
        parentFolderId: 'missing-folder',
        importFile: () => true
      })
    ).rejects.toThrow()
  })

  it('导入失败的文件计入回调返回值，而不是算进 importedCount', async () => {
    sourceFile('a.png')
    sourceFile('b.png')

    const summary = await importFolderTree({
      root: projectRoot,
      sourceDir,
      parentFolderId: null,
      importFile: (absolutePath) => baseName(absolutePath) === 'a.png'
    })

    expect(summary.importedCount).toBe(1)
  })
})
