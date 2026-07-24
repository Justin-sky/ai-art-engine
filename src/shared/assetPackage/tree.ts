/**
 * 资产包 / 工程库勾选树（Unity Export/Import Package 式）。
 */

import type { AssetFolder, AssetInfo, AssetType } from '../domain'
import { compareNames, normalizeFolders } from '../folderTree'
import type {
  AssetPackageEntryKind,
  AssetPackageEntryRole,
  AssetPackagePreviewEntry
} from './types'

export interface AssetPackageTreeRow {
  guid: string
  kind: AssetPackageEntryKind
  name: string
  depth: number
  parentGuid: string | null
  assetType?: AssetType
  role?: AssetPackageEntryRole
  /** 是否有子节点（文件夹） */
  hasChildren: boolean
}

function childrenFolders(
  folders: AssetFolder[],
  parentId: string | null
): AssetFolder[] {
  return folders
    .filter((f) => (f.parentId ?? null) === parentId)
    .sort((a, b) => compareNames(a.name, b.name))
}

function childrenAssets(assets: AssetInfo[], folderId: string | null): AssetInfo[] {
  return assets
    .filter((a) => (a.folderId ?? null) === folderId)
    .sort((a, b) => compareNames(a.name, b.name))
}

/** 从工程资产库构建可勾选扁平树 */
export function buildProjectPackageTree(
  folders: readonly AssetFolder[],
  assets: readonly AssetInfo[]
): AssetPackageTreeRow[] {
  const normalized = normalizeFolders([...folders])
  const rows: AssetPackageTreeRow[] = []

  const walk = (parentId: string | null, depth: number): void => {
    for (const folder of childrenFolders(normalized, parentId)) {
      const kids = childrenFolders(normalized, folder.id)
      const hasAssetKids = assets.some((a) => (a.folderId ?? null) === folder.id)
      rows.push({
        guid: folder.id,
        kind: 'folder',
        name: folder.name,
        depth,
        parentGuid: parentId,
        hasChildren: kids.length > 0 || hasAssetKids
      })
      walk(folder.id, depth + 1)
    }
    for (const asset of childrenAssets([...assets], parentId)) {
      rows.push({
        guid: asset.id,
        kind: 'asset',
        name: asset.name,
        depth,
        parentGuid: parentId,
        assetType: asset.type,
        hasChildren: false
      })
    }
  }

  walk(null, 0)
  return rows
}

/** 从包预览条目构建可勾选扁平树（按 pathname 深度排序后挂到 parentGuid） */
export function buildPreviewPackageTree(
  entries: readonly AssetPackagePreviewEntry[]
): AssetPackageTreeRow[] {
  const folders = entries.filter((e) => e.kind === 'folder')
  const assets = entries.filter((e) => e.kind === 'asset')
  const folderById = new Map(folders.map((f) => [f.guid, f]))

  const rows: AssetPackageTreeRow[] = []

  const walk = (parentId: string | null, depth: number): void => {
    const childFolders = folders
      .filter((f) => (f.parentGuid ?? null) === parentId)
      .sort((a, b) => compareNames(a.name, b.name))
    for (const folder of childFolders) {
      const hasChildFolder = folders.some((f) => (f.parentGuid ?? null) === folder.guid)
      const hasChildAsset = assets.some((a) => (a.parentGuid ?? null) === folder.guid)
      rows.push({
        guid: folder.guid,
        kind: 'folder',
        name: folder.name,
        depth,
        parentGuid: parentId,
        role: folder.role,
        hasChildren: hasChildFolder || hasChildAsset
      })
      walk(folder.guid, depth + 1)
    }
    const childAssets = assets
      .filter((a) => {
        const parent = a.parentGuid ?? null
        if (parent === parentId) return true
        // 孤儿：父文件夹不在包内时挂到根
        return parentId === null && parent != null && !folderById.has(parent)
      })
      .sort((a, b) => compareNames(a.name, b.name))
    for (const asset of childAssets) {
      rows.push({
        guid: asset.guid,
        kind: 'asset',
        name: asset.name,
        depth,
        parentGuid: parentId,
        assetType: asset.assetType,
        role: asset.role,
        hasChildren: false
      })
    }
  }

  walk(null, 0)

  // 挂到缺失父级的资产：补到根（避免丢项）
  const listed = new Set(rows.map((r) => r.guid))
  for (const asset of assets) {
    if (listed.has(asset.guid)) continue
    rows.push({
      guid: asset.guid,
      kind: 'asset',
      name: asset.name,
      depth: 0,
      parentGuid: null,
      assetType: asset.assetType,
      role: asset.role,
      hasChildren: false
    })
  }
  for (const folder of folders) {
    if (listed.has(folder.guid)) continue
    rows.push({
      guid: folder.guid,
      kind: 'folder',
      name: folder.name,
      depth: 0,
      parentGuid: null,
      role: folder.role,
      hasChildren: false
    })
  }

  return rows
}

/** 某节点在扁平树中的全部子孙 guid */
export function collectDescendantGuids(
  rows: readonly AssetPackageTreeRow[],
  rootGuid: string
): string[] {
  const index = rows.findIndex((r) => r.guid === rootGuid)
  if (index < 0) return []
  const rootDepth = rows[index].depth
  const out: string[] = []
  for (let i = index + 1; i < rows.length; i++) {
    if (rows[i].depth <= rootDepth) break
    out.push(rows[i].guid)
  }
  return out
}

/** 勾选文件夹时联动子孙；返回新的选中集合 */
export function toggleTreeSelection(
  rows: readonly AssetPackageTreeRow[],
  selected: ReadonlySet<string>,
  guid: string,
  checked: boolean
): Set<string> {
  const next = new Set(selected)
  const row = rows.find((r) => r.guid === guid)
  if (!row) return next
  const affected = [guid, ...collectDescendantGuids(rows, guid)]
  if (checked) {
    for (const id of affected) next.add(id)
  } else {
    for (const id of affected) next.delete(id)
  }
  return next
}

/**
 * 从勾选集合拆出 assetIds / folderIds。
 * 仅勾选「空文件夹」时仍导出该文件夹结构。
 */
export function selectionToExportIds(
  rows: readonly AssetPackageTreeRow[],
  selected: ReadonlySet<string>
): { assetIds: string[]; folderIds: string[] } {
  const assetIds: string[] = []
  const folderIds: string[] = []
  for (const row of rows) {
    if (!selected.has(row.guid)) continue
    if (row.kind === 'asset') assetIds.push(row.guid)
    else folderIds.push(row.guid)
  }
  return { assetIds, folderIds }
}

/**
 * 导入时：用户勾选项 + 所选资产的祖先文件夹（保证路径）。
 * includePackageDeps：把包内 dependencies 且存在于 entries 的 guid 一并加入。
 */
export function expandImportSelection(
  entries: readonly AssetPackagePreviewEntry[],
  selected: ReadonlySet<string>,
  includePackageDeps: boolean
): Set<string> {
  const byGuid = new Map(entries.map((e) => [e.guid, e]))
  const next = new Set<string>()

  for (const guid of selected) {
    if (byGuid.has(guid)) next.add(guid)
  }

  if (includePackageDeps) {
    let changed = true
    while (changed) {
      changed = false
      for (const guid of [...next]) {
        const entry = byGuid.get(guid)
        if (!entry?.dependencies) continue
        for (const dep of entry.dependencies) {
          if (byGuid.has(dep) && !next.has(dep)) {
            next.add(dep)
            changed = true
          }
        }
      }
    }
  }

  // 祖先文件夹
  for (const guid of [...next]) {
    let parent = byGuid.get(guid)?.parentGuid ?? null
    while (parent) {
      next.add(parent)
      parent = byGuid.get(parent)?.parentGuid ?? null
    }
  }

  return next
}
