import type { AssetFolder } from './domain'
import { unityNaturalCompare } from './projectSort'

export const ASSETS_ROOT_TREE_KEY = '__assets_root__'

export interface FlatFolderRow {
  id: string
  name: string
  depth: number
  hasChildren: boolean
}

/** 目录名升序（Unity NaturalCompare）。 */
export function compareNames(a: string, b: string): number {
  return unityNaturalCompare(a, b)
}

/** Fix broken parentId links (empty, self, missing parent, name used as id). */
export function normalizeFolders(folders?: readonly AssetFolder[] | null): AssetFolder[] {
  const list = folders ? [...folders] : []
  const byId = new Map(list.map((f) => [f.id, f]))
  const byName = new Map(list.map((f) => [f.name, f]))

  return list.map((folder) => {
    let parentId = folder.parentId ?? null
    if (parentId === '' || parentId === folder.id) parentId = null

    if (parentId && !byId.has(parentId)) {
      parentId = byName.get(parentId)?.id ?? null
    }

    return parentId === folder.parentId ? folder : { ...folder, parentId }
  })
}

function childrenOf(folders: AssetFolder[], parentId: string | null): AssetFolder[] {
  return folders
    .filter((f) => {
      const pid = f.parentId ?? null
      return pid === parentId
    })
    .sort((a, b) => compareNames(a.name, b.name))
}

/** Full folder tree as flat rows (always includes all nested folders). */
export function buildFlatFolderTree(folders: AssetFolder[]): FlatFolderRow[] {
  const normalized = normalizeFolders(folders)
  const rows: FlatFolderRow[] = []

  const walk = (parentId: string | null, depth: number): void => {
    for (const folder of childrenOf(normalized, parentId)) {
      const kids = childrenOf(normalized, folder.id)
      rows.push({
        id: folder.id,
        name: folder.name,
        depth,
        hasChildren: kids.length > 0
      })
      if (kids.length > 0) walk(folder.id, depth + 1)
    }
  }

  walk(null, 0)
  return rows
}

/** Folder tree rows respecting expand/collapse (Unity Project window style). */
export function buildVisibleFlatFolderTree(
  folders: AssetFolder[],
  isExpanded: (folderId: string) => boolean,
  rootName = 'Assets'
): FlatFolderRow[] {
  const normalized = normalizeFolders(folders)
  const rootChildren = childrenOf(normalized, null)
  const rows: FlatFolderRow[] = [
    {
      id: ASSETS_ROOT_TREE_KEY,
      name: rootName,
      depth: 0,
      hasChildren: rootChildren.length > 0
    }
  ]

  const walk = (parentId: string | null, depth: number): void => {
    for (const folder of childrenOf(normalized, parentId)) {
      const kids = childrenOf(normalized, folder.id)
      rows.push({
        id: folder.id,
        name: folder.name,
        depth,
        hasChildren: kids.length > 0
      })
      if (kids.length > 0 && isExpanded(folder.id)) {
        walk(folder.id, depth + 1)
      }
    }
  }

  if (isExpanded(ASSETS_ROOT_TREE_KEY)) {
    walk(null, 1)
  }
  return rows
}

export function folderChildren(folders: AssetFolder[], parentId: string | null): AssetFolder[] {
  return childrenOf(normalizeFolders(folders), parentId)
}

/**
 * Collect folderId and all descendant folder ids.
 * Returned deepest-first so children can be removed before parents.
 */
export function collectFolderSubtreeIds(
  folders: AssetFolder[],
  folderId: string
): string[] {
  const normalized = normalizeFolders(folders)
  const byParent = new Map<string | null, AssetFolder[]>()
  for (const folder of normalized) {
    const parentId = folder.parentId ?? null
    const list = byParent.get(parentId)
    if (list) list.push(folder)
    else byParent.set(parentId, [folder])
  }

  const result: string[] = []
  const walk = (id: string): void => {
    for (const child of byParent.get(id) ?? []) {
      walk(child.id)
    }
    result.push(id)
  }
  walk(folderId)
  return result
}
