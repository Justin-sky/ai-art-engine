import { describe, expect, it } from 'vitest'
import {
  createStage2dLayer,
  normalizeStage2dScene,
  stage2dGroundY,
  computeStage2dLayerPlacements,
  type Stage2dSceneState
} from '../src/shared/gameAssets'

const sourceA = { srcWidth: 300, srcHeight: 400, bounds: { x: 10, y: 20, width: 200, height: 300 } }
const sourceB = { srcWidth: 500, srcHeight: 500, bounds: { x: 0, y: 0, width: 500, height: 500 } }

function makeScene(overrides?: Partial<Stage2dSceneState>): Stage2dSceneState {
  return normalizeStage2dScene({
    canvasWidth: 512,
    canvasHeight: 512,
    anchor: 'ground',
    groundRatio: 0.06,
    ...overrides
  })
}

describe('normalizeStage2dScene：场景归一化', () => {
  it('缺省字段回落默认画布 / ground 语义', () => {
    const s = normalizeStage2dScene({})
    expect(s.canvasWidth).toBe(1024)
    expect(s.canvasHeight).toBe(1024)
    expect(s.anchor).toBe('ground')
    expect(s.groundRatio).toBe(0.06)
    expect(s.layers).toEqual([])
  })

  it('越界画布夹取到合法范围，非整数取整', () => {
    const s = normalizeStage2dScene({ canvasWidth: 0, canvasHeight: 99999, groundRatio: 2 })
    expect(s.canvasWidth).toBe(16)
    expect(s.canvasHeight).toBe(8192)
    expect(s.groundRatio).toBe(0.5)
  })

  it('逐层归一化：剔除无源层、补齐 id/name/visible、夹取对齐参数', () => {
    const s = normalizeStage2dScene({
      canvasWidth: 256,
      canvasHeight: 256,
      anchor: 'center',
      layers: [
        { id: 'a', name: 'A', sourceUrl: 'sprites/a.png', align: { contentHeightRatio: 3, groundRatio: -1 } },
        { sourceUrl: '', name: 'empty' },
        { id: 'c', sourceUrl: 'sprites/c.png', visible: false }
      ]
    })
    expect(s.layers.length).toBe(2)
    expect(s.layers[0]).toMatchObject({ id: 'a', name: 'A', visible: true })
    expect(s.layers[0]!.align).toMatchObject({ anchor: 'ground', contentHeightRatio: 1, groundRatio: 0 })
    expect(s.layers[1]).toMatchObject({ visible: false })
    expect(typeof s.layers[1]!.id).toBe('string')
    expect(typeof s.layers[1]!.name).toBe('string')
  })
})

describe('stage2dGroundY / createStage2dLayer', () => {
  it('ground 基线 = 画布高减地面比例', () => {
    expect(stage2dGroundY(makeScene({ canvasHeight: 400, groundRatio: 0.06 }))).toBe(376)
  })

  it('center 语义下 ground 基线返回 -1', () => {
    expect(stage2dGroundY(makeScene({ anchor: 'center' }))).toBe(-1)
  })

  it('createStage2dLayer 生成唯一 id 与继承默认对齐', () => {
    const a = createStage2dLayer({ sourceUrl: 'sprites/a.png', name: '腿' })
    const b = createStage2dLayer({ sourceUrl: 'sprites/b.png' })
    expect(a.id).not.toBe(b.id)
    expect(a.name).toBe('腿')
    expect(a.sourceUrl).toBe('sprites/a.png')
    expect(a.visible).toBe(true)
    expect(a.align).toMatchObject({ anchor: 'ground', fitWithinWidth: true })
  })
})

describe('computeStage2dLayerPlacements：逐层锚点落位', () => {
  it('ground 层各自落到同一地面基线（脚底不漂移）', () => {
    const scene = makeScene({ canvasHeight: 400, groundRatio: 0.1 })
    const placements = computeStage2dLayerPlacements(scene, [sourceA, sourceB])
    expect(placements.length).toBe(0) // 场景无层 → 无放置

    const layered = makeScene({
      canvasHeight: 400,
      groundRatio: 0.1,
      layers: [
        { id: 'a', name: 'A', sourceUrl: 'sprites/a.png', align: { anchor: 'ground', contentHeightRatio: 0.8, groundRatio: 0.1, fitWithinWidth: true }, visible: true },
        { id: 'b', name: 'B', sourceUrl: 'sprites/b.png', align: { anchor: 'ground', contentHeightRatio: 0.8, groundRatio: 0.1, fitWithinWidth: true }, visible: true }
      ]
    })
    const p = computeStage2dLayerPlacements(layered, [sourceA, sourceB])
    const groundY = 400 - Math.round(0.1 * 400) // 360
    for (const item of p) {
      expect(item.plan).not.toBeNull()
      expect(item.plan!.groundY).toBe(groundY)
      expect(item.plan!.dstY + item.plan!.dstH).toBe(groundY)
    }
    // 主体框高占 0.8*400=320 → 源高 300 的 A 缩放 320/300，源高 500 的 B 缩放 320/500
    expect(p[0]!.plan!.scale).toBeCloseTo(320 / 300, 5)
    expect(p[1]!.plan!.scale).toBeCloseTo(320 / 500, 5)
  })

  it('center 层主体中心对齐画布中心', () => {
    const scene = makeScene({
      canvasHeight: 500,
      anchor: 'center',
      layers: [
        { id: 'a', name: 'A', sourceUrl: 'sprites/a.png', align: { anchor: 'center', contentHeightRatio: 0.5, groundRatio: 0.06, fitWithinWidth: true }, visible: true }
      ]
    })
    const p = computeStage2dLayerPlacements(scene, [sourceA])
    expect(p[0]!.plan).not.toBeNull()
    const plan = p[0]!.plan!
    expect(plan.anchor).toBe('center')
    // dst 中心应在画布中心 250 / 256（dstW 为奇数时允许 ±0.5 取整差）
    expect(Math.abs(plan.dstY + plan.dstH / 2 - 250)).toBeLessThanOrEqual(1)
    expect(Math.abs(plan.dstX + plan.dstW / 2 - 256)).toBeLessThanOrEqual(1)
  })

  it('空 bounds 的源返回 plan=null（不崩溃）', () => {
    const scene = makeScene({
      layers: [
        { id: 'a', name: 'A', sourceUrl: 'sprites/a.png', align: { anchor: 'ground', contentHeightRatio: 0.8, groundRatio: 0.06, fitWithinWidth: true }, visible: true }
      ]
    })
    const p = computeStage2dLayerPlacements(scene, [{ srcWidth: 100, srcHeight: 100, bounds: null }])
    expect(p.length).toBe(1)
    expect(p[0]!.plan).toBeNull()
    expect(p[0]!.bounds).toBeNull()
  })
})
