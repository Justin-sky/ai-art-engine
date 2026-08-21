import { describe, expect, it } from 'vitest'
import {
  buildLayerSplitList,
  collectLayerSplitGroupLayers,
  isCanvasSafeImageSrc,
  isLayerSplitLayerDrawable,
  layerSplitFingerprint,
  nestLayerSplitResult,
  normalizedToRect,
  normalizeImageLayerSplit,
  placeLayersInParentRect,
  reorderLayerSplit,
  resetLayerSplitRect
} from '../src/shared/graph'
import { parseVolcengineArkImageLayers } from '../src/shared/modelProviders/volcengineArk/layerDecomposition'

describe('imageLayerSplit', () => {
  it('normalizes defaults', () => {
    expect(normalizeImageLayerSplit()).toMatchObject({
      prompt: '',
      resolution: '2K',
      selectedId: '',
      layers: [],
      groups: []
    })
  })

  it('keeps 1.5K / auto resolution', () => {
    expect(normalizeImageLayerSplit({ resolution: '1.5K' }).resolution).toBe('1.5K')
    expect(normalizeImageLayerSplit({ resolution: 'auto' }).resolution).toBe('auto')
  })

  it('converts normalized bbox with 0-1000 scale', () => {
    expect(normalizedToRect([187, 59, 808, 188], 2048, 2048)).toEqual({
      left: 383,
      top: 121,
      width: 1272,
      height: 264
    })
  })

  it('reorders element layers without moving the base', () => {
    const layers = normalizeImageLayerSplit({
      layers: [
        { id: 'base', imageId: 'base', zIndex: 0, name: 'Base', visible: true, left: 0, top: 0, width: 10, height: 10 },
        { id: 'a', imageId: 'a', zIndex: 1, name: 'A', visible: true, left: 0, top: 0, width: 10, height: 10 },
        { id: 'b', imageId: 'b', zIndex: 2, name: 'B', visible: true, left: 0, top: 0, width: 10, height: 10 }
      ]
    }).layers
    const up = reorderLayerSplit(layers, 'a', 'up')
    expect(up.find((l) => l.id === 'a')?.zIndex).toBe(2)
    expect(up.find((l) => l.id === 'b')?.zIndex).toBe(1)
    expect(reorderLayerSplit(layers, 'base', 'up').find((l) => l.id === 'base')?.zIndex).toBe(0)
  })

  it('resets a layer to original absolute box', () => {
    const layer = resetLayerSplitRect(
      {
        id: 'a',
        imageId: 'a',
        zIndex: 1,
        name: 'A',
        description: '',
        visible: true,
        left: 10,
        top: 10,
        width: 20,
        height: 20,
        originalAbsolute: [383, 120, 1655, 384]
      },
      2048,
      2048
    )
    expect(layer).toMatchObject({ left: 383, top: 120, width: 1272, height: 264 })
  })

  it('fingerprints source + prompt + resolution', () => {
    const a = layerSplitFingerprint('http://img/a.png', 'person', '2K')
    const b = layerSplitFingerprint('http://img/a.png', 'person', '2K')
    const c = layerSplitFingerprint('http://img/a.png', 'text', '2K')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('rejects remote https as canvas sources', () => {
    expect(isCanvasSafeImageSrc('https://tos.example/a.png')).toBe(false)
    expect(isCanvasSafeImageSrc('data:image/png;base64,aaa')).toBe(true)
    expect(isCanvasSafeImageSrc('studio-media://x')).toBe(true)
  })

  it('nests a selected layer into a group with mapped coordinates', () => {
    const parent = {
      id: 'person',
      imageId: 'person',
      zIndex: 2,
      name: 'Person',
      description: '',
      visible: true,
      left: 100,
      top: 50,
      width: 200,
      height: 100
    }
    const state = normalizeImageLayerSplit({
      canvasWidth: 1000,
      canvasHeight: 1000,
      layers: [
        { id: 'base', imageId: 'base', zIndex: 0, name: 'Base', visible: true, left: 0, top: 0, width: 1000, height: 1000 },
        { id: 'a', imageId: 'a', zIndex: 1, name: 'A', visible: true, left: 0, top: 0, width: 10, height: 10 },
        parent,
        { id: 'b', imageId: 'b', zIndex: 3, name: 'B', visible: true, left: 0, top: 0, width: 10, height: 10 }
      ]
    })
    const nested = placeLayersInParentRect(
      parent,
      [
        { id: 'p-base', imageId: 'p-base', zIndex: 0, name: 'Base', description: '', visible: true, left: 0, top: 0, width: 400, height: 200 },
        { id: 'hat', imageId: 'hat', zIndex: 1, name: 'Hat', description: '', visible: true, left: 40, top: 20, width: 80, height: 40 }
      ],
      { width: 400, height: 200 }
    )
    expect(nested[0]).toMatchObject({ left: 100, top: 50, width: 200, height: 100, role: 'layer' })
    expect(nested[1]).toMatchObject({ left: 120, top: 60, width: 40, height: 20 })

    const next = nestLayerSplitResult({
      state,
      parentId: 'person',
      nestedLayers: nested,
      groupName: 'Person 拆分',
      stamp: 1
    })
    expect(next.groups).toHaveLength(1)
    expect(next.groups[0]).toMatchObject({
      name: 'Person 拆分',
      sourceLayerId: 'person',
      visible: true
    })
    expect(next.layers.find((l) => l.id === 'person')).toMatchObject({
      visible: false,
      groupId: next.groups[0]!.id
    })
    expect(next.layers.find((l) => l.id === 'hat')).toMatchObject({
      groupId: next.groups[0]!.id,
      left: 120,
      top: 60
    })
    expect(next.layers.find((l) => l.id === 'b')?.zIndex).toBe(5)

    const rows = buildLayerSplitList(next)
    expect(rows.map((row) => (row.kind === 'group' ? `group:${row.group.name}` : `layer:${row.layer.id}`))).toEqual([
      'layer:b',
      'group:Person 拆分',
      'layer:hat',
      'layer:p-base',
      'layer:person',
      'layer:a',
      'layer:base'
    ])
    expect(isLayerSplitLayerDrawable(next, next.layers.find((l) => l.id === 'hat')!)).toBe(true)
    expect(collectLayerSplitGroupLayers(next, next.groups[0]!.id).map((l) => l.id)).toEqual([
      'person',
      'p-base',
      'hat'
    ])

    const hidden = {
      ...next,
      groups: next.groups.map((g) => ({ ...g, visible: false }))
    }
    expect(isLayerSplitLayerDrawable(hidden, hidden.layers.find((l) => l.id === 'hat')!)).toBe(false)
    expect(isLayerSplitLayerDrawable(hidden, hidden.layers.find((l) => l.id === 'base')!)).toBe(true)
  })

  it('allows z-index beyond a single API split', () => {
    const layer = normalizeImageLayerSplit({
      layers: [{ id: 'x', imageId: 'x', zIndex: 40, name: 'X', visible: true, left: 0, top: 0, width: 1, height: 1 }]
    }).layers[0]
    expect(layer?.zIndex).toBe(40)
  })
})

describe('parseVolcengineArkImageLayers', () => {
  it('maps official layer_decomposition fields', () => {
    const parsed = parseVolcengineArkImageLayers([
      { url: 'https://base.jpg', size: '2048x2048', output_format: 'jpeg', z_index: 0 },
      {
        url: 'https://title.png',
        size: '1273x265',
        output_format: 'png',
        z_index: 1,
        bounding_box: {
          absolute: [383, 120, 1655, 384],
          normalized: [187, 59, 808, 188]
        },
        name: 'Seedream title text',
        description: 'Large yellow Seedream title text in a serif font'
      }
    ])
    expect(parsed.images).toEqual(['https://base.jpg', 'https://title.png'])
    expect(parsed.layers[0]).toMatchObject({ zIndex: 0, url: 'https://base.jpg' })
    expect(parsed.layers[1]).toMatchObject({
      zIndex: 1,
      name: 'Seedream title text',
      boundingBox: {
        absolute: [383, 120, 1655, 384],
        normalized: [187, 59, 808, 188]
      }
    })
  })
})
