import { describe, expect, it } from 'vitest'
import {
  buildEngineSpriteSheetJson,
  buildSpriteManifest,
  SPRITE_MANIFEST_VERSION
} from '../src/shared/gameAssets'

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

describe('buildEngineSpriteSheetJson：通用引擎 Sprite Sheet Atlas JSON', () => {
  it('产出兼容 TexturePacker / Aseprite 的 frames、duration、pivot、frameTags 与 hurtbox slice', () => {
    const atlas = buildEngineSpriteSheetJson({
      imageFileName: 'hero-run.png',
      frameWidth: 128,
      frameHeight: 128,
      frameNames: ['run-0', 'run-1', 'run-2', 'run-3'],
      fps: 10,
      anchor: 'ground',
      playMode: 'pingpong',
      tagName: 'run'
    })
    expect(atlas.meta.image).toBe('hero-run.png')
    expect(atlas.meta.size).toEqual({ w: 512, h: 128 })
    expect(atlas.meta.frameTags).toEqual([{ name: 'run', from: 0, to: 3, direction: 'pingpong' }])
    expect(atlas.frames['run-2']).toMatchObject({
      frame: { x: 256, y: 0, w: 128, h: 128 },
      duration: 100,
      pivot: { x: 0.5, y: 1 }
    })
    expect(atlas.meta.slices[0]?.name).toBe('hurtbox')
  })

  it('支持多行换行网格（columns 参数）正确计算 row/col 像素坐标与图集总尺寸', () => {
    const atlas = buildEngineSpriteSheetJson({
      imageFileName: 'hero-12f.png',
      frameWidth: 64,
      frameHeight: 64,
      frameNames: Array.from({ length: 10 }, (_, i) => `f-${i}`),
      columns: 8,
      fps: 12
    })
    expect(atlas.meta.size).toEqual({ w: 512, h: 128 })
    expect(atlas.frames['f-7']?.frame).toEqual({ x: 448, y: 0, w: 64, h: 64 })
    expect(atlas.frames['f-8']?.frame).toEqual({ x: 0, y: 64, w: 64, h: 64 })
    expect(atlas.frames['f-9']?.frame).toEqual({ x: 64, y: 64, w: 64, h: 64 })
  })

  it('支持逐帧停留倍率 frameHolds，导出不等长帧 duration（Hit-Stop 打击感顿帧）', () => {
    const atlas = buildEngineSpriteSheetJson({
      imageFileName: 'hero-slash.png',
      frameWidth: 64,
      frameHeight: 64,
      frameNames: ['s-0', 's-1', 's-2', 's-3'],
      fps: 10,
      frameHolds: [1.5, 0.5, 2.5, 1]
    })
    expect(atlas.frames['s-0']?.duration).toBe(150)
    expect(atlas.frames['s-1']?.duration).toBe(50)
    expect(atlas.frames['s-2']?.duration).toBe(250)
    expect(atlas.frames['s-3']?.duration).toBe(100)
  })

  it('支持导出配套 2D 法线贴图 normalMap 与逐帧 hurtbox + hitbox 攻防双判定框切片', () => {
    const atlas = buildEngineSpriteSheetJson({
      imageFileName: 'hero-slash.png',
      normalMapFileName: 'hero-slash.normal.png',
      frameWidth: 64,
      frameHeight: 64,
      frameNames: ['s-0', 's-1'],
      fps: 12,
      frameCombatBoxes: [
        { hurtbox: { x: 20, y: 12, width: 16, height: 44 }, hitbox: null },
        {
          hurtbox: { x: 20, y: 12, width: 16, height: 44 },
          hitbox: { x: 36, y: 24, width: 22, height: 10 }
        }
      ]
    })
    expect(atlas.meta.normalMap).toBe('hero-slash.normal.png')
    const hurtSlice = atlas.meta.slices.find((s) => s.name === 'hurtbox')!
    const hitSlice = atlas.meta.slices.find((s) => s.name === 'hitbox')!
    expect(hurtSlice.keys.length).toBe(2)
    expect(hitSlice.keys.length).toBe(1)
    expect(hitSlice.keys[0]).toMatchObject({
      frame: 1,
      bounds: { x: 36, y: 24, w: 22, h: 10 }
    })
  })
})
