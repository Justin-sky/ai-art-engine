import { describe, expect, it } from 'vitest'
import {
  ASSETS_ROOT_TREE_KEY,
  buildFlatFolderTree,
  buildVisibleFlatFolderTree,
  collectFolderSubtreeIds
} from '@shared/folderTree'
import type { AssetFolder } from '@shared/domain'

const folders: AssetFolder[] = [
  { id: 'a', name: 'Addressables', parentId: null },
  { id: 'b', name: 'BundleA', parentId: null },
  { id: 'c', name: 'DebugData', parentId: null },
  { id: 'd', name: 'LuaScripts', parentId: 'a' },
  { id: 'e', name: 'OPS', parentId: null }
]

describe('buildVisibleFlatFolderTree', () => {
  it('always shows Assets root, then children when expanded', () => {
    const expanded = new Set([ASSETS_ROOT_TREE_KEY, 'a'])
    const rows = buildVisibleFlatFolderTree(folders, (id) => expanded.has(id))
    expect(rows.map((r) => r.name)).toEqual([
      'Assets',
      'Addressables',
      'LuaScripts',
      'BundleA',
      'DebugData',
      'OPS'
    ])
    expect(rows[0]?.id).toBe(ASSETS_ROOT_TREE_KEY)
    expect(rows[0]?.depth).toBe(0)
    expect(rows.find((r) => r.id === 'a')?.depth).toBe(1)
    expect(rows.find((r) => r.id === 'd')?.depth).toBe(2)
  })

  it('hides nested folders when parent is collapsed', () => {
    const expanded = new Set([ASSETS_ROOT_TREE_KEY])
    const rows = buildVisibleFlatFolderTree(folders, (id) => expanded.has(id))
    expect(rows.map((r) => r.name)).not.toContain('LuaScripts')
  })

  it('keeps only Assets root when root is collapsed', () => {
    const rows = buildVisibleFlatFolderTree(folders, () => false)
    expect(rows).toEqual([
      {
        id: ASSETS_ROOT_TREE_KEY,
        name: 'Assets',
        depth: 0,
        hasChildren: true
      }
    ])
  })

  it('marks leaf folders without children', () => {
    const rows = buildVisibleFlatFolderTree(folders, () => true)
    const debug = rows.find((r) => r.id === 'c')
    expect(debug?.hasChildren).toBe(false)
  })

  it('supports custom root label', () => {
    const rows = buildVisibleFlatFolderTree(folders, () => false, '资源')
    expect(rows[0]?.name).toBe('资源')
  })
})

describe('buildFlatFolderTree', () => {
  it('still returns full tree for folder pickers', () => {
    const rows = buildFlatFolderTree(folders)
    expect(rows).toHaveLength(5)
  })
})

describe('collectFolderSubtreeIds', () => {
  it('returns descendants deepest-first then the root id', () => {
    expect(collectFolderSubtreeIds(folders, 'a')).toEqual(['d', 'a'])
  })

  it('returns only itself for leaf folders', () => {
    expect(collectFolderSubtreeIds(folders, 'c')).toEqual(['c'])
  })
})
