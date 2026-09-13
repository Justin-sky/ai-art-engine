import { describe, expect, it } from 'vitest'
import {
  MCP_ASSET_IMPORT_LIMIT,
  MCP_CREATABLE_ASSET_TYPES,
  assetImportActivityDetail,
  assetImportActivityTitle,
  isMcpCreatableAssetType,
  normalizeImportFilePaths,
  normalizeProjectRelativePath,
  normalizeStringList
} from '@shared/mcpAssetWrite'

describe('MCP 资产写入：类型白名单', () => {
  it('白名单覆盖常用数据 / 占位型资产', () => {
    for (const type of [
      'screenplay',
      'gameSystem',
      'world',
      'beat',
      'subgraph',
      'canvas',
      'image',
      'video',
      'voice',
      'motion2d'
    ]) {
      expect(isMcpCreatableAssetType(type)).toBe(true)
    }
  })

  it('排除需要专用编辑器写入的资产类型', () => {
    for (const type of ['motion', 'model', 'model3d']) {
      expect(isMcpCreatableAssetType(type)).toBe(false)
    }
  })

  it('拒绝空串与未知类型', () => {
    expect(isMcpCreatableAssetType('')).toBe(false)
    expect(isMcpCreatableAssetType('unknown')).toBe(false)
    expect(isMcpCreatableAssetType('IMAGE')).toBe(false)
  })

  it('白名单无重复项', () => {
    expect(new Set(MCP_CREATABLE_ASSET_TYPES).size).toBe(MCP_CREATABLE_ASSET_TYPES.length)
  })

  it('导入上限为正整数', () => {
    expect(Number.isInteger(MCP_ASSET_IMPORT_LIMIT)).toBe(true)
    expect(MCP_ASSET_IMPORT_LIMIT).toBeGreaterThan(0)
  })
})

describe('MCP 资产写入：导入路径归一化', () => {
  it('非数组入参返回空列表', () => {
    expect(normalizeImportFilePaths(undefined)).toEqual([])
    expect(normalizeImportFilePaths('C:/a.png')).toEqual([])
    expect(normalizeImportFilePaths({ 0: 'C:/a.png' })).toEqual([])
  })

  it('剔除空串与非字符串项', () => {
    expect(normalizeImportFilePaths(['', '   ', 42, null, 'C:/a.png'])).toEqual(['C:/a.png'])
  })

  it('裁剪首尾空白并保序去重', () => {
    expect(normalizeImportFilePaths([' C:/b.png ', 'C:/a.png', 'C:/b.png', ' C:/b.png'])).toEqual([
      'C:/b.png',
      'C:/a.png'
    ])
  })

  it('保留原始顺序', () => {
    expect(normalizeImportFilePaths(['C:/z.png', 'C:/a.png'])).toEqual(['C:/z.png', 'C:/a.png'])
  })
})

describe('MCP 资产写入：字符串数组归一化', () => {
  it('与导入路径同口径（去空、去重、保序）', () => {
    expect(normalizeStringList([' a ', '', 'b', 'a', 1, null])).toEqual(['a', 'b'])
  })

  it('非数组返回空列表', () => {
    expect(normalizeStringList(undefined)).toEqual([])
    expect(normalizeStringList('a')).toEqual([])
  })
})

describe('MCP 资产写入：工程内相对路径', () => {
  it('接受常规相对路径并统一正斜杠', () => {
    expect(normalizeProjectRelativePath('Assets/Generated/a.png')).toBe('Assets/Generated/a.png')
    expect(normalizeProjectRelativePath('Assets\\Generated\\a.png')).toBe('Assets/Generated/a.png')
    expect(normalizeProjectRelativePath('  Cache/Videos/a.mp4  ')).toBe('Cache/Videos/a.mp4')
  })

  it('拒绝绝对路径', () => {
    expect(normalizeProjectRelativePath('C:/art/a.png')).toBeNull()
    expect(normalizeProjectRelativePath('C:\\art\\a.png')).toBeNull()
    expect(normalizeProjectRelativePath('/home/user/a.png')).toBeNull()
  })

  it('拒绝 .. 越界', () => {
    expect(normalizeProjectRelativePath('../a.png')).toBeNull()
    expect(normalizeProjectRelativePath('Assets/../../a.png')).toBeNull()
  })

  it('拒绝空串', () => {
    expect(normalizeProjectRelativePath('   ')).toBeNull()
  })
})

describe('MCP 资产写入：导入活动文案', () => {
  it('标题带本次提交的路径数', () => {
    expect(assetImportActivityTitle(1)).toBe('导入 1 个素材')
    expect(assetImportActivityTitle(12)).toBe('导入 12 个素材')
  })

  it('单件补充说明取文件名（正反斜杠都认）', () => {
    expect(assetImportActivityDetail(['D:/art/a.svg'])).toBe('a.svg')
    expect(assetImportActivityDetail(['D:\\art\\icons\\b.png'])).toBe('b.png')
  })

  it('多件补充说明带首个文件名与总数', () => {
    expect(assetImportActivityDetail(['D:/art/a.svg', 'D:/art/b.svg'])).toBe('a.svg 等 2 个文件')
  })

  it('空列表回落到空串（不出现 undefined 副标题）', () => {
    expect(assetImportActivityDetail([])).toBe('')
  })
})
