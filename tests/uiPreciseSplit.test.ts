import { describe, expect, it } from 'vitest'
import {
  buildLayoutTree,
  createImage,
  estimateShift,
  inpaintPushPull,
  parseLayoutResponse,
  refineElementBox,
  runPreciseUiSplit,
  type PreciseSplitIo,
  type RgbaImage
} from '../src/shared/graph/uiPreciseSplit'
import { mapPreciseResultToLayers } from '../src/shared/graph/execute/layerSplitPrecise'
import { prefersPreciseUiLayerSplit } from '../src/shared/graph/imageLayerSplit'
import { pickVisionGroundingProvider, visionGroundingScore } from '../src/shared/modelProvider'

const W = 200
const H = 120
const PANEL = { left: 30, top: 16, width: 140, height: 90 }
const BUTTON = { left: 60, top: 70, width: 80, height: 24 }
const TEXT = { left: 86, top: 76, width: 28, height: 12 }
const PANEL_RGB = [40, 60, 120]
const BUTTON_RGB = [230, 180, 40]

function inRect(
  x: number,
  y: number,
  r: { left: number; top: number; width: number; height: number }
): boolean {
  return x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height
}

/** 合成场景：渐变背景 + 面板 + 面板上的按钮 + 按钮上的白色文字笔画 */
function renderScene(
  opts: { panel?: boolean; button?: boolean; text?: boolean; shift?: number } = {}
): RgbaImage {
  const { panel = true, button = true, text = true, shift = 0 } = opts
  const img = createImage(W, H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = x - shift
      const sy = y - shift
      let rgb = [20 + Math.round((sx / W) * 60), 20, 30 + Math.round((sy / H) * 40)]
      if (panel && inRect(sx, sy, PANEL)) rgb = PANEL_RGB
      if (button && inRect(sx, sy, BUTTON)) rgb = BUTTON_RGB
      // 文字：两根竖笔画 + 一根横笔画
      if (
        text &&
        inRect(sx, sy, TEXT) &&
        (sx - TEXT.left < 4 ||
          TEXT.left + TEXT.width - sx <= 4 ||
          Math.abs(sy - (TEXT.top + 6)) <= 1)
      ) {
        rgb = [255, 255, 255]
      }
      const i = (y * W + x) * 4
      img.data[i] = rgb[0]!
      img.data[i + 1] = rgb[1]!
      img.data[i + 2] = rgb[2]!
      img.data[i + 3] = 255
    }
  }
  return img
}

function toBox2d(r: { left: number; top: number; width: number; height: number }): number[] {
  return [
    Math.round((r.top / H) * 1000),
    Math.round((r.left / W) * 1000),
    Math.round(((r.top + r.height) / H) * 1000),
    Math.round(((r.left + r.width) / W) * 1000)
  ]
}

const VLM_JSON = JSON.stringify({
  screenKind: 'popup',
  elements: [
    { id: 'e1', name: 'Panel', kind: 'panel', box_2d: toBox2d(PANEL), parent: null, order: 1 },
    // VLM 框故意偏大几像素，验证边缘吸附
    {
      id: 'e2',
      name: 'Buy Button',
      kind: 'button',
      box_2d: toBox2d({ left: 56, top: 67, width: 88, height: 30 }),
      parent: 'e1',
      order: 2
    },
    {
      id: 'e3',
      name: 'Label',
      kind: 'text',
      box_2d: toBox2d(TEXT),
      parent: 'e2',
      order: 3,
      ocr: ['T1'],
      text: 'OK'
    }
  ]
})

function mockIo(extra: Partial<PreciseSplitIo> = {}): PreciseSplitIo {
  return {
    vlm: async () => VLM_JSON,
    encodePng: async () => 'data:image/png;base64,AAAA',
    ocr: async () => [{ text: '0K', ...TEXT }],
    ...extra
  }
}

function pixel(img: { width: number; data: Uint8ClampedArray }, x: number, y: number): number[] {
  const i = (y * img.width + x) * 4
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!]
}

describe('uiPreciseSplit · layout parsing', () => {
  it('parses box_2d (0-1000), bbox (0-1) and kind aliases, dropping full-canvas backgrounds', () => {
    const raw = JSON.stringify({
      elements: [
        { id: 'bg', name: 'BG', kind: 'panel', box_2d: [0, 0, 1000, 1000] },
        { id: 'a', name: 'A', kind: 'btn', box_2d: [100, 200, 300, 400] },
        { id: 'b', name: 'B', type: 'label', bbox: [0.5, 0.5, 0.75, 0.6] }
      ]
    })
    const parsed = parseLayoutResponse('```json\n' + raw + '\n```', 1000, 500)
    expect(parsed.elements.map((e) => e.id)).toEqual(['a', 'b'])
    expect(parsed.elements[0]).toMatchObject({
      kind: 'button',
      box: { left: 200, top: 50, width: 200, height: 100 }
    })
    expect(parsed.elements[1]).toMatchObject({
      kind: 'text',
      box: { left: 500, top: 250, width: 250, height: 50 }
    })
  })

  it('fixes invalid parents geometrically and assigns occlusion levels', () => {
    const tree = buildLayoutTree({
      width: W,
      height: H,
      ocr: [{ text: 'OK', ...TEXT }],
      elements: [
        { id: 'p', name: 'P', kind: 'panel', box: PANEL, parentRef: null, order: 1, ocrRefs: [] },
        // 声明的父级不包含它 → 改挂到面板
        {
          id: 'b',
          name: 'B',
          kind: 'button',
          box: BUTTON,
          parentRef: 'ghost',
          order: 2,
          ocrRefs: []
        }
      ]
    })
    const byId = new Map(tree.elements.map((e) => [e.id, e]))
    expect(byId.get('b')!.parentId).toBe('p')
    expect(byId.get('p')!.level).toBe(1)
    expect(byId.get('b')!.level).toBe(2)
    // 未被认领的 OCR 文本自动补成普通文字，挂到最小的包含容器（按钮）
    const ocrText = tree.elements.find((e) => e.plainText)!
    expect(ocrText.text).toBe('OK')
    expect(ocrText.parentId).toBe('b')
    expect(ocrText.paintIndex!).toBeGreaterThan(byId.get('b')!.paintIndex!)
  })
})

describe('uiPreciseSplit · pixel ops', () => {
  it('snaps an oversized VLM box to the real element edge', () => {
    const img = renderScene({ text: false })
    const snapped = refineElementBox(img, { left: 56, top: 67, width: 88, height: 30 })
    expect(Math.abs(snapped.left - BUTTON.left)).toBeLessThanOrEqual(1)
    expect(Math.abs(snapped.top - BUTTON.top)).toBeLessThanOrEqual(1)
    expect(Math.abs(snapped.width - BUTTON.width)).toBeLessThanOrEqual(2)
    expect(Math.abs(snapped.height - BUTTON.height)).toBeLessThanOrEqual(2)
  })

  it('push-pull fills a hole inside a flat region with the surrounding color', () => {
    const img = renderScene({ button: false, text: false })
    const hole = new Uint8Array(W * H)
    for (let y = BUTTON.top; y < BUTTON.top + BUTTON.height; y++) {
      for (let x = BUTTON.left; x < BUTTON.left + BUTTON.width; x++) hole[y * W + x] = 1
    }
    const damaged = renderScene({ text: false })
    inpaintPushPull(damaged, hole)
    const c = pixel(damaged, 100, 82)
    expect(Math.abs(c[0]! - PANEL_RGB[0]!)).toBeLessThanOrEqual(3)
    expect(Math.abs(c[2]! - PANEL_RGB[2]!)).toBeLessThanOrEqual(3)
    expect(c[3]).toBe(255)
    // 洞外像素不动
    expect(pixel(damaged, 5, 5)).toEqual(pixel(img, 5, 5))
  })

  it('estimates the drift of a regenerated plate', () => {
    const ref = renderScene({ button: false, text: false })
    const moved = renderScene({ button: false, text: false, shift: 4 })
    const hole = new Uint8Array(W * H)
    const s = estimateShift(ref, moved, hole)
    expect(s.dx).toBe(4)
    expect(s.dy).toBe(4)
  })
})

describe('uiPreciseSplit · end-to-end', () => {
  it('splits panel / button / text into complete layers with local peeling', async () => {
    const source = renderScene()
    const result = await runPreciseUiSplit(mockIo(), source, {
      generativePeel: false,
      zoomRefine: false
    })
    const byName = new Map(result.layers.map((l) => [l.name, l]))
    expect([...byName.keys()]).toEqual(['Panel', 'Buy Button', 'Label'])

    const button = byName.get('Buy Button')!
    expect(Math.abs(button.left - BUTTON.left)).toBeLessThanOrEqual(1)
    expect(Math.abs(button.width - BUTTON.width)).toBeLessThanOrEqual(2)
    expect(button.parentElementId).toBe('e1')
    expect(button.uiControlType).toBe('button')
    // 按钮层不含文字：文字位置是按钮底色
    const bx = TEXT.left + 1 - button.left
    const by = TEXT.top + 1 - button.top
    const bp = pixel({ width: button.width, data: button.rgba }, bx, by)
    expect(Math.abs(bp[0]! - BUTTON_RGB[0]!)).toBeLessThanOrEqual(6)
    expect(bp[3]).toBe(255)

    // 面板层被按钮遮住的部分已补全为面板色
    const panel = byName.get('Panel')!
    const pp = pixel({ width: panel.width, data: panel.rgba }, 100 - panel.left, 82 - panel.top)
    expect(Math.abs(pp[2]! - PANEL_RGB[2]!)).toBeLessThanOrEqual(6)
    expect(pp[3]).toBe(255)

    // 文字层：VLM 纠正 OCR 误识，导出可编辑文字
    const label = byName.get('Label')!
    expect(label.editableText?.text).toBe('OK')
    expect(label.uiPartRole).toBe('button-label')

    // 底图：面板区域恢复为背景渐变（不再是面板蓝）
    const basePx = pixel(result.base, 100, 40)
    expect(basePx[2]!).toBeLessThan(PANEL_RGB[2]! - 30)

    expect(result.reconstructionError).toBeLessThan(1.5)
  })

  it('uses the generative plate (aligned) and keeps pixels outside the mask untouched', async () => {
    const source = renderScene()
    const calls: string[] = []
    const io = mockIo({
      editImage: async (req) => {
        calls.push(req.prompt)
        // 模拟模型：level 2 去掉按钮，level 1 去掉面板；输出带 3px 漂移
        const removeButton = req.prompt.includes('Buy Button')
        return renderScene({
          panel: !req.prompt.includes('Panel'),
          button: !removeButton,
          text: false,
          shift: 3
        })
      }
    })
    const result = await runPreciseUiSplit(io, source, { zoomRefine: false })
    expect(calls.length).toBe(2)
    expect(result.peelReport.filter((r) => r.method === 'generative').length).toBe(2)
    // 底图中心 = 背景渐变
    const px = pixel(result.base, 100, 40)
    const expected = pixel(renderScene({ panel: false, button: false, text: false }), 100, 40)
    for (let c = 0; c < 3; c++) expect(Math.abs(px[c]! - expected[c]!)).toBeLessThanOrEqual(4)
    // 蒙版外逐位不变
    expect(pixel(result.base, 2, 2)).toEqual(pixel(source, 2, 2))
    expect(result.reconstructionError).toBeLessThan(2)
  })

  it('throws a typed error when the VLM returns nothing usable', async () => {
    await expect(
      runPreciseUiSplit(mockIo({ vlm: async () => 'sorry' }), renderScene(), { zoomRefine: false })
    ).rejects.toMatchObject({ code: 'PRECISE_SPLIT_NO_ELEMENTS' })
  })
})

describe('uiPreciseSplit · executor mapping', () => {
  it('maps layers to a canvas base + nested element groups', async () => {
    const result = await runPreciseUiSplit(mockIo(), renderScene(), {
      generativePeel: false,
      zoomRefine: false
    })
    const mapped = await mapPreciseResultToLayers(result, {
      idPrefix: 'layerSplit:n1:1',
      encodePng: async (img) => `data:image/png;base64,${img.width}x${img.height}`
    })
    expect(mapped.layers[0]).toMatchObject({
      id: 'layerSplit:n1:1:base',
      role: 'canvas-base',
      zIndex: 0
    })
    expect(mapped.batch.map((b) => b.id)).toEqual(mapped.layers.map((l) => l.imageId))
    const byName = new Map(mapped.layers.map((l) => [l.name, l]))
    const panel = byName.get('Panel')!
    const button = byName.get('Buy Button')!
    const label = byName.get('Label')!
    // Panel 组 ⊃ Button 组 ⊃ Label；元素本体图层在自己的组内
    const panelGroup = mapped.groups.find((g) => g.sourceLayerId === panel.id)!
    const buttonGroup = mapped.groups.find((g) => g.sourceLayerId === button.id)!
    expect(panel.groupId).toBe(panelGroup.id)
    expect(button.groupId).toBe(buttonGroup.id)
    expect(buttonGroup.parentGroupId).toBe(panelGroup.id)
    expect(label.groupId).toBe(buttonGroup.id)
    expect(label.editableText?.text).toBe('OK')
    // 绘制顺序：面板 < 按钮 < 文字
    expect(panel.zIndex).toBeLessThan(button.zIndex)
    expect(button.zIndex).toBeLessThan(label.zIndex)
  })

  it('auto / precise prefer the precise pipeline, legacy modes do not', () => {
    expect(prefersPreciseUiLayerSplit('auto')).toBe(true)
    expect(prefersPreciseUiLayerSplit('precise')).toBe(true)
    expect(prefersPreciseUiLayerSplit(undefined)).toBe(true)
    expect(prefersPreciseUiLayerSplit('ai-inpaint-slice')).toBe(false)
    expect(prefersPreciseUiLayerSplit('local-slice')).toBe(false)
  })
})

describe('vision grounding routing', () => {
  const provider = (id: string, models: string[], enabled = true) =>
    ({
      id,
      enabled,
      apiKey: 'k',
      providerKind: 'openai-compatible',
      modalities: { text: { selectedModelIds: models, defaultModelId: models[0] ?? '' } }
    }) as unknown as Parameters<typeof pickVisionGroundingProvider>[0][number]

  it('scores Gemini Pro highest and excludes image / tts models', () => {
    expect(visionGroundingScore('gemini-2.5-pro')).toBeGreaterThan(visionGroundingScore('gpt-4.1'))
    expect(visionGroundingScore('gemini-2.5-flash-image')).toBe(0)
    expect(visionGroundingScore('deepseek-chat')).toBe(0)
  })

  it('picks the best enabled vision model across providers', () => {
    const picked = pickVisionGroundingProvider([
      provider('a', ['deepseek-chat', 'gpt-4.1']),
      provider('b', ['gemini-2.5-pro'], false),
      provider('c', ['gemini-2.5-flash'])
    ])
    expect(picked?.provider.id).toBe('c')
    expect(picked?.modelId).toBe('gemini-2.5-flash')
    expect(pickVisionGroundingProvider([provider('a', ['deepseek-chat'])])).toBeNull()
  })
})
