import { describe, expect, it } from 'vitest'
import {
  assertSafePackagePathname,
  buildAssetPathname,
  folderPathname,
  uniquifyPathnames
} from '../src/shared/assetPackage/pathname'
import type { AssetFolder, AssetInfo } from '../src/shared/domain'

const folders: AssetFolder[] = [
  {
    id: 'f1',
    name: 'Characters',
    parentId: null,
    createdAt: 't',
    updatedAt: 't'
  },
  {
    id: 'f2',
    name: 'Heroes',
    parentId: 'f1',
    createdAt: 't',
    updatedAt: 't'
  }
]

describe('assetPackage pathname', () => {
  it('builds folder and asset pathnames', () => {
    expect(folderPathname(folders, null)).toBe('Assets')
    expect(folderPathname(folders, 'f2')).toBe('Assets/Characters/Heroes')
    const asset: AssetInfo = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      type: 'image',
      name: 'Hero',
      relativePath: 'Assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png',
      folderId: 'f2',
      version: 1,
      createdAt: 't',
      updatedAt: 't'
    }
    expect(buildAssetPathname(folders, asset)).toBe('Assets/Characters/Heroes/Hero.png')
  })

  it('rejects unsafe pathnames', () => {
    expect(() => assertSafePackagePathname('../Assets/x')).toThrow()
    expect(() => assertSafePackagePathname('Assets/a/../b')).toThrow()
  })

  it('uniquifies colliding pathnames', () => {
    const map = uniquifyPathnames([
      { guid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pathname: 'Assets/A.png' },
      { guid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', pathname: 'Assets/A.png' }
    ])
    expect(map.get('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBe('Assets/A.png')
    expect(map.get('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).toBe('Assets/A~bbbbbbbb.png')
  })
})
