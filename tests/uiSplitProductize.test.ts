import { describe, expect, it } from 'vitest'
import {
  asciiSlug,
  bleedTransparentRgb,
  buildUiExportNames,
  createImage,
  type PreciseSplitResult
} from '../src/shared/graph/uiPreciseSplit'
import { mapPreciseResultToLayers } from '../src/shared/graph/execute/layerSplitPrecise'
import {
  buildLayerSplitUiManifest,
  normalizeImageLayerSplit
} from '../src/shared/graph/imageLayerSplit'

describe('uiPreciseSplit v2 · P4 productized output', () => {
  it('alpha bleed colourises transparent pixels next to the shape without touching alpha or opaque pixels', () => {
    const w = 10
    const h = 10
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let y = 3; y < 7; y++)
      for (let x = 3; x < 7; x++) {
        const i = (y * w + x) * 4
        rgba[i] = 200
        rgba[i + 1] = 40
        rgba[i + 2] = 20
        rgba[i + 3] = 255
      }
    const before = new Uint8ClampedArray(rgba)
    const n = bleedTransparentRgb(rgba, w, h, 2)
    expect(n).toBeGreaterThan(0)
    // 紧邻像素：RGB = 形状颜色，alpha 仍为 0
    const i = (5 * w + 2) * 4
    expect([rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]).toEqual([200, 40, 20, 0])
    // 不透明像素不变
    const j = (4 * w + 4) * 4
    expect(Array.from(rgba.slice(j, j + 4))).toEqual(Array.from(before.slice(j, j + 4)))
    // 超出半径的像素不动
    expect(rgba[(0 * w + 0) * 4 + 3]).toBe(0)
  })

  it('builds unique engine-safe export names with game UI prefixes', () => {
    expect(asciiSlug('Confirm Button', 'Btn')).toBe('Confirm')
    expect(asciiSlug('确认按钮', 'Btn')).toBe('')
    const names = buildUiExportNames([
      { id: 'a', kind: 'button', name: 'Confirm Button' },
      { id: 'b', kind: 'button', name: 'Confirm Button' },
      { id: 'c', kind: 'item-slot', name: '奖励槽位' },
      { id: 'd', kind: 'item-slot', name: '奖励槽位' },
      { id: 'e', kind: 'text', name: '数量', text: 'x5' },
      { id: 'f', kind: 'close-button', name: 'X' }
    ])
    expect(names.get('a')).toBe('Btn_Confirm_01')
    expect(names.get('b')).toBe('Btn_Confirm_02')
    expect(names.get('c')).toBe('Slot_01')
    expect(names.get('d')).toBe('Slot_02')
    expect(names.get('e')).toBe('Txt_X5_01')
    expect(names.get('f')).toBe('BtnClose_X_01')
    for (const v of names.values()) expect(v).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/)
  })

  it('maps precise results with nine-slice borders, export names, prefab keys and QA issues that survive normalisation and reach the manifest', async () => {
    // 64×40 面板：2px 亮边 + 平坦中部（可九宫格拉伸）
    const pw = 64
    const ph = 40
    const panel = new Uint8ClampedArray(pw * ph * 4)
    for (let y = 0; y < ph; y++)
      for (let x = 0; x < pw; x++) {
        const edge = x < 8 || y < 8 || x >= pw - 8 || y >= ph - 8
        const i = (y * pw + x) * 4
        panel[i] = edge ? 180 + ((x * 7 + y * 3) % 50) : 40
        panel[i + 1] = edge ? 150 : 60
        panel[i + 2] = edge ? 90 : 120
        panel[i + 3] = 255
      }
    const slot = new Uint8ClampedArray(20 * 20 * 4).fill(200)
    const result: PreciseSplitResult = {
      canvasWidth: 200,
      canvasHeight: 100,
      base: createImage(200, 100),
      layers: [
        {
          id: 'p',
          elementId: 'p',
          name: 'Reward Panel',
          kind: 'panel',
          parentElementId: null,
          paintIndex: 1,
          left: 10,
          top: 10,
          width: pw,
          height: ph,
          rgba: panel
        },
        ...[0, 1].map((i) => ({
          id: `s${i}`,
          elementId: `s${i}`,
          name: '奖励槽位',
          kind: 'item-slot' as const,
          parentElementId: 'p',
          paintIndex: 2 + i,
          left: 14 + i * 24,
          top: 20,
          width: 20,
          height: 20,
          rgba: new Uint8ClampedArray(slot),
          prefabKey: 'prefab_1'
        }))
      ],
      tree: { canvasWidth: 200, canvasHeight: 100, elements: [] },
      reconstructionError: 0,
      peelReport: [],
      qa: {
        layers: [
          {
            elementId: 's1',
            name: '奖励槽位',
            issues: ['edge_halo'],
            scores: {
              edgeHalo: 0.4,
              baseResidue: 0,
              occludedDup: 0,
              coverage: 1,
              occludedTexture: 1
            }
          }
        ],
        flagged: 1,
        passed: false
      },
      notes: []
    }
    const mapped = await mapPreciseResultToLayers(result, {
      idPrefix: 'n',
      encodePng: async () => 'data:image/png;base64,AAAA'
    })
    const panelLayer = mapped.layers.find((l) => l.name === 'Reward Panel')!
    expect(panelLayer.exportName).toBe('Panel_Reward_01')
    expect(panelLayer.nineSliceBorders).toBeTruthy()
    expect(panelLayer.nineSliceBorders!.every((v) => v >= 6 && v <= 20)).toBe(true)
    const slots = mapped.layers.filter((l) => l.name === '奖励槽位')
    expect(slots.map((l) => l.exportName)).toEqual(['Slot_01', 'Slot_02'])
    expect(slots.every((l) => l.prefabKey === 'prefab_1')).toBe(true)
    expect(slots[1]!.qaIssues).toEqual(['edge_halo'])

    const state = normalizeImageLayerSplit({
      canvasWidth: 200,
      canvasHeight: 100,
      layers: [...mapped.layers, { ...mapped.layers[1]!, id: 'bad', exportName: '非法 名字!' }],
      groups: mapped.groups
    })
    const s1 = state.layers.find((l) => l.exportName === 'Slot_02')!
    expect(s1.prefabKey).toBe('prefab_1')
    expect(s1.qaIssues).toEqual(['edge_halo'])
    expect(state.layers.find((l) => l.id === 'bad')!.exportName).toBeUndefined()

    const manifest = buildLayerSplitUiManifest(state)
    const m1 = manifest.layers.find((l) => l.exportName === 'Slot_02')!
    expect(m1.prefabKey).toBe('prefab_1')
    expect(m1.qaIssues).toEqual(['edge_halo'])
  })
})
