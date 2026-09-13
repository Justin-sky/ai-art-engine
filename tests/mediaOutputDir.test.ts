import { describe, expect, it } from 'vitest'
import {
  buildGeneratedMediaFileKey,
  isUnderAssetLibraryDir,
  isUnderCacheOutputDir,
  normalizeProjectRelativeDir,
  resolveMediaOutputDir,
  shouldRegisterOutputInAssetLibrary
} from '../src/shared/domain'

describe('resolveMediaOutputDir (cache redesign)', () => {
  it('defaults to Cache/{Kind} without explicit path', () => {
    expect(resolveMediaOutputDir({ kind: 'image' })).toBe('Cache/Images')
    expect(resolveMediaOutputDir({ kind: 'video' })).toBe('Cache/Videos')
    expect(resolveMediaOutputDir({ kind: 'text' })).toBe('Cache/Texts')
    expect(resolveMediaOutputDir({ kind: 'voice' })).toBe('Cache/Voices')
    expect(resolveMediaOutputDir({ kind: 'model' })).toBe('Cache/Models')
  })

  it('uses project cacheOutputDir root when set', () => {
    expect(resolveMediaOutputDir({ kind: 'image', cacheOutputDir: 'Temp/Cache' })).toBe(
      'Temp/Cache/Images'
    )
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
    const shouldRegister = isUnderAssetLibraryDir(outDir) && !isUnderCacheOutputDir(outDir)
    expect(shouldRegister).toBe(false)
  })

  it('still allows Assets library registration', () => {
    const outDir = 'Assets/Hero/Images'
    expect(isUnderAssetLibraryDir(outDir)).toBe(true)
    expect(isUnderCacheOutputDir(outDir)).toBe(false)
    expect(isUnderAssetLibraryDir(outDir) && !isUnderCacheOutputDir(outDir)).toBe(true)
  })

  it('respects custom cache root', () => {
    expect(isUnderCacheOutputDir('Work/Out/Videos', 'Work/Out')).toBe(true)
    expect(isUnderCacheOutputDir('Cache/Videos', 'Work/Out')).toBe(false)
  })
})

describe('normalizeProjectRelativeDir', () => {
  it('统一斜杠并去掉前导 / 与 ./（绝对式写法按工程相对目录处理）', () => {
    expect(normalizeProjectRelativeDir('/Assets/UIKits/Home')).toBe('Assets/UIKits/Home')
    expect(normalizeProjectRelativeDir('\\Assets\\UIKits\\Home\\')).toBe('Assets/UIKits/Home')
    expect(normalizeProjectRelativeDir('./Assets/UIKits/Home')).toBe('Assets/UIKits/Home')
    expect(normalizeProjectRelativeDir('  Assets/UIKits/Home  ')).toBe('Assets/UIKits/Home')
    expect(normalizeProjectRelativeDir('Assets/2D/Spine/x')).toBe('Assets/2D/Spine/x')
    expect(normalizeProjectRelativeDir('/')).toBe('')
    expect(normalizeProjectRelativeDir('')).toBe('')
  })

  it('保留 .. 段（越界交给 assertInsideProject 拦）', () => {
    expect(normalizeProjectRelativeDir('../Assets')).toBe('../Assets')
  })
})

describe('shouldRegisterOutputInAssetLibrary', () => {
  it('前导斜杠 / 反斜杠的资产库目录同样入库', () => {
    // 回归：`/Assets/UIKits/x` 会被 join 解析成 <root>/Assets/UIKits/x 真的写进资产库，
    // 但旧判定（startsWith('Assets/')）判否，落盘文件拿不到 .asset.json、素材库看不到
    expect(shouldRegisterOutputInAssetLibrary('/Assets/UIKits/x')).toBe(true)
    expect(shouldRegisterOutputInAssetLibrary('\\Assets\\UIKits\\x')).toBe(true)
    expect(shouldRegisterOutputInAssetLibrary('Assets/2D/Spine/skeleton')).toBe(true)
    expect(shouldRegisterOutputInAssetLibrary('Assets/UIKits/Home/')).toBe(true)
  })

  it('缓存根与库外目录不入库', () => {
    expect(shouldRegisterOutputInAssetLibrary('Cache/Images')).toBe(false)
    expect(shouldRegisterOutputInAssetLibrary('/Cache/Images')).toBe(false)
    expect(shouldRegisterOutputInAssetLibrary('Assets/Cache/Images', 'Assets/Cache')).toBe(false)
    expect(shouldRegisterOutputInAssetLibrary('Output/Images')).toBe(false)
    expect(shouldRegisterOutputInAssetLibrary('')).toBe(false)
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
