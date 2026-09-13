import { describe, expect, it } from 'vitest'
import { buildSpriteManifest, SPRITE_MANIFEST_VERSION } from '../src/shared/gameAssets'

describe('buildSpriteManifest：对齐产物清单构建', () => {
  it('基础字段与条目保序、保留逐条锚点', () => {
    const m = buildSpriteManifest({
      exportId: 'hero',
      createdAt: '2026-01-01T00:00:00.000Z',
      canvasWidth: 512,
      canvasHeight: 512,
      anchor: 'ground',
      sprites: [
        {
          name: 'idle-0',
          fileName: 'idle-0.png',
          width: 512,
          height: 512,
          anchorX: 256,
          anchorY: 480
        },
        {
          name: 'idle-1',
          fileName: 'idle-1.png',
          width: 512,
          height: 512,
          anchorX: 256,
          anchorY: 480
        }
      ]
    })
    expect(m.version).toBe(SPRITE_MANIFEST_VERSION)
    expect(m.kind).toBe('sprite-batch')
    expect(m.exportId).toBe('hero')
    expect(m.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(m.anchor).toBe('ground')
    expect(m.sprites.map((s) => s.name)).toEqual(['idle-0', 'idle-1'])
    expect(m.sprites[0]).toMatchObject({ anchorX: 256, anchorY: 480 })
  })

  it('缺省 exportId / createdAt 自动补齐', () => {
    const m = buildSpriteManifest({
      canvasWidth: 128,
      canvasHeight: 128,
      anchor: 'center',
      sprites: [{ name: 'a', fileName: 'a.png', width: 128, height: 128 }]
    })
    expect(m.exportId.length).toBeGreaterThan(0)
    expect(typeof m.createdAt).toBe('string')
  })

  it('省略逐条锚点：按锚点语义取默认并夹取到图片内', () => {
    const ground = buildSpriteManifest({
      canvasWidth: 100,
      canvasHeight: 100,
      anchor: 'ground',
      sprites: [{ name: 'g', fileName: 'g.png', width: 100, height: 100 }]
    }).sprites[0]!
    expect(ground.anchor).toBe('ground')
    expect(ground.anchorX).toBe(50)
    expect(ground.anchorY).toBe(100) // 底边中点

    const center = buildSpriteManifest({
      canvasWidth: 100,
      canvasHeight: 200,
      anchor: 'center',
      sprites: [{ name: 'c', fileName: 'c.png', width: 80, height: 60 }]
    }).sprites[0]!
    expect(center.anchor).toBe('center')
    expect(center.anchorX).toBe(40) // 图片中心 X
    expect(center.anchorY).toBe(30) // 图片中心 Y
  })

  it('空名 / 越界锚点条目被剔除或夹取', () => {
    const m = buildSpriteManifest({
      canvasWidth: 64,
      canvasHeight: 64,
      anchor: 'center',
      sprites: [
        { name: '', fileName: 'x.png', width: 64, height: 64 },
        { name: 'big', fileName: 'big.png', width: 64, height: 64, anchorX: -5, anchorY: 999 },
        { name: 'ok', fileName: 'ok.png', width: 10, height: 10 }
      ]
    })
    expect(m.sprites.map((s) => s.name)).toEqual(['big', 'ok'])
    expect(m.sprites[0]).toMatchObject({ anchorX: 0, anchorY: 64 })
  })
})
