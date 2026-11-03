import { describe, expect, it } from 'vitest'
import {
  computeLayerSplitExplode2dLayout,
  type ImageLayerSplitLayer,
  type ImageLayerSplitState,
  type LayerSplitExplode2dItem
} from '../src/shared/graph'

function overlaps(a: LayerSplitExplode2dItem, b: LayerSplitExplode2dItem, pad = 0): boolean {
  return (
    a.left < b.left + b.width + pad &&
    a.left + a.width + pad > b.left &&
    a.top < b.top + b.height + pad &&
    a.top + a.height + pad > b.top
  )
}

function buildSampleSplitState(): Pick<
  ImageLayerSplitState,
  'canvasWidth' | 'canvasHeight' | 'layers' | 'groups'
> {
  const layers: ImageLayerSplitLayer[] = [
    {
      id: 'base',
      imageId: 'base',
      zIndex: 0,
      name: 'Base',
      description: '',
      visible: true,
      left: 0,
      top: 0,
      width: 1920,
      height: 1080,
      role: 'canvas-base'
    },
    {
      id: 'panel',
      imageId: 'panel',
      zIndex: 1,
      name: 'Dialog Panel',
      description: '',
      visible: true,
      left: 460,
      top: 190,
      width: 1000,
      height: 700,
      role: 'layer',
      groupId: 'grp-panel'
    },
    {
      id: 'slot-1',
      imageId: 'slot-1',
      zIndex: 2,
      name: 'Reward Slot 1',
      description: '',
      visible: true,
      left: 620,
      top: 380,
      width: 180,
      height: 180,
      role: 'layer',
      groupId: 'grp-panel'
    },
    {
      id: 'portrait-1',
      imageId: 'portrait-1',
      zIndex: 3,
      name: 'Portrait 1',
      description: '',
      visible: true,
      left: 636,
      top: 396,
      width: 148,
      height: 148,
      role: 'layer',
      groupId: 'grp-panel'
    },
    {
      id: 'badge-dot',
      imageId: 'badge-dot',
      zIndex: 4,
      name: 'Red Dot',
      description: '',
      visible: true,
      left: 786,
      top: 370,
      width: 16,
      height: 16,
      role: 'layer',
      groupId: 'grp-panel'
    },
    {
      id: 'btn-claim',
      imageId: 'btn-claim',
      zIndex: 5,
      name: 'Claim Button',
      description: '',
      visible: true,
      left: 810,
      top: 720,
      width: 300,
      height: 84,
      role: 'layer',
      groupId: 'grp-panel'
    },
    {
      id: 'lbl-claim',
      imageId: 'lbl-claim',
      zIndex: 6,
      name: 'Claim Text',
      description: '',
      visible: true,
      left: 900,
      top: 744,
      width: 120,
      height: 36,
      role: 'layer',
      groupId: 'grp-panel'
    },
    {
      id: 'hidden-fx',
      imageId: 'hidden-fx',
      zIndex: 7,
      name: 'Hidden FX',
      description: '',
      visible: false,
      left: 500,
      top: 300,
      width: 200,
      height: 200,
      role: 'layer'
    },
    {
      id: 'hidden-grp-child',
      imageId: 'hidden-grp-child',
      zIndex: 8,
      name: 'Hidden Group Child',
      description: '',
      visible: true,
      left: 100,
      top: 100,
      width: 80,
      height: 80,
      role: 'layer',
      groupId: 'grp-hidden'
    }
  ]

  return {
    canvasWidth: 1920,
    canvasHeight: 1080,
    layers,
    groups: [
      {
        id: 'grp-panel',
        name: 'Dialog Panel',
        collapsed: false,
        visible: true,
        sourceLayerId: 'panel'
      },
      {
        id: 'grp-hidden',
        name: 'Hidden Group',
        collapsed: false,
        visible: false
      }
    ]
  }
}

describe('layerSplitExplode2d', () => {
  it('arranges base and visible foreground chunks in a zero-overlap 2D tiled plane', () => {
    const state = buildSampleSplitState()
    const layout = computeLayerSplitExplode2dLayout(state, {
      mode: 'tiled',
      gap: 24,
      targetAspect: 1.5
    })

    // 隐藏图层与隐藏分组内图层不参与排布
    expect(layout.items.map((i) => i.id)).toEqual([
      'base',
      'panel',
      'slot-1',
      'portrait-1',
      'badge-dot',
      'btn-claim',
      'lbl-claim'
    ])

    // 所有图块严格落在画板边界内，且任意两块之间零重叠
    for (let i = 0; i < layout.items.length; i++) {
      const a = layout.items[i]!
      expect(a.left).toBeGreaterThanOrEqual(0)
      expect(a.top).toBeGreaterThanOrEqual(0)
      expect(a.left + a.width).toBeLessThanOrEqual(layout.boardWidth)
      expect(a.top + a.height).toBeLessThanOrEqual(layout.boardHeight)
      for (let j = i + 1; j < layout.items.length; j++) {
        const b = layout.items[j]!
        expect(overlaps(a, b, 6)).toBe(false)
      }
    }

    // 微小 16x16 角标被赋予可读最小卡片尺寸，同时保留真实像素尺寸供标签显示
    const dot = layout.byId['badge-dot']!
    expect(dot.naturalWidth).toBe(16)
    expect(dot.naturalHeight).toBe(16)
    expect(dot.width).toBeGreaterThanOrEqual(56)
    expect(dot.height).toBeGreaterThanOrEqual(40)

    // 增大间距档位会使画板总面积单调增加
    const wider = computeLayerSplitExplode2dLayout(state, {
      mode: 'tiled',
      gap: 64,
      targetAspect: 1.5
    })
    expect(wider.boardWidth * wider.boardHeight).toBeGreaterThan(
      layout.boardWidth * layout.boardHeight
    )
  })

  it('radially explodes stacked overlapping UI widgets without foreground collisions and preserves origin anchors', () => {
    const state = buildSampleSplitState()
    const layout = computeLayerSplitExplode2dLayout(state, {
      mode: 'radial',
      gap: 28
    })

    const fg = layout.items.filter((i) => !i.isBase)
    expect(fg.length).toBe(6)

    // 底板锚定在 originFrame，所有前景块互不重叠且严格位于画板内
    const base = layout.byId['base']!
    expect(base.left).toBe(layout.originFrame.left)
    expect(base.top).toBe(layout.originFrame.top)

    for (let i = 0; i < fg.length; i++) {
      const a = fg[i]!
      expect(a.left).toBeGreaterThanOrEqual(0)
      expect(a.top).toBeGreaterThanOrEqual(0)
      expect(a.left + a.width).toBeLessThanOrEqual(layout.boardWidth)
      expect(a.top + a.height).toBeLessThanOrEqual(layout.boardHeight)
      for (let j = i + 1; j < fg.length; j++) {
        expect(overlaps(a, fg[j]!, 4)).toBe(false)
      }
    }

    // 原本叠在按钮正上方的文字与按钮已被平面推开，且各自记录了非零引导线位移
    const btn = layout.byId['btn-claim']!
    const lbl = layout.byId['lbl-claim']!
    expect(overlaps(btn, lbl)).toBe(false)
    expect(
      Math.hypot(lbl.explodedCenterX - lbl.originCenterX, lbl.explodedCenterY - lbl.originCenterY)
    ).toBeGreaterThan(10)
  })
})
