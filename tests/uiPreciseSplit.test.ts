import { describe, expect, it } from 'vitest'
import {
  buildBinaryMaskRgba,
  buildLayoutTree,
  createImage,
  estimateShift,
  filterOcrFalsePositives,
  inpaintPushPull,
  packOcclusionAtlas,
  parseLayoutResponse,
  postProcessInstanceMask,
  refineElementBox,
  runPreciseUiSplit,
  scoreSamCandidateMask,
  textStrokeMask,
  unpackOcclusionAtlas,
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

function toBox2d(
  r: { left: number; top: number; width: number; height: number },
  w = W,
  h = H
): number[] {
  return [
    Math.round((r.top / h) * 1000),
    Math.round((r.left / w) * 1000),
    Math.round(((r.top + r.height) / h) * 1000),
    Math.round(((r.left + r.width) / w) * 1000)
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

describe('uiPreciseSplit · Zhihu scheme 5 enhancements', () => {
  it('filters out low-confidence single-character and symbol-only OCR false positives', () => {
    const filtered = filterOcrFalsePositives([
      { text: '!', left: 10, top: 10, width: 12, height: 12, confidence: 0.99 },
      { text: 'A', left: 20, top: 10, width: 12, height: 12, confidence: 0.72 },
      { text: 'X', left: 30, top: 10, width: 3, height: 12, confidence: 0.96 },
      { text: 'PLAY', left: 40, top: 10, width: 48, height: 16, confidence: 0.88 }
    ])
    expect(filtered.map((b) => b.text)).toEqual(['PLAY'])
  })

  it('scores SAM 2.1 candidate masks and cleans speckles via 3x3 closing + 8-CC filtering', () => {
    const bw = 40
    const bh = 20
    const box = { left: 10, top: 10, width: bw, height: bh }
    const goodMask = new Uint8Array(W * H)
    const leakyMask = new Uint8Array(W * H)
    for (let y = box.top + 2; y < box.top + bh - 2; y++) {
      for (let x = box.left + 2; x < box.left + bw - 2; x++) {
        goodMask[y * W + x] = 1
        leakyMask[y * W + x] = 1
      }
    }
    // Add competitor overlap to leakyMask
    for (let y = 10; y < 30; y++) {
      for (let x = 60; x < 80; x++) {
        leakyMask[y * W + x] = 1
      }
    }
    const pos = [{ x: 30, y: 20 }]
    const neg = [{ x: 70, y: 20 }]
    const goodScore = scoreSamCandidateMask({
      mask: goodMask,
      width: W,
      height: H,
      samScore: 0.85,
      promptBox: box,
      positivePoints: pos,
      negativePoints: neg
    })
    const leakyScore = scoreSamCandidateMask({
      mask: leakyMask,
      width: W,
      height: H,
      samScore: 0.88,
      promptBox: box,
      positivePoints: pos,
      negativePoints: neg
    })
    expect(goodScore.totalScore).toBeGreaterThan(leakyScore.totalScore)

    // Add an isolated 2px speckle and a 1px interior pinhole to goodMask
    goodMask[20 * W + 30] = 0 // 1px pinhole inside main component
    goodMask[5 * W + 5] = 1 // isolated tiny speckle outside
    const cleaned = postProcessInstanceMask(goodMask, W, H, pos)
    expect(cleaned[20 * W + 30]).toBe(1) // closed by 3x3 closing
    expect(cleaned[5 * W + 5]).toBe(0) // removed by 8-CC filter
  })

  it('supports dual-image VLM audit (raster_text_ids) and surface vs image repair routing', async () => {
    const source = renderScene()
    const vlmImageCounts: number[] = []
    let editCalls = 0
    const io = mockIo({
      vlm: async (req) => {
        vlmImageCounts.push(req.images.length)
        return JSON.stringify({
          screen_kind: 'popup',
          raster_text_ids: [0],
          background_repair: { mode: 'surface' },
          elements: [
            {
              id: 'panel',
              name: 'Panel',
              kind: 'panel',
              role: 'dialog-frame',
              box_2d: [130, 150, 885, 850],
              positive_points_norm: [[500, 500]],
              negative_points_norm: [[50, 50]],
              element_repair_mode: 'surface',
              z_hint: 1
            },
            {
              id: 'btn',
              name: 'Buy Button',
              kind: 'button',
              role: 'primary-cta',
              parent_id: 'panel',
              box_2d: [580, 300, 785, 700],
              positive_points_norm: [[680, 500]],
              negative_points_norm: [[300, 500]],
              element_repair_mode: 'none',
              z_hint: 2
            }
          ]
        })
      },
      editImage: async () => {
        editCalls++
        return source
      }
    })
    const result = await runPreciseUiSplit(io, source, { zoomRefine: false })
    // Dual-image input: original + initial OCR-cleaned preview
    expect(vlmImageCounts[0]).toBe(2)
    // Both panel and background_repair are marked 'surface', so generative editImage is skipped
    expect(editCalls).toBe(0)
    // OCR #0 is marked in raster_text_ids, so no separate editable text layer is emitted
    expect(result.layers.some((l) => l.editableText != null)).toBe(false)
    // And the button pixels at the text stroke remain intact (not erased from button)
    const byName = new Map(result.layers.map((l) => [l.name, l]))
    const button = byName.get('Buy Button')!
    const bx = TEXT.left + 1 - button.left
    const by = TEXT.top + 1 - button.top
    const bp = pixel({ width: button.width, data: button.rgba }, bx, by)
    expect(bp[0]).toBe(255)
    expect(bp[1]).toBe(255)
    expect(bp[2]).toBe(255)
  })

  it('packs and unpacks an occlusion atlas and builds binary mask RGBA', () => {
    const source = renderScene()
    const mask = new Uint8Array(W * H)
    for (let y = BUTTON.top; y < BUTTON.top + BUTTON.height; y++) {
      for (let x = BUTTON.left; x < BUTTON.left + BUTTON.width; x++) {
        mask[y * W + x] = 1
      }
    }
    const binRgba = buildBinaryMaskRgba(mask, W, H)
    expect(pixel(binRgba, BUTTON.left + 2, BUTTON.top + 2).slice(0, 3)).toEqual([255, 255, 255])
    expect(pixel(binRgba, 2, 2).slice(0, 3)).toEqual([0, 0, 0])

    const packed = packOcclusionAtlas({
      plate: source,
      holeMask: mask,
      targets: [{ id: 'btn', name: 'Buy Button', rect: BUTTON }]
    })
    expect(packed.cells.length).toBe(1)
    // Simulate inpainting model filling the masked hole in the atlas with PANEL_RGB
    const repairedAtlas = createImage(packed.atlas.width, packed.atlas.height)
    repairedAtlas.data.set(packed.atlas.data)
    for (let i = 0; i < packed.maskImage.data.length; i += 4) {
      if (packed.maskImage.data[i]! > 128) {
        repairedAtlas.data[i] = PANEL_RGB[0]!
        repairedAtlas.data[i + 1] = PANEL_RGB[1]!
        repairedAtlas.data[i + 2] = PANEL_RGB[2]!
        repairedAtlas.data[i + 3] = 255
      }
    }
    const unpacked = unpackOcclusionAtlas(source, repairedAtlas, packed, mask)
    expect(pixel(unpacked, BUTTON.left + 5, BUTTON.top + 5)).toEqual([...PANEL_RGB, 255])

    // Verify Otsu textStrokeMask quality gate on text vs uniform region
    const textMask = textStrokeMask(source, TEXT)
    expect(textMask.maskQuality).toBe('estimated_glyphs')
    const uniformMask = textStrokeMask(source, { left: 35, top: 20, width: 20, height: 14 })
    expect(uniformMask.maskQuality).toBe('coarse')
  })

  it('splits a game avatar slot into clean frame, portrait, pentagon corner badge, and outlined x5 text without border notches or hair bleed', async () => {
    const cw = 160
    const ch = 160
    const card = { left: 20, top: 20, width: 120, height: 120 }
    const img = createImage(cw, ch)
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        let rgb: [number, number, number] = [10, 35, 65] // outer dark blue
        if (inRect(x, y, card)) {
          const rx = x - card.left
          const ry = y - card.top
          if (rx < 2 || rx >= card.width - 2 || ry < 2 || ry >= card.height - 2) {
            rgb = [135, 140, 145] // 2px grey border
          } else if (ry >= card.height - 7) {
            rgb = [205, 100, 250] // bottom purple rarity bar
          } else {
            // Vertical black-to-purple slot gradient
            const t = ry / (card.height - 8)
            rgb = [Math.round(12 + 62 * t), Math.round(12 + 16 * t), Math.round(18 + 74 * t)]
            // Character portrait: blonde head/hair in upper-mid center + dark/yellow armor at bottom
            const headDist = Math.hypot(rx - 62, ry - 48)
            if (headDist <= 34) {
              rgb = [242, 198, 142] // blonde hair / skin
            } else if (ry >= 78 && rx >= 24 && rx <= 100) {
              rgb = rx >= 68 && rx <= 82 ? [240, 170, 24] : [28, 28, 36] // yellow strap + dark armor
            }
          }
          // Top-left purple pentagon badge (chamfered bottom-right corner)
          if (rx >= 2 && rx < 34 && ry >= 2 && ry < 34 && rx + ry < 56) {
            rgb = rx >= 10 && rx < 22 && ry >= 10 && ry < 22 ? [255, 255, 255] : [128, 0, 200]
          }
          // Bottom-right outlined "x5" text over shoulder armor + purple gradient
          if (rx >= 84 && rx < 110 && ry >= 88 && ry < 108) {
            const tx = rx - 84
            const ty = ry - 88
            const isCore =
              (tx >= 4 && tx <= 7 && ty >= 4 && ty <= 15) ||
              (tx >= 14 && tx <= 21 && (ty === 5 || ty === 10 || ty === 15))
            const isOutline =
              !isCore &&
              tx >= 2 &&
              tx <= 23 &&
              ty >= 3 &&
              ty <= 17 &&
              ((tx >= 2 && tx <= 9) || (tx >= 12 && tx <= 23))
            if (isCore) rgb = [255, 255, 255]
            else if (isOutline) rgb = [10, 10, 14]
          }
        }
        const i = (y * cw + x) * 4
        img.data[i] = rgb[0]
        img.data[i + 1] = rgb[1]
        img.data[i + 2] = rgb[2]
        img.data[i + 3] = 255
      }
    }

    // VLM only outputs the outer card panel, an oversized badge box (overlapping top border & hair), and "x5" labeled as badge
    const io = mockIo({
      ocr: async () => [],
      vlm: async () =>
        JSON.stringify({
          screen_kind: 'component',
          background_repair: { mode: 'surface' },
          elements: [
            {
              id: 'card',
              name: 'Avatar Card',
              kind: 'panel',
              box_2d: toBox2d(card, cw, ch),
              element_repair_mode: 'surface',
              order: 1
            },
            {
              id: 'badge',
              name: 'Piece Badge',
              kind: 'badge',
              parent: 'card',
              // Deliberately oversized box extending onto top border (top: 18) and blonde hair (width: 44, height: 44)
              box_2d: toBox2d({ left: 20, top: 18, width: 44, height: 44 }, cw, ch),
              positive_points_norm: [[Math.round((34 / cw) * 1000), Math.round((34 / ch) * 1000)]],
              order: 3
            },
            {
              id: 'count',
              name: 'x5',
              kind: 'badge',
              parent: 'card',
              box_2d: toBox2d({ left: 102, top: 106, width: 30, height: 24 }, cw, ch),
              text: 'x5',
              order: 4
            }
          ]
        })
    })

    const res = await runPreciseUiSplit(io, img, { generativePeel: false, zoomRefine: false })
    const byName = new Map(res.layers.map((l) => [l.name, l]))

    // 1) Portrait was automatically decomposed out of Avatar Card as a separate layer!
    expect(byName.has('Avatar Card')).toBe(true)
    expect(byName.has('Portrait')).toBe(true)
    expect(byName.has('Piece Badge')).toBe(true)
    expect(byName.has('x5')).toBe(true)

    // 2) Top-left grey border of Avatar Card is intact (not eaten by outer dark blue background!)
    const cardLayer = byName.get('Avatar Card')!
    const topBorderPx = pixel(
      { width: cardLayer.width, data: cardLayer.rgba },
      38 - cardLayer.left,
      20 - cardLayer.top
    )
    expect(topBorderPx[0]).toBeGreaterThan(115)
    expect(topBorderPx[3]).toBeGreaterThan(220)

    // 3) Piece Badge Base (pentagon plate) and Piece Badge (white puzzle symbol) are both cleanly extracted!
    expect(byName.has('Piece Badge Base')).toBe(true)
    const plateLayer = byName.get('Piece Badge Base')!
    const bx = plateLayer.width - 2
    const by = plateLayer.height - 2
    const badgeCornerPx = pixel({ width: plateLayer.width, data: plateLayer.rgba }, bx, by)
    expect(badgeCornerPx[3]).toBe(0)
    // And the center of Piece Badge Base (where the white puzzle icon sat) was inpainted to solid purple!
    const plateCenterPx = pixel(
      { width: plateLayer.width, data: plateLayer.rgba },
      Math.floor(plateLayer.width / 2),
      Math.floor(plateLayer.height / 2)
    )
    expect(plateCenterPx[0]).toBeGreaterThan(100)
    expect(plateCenterPx[1]).toBeLessThan(80)
    expect(plateCenterPx[2]).toBeGreaterThan(130)

    // 4) Avatar Card inner cavity has clean dark-to-purple slot background (zero blonde hair / face ghost!)
    const cardCenterPx = pixel(
      { width: cardLayer.width, data: cardLayer.rgba },
      Math.floor(cardLayer.width / 2),
      Math.floor(cardLayer.height / 2)
    )
    expect(cardCenterPx[0]).toBeLessThan(90)
    expect(cardCenterPx[1]).toBeLessThan(60)

    // 5) "x5" is recognized as editable plainText and background between/outside characters is transparent (no armor block)
    const countLayer = byName.get('x5')!
    expect(countLayer.editableText?.text).toBe('x5')
    const gapPx = pixel(
      { width: countLayer.width, data: countLayer.rgba },
      Math.floor(countLayer.width * 0.42),
      0
    )
    expect(gapPx[3]).toBeLessThanOrEqual(8)
  })

  it('expands truncated +/- button boxes to full height and leaves zero button residue on base', async () => {
    const bw = 200
    const bh = 120
    const img = createImage(bw, bh)
    for (let p = 0; p < bw * bh; p++) {
      const i = p * 4
      img.data[i] = 8
      img.data[i + 1] = 18
      img.data[i + 2] = 30
      img.data[i + 3] = 255
    }
    const paintBox = (
      rect: { left: number; top: number; width: number; height: number },
      rgba: [number, number, number, number]
    ): void => {
      for (let y = rect.top; y < rect.top + rect.height; y++) {
        for (let x = rect.left; x < rect.left + rect.width; x++) {
          const i = (y * bw + x) * 4
          img.data[i] = rgba[0]
          img.data[i + 1] = rgba[1]
          img.data[i + 2] = rgba[2]
          img.data[i + 3] = rgba[3]
        }
      }
    }

    // Minus button at (20, 40, 44x32) with cyan body and white "-" bar
    paintBox({ left: 20, top: 40, width: 44, height: 32 }, [38, 155, 215, 255])
    paintBox({ left: 34, top: 54, width: 16, height: 4 }, [255, 255, 255, 255])

    // Plus button at (136, 40, 44x32) with cyan body and white "+" cross
    paintBox({ left: 136, top: 40, width: 44, height: 32 }, [38, 155, 215, 255])
    paintBox({ left: 150, top: 54, width: 16, height: 4 }, [255, 255, 255, 255])
    paintBox({ left: 156, top: 48, width: 4, height: 16 }, [255, 255, 255, 255])

    // VLM boxes for Minus and Plus only cover the top ~68% of the buttons (height=22 instead of 32)!
    const vlmJson = JSON.stringify({
      screen_kind: 'popup_dialog',
      background_repair_mode: 'surface',
      elements: [
        {
          id: 'btn_minus',
          name: 'Minus Button',
          kind: 'button',
          bbox: [20 * 5, Math.round((40 / bh) * 1000), 64 * 5, Math.round((62 / bh) * 1000)],
          parent: null,
          order: 1
        },
        {
          id: 'btn_plus',
          name: 'Plus Button',
          kind: 'button',
          bbox: [136 * 5, Math.round((40 / bh) * 1000), 180 * 5, Math.round((62 / bh) * 1000)],
          parent: null,
          order: 2
        }
      ]
    })

    const io: PreciseSplitIo = {
      vlm: async () => vlmJson,
      encodePng: async () => 'data:image/png;base64,AA=='
    }

    const res = await runPreciseUiSplit(io, img, { generativePeel: false, zoomRefine: false })
    const minus = res.layers.find((l) => l.name === 'Minus Button')!
    const plus = res.layers.find((l) => l.name === 'Plus Button')!
    expect(minus.height).toBeGreaterThanOrEqual(31)
    expect(plus.height).toBeGreaterThanOrEqual(31)

    // Base plate where the bottom of the Minus/Plus buttons sat (y=68) has zero cyan residue!
    const baseMinusBottom = pixel(res.base, 42, 68)
    const basePlusBottom = pixel(res.base, 158, 68)
    expect(baseMinusBottom[2]).toBeLessThan(55)
    expect(basePlusBottom[2]).toBeLessThan(55)
  })
})
