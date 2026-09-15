import { describe, expect, it } from 'vitest'
import {
  MCP_ASSET_IMPORT_LIMIT,
  MCP_CREATABLE_ASSET_TYPES,
  assetImportActivityDetail,
  assetImportActivityTitle,
  isMcpCreatableAssetType,
  isProjectInternalPath,
  normalizeImportFilePaths,
  normalizeProjectRelativePath,
  normalizeStringList,
  projectGeneratedOutputImportError
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

describe('MCP 资产写入：拒绝把工程内任意素材当素材导入', () => {
  const ROOT = 'C:/proj'

  it('缓存根、Output、Assets、Docs、Build 等工程内目录一律拦截', () => {
    expect(isProjectInternalPath('C:/proj/Cache/Images/a.png', ROOT)).toBe(true)
    expect(isProjectInternalPath('C:/proj/Cache/Videos/a.mp4', ROOT)).toBe(true)
    expect(isProjectInternalPath('C:/proj/Output/a.svg', ROOT)).toBe(true)
    expect(isProjectInternalPath('C:/proj/Assets/Advert/a.png', ROOT)).toBe(true)
    expect(isProjectInternalPath('C:/proj/Docs/a.png', ROOT)).toBe(true)
    expect(isProjectInternalPath('C:/proj/Build/a.png', ROOT)).toBe(true)
  })

  it('反斜杠 / 大小写 / 尾斜杠都归一化后判定', () => {
    expect(isProjectInternalPath('C:\\proj\\Cache\\Images\\a.png', ROOT)).toBe(true)
    expect(isProjectInternalPath('C:/PROJ/assets/advert/a.png', ROOT)).toBe(true)
    expect(isProjectInternalPath('C:/proj/Cache/Images/a.png', 'C:/proj/')).toBe(true)
  })

  it('相对路径按工程内路径判定（含 Assets/Cache/Output/Docs）', () => {
    expect(isProjectInternalPath('Cache/Images/a.png', ROOT)).toBe(true)
    expect(isProjectInternalPath('./Output/a.svg', ROOT)).toBe(true)
    expect(isProjectInternalPath('Assets/Advert/a.png', ROOT)).toBe(true)
    expect(isProjectInternalPath('Docs/a.txt', ROOT)).toBe(true)
  })

  it('工程外的本机素材放行（即便目录碰巧叫 Cache 或 Assets）', () => {
    expect(isProjectInternalPath('D:/downloads/Cache/a.png', ROOT)).toBe(false)
    expect(isProjectInternalPath('C:/other/Cache/a.png', ROOT)).toBe(false)
    expect(isProjectInternalPath('/home/user/Cache/a.png', ROOT)).toBe(false)
    expect(isProjectInternalPath('D:/photos/Assets/xxx.png', ROOT)).toBe(false)
  })

  it('工程根自身、空路径、空根都不算工程内文件', () => {
    expect(isProjectInternalPath(ROOT, ROOT)).toBe(false)
    expect(isProjectInternalPath('', ROOT)).toBe(false)
    expect(isProjectInternalPath('   ', ROOT)).toBe(false)
    expect(isProjectInternalPath('C:/proj/Cache/a.png', '')).toBe(false)
  })

  it('前缀相近的兄弟目录仍在工程内，照拦', () => {
    expect(isProjectInternalPath('C:/proj/Cache2/a.png', ROOT)).toBe(true)
    expect(isProjectInternalPath('C:/proj/Outputs/a.png', ROOT)).toBe(true)
  })
})

describe('MCP 资产写入：工程内素材拒绝文案', () => {
  it('列出被拒文件并区分两类工程内素材（生成产物 / 已入库）', () => {
    const message = projectGeneratedOutputImportError(['C:/proj/Cache/Images/a.png'])
    expect(message).toContain('C:/proj/Cache/Images/a.png')
    expect(message).toContain('保存到资产库')
    expect(message).toContain('Cache/')
    expect(message).toContain('Output/')
    expect(message).toContain('Assets/')
  })

  it('超过 5 个文件时折叠为总数', () => {
    const many = Array.from({ length: 7 }, (_, i) => `C:/proj/Cache/Images/${i}.png`)
    const message = projectGeneratedOutputImportError(many)
    expect(message).toContain('等 7 个文件')
    expect(message).not.toContain('C:/proj/Cache/Images/6.png')
  })
})
