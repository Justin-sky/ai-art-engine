import { describe, expect, it } from 'vitest'
import { stageSceneWithUpstreamSources } from '../src/shared/graph/stage2d'
import type { Stage2dSceneState } from '../src/shared/gameAssets/stage2dScene'

function makeScene(
  layers: Array<Partial<{ sourceUrl: string; name: string; visible: boolean }>> = []
): Stage2dSceneState {
  return {
    canvasWidth: 512,
    canvasHeight: 512,
    anchor: 'ground',
    groundRatio: 0.08,
    layers: layers.map((l, index) => ({
      id: `layer-${index}`,
      name: l.name ?? `Layer ${index + 1}`,
      sourceUrl: l.sourceUrl ?? '',
      align: {
        anchor: 'ground',
        contentHeightRatio: 0.9,
        groundRatio: 0.08,
        fitWithinWidth: true
      },
      visible: l.visible ?? true
    }))
  }
}

describe('stageSceneWithUpstreamSources（stage.2d 上游自动成层）', () => {
  it('无上游时原样返回（既有层保留，不改动）', () => {
    const scene = makeScene([{ sourceUrl: 'assets/sprite/a.png' }])
    const next = stageSceneWithUpstreamSources(scene, [])
    expect(next.layers).toHaveLength(1)
    expect(next.layers[0].id).toBe('layer-0')
    expect(next.layers[0].sourceUrl).toBe('assets/sprite/a.png')
  })

  it('上游精灵按序成层：默认继承舞台 ground 语义与内容占比', () => {
    const scene = makeScene()
    const next = stageSceneWithUpstreamSources(scene, [
      { sourceUrl: 'assets/sprite/leg.png', name: '腿' },
      { sourceUrl: 'assets/sprite/body.png', name: '身体' }
    ])
    expect(next.layers.map((l) => l.sourceUrl)).toEqual([
      'assets/sprite/leg.png',
      'assets/sprite/body.png'
    ])
    expect(next.layers.map((l) => l.name)).toEqual(['腿', '身体'])
    // 层序即 z 序：后置精灵覆盖前置
    expect(next.layers[1].id).toBe('layer-1')
    for (const layer of next.layers) {
      expect(layer.align.anchor).toBe('ground')
      expect(layer.align.groundRatio).toBeCloseTo(0.08)
      expect(layer.align.contentHeightRatio).toBeCloseTo(0.9)
      expect(layer.visible).toBe(true)
    }
  })

  it('重跑同批上游：复用既有同序层 id 与对齐，不抖动', () => {
    const scene = makeScene()
    const first = stageSceneWithUpstreamSources(scene, [
      { sourceUrl: 'assets/sprite/a.png', name: 'a' },
      { sourceUrl: 'assets/sprite/b.png', name: 'b' }
    ])
    first.layers[0].align.anchor = 'center'
    first.layers[0].align.contentHeightRatio = 0.5
    const second = stageSceneWithUpstreamSources(first, [
      { sourceUrl: 'assets/sprite/a.png', name: 'a' },
      { sourceUrl: 'assets/sprite/b2.png', name: 'b2' }
    ])
    expect(second.layers[0].id).toBe(first.layers[0].id)
    expect(second.layers[0].align.anchor).toBe('center')
    expect(second.layers[0].align.contentHeightRatio).toBeCloseTo(0.5)
    // 源与名随上游刷新
    expect(second.layers[1].sourceUrl).toBe('assets/sprite/b2.png')
    expect(second.layers[1].name).toBe('b2')
  })

  it('上游比既有层少时移除多余旧层（上游即舞台内容）', () => {
    const scene = makeScene([
      { sourceUrl: 'assets/sprite/old-a.png' },
      { sourceUrl: 'assets/sprite/old-b.png' },
      { sourceUrl: 'assets/sprite/old-c.png' }
    ])
    const next = stageSceneWithUpstreamSources(scene, [{ sourceUrl: 'assets/sprite/new-a.png' }])
    expect(next.layers).toHaveLength(1)
    expect(next.layers[0].sourceUrl).toBe('assets/sprite/new-a.png')
  })

  it('空像素源的上游不占层位（保留其槽位语义）', () => {
    const scene = makeScene()
    const next = stageSceneWithUpstreamSources(scene, [
      { sourceUrl: 'assets/sprite/first.png', name: '一' },
      { sourceUrl: '', name: '空' },
      { sourceUrl: 'assets/sprite/third.png', name: '三' }
    ])
    expect(next.layers.map((l) => l.name)).toEqual(['一', '三'])
    // 跳过的槽位不出层；非空源保持其自身位置语义（index 序）
    expect(next.layers[1].name).toBe('三')
  })

  it('输入为空源只留空白格（待 dock 补源）也视为合法场景', () => {
    const scene = makeScene()
    const next = stageSceneWithUpstreamSources(scene, [{ sourceUrl: '   ', name: '空白' }])
    expect(next.layers).toHaveLength(0)
  })
})
