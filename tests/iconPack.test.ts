import { describe, expect, it } from 'vitest'
import {
  applyColorDistanceKey,
  averageRegionColor,
  buildIconPackManifest,
  ICON_PACK_MANIFEST_VERSION,
  normalizedColorDistance,
  sanitizeIconStem
} from '../src/shared/gameAssets'
import {
  iconPackCellKeyAt,
  parseIconNameLines
} from '../src/shared/graph'

describe('iconPack 键控与采样', () => {
  it('色距：同色距离为 0，反色距离为 255', () => {
    expect(normalizedColorDistance(10, 10, 10, { r: 10, g: 10, b: 10 })).toBe(0)
    expect(normalizedColorDistance(0, 0, 0, { r: 255, g: 255, b: 255 })).toBeCloseTo(255, 1)
  })

  it('采样色键控：背景像素透明、图标像素保留', () => {
    const bg = { r: 240, g: 240, b: 240 }
    const rgba = new Uint8ClampedArray([240, 240, 240, 255, 10, 200, 60, 255])
    applyColorDistanceKey(rgba, bg, { distance: 40, feather: 10 })
    expect(rgba[3]).toBe(0)
    expect(rgba[7]).toBe(255)
  })

  it('区域平均色采样', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4)
    for (let i = 0; i < 4; i++) {
      data[i * 4] = 200
      data[i * 4 + 1] = 100
      data[i * 4 + 2] = 50
      data[i * 4 + 3] = 255
    }
    const color = averageRegionColor(data, 2, { x: 0, y: 0, width: 2, height: 2 })
    expect(color).not.toBeNull()
    expect(color!.r).toBe(200)
    expect(color!.g).toBe(100)
    expect(color!.b).toBe(50)
  })
})

describe('图标包 manifest 构建与名单解析', () => {
  it('按 cellKey 顺序构建图标清单、锚点为画布中心', () => {
    const m = buildIconPackManifest({
      packId: 'skill-icons',
      createdAt: '2026-01-01T00:00:00.000Z',
      canvasSize: 512,
      background: { r: 245, g: 245, b: 245 },
      rows: 3,
      cols: 3,
      icons: [
        { name: '火焰斩', fileName: '火焰斩.png', cellKey: '1-1' },
        { name: '治疗术', fileName: '治疗术.png', cellKey: '1-2' }
      ]
    })
    expect(m.version).toBe(ICON_PACK_MANIFEST_VERSION)
    expect(m.kind).toBe('icon-pack')
    expect(m.icons.map((i) => i.cellKey)).toEqual(['1-1', '1-2'])
    expect(m.icons[0]).toMatchObject({ anchorX: 256, anchorY: 256, width: 512, height: 512 })
  })

  it('文件名清理：危险字符转下划线、中文保留', () => {
    expect(sanitizeIconStem(' 火焰 斩/1 ')).toBe('火焰_斩_1')
    expect(sanitizeIconStem('a:b*c?d')).toBe('a_b_c_d')
    expect(sanitizeIconStem('')).toBe('icon')
  })

  it('名单行解析：每行一枚、忽略空行与注释行', () => {
    expect(parseIconNameLines('火焰斩\n\n# 说明\n冰霜护盾\n// 注释\n治疗术')).toEqual([
      '火焰斩',
      '冰霜护盾',
      '治疗术'
    ])
  })

  it('格位换算：名单顺序即整版表逐行格位', () => {
    expect(iconPackCellKeyAt(3, 3, 0)).toBe('1-1')
    expect(iconPackCellKeyAt(3, 3, 3)).toBe('2-1')
    expect(iconPackCellKeyAt(3, 3, 8)).toBe('3-3')
  })
})
