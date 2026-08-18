import { describe, expect, it } from 'vitest'
import {
  buildGeneratedMediaFileKey,
  isUnderAssetLibraryDir,
  isUnderCacheOutputDir,
  resolveMediaOutputDir
} from '../src/shared/domain'

describe('resolveMediaOutputDir (cache redesign)', () => {
  it('defaults to Cache/{Kind} without explicit path', () => {
    expect(resolveMediaOutputDir({ kind: 'image' })).toBe('Cache/Images')
    expect(resolveMediaOutputDir({ kind: 'video' })).toBe('Cache/Videos')
    expect(resolveMediaOutputDir({ kind: 'text' })).toBe('Cache/Texts')
    expect(resolveMediaOutputDir({ kind: 'voice' })).toBe('Cache/Voices')
  })

  it('uses project cacheOutputDir root when set', () => {
    expect(
      resolveMediaOutputDir({ kind: 'image', cacheOutputDir: 'Temp/Cache' })
    ).toBe('Temp/Cache/Images')
  })

  it('keeps explicit mediaOutputDir', () => {
    expect(
      resolveMediaOutputDir({
        kind: 'image',
        mediaOutputDir: 'Assets/Hero/Images'
      })
    ).toBe('Assets/Hero/Images')
  })
})

describe('cache registration gates', () => {
  it('treats Cache paths as non-library', () => {
    expect(isUnderCacheOutputDir('Cache/Images')).toBe(true)
    expect(isUnderAssetLibraryDir('Cache/Images')).toBe(false)
    // saveGraphRunMedia registers only when under Assets && !under Cache
    const outDir = 'Cache/Images'
    const shouldRegister =
      isUnderAssetLibraryDir(outDir) && !isUnderCacheOutputDir(outDir)
    expect(shouldRegister).toBe(false)
  })

  it('still allows Assets library registration', () => {
    const outDir = 'Assets/Hero/Images'
    expect(isUnderAssetLibraryDir(outDir)).toBe(true)
    expect(isUnderCacheOutputDir(outDir)).toBe(false)
    expect(isUnderAssetLibraryDir(outDir) && !isUnderCacheOutputDir(outDir)).toBe(
      true
    )
  })

  it('respects custom cache root', () => {
    expect(isUnderCacheOutputDir('Work/Out/Videos', 'Work/Out')).toBe(true)
    expect(isUnderCacheOutputDir('Cache/Videos', 'Work/Out')).toBe(false)
  })
})

describe('buildGeneratedMediaFileKey', () => {
  it('builds asset_node_stamp[+index]', () => {
    expect(
      buildGeneratedMediaFileKey({
        hostAssetName: '角色 A',
        nodeTitle: '生图',
        stamp: '20260728-120000000'
      })
    ).toBe('角色 A_生图_20260728-120000000')

    expect(
      buildGeneratedMediaFileKey({
        hostAssetName: 'Hero',
        nodeTitle: 'gen',
        stamp: '20260728-120000000',
        index: 2
      })
    ).toBe('Hero_gen_20260728-120000000_2')
  })

  it('sanitizes illegal path characters', () => {
    expect(
      buildGeneratedMediaFileKey({
        hostAssetName: 'a/b:c',
        nodeTitle: 'n*x',
        stamp: 't'
      })
    ).toBe('a_b_c_n_x_t')
  })
})
