import { describe, expect, it } from 'vitest'
import {
  buildPreviewPackageTree,
  buildProjectPackageTree,
  collectDescendantGuids,
  expandImportSelection,
  selectionToExportIds,
  toggleTreeSelection
} from '../src/shared/assetPackage/tree'
import type { AssetFolder, AssetInfo } from '../src/shared/domain'

const F1 = '11111111-1111-4111-8111-111111111111'
const F2 = '22222222-2222-4222-8222-222222222222'
const A1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const A2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const DEP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function folder(partial: Partial<AssetFolder> & Pick<AssetFolder, 'id' | 'name'>): AssetFolder {
  return {
    parentId: null,
    createdAt: '',
    updatedAt: '',
    ...partial
  }
}

function asset(partial: Partial<AssetInfo> & Pick<AssetInfo, 'id' | 'name'>): AssetInfo {
  return {
    type: 'image',
    relativePath: '',
    version: 1,
    createdAt: '',
    updatedAt: '',
    ...partial
  }
}

describe('assetPackage tree', () => {
  it('builds project tree and toggles folder with descendants', () => {
    const folders = [
      folder({ id: F1, name: 'Chars' }),
      folder({ id: F2, name: 'Sub', parentId: F1 })
    ]
    const assets = [
      asset({ id: A1, name: 'Hero', folderId: F1 }),
      asset({ id: A2, name: 'Pose', folderId: F2 })
    ]
    const rows = buildProjectPackageTree(folders, assets)
    expect(rows.map((r) => r.name)).toEqual(['Chars', 'Sub', 'Pose', 'Hero'])
    const selected = toggleTreeSelection(rows, new Set(), F1, true)
    expect(selected.has(F1)).toBe(true)
    expect(selected.has(F2)).toBe(true)
    expect(selected.has(A1)).toBe(true)
    expect(selected.has(A2)).toBe(true)
    const ids = selectionToExportIds(rows, selected)
    expect(ids.folderIds.sort()).toEqual([F1, F2].sort())
    expect(ids.assetIds.sort()).toEqual([A1, A2].sort())
  })

  it('expands import selection with ancestors and deps', () => {
    const entries = [
      {
        guid: F1,
        kind: 'folder' as const,
        pathname: 'Assets/Chars',
        name: 'Chars',
        parentGuid: null,
        role: 'structural' as const
      },
      {
        guid: A1,
        kind: 'asset' as const,
        pathname: 'Assets/Chars/Hero.png',
        name: 'Hero',
        parentGuid: F1,
        assetType: 'image' as const,
        role: 'selected' as const,
        dependencies: [DEP]
      },
      {
        guid: DEP,
        kind: 'asset' as const,
        pathname: 'Assets/Dep.png',
        name: 'Dep',
        parentGuid: null,
        assetType: 'image' as const,
        role: 'dependency' as const,
        dependencies: []
      }
    ]
    const next = expandImportSelection(entries, new Set([A1]), true)
    expect(next.has(A1)).toBe(true)
    expect(next.has(F1)).toBe(true)
    expect(next.has(DEP)).toBe(true)
  })

  it('collectDescendantGuids stops at sibling branch', () => {
    const rows = buildProjectPackageTree(
      [folder({ id: F1, name: 'A' }), folder({ id: F2, name: 'B' })],
      [asset({ id: A1, name: 'x', folderId: F1 }), asset({ id: A2, name: 'y', folderId: F2 })]
    )
    expect(collectDescendantGuids(rows, F1).sort()).toEqual([A1].sort())
  })

  it('shows orphan assets at root when parent folder missing from package', () => {
    const missingParent = '99999999-9999-4999-8999-999999999999'
    const rows = buildPreviewPackageTree([
      {
        guid: A1,
        kind: 'asset',
        pathname: 'Assets/Orphan.png',
        name: 'Orphan',
        parentGuid: missingParent,
        assetType: 'image',
        role: 'selected'
      }
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].guid).toBe(A1)
    expect(rows[0].depth).toBe(0)
    expect(rows[0].parentGuid).toBe(null)
  })
})
