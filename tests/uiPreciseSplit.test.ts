import { describe, expect, it } from 'vitest'
import { readPsd } from 'ag-psd'
import {
  buildBinaryMaskRgba,
  buildLayoutTree,
  buildOwnershipMap,
  completeOccludedGenerative,
  computeComponentVisualDescriptor,
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
  segmentContainerSilhouette,
  textStrokeMask,
  unpackOcclusionAtlas,
  type PreciseSplitComponentCandidate,
  type PreciseSplitIo,
  type RgbaImage
} from '../src/shared/graph/uiPreciseSplit'
import {
  mapPreciseResultToLayers,
  purifySolidBgFallbackSplitLayers,
  runPreciseLayerSplitForNode
} from '../src/shared/graph/execute/layerSplitPrecise'
import {
  normalizeImageLayerSplit,
  prefersPreciseUiLayerSplit
} from '../src/shared/graph/imageLayerSplit'
import { layerSplitToPsdUint8Array } from '../src/renderer/src/features/graph/model/layerSplitPsd'
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

  it('peels leaf-to-root when a corner-straddling badge with outer glow and stale negative point overlaps a button', async () => {
    const cw = 200
    const ch = 128
    const panelRect = { left: 20, top: 16, width: 160, height: 96 }
    const btnRect = { left: 44, top: 52, width: 100, height: 36 }
    // 角标中心在 (146, 46)，严格落在按钮框 (44..144, 52..88) 之外，同时压住按钮右上角 10x6 区域 (134..144, 52..58)
    const badgeRect = { left: 134, top: 34, width: 24, height: 24 }
    const textRect = { left: 78, top: 64, width: 32, height: 12 }

    const panelRgb: [number, number, number] = [28, 42, 78]
    const btnBodyRgb: [number, number, number] = [238, 168, 36]
    const btnBorderRgb: [number, number, number] = [255, 224, 118]
    const badgeRgb: [number, number, number] = [225, 40, 58]

    const img = createImage(cw, ch)
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        let rgb: [number, number, number] = [12, 16, 26]
        if (inRect(x, y, panelRect)) {
          rgb = [...panelRgb]
        }
        if (inRect(x, y, btnRect)) {
          const onBorder =
            x - btnRect.left < 2 ||
            btnRect.left + btnRect.width - x <= 2 ||
            y - btnRect.top < 2 ||
            btnRect.top + btnRect.height - y <= 2
          rgb = onBorder ? [...btnBorderRgb] : [...btnBodyRgb]
        }
        if (
          inRect(x, y, textRect) &&
          (x - textRect.left < 3 ||
            textRect.left + textRect.width - x <= 3 ||
            Math.abs(y - (textRect.top + 6)) <= 1)
        ) {
          rgb = [255, 255, 255]
        }
        // 角标外圈 2px 软红光晕 + 实心红角标压在最顶层
        const dx = Math.max(badgeRect.left - x, 0, x - (badgeRect.left + badgeRect.width - 1))
        const dy = Math.max(badgeRect.top - y, 0, y - (badgeRect.top + badgeRect.height - 1))
        const dist = Math.hypot(dx, dy)
        if (dist === 0) {
          rgb = [...badgeRgb]
        } else if (dist <= 2.2) {
          const a = dist <= 1.2 ? 0.45 : 0.22
          rgb = [
            Math.round(rgb[0] * (1 - a) + badgeRgb[0] * a),
            Math.round(rgb[1] * (1 - a) + badgeRgb[1] * a),
            Math.round(rgb[2] * (1 - a) + badgeRgb[2] * a)
          ]
        }
        const i = (y * cw + x) * 4
        img.data[i] = rgb[0]
        img.data[i + 1] = rgb[1]
        img.data[i + 2] = rgb[2]
        img.data[i + 3] = 255
      }
    }

    // 故意让 VLM 把 badge 的 order 排在 btn 前面，且在 btn 被角标压住的右上角 (139, 55) 打了负向提示点
    const vlmJson = JSON.stringify({
      screen_kind: 'popup',
      background_repair: { mode: 'surface' },
      elements: [
        {
          id: 'panel',
          name: 'Dialog Panel',
          kind: 'panel',
          box_2d: toBox2d(panelRect, cw, ch),
          element_repair_mode: 'surface',
          order: 1
        },
        {
          id: 'badge',
          name: 'Corner Dot',
          kind: 'badge',
          parent_id: 'panel',
          box_2d: toBox2d(badgeRect, cw, ch),
          positive_points_norm: [[Math.round((46 / ch) * 1000), Math.round((146 / cw) * 1000)]],
          order: 2
        },
        {
          id: 'btn',
          name: 'Claim Button',
          kind: 'button',
          parent_id: 'panel',
          box_2d: toBox2d(btnRect, cw, ch),
          positive_points_norm: [[Math.round((70 / ch) * 1000), Math.round((94 / cw) * 1000)]],
          negative_points_norm: [[Math.round((55 / ch) * 1000), Math.round((139 / cw) * 1000)]],
          element_repair_mode: 'surface',
          order: 3
        },
        {
          id: 'txt',
          name: 'Claim Label',
          kind: 'text',
          parent_id: 'btn',
          box_2d: toBox2d(textRect, cw, ch),
          ocr: ['T1'],
          text: 'OK',
          order: 4
        }
      ]
    })

    const io: PreciseSplitIo = {
      vlm: async () => vlmJson,
      encodePng: async () => 'data:image/png;base64,AAAA',
      ocr: async () => [{ text: 'OK', ...textRect }]
    }

    const res = await runPreciseUiSplit(io, img, { generativePeel: false, zoomRefine: false })
    const byName = new Map(res.layers.map((l) => [l.name, l]))
    const treeById = new Map(res.tree.elements.map((e) => [e.id, e]))

    // 1) 层级树按叶→根分配：Corner Dot(L3) 先于 Claim Button(L2) 先于 Dialog Panel(L1)
    expect(treeById.get('panel')!.level).toBe(1)
    expect(treeById.get('btn')!.level).toBe(2)
    expect(treeById.get('badge')!.level).toBe(3)

    // 2) Claim Button 被角标跨角遮住的右上角 (140, 55) 已完整恢复（不缺角、不透明、金色表面）
    const btnLayer = byName.get('Claim Button')!
    expect(btnLayer.width).toBeGreaterThanOrEqual(btnRect.width)
    expect(btnLayer.height).toBeGreaterThanOrEqual(btnRect.height)
    const occCornerPx = pixel(
      { width: btnLayer.width, data: btnLayer.rgba },
      140 - btnLayer.left,
      55 - btnLayer.top
    )
    expect(occCornerPx[3]).toBe(255)
    expect(occCornerPx[0]).toBeGreaterThan(215)
    expect(occCornerPx[1]).toBeGreaterThan(145)
    expect(occCornerPx[2]).toBeLessThan(95)

    // 3) Dialog Panel 在按钮右上角 (140, 55) 与角标外探区 (148, 40) 均恢复为纯净深蓝面板色，无金边/红晕残留
    const panelLayer = byName.get('Dialog Panel')!
    for (const [gx, gy] of [
      [140, 55],
      [148, 40],
      [133, 44]
    ] as const) {
      const p = pixel(
        { width: panelLayer.width, data: panelLayer.rgba },
        gx - panelLayer.left,
        gy - panelLayer.top
      )
      expect(Math.abs(p[0]! - panelRgb[0])).toBeLessThanOrEqual(8)
      expect(Math.abs(p[1]! - panelRgb[1])).toBeLessThanOrEqual(8)
      expect(Math.abs(p[2]! - panelRgb[2])).toBeLessThanOrEqual(8)
      expect(p[3]).toBe(255)
    }

    expect(res.reconstructionError).toBeLessThan(1.5)
  })

  it('recognizes gpt-6+ vision grounding models and drops root full-canvas scene backgrounds from VLM elements', () => {
    expect(visionGroundingScore('gpt-6.1-sol')).toBeGreaterThanOrEqual(70)
    expect(visionGroundingScore('gpt-6-mini')).toBeGreaterThanOrEqual(70)
    expect(visionGroundingScore('o4-mini')).toBeGreaterThanOrEqual(70)

    const parsed = parseLayoutResponse(
      JSON.stringify({
        screenKind: 'hud',
        elements: [
          {
            id: 'e1',
            name: '全屏中医馆场景背景',
            kind: 'illustration',
            bbox: [7, 0, 1536, 840],
            parent: null,
            order: 1
          },
          {
            id: 'e2',
            name: '底部播放控制条',
            kind: 'panel',
            bbox: [38, 705, 772, 831],
            parent: null,
            order: 2
          }
        ]
      }),
      1536,
      864
    )
    expect(parsed.elements.map((e) => e.id)).toEqual(['e2'])
    expect(parsed.backgroundRepairMode).toBe('scene')
  })

  it('preserves thin 2px gold-ring hollow buttons and carves rounded control bar corners without wooden table debris', async () => {
    const cw = 260
    const ch = 120
    const barRect = { left: 24, top: 32, width: 212, height: 60 }
    const radius = 16
    const stopBtnCenter = { x: 64, y: 62 }
    const stopBtnR = 18

    const img = createImage(cw, ch)
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        // Warm textured wooden table background
        const grain = Math.round(Math.sin(x * 0.25 + y * 0.08) * 5)
        let rgb: [number, number, number] = [92 + grain, 58 + grain, 34 + grain]

        // Rounded capsule playback control bar
        if (inRect(x, y, barRect)) {
          const lx = x - barRect.left
          const ly = y - barRect.top
          const cx =
            lx < radius ? radius : lx >= barRect.width - radius ? barRect.width - 1 - radius : lx
          const cy =
            ly < radius ? radius : ly >= barRect.height - radius ? barRect.height - 1 - radius : ly
          const dist = Math.hypot(lx - cx, ly - cy)
          if (dist <= radius + 0.3) {
            const onBarBorder = dist >= radius - 1.4
            rgb = onBarBorder ? [68, 132, 148] : [22, 30, 42]
          }
        }

        // Hollow 2px gold outline circular Stop Button + inner gold square
        const bDist = Math.hypot(x - stopBtnCenter.x, y - stopBtnCenter.y)
        if (bDist >= stopBtnR - 2 && bDist <= stopBtnR) {
          rgb = [235, 192, 92]
        } else if (Math.abs(x - stopBtnCenter.x) <= 5 && Math.abs(y - stopBtnCenter.y) <= 5) {
          rgb = [235, 192, 92]
        }

        const i = (y * cw + x) * 4
        img.data[i] = rgb[0]
        img.data[i + 1] = rgb[1]
        img.data[i + 2] = rgb[2]
        img.data[i + 3] = 255
      }
    }

    const stopBox = {
      left: stopBtnCenter.x - stopBtnR,
      top: stopBtnCenter.y - stopBtnR,
      width: stopBtnR * 2 + 1,
      height: stopBtnR * 2 + 1
    }
    const vlmJson = JSON.stringify({
      background_repair: { mode: 'surface' },
      elements: [
        {
          id: 'bar',
          name: '底部播放控制条',
          kind: 'panel',
          box_2d: toBox2d(barRect, cw, ch),
          element_repair_mode: 'surface',
          order: 1
        },
        {
          id: 'stop_btn',
          name: '停止按钮',
          kind: 'button',
          parent_id: 'bar',
          box_2d: toBox2d(stopBox, cw, ch),
          order: 2
        }
      ]
    })

    const res = await runPreciseUiSplit(
      {
        vlm: async () => vlmJson,
        encodePng: async () => 'data:image/png;base64,AAAA',
        ocr: async () => []
      },
      img,
      { generativePeel: false, zoomRefine: false }
    )
    const byName = new Map(res.layers.map((l) => [l.name, l]))
    const stopLayer = byName.get('停止按钮')!
    const barLayer = byName.get('底部播放控制条')!

    // 1) 停止按钮 2px 金色外圆环完整保留，不会被 refineMaskByPalette 当成噪点删到只剩中心小方块
    expect(stopLayer.width).toBeGreaterThanOrEqual(stopBtnR * 2 - 1)
    expect(stopLayer.height).toBeGreaterThanOrEqual(stopBtnR * 2 - 1)

    // 2) 底部播放控制条四角圆弧外侧保持透明（不粘连木桌残片），且停止按钮正下方无金环残留
    const outerCornerAlpha = pixel({ width: barLayer.width, data: barLayer.rgba }, 0, 0)[3]
    expect(outerCornerAlpha).toBeLessThanOrEqual(16)
    const underRingTop = pixel(
      { width: barLayer.width, data: barLayer.rgba },
      stopBtnCenter.x - barLayer.left,
      stopBtnCenter.y - stopBtnR + 1 - barLayer.top
    )
    expect(underRingTop[0]).toBeLessThan(60)
    expect(underRingTop[3]).toBe(255)
  })

  it('reconstructs voice input bar inner cyan border across symmetric end buttons, prevents button holes, and drops hallucinated border text', async () => {
    const cw = 320
    const ch = 150
    const bubbleRect = { left: 190, top: 12, width: 112, height: 34 }
    const hallTextRect = { left: 274, top: 10, width: 30, height: 14 }
    const barRect = { left: 20, top: 76, width: 280, height: 54 }
    const micBtn = { left: 32, top: 85, width: 36, height: 36 }
    const micIcon = { left: 45, top: 96, width: 10, height: 14 }
    const sendBtn = { left: 252, top: 85, width: 36, height: 36 }
    const sendIcon = { left: 265, top: 96, width: 10, height: 14 }
    const placeholderBox = { left: 96, top: 97, width: 84, height: 12 }

    const img = createImage(cw, ch)
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        let rgb: [number, number, number] = [38, 28, 22]

        // Top-right user message bubble with 2px cyan border
        if (inRect(x, y, bubbleRect)) {
          const onEdge =
            x - bubbleRect.left < 2 ||
            bubbleRect.left + bubbleRect.width - x <= 2 ||
            y - bubbleRect.top < 2 ||
            bubbleRect.top + bubbleRect.height - y <= 2
          rgb = onEdge ? [68, 214, 238] : [20, 44, 62]
        }

        // Bottom voice input bar: outer border + dark margin + inner cyan pill border at dy=10..11 and dy=42..43
        if (inRect(x, y, barRect)) {
          const lx = x - barRect.left
          const ly = y - barRect.top
          const onOuter = lx < 2 || lx >= barRect.width - 2 || ly < 2 || ly >= barRect.height - 2
          if (onOuter) {
            rgb = [62, 178, 204]
          } else if (
            lx >= 10 &&
            lx < barRect.width - 10 &&
            (ly === 10 || ly === 11 || ly === 42 || ly === 43)
          ) {
            rgb = [72, 218, 242]
          } else if (lx >= 10 && lx < barRect.width - 10 && ly > 11 && ly < 42) {
            rgb = [28, 40, 58]
          } else {
            rgb = [16, 22, 34]
          }
        }

        // Placeholder text with 1px soft halo inside pill
        if (inRect(x, y, placeholderBox)) {
          const tx = x - placeholderBox.left
          const ty = y - placeholderBox.top
          if (ty >= 2 && ty <= 9 && tx % 6 < 3) {
            rgb = [188, 214, 228]
          } else if (ty >= 1 && ty <= 10 && tx % 6 === 3) {
            rgb = [66, 88, 108]
          }
        }

        // Symmetric left Mic button & right Send button + crisp white inner icons
        if (inRect(x, y, micBtn)) rgb = [36, 152, 182]
        if (inRect(x, y, micIcon)) rgb = [245, 252, 255]
        if (inRect(x, y, sendBtn)) rgb = [42, 186, 212]
        if (inRect(x, y, sendIcon)) rgb = [245, 252, 255]

        const i = (y * cw + x) * 4
        img.data[i] = rgb[0]
        img.data[i + 1] = rgb[1]
        img.data[i + 2] = rgb[2]
        img.data[i + 3] = 255
      }
    }

    const vlmJson = JSON.stringify({
      background_repair: { mode: 'surface' },
      elements: [
        {
          id: 'bubble',
          name: '用户消息气泡3',
          kind: 'panel',
          box_2d: toBox2d(bubbleRect, cw, ch),
          order: 1
        },
        {
          id: 'hall_ts',
          name: '消息3时间戳',
          kind: 'text',
          parent_id: 'bubble',
          box_2d: toBox2d(hallTextRect, cw, ch),
          text: '12:08',
          order: 2
        },
        {
          id: 'input_bar',
          name: '底部语音输入条',
          kind: 'panel',
          box_2d: toBox2d(barRect, cw, ch),
          element_repair_mode: 'surface',
          order: 3
        },
        {
          id: 'mic_btn',
          name: '麦克风按钮',
          kind: 'button',
          parent_id: 'input_bar',
          box_2d: toBox2d(micBtn, cw, ch),
          order: 4
        },
        {
          id: 'mic_ic',
          name: '麦克风图标',
          kind: 'icon',
          parent_id: 'mic_btn',
          box_2d: toBox2d(micIcon, cw, ch),
          order: 5
        },
        {
          id: 'send_btn',
          name: '发送按钮',
          kind: 'button',
          parent_id: 'input_bar',
          box_2d: toBox2d(sendBtn, cw, ch),
          order: 6
        },
        {
          id: 'send_ic',
          name: '发送箭头图标',
          kind: 'icon',
          parent_id: 'send_btn',
          box_2d: toBox2d(sendIcon, cw, ch),
          order: 7
        },
        {
          id: 'ph_txt',
          name: '占位提示语',
          kind: 'text',
          parent_id: 'input_bar',
          box_2d: toBox2d(placeholderBox, cw, ch),
          ocr: ['T1'],
          text: 'Listening...',
          order: 8
        }
      ]
    })

    const res = await runPreciseUiSplit(
      {
        vlm: async () => vlmJson,
        encodePng: async () => 'data:image/png;base64,AAAA',
        ocr: async () => [{ text: 'Listening...', ...placeholderBox }]
      },
      img,
      { generativePeel: false, zoomRefine: false }
    )
    const byName = new Map(res.layers.map((l) => [l.name, l]))

    // 1) 无 OCR 支撑且只压在气泡描边上的「消息3时间戳」被拒绝，不会把「用户消息气泡3」右上角咬出缺口
    expect(byName.has('消息3时间戳')).toBe(false)
    const bubbleLayer = byName.get('用户消息气泡3')!
    const bubbleTopRightBorder = pixel(
      { width: bubbleLayer.width, data: bubbleLayer.rgba },
      284 - bubbleLayer.left,
      12 - bubbleLayer.top
    )
    expect(bubbleTopRightBorder[2]).toBeGreaterThan(200)
    expect(bubbleTopRightBorder[3]).toBe(255)

    // 2) 发送按钮与麦克风按钮内部实心无破洞（不生成重复 *_plate），且发送按钮未撕走父容器外框线
    expect(res.layers.some((l) => l.name.endsWith(' Base'))).toBe(false)
    const sendBtnLayer = byName.get('发送按钮')!
    expect(sendBtnLayer.left + sendBtnLayer.width).toBeLessThanOrEqual(
      barRect.left + barRect.width - 2
    )
    const sendBtnCenter = pixel(
      { width: sendBtnLayer.width, data: sendBtnLayer.rgba },
      Math.floor(sendBtnLayer.width / 2),
      Math.floor(sendBtnLayer.height / 2)
    )
    expect(sendBtnCenter[3]).toBe(255)

    // 3) 底部语音输入条在左右对称按钮下方完整续接青色内胶囊描边（不出现纵向深色条纹），且占位字无浮雕残影
    const barLayer = byName.get('底部语音输入条')!
    for (const gx of [50, 270]) {
      const innerBorderPx = pixel(
        { width: barLayer.width, data: barLayer.rgba },
        gx - barLayer.left,
        barRect.top + 10 - barLayer.top
      )
      expect(innerBorderPx[1]).toBeGreaterThan(195)
      expect(innerBorderPx[2]).toBeGreaterThan(215)
    }
    const phCenterPx = pixel(
      { width: barLayer.width, data: barLayer.rgba },
      placeholderBox.left + 12 - barLayer.left,
      placeholderBox.top + 5 - barLayer.top
    )
    expect(Math.abs(phCenterPx[0] - 28)).toBeLessThanOrEqual(6)
    expect(Math.abs(phCenterPx[1] - 40)).toBeLessThanOrEqual(6)
  })

  it('orders glowing pedestal below standing hologram, unmixes translucent pedestal glow without dark wood chunks, and excludes protruding acupoint tag box', async () => {
    const cw = 220
    const ch = 220
    const woodRgb: [number, number, number] = [56, 36, 22]
    const holoBox = { left: 74, top: 28, width: 72, height: 152 }
    const tagRect = { left: 112, top: 112, width: 54, height: 24 }
    const pedestalBox = { left: 56, top: 162, width: 108, height: 38 }

    const img = createImage(cw, ch)
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        let rgb: [number, number, number] = [...woodRgb]

        // Translucent cyan glowing pedestal blended over dark brown wood cabinet
        if (inRect(x, y, pedestalBox)) {
          const nx = (x - (pedestalBox.left + pedestalBox.width / 2)) / (pedestalBox.width / 2)
          const ny = (y - (pedestalBox.top + pedestalBox.height / 2)) / (pedestalBox.height / 2)
          const r = Math.hypot(nx, ny)
          if (r <= 1) {
            const glowA = Math.max(0, (1 - r) * 0.65)
            rgb = [
              Math.round(rgb[0] * (1 - glowA) + 48 * glowA),
              Math.round(rgb[1] * (1 - glowA) + 216 * glowA),
              Math.round(rgb[2] * (1 - glowA) + 255 * glowA)
            ]
          }
        }

        // Standing cyan hologram figure with arms-torso gaps and legs reaching y=176 inside pedestal
        const cx = 110
        const inHead = Math.hypot(x - cx, y - 44) <= 12
        const inTorso = Math.abs(x - cx) <= 13 && y >= 56 && y <= 114
        const inArms =
          y >= 62 &&
          y <= 98 &&
          ((x >= 80 && x <= 88) || (x >= 132 && x <= 140) || (y <= 68 && Math.abs(x - cx) <= 30))
        const inLegs = y >= 115 && y <= 176 && ((x >= 96 && x <= 105) || (x >= 115 && x <= 124))
        if (inHead || inTorso || inArms || inLegs) {
          rgb = [86, 228, 252]
        }

        // Protruding acupoint tag "足三里" overlapping right leg (x=115..124) and protruding to x=166 over wood
        if (inRect(x, y, tagRect)) {
          rgb = [24, 58, 76]
        }

        const i = (y * cw + x) * 4
        img.data[i] = rgb[0]
        img.data[i + 1] = rgb[1]
        img.data[i + 2] = rgb[2]
        img.data[i + 3] = 255
      }
    }

    const vlmJson = JSON.stringify({
      background_repair: { mode: 'surface' },
      elements: [
        {
          id: 'holo',
          name: '全息人体经络影像',
          kind: 'illustration',
          box_2d: toBox2d(holoBox, cw, ch),
          order: 1
        },
        {
          id: 'pedestal',
          name: '全息投影发光底座',
          kind: 'decoration',
          box_2d: toBox2d(pedestalBox, cw, ch),
          order: 2
        },
        {
          id: 'tag',
          name: '足三里穴位标签',
          kind: 'badge',
          box_2d: toBox2d(tagRect, cw, ch),
          order: 3
        }
      ]
    })

    const res = await runPreciseUiSplit(
      {
        vlm: async () => vlmJson,
        encodePng: async () => 'data:image/png;base64,AAAA',
        ocr: async () => []
      },
      img,
      { generativePeel: false, zoomRefine: false }
    )
    const byName = new Map(res.layers.map((l) => [l.name, l]))
    const holoLayer = byName.get('全息人体经络影像')!
    const pedLayer = byName.get('全息投影发光底座')!

    // 1) 发光底座排在全息人像下层，不会把全息人像双脚 (y=172) 切掉
    expect(pedLayer.paintIndex).toBeLessThan(holoLayer.paintIndex)
    expect(holoLayer.top + holoLayer.height).toBeGreaterThanOrEqual(175)
    const rightFootPx = pixel(
      { width: holoLayer.width, data: holoLayer.rgba },
      120 - holoLayer.left,
      172 - holoLayer.top
    )
    expect(rightFootPx[2]).toBeGreaterThan(200)
    expect(rightFootPx[3]).toBeGreaterThan(200)

    // 2) 全息人像右臂与躯干之间的背景空隙 (x=92, y=82) 保持透明，且向外伸出的穴位标签区 (x=142, y=124) 未粘进人像
    const armTorsoGapPx = pixel(
      { width: holoLayer.width, data: holoLayer.rgba },
      92 - holoLayer.left,
      82 - holoLayer.top
    )
    expect(armTorsoGapPx[3]).toBeLessThanOrEqual(16)
    if (142 - holoLayer.left < holoLayer.width) {
      const protrudingTagPx = pixel(
        { width: holoLayer.width, data: holoLayer.rgba },
        142 - holoLayer.left,
        124 - holoLayer.top
      )
      expect(protrudingTagPx[3]).toBeLessThanOrEqual(16)
    }

    // 3) 全息投影发光底座通过物理去底色反解为半透明青色光晕，绝不夹带 alpha=255 的棕褐色木柜色块
    const pedGlowSample = pixel(
      { width: pedLayer.width, data: pedLayer.rgba },
      82 - pedLayer.left,
      180 - pedLayer.top
    )
    expect(pedGlowSample[3]).toBeGreaterThan(25)
    expect(pedGlowSample[3]).toBeLessThan(210)
    expect(pedGlowSample[2]).toBeGreaterThan(pedGlowSample[0] + 90)
    expect(res.reconstructionError).toBeLessThan(1.8)
  })
})

describe('uiPreciseSplit · bggg-creator-image2psd layerSplit optimizations', () => {
  it('heals clipped OCR/SAM edges in-place via composite pixel-diff check without moving layer coordinates and scrubs union-mask base ghosts', async () => {
    const cw = 180
    const ch = 100
    const bgRgb: [number, number, number] = [18, 26, 44]
    // Badge spans x=40..79 (width=40), y=32..63 (height=32)
    const badgeFull = { left: 40, top: 32, width: 40, height: 32 }
    // Text glyph block spans x=104..139 (width=36), y=42..53 (height=12)
    const textFull = { left: 104, top: 42, width: 36, height: 12 }

    const img = createImage(cw, ch)
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        let rgb: [number, number, number] = [...bgRgb]
        if (inRect(x, y, badgeFull)) {
          rgb = [238, 178, 42]
        }
        if (inRect(x, y, textFull) && y >= 44 && y <= 51) {
          rgb = [252, 252, 255]
        }
        const i = (y * cw + x) * 4
        img.data[i] = rgb[0]
        img.data[i + 1] = rgb[1]
        img.data[i + 2] = rgb[2]
        img.data[i + 3] = 255
      }
    }

    // Deliberately clip 2px off the right side of BOTH the SAM mask (width=38) and OCR box (width=34)
    const clippedBadgeBox = { left: 40, top: 32, width: 38, height: 32 }
    const clippedTextBox = { left: 104, top: 42, width: 34, height: 12 }

    const io: PreciseSplitIo = {
      vlm: async () =>
        JSON.stringify({
          background_repair: { mode: 'surface' },
          elements: [
            {
              id: 'b1',
              name: 'Gold Badge',
              kind: 'badge',
              box_2d: toBox2d(clippedBadgeBox, cw, ch),
              order: 1
            },
            {
              id: 't1',
              name: 'Title Text',
              kind: 'text',
              box_2d: toBox2d(clippedTextBox, cw, ch),
              ocr: ['T1'],
              text: 'CLAIM',
              order: 2
            }
          ]
        }),
      encodePng: async () => 'data:image/png;base64,AAAA',
      ocr: async () => [{ text: 'CLAIM', ...clippedTextBox }],
      segmentSam2: async () => {
        const mask = new Uint8Array(cw * ch)
        for (let y = clippedBadgeBox.top; y < clippedBadgeBox.top + clippedBadgeBox.height; y++) {
          for (
            let x = clippedBadgeBox.left;
            x < clippedBadgeBox.left + clippedBadgeBox.width;
            x++
          ) {
            mask[y * cw + x] = 1
          }
        }
        return { masks: [{ mask, score: 0.96 }] }
      }
    }

    const res = await runPreciseUiSplit(io, img, { generativePeel: false, zoomRefine: false })
    const byName = new Map(res.layers.map((l) => [l.name, l]))
    const badgeLayer = byName.get('Gold Badge')!
    const textLayer = byName.get('Title Text')!

    // Origin left coordinates remain locked (zero shift), while clipped right 2px strokes are healed!
    expect(badgeLayer.left).toBe(40)
    expect(badgeLayer.left + badgeLayer.width).toBeGreaterThanOrEqual(80)
    expect(textLayer.left).toBe(104)
    expect(textLayer.left + textLayer.width).toBeGreaterThanOrEqual(140)

    // Base layer under the newly healed right-edge pixels (x=79 and x=139) is scrubbed clean (no gold/white ghost!)
    const baseUnderClippedBadge = pixel(res.base, 79, 48)
    const baseUnderClippedText = pixel(res.base, 139, 47)
    expect(Math.abs(baseUnderClippedBadge[0]! - bgRgb[0])).toBeLessThanOrEqual(8)
    expect(Math.abs(baseUnderClippedText[0]! - bgRgb[0])).toBeLessThanOrEqual(8)
    expect(res.reconstructionError).toBeLessThan(1.0)
  })

  it('recovers heavily occluded subjects via solid-studio-BG companion fallback when masked hole-inpaint misaligns', async () => {
    const cw = 120
    const ch = 120
    const rect = { left: 24, top: 24, width: 72, height: 72 }
    const plate = createImage(cw, ch)
    const fullSubject = createImage(rect.width, rect.height)

    // Render textured emblem with checkerboard crest + bright white central highlight
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const i = (y * cw + x) * 4
        plate.data[i] = 16
        plate.data[i + 1] = 22
        plate.data[i + 2] = 36
        plate.data[i + 3] = 255
      }
    }
    for (let y = 0; y < rect.height; y++) {
      for (let x = 0; x < rect.width; x++) {
        const si = (y * rect.width + x) * 4
        const inCenterGem = x >= 28 && x < 44 && y >= 28 && y < 44
        const stripe = ((x >> 2) + (y >> 2)) % 2 === 0
        const rgb: [number, number, number] = inCenterGem
          ? [255, 255, 255]
          : stripe
            ? [216, 74, 48]
            : [148, 36, 28]
        fullSubject.data[si] = rgb[0]
        fullSubject.data[si + 1] = rgb[1]
        fullSubject.data[si + 2] = rgb[2]
        fullSubject.data[si + 3] = 255

        const gi = ((rect.top + y) * cw + (rect.left + x)) * 4
        // Right-bottom quadrant (x>=40, y>=40) was occluded and left as flat blurry push-pull smear
        if (x >= 40 && y >= 40) {
          plate.data[gi] = 180
          plate.data[gi + 1] = 55
          plate.data[gi + 2] = 38
        } else {
          plate.data[gi] = rgb[0]
          plate.data[gi + 1] = rgb[1]
          plate.data[gi + 2] = rgb[2]
        }
      }
    }

    const subjMask = new Uint8Array(rect.width * rect.height).fill(1)
    const occluderRect = { left: rect.left + 40, top: rect.top + 40, width: 32, height: 32 }
    const occMask = new Uint8Array(occluderRect.width * occluderRect.height).fill(1)
    const ownership = buildOwnershipMap(cw, ch, [
      { id: 'emblem', paintIndex: 1, mask: { rect, mask: subjMask } },
      { id: 'occ_badge', paintIndex: 2, mask: { rect: occluderRect, mask: occMask } }
    ])

    const visibleBefore = pixel(plate, rect.left + 32, rect.top + 32)
    let callIdx = 0
    const report = await completeOccludedGenerative({
      io: {
        encodePng: async () => 'data:image/png;base64,AAAA',
        editImage: async (req) => {
          callIdx += 1
          if (req.maskImage) {
            // 1st call (black-hole mask inpaint): return misaligned garbage so shift.error > 26
            const bad = createImage(96, 96)
            bad.data.fill(240)
            return bad
          }
          // 2nd call (bggg solid-studio-BG companion fallback): return standalone subject on #FFFFFF with 8px margin
          const pad = 8
          const studio = createImage(rect.width + pad * 2, rect.height + pad * 2)
          studio.data.fill(255) // pure #FFFFFF studio background
          for (let y = 0; y < rect.height; y++) {
            for (let x = 0; x < rect.width; x++) {
              const si = (y * rect.width + x) * 4
              const di = ((y + pad) * studio.width + (x + pad)) * 4
              studio.data[di] = fullSubject.data[si]!
              studio.data[di + 1] = fullSubject.data[si + 1]!
              studio.data[di + 2] = fullSubject.data[si + 2]!
              studio.data[di + 3] = 255
            }
          }
          return studio
        }
      },
      ownership,
      maxCalls: 3,
      targets: [
        {
          id: 'emblem',
          name: 'Crest Icon',
          kind: 'icon',
          entryIndex: 0,
          mask: { rect, mask: subjMask },
          plate
        }
      ]
    })

    expect(callIdx).toBe(2)
    expect(report.accepted).toBe(1)
    expect(report.pixels).toBeGreaterThan(500)
    // Visible unoccluded white gem pixel remains 100% locked
    expect(pixel(plate, rect.left + 32, rect.top + 32)).toEqual(visibleBefore)
    // Occluded region now has restored checkerboard contrast instead of flat [180,55,38] blur
    const restoredLight = pixel(plate, rect.left + 48, rect.top + 48)
    const restoredDark = pixel(plate, rect.left + 52, rect.top + 48)
    expect(Math.abs(restoredLight[0]! - restoredDark[0]!)).toBeGreaterThan(35)
  })

  it('auto-unifies repeated in-screen UI slots into shared Smart Object masters in standalone runPreciseLayerSplitForNode', async () => {
    const cw = 220
    const ch = 96
    const slots = [
      { left: 16, top: 24, width: 48, height: 48 },
      { left: 86, top: 24, width: 48, height: 48 },
      { left: 156, top: 24, width: 48, height: 48 }
    ]
    const img = createImage(cw, ch)
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        let rgb: [number, number, number] = [14, 18, 28]
        for (let si = 0; si < slots.length; si++) {
          const s = slots[si]!
          if (!inRect(x, y, s)) continue
          const lx = x - s.left
          const ly = y - s.top
          const onBorder = lx < 4 || lx >= s.width - 4 || ly < 4 || ly >= s.height - 4
          rgb = onBorder ? [228, 178, 56] : [34, 42, 66]
          // First two slots hold colored item blocks in their center; 3rd slot is clean empty!
          if (si < 2 && lx >= 16 && lx < 32 && ly >= 16 && ly < 32) {
            rgb = si === 0 ? [60, 210, 245] : [240, 72, 96]
          }
        }
        const i = (y * cw + x) * 4
        img.data[i] = rgb[0]
        img.data[i + 1] = rgb[1]
        img.data[i + 2] = rgb[2]
        img.data[i + 3] = 255
      }
    }

    const encodedStore = new Map<string, RgbaImage>()
    let seq = 0
    const encodeImg = async (rgba: RgbaImage): Promise<string> => {
      seq += 1
      const url = `data:image/png;base64,SLOT_${seq}`
      encodedStore.set(url, {
        width: rgba.width,
        height: rgba.height,
        data: new Uint8ClampedArray(rgba.data)
      })
      return url
    }
    const sourceUrl = await encodeImg(img)

    // Missing generateImage must fail fast without falling back to local segmentation
    await expect(
      runPreciseLayerSplitForNode(
        {
          node: { id: 'split1', typeId: 'image.layerSplit', params: {} } as never,
          inputs: {},
          uiRgbaCodec: {
            decodeImageRgba: async (url: string) => encodedStore.get(url)!,
            encodeRgbaPng: encodeImg
          },
          generateText: async () => ({ text: '{}' })
        } as never,
        {
          sourceUrl,
          userHint: '',
          stamp: 99,
          toCanvasSafeUrl: async (u) => u
        }
      )
    ).rejects.toMatchObject({ code: 'graphExec.capability.imageGenerate' })

    const cleanBase = createImage(cw, ch)
    for (let p = 0; p < cw * ch; p++) {
      cleanBase.data[p * 4] = 14
      cleanBase.data[p * 4 + 1] = 18
      cleanBase.data[p * 4 + 2] = 28
      cleanBase.data[p * 4 + 3] = 255
    }
    const cleanSlotStudio = createImage(68, 68)
    cleanSlotStudio.data.fill(255)
    for (let ly = 0; ly < 48; ly++) {
      for (let lx = 0; lx < 48; lx++) {
        const onBorder = lx < 4 || lx >= 44 || ly < 4 || ly >= 44
        const rgb = onBorder ? [228, 178, 56] : [34, 42, 66]
        const si = ((10 + ly) * 68 + (10 + lx)) * 4
        cleanSlotStudio.data[si] = rgb[0]
        cleanSlotStudio.data[si + 1] = rgb[1]
        cleanSlotStudio.data[si + 2] = rgb[2]
        cleanSlotStudio.data[si + 3] = 255
      }
    }
    const cleanPortraitStudio = createImage(36, 36)
    cleanPortraitStudio.data.fill(255)
    for (let ly = 0; ly < 16; ly++) {
      for (let lx = 0; lx < 16; lx++) {
        const si = ((10 + ly) * 36 + (10 + lx)) * 4
        cleanPortraitStudio.data[si] = 60
        cleanPortraitStudio.data[si + 1] = 210
        cleanPortraitStudio.data[si + 2] = 245
        cleanPortraitStudio.data[si + 3] = 255
      }
    }

    const mapped = await runPreciseLayerSplitForNode(
      {
        node: { id: 'split1', typeId: 'image.layerSplit', params: {} } as never,
        inputs: {},
        uiRgbaCodec: {
          decodeImageRgba: async (url: string) => encodedStore.get(url)!,
          encodeRgbaPng: encodeImg
        },
        generateText: async () => ({
          text: JSON.stringify({
            background_repair: { mode: 'surface' },
            elements: [
              {
                id: 's1',
                name: 'Slot 1',
                kind: 'item-slot',
                box_2d: toBox2d(slots[0]!, cw, ch),
                order: 1
              },
              {
                id: 's2',
                name: 'Slot 2',
                kind: 'item-slot',
                box_2d: toBox2d(slots[1]!, cw, ch),
                order: 2
              },
              {
                id: 's3',
                name: 'Slot 3',
                kind: 'item-slot',
                box_2d: toBox2d(slots[2]!, cw, ch),
                order: 3
              }
            ]
          })
        }),
        generateImage: async (req: { inputReferences?: string[]; prompt: string }) => {
          if ((req.inputReferences?.length ?? 0) >= 2) {
            return { images: [await encodeImg(cleanBase)] }
          }
          if (req.prompt.includes('Portrait')) {
            return { images: [await encodeImg(cleanPortraitStudio)] }
          }
          return { images: [await encodeImg(cleanSlotStudio)] }
        }
      } as never,
      {
        sourceUrl,
        userHint: '',
        stamp: 100,
        toCanvasSafeUrl: async (u) => u
      }
    )

    expect(mapped.componentLibrary?.length).toBe(1)
    expect(mapped.componentLibrary![0]!.sourceCount).toBe(3)
    const linkedSlots = mapped.layers.filter(
      (l) => l.componentId === mapped.componentLibrary![0]!.id
    )
    expect(linkedSlots).toHaveLength(3)
  })

  it('strips white studio background from full-canvas AI foreground layers while protecting white interior highlights', async () => {
    const cw = 120
    const ch = 80
    const fgOnWhite = createImage(cw, ch)
    fgOnWhite.data.fill(255) // Opaque #FFFFFF studio background from AI layer generator
    const btnRect = { left: 32, top: 24, width: 56, height: 32 }
    for (let y = btnRect.top; y < btnRect.top + btnRect.height; y++) {
      for (let x = btnRect.left; x < btnRect.left + btnRect.width; x++) {
        const i = (y * cw + x) * 4
        const inWhiteHighlight = x >= 50 && x < 70 && y >= 34 && y < 46
        if (inWhiteHighlight) {
          fgOnWhite.data[i] = 255
          fgOnWhite.data[i + 1] = 255
          fgOnWhite.data[i + 2] = 255
        } else {
          fgOnWhite.data[i] = 36
          fgOnWhite.data[i + 1] = 132
          fgOnWhite.data[i + 2] = 228
        }
        fgOnWhite.data[i + 3] = 255
      }
    }

    const store = new Map<string, RgbaImage>([['data:image/png;base64,FG_WHITE', fgOnWhite]])
    let outImg: RgbaImage | null = null
    const mapped = {
      canvasWidth: cw,
      canvasHeight: ch,
      layers: [
        {
          id: 'l_base',
          imageId: 'img_base',
          zIndex: 0,
          name: 'Base',
          description: '',
          visible: true,
          left: 0,
          top: 0,
          width: cw,
          height: ch,
          role: 'canvas-base' as const,
          uiPartRole: 'canvas-base' as const
        },
        {
          id: 'l_fg',
          imageId: 'img_fg',
          zIndex: 1,
          name: 'CTA Button',
          description: 'button',
          visible: true,
          left: 0,
          top: 0,
          width: cw,
          height: ch,
          role: 'layer' as const
        }
      ],
      batch: [
        { id: 'img_base', title: 'Base', dataUrl: 'data:image/png;base64,BASE' },
        { id: 'img_fg', title: 'CTA Button', dataUrl: 'data:image/png;base64,FG_WHITE' }
      ]
    }

    const purified = await purifySolidBgFallbackSplitLayers(
      {
        uiRgbaCodec: {
          decodeImageRgba: async (url) => store.get(url)!,
          encodeRgbaPng: async (rgba) => {
            outImg = rgba
            return 'data:image/png;base64,FG_CLEAN'
          }
        }
      },
      mapped
    )

    expect(purified).toBe(1)
    const fgLayer = mapped.layers[1]!
    expect(Math.abs(fgLayer.left - btnRect.left)).toBeLessThanOrEqual(2)
    expect(Math.abs(fgLayer.top - btnRect.top)).toBeLessThanOrEqual(2)
    expect(Math.abs(fgLayer.width - btnRect.width)).toBeLessThanOrEqual(4)
    expect(Math.abs(fgLayer.height - btnRect.height)).toBeLessThanOrEqual(4)
    expect(outImg).not.toBeNull()
    // Interior white highlight stays 100% opaque (alpha = 255, RGB = [255,255,255])!
    const hlX = 60 - fgLayer.left
    const hlY = 40 - fgLayer.top
    const hlPx = pixel(outImg!, hlX, hlY)
    expect(hlPx).toEqual([255, 255, 255, 255])
  })

  it('segmentContainerSilhouette extracts crisp rounded containers across two-tone/gradient exterior backgrounds', () => {
    const cw = 160
    const ch = 100
    const canvas = createImage(cw, ch)
    const box = { left: 30, top: 20, width: 100, height: 60 }
    const rad = 12

    const insideRounded = (x: number, y: number): boolean => {
      if (!inRect(x, y, box)) return false
      const lx = x - box.left
      const ly = y - box.top
      const cx = lx < rad ? rad : lx >= box.width - rad ? box.width - rad - 1 : lx
      const cy = ly < rad ? rad : ly >= box.height - rad ? box.height - rad - 1 : ly
      return Math.hypot(lx - cx, ly - cy) <= rad
    }

    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const i = (y * cw + x) * 4
        if (insideRounded(x, y)) {
          canvas.data[i] = 225
          canvas.data[i + 1] = 176
          canvas.data[i + 2] = 52
          canvas.data[i + 3] = 255
        } else if (x < cw / 2) {
          // Left backdrop: dark navy
          canvas.data[i] = 20
          canvas.data[i + 1] = 28
          canvas.data[i + 2] = 52
          canvas.data[i + 3] = 255
        } else {
          // Right backdrop: warm bronze (global outerRing.spread > 50, previously caused null bailout)
          canvas.data[i] = 86
          canvas.data[i + 1] = 62
          canvas.data[i + 2] = 36
          canvas.data[i + 3] = 255
        }
      }
    }

    const sil = segmentContainerSilhouette(canvas, { left: 28, top: 18, width: 104, height: 64 })
    expect(sil).not.toBeNull()
    const w = sil!.rect.width
    // Exterior rounded corners must be background (0) while center stays solid foreground (1)
    expect(sil!.mask[(20 - sil!.rect.top) * w + (30 - sil!.rect.left)]).toBe(0)
    expect(sil!.mask[(20 - sil!.rect.top) * w + (129 - sil!.rect.left)]).toBe(0)
    expect(sil!.mask[(50 - sil!.rect.top) * w + (80 - sil!.rect.left)]).toBe(1)
  })

  it('pre-segmentation maskless upstream component matching replaces UI controls cleanly even on gradient backdrops', async () => {
    const cw = 200
    const ch = 120
    const btnRect = { left: 50, top: 44, width: 100, height: 32 }
    const txtRect = { left: 78, top: 53, width: 44, height: 14 }

    // Canonical 80x32 9-slice button master with dark outer border + vertical gradient sheen
    const mw = 80
    const mh = 32
    const master = createImage(mw, mh)
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        const i = (y * mw + x) * 4
        const isBorder = x < 3 || x >= mw - 3 || y < 3 || y >= mh - 3
        if (isBorder) {
          master.data[i] = 28
          master.data[i + 1] = 34
          master.data[i + 2] = 54
        } else {
          const t = y / Math.max(1, mh - 1)
          master.data[i] = Math.round(92 - 42 * t)
          master.data[i + 1] = Math.round(156 - 58 * t)
          master.data[i + 2] = Math.round(232 - 52 * t)
        }
        master.data[i + 3] = 255
      }
    }
    const candidate: PreciseSplitComponentCandidate = {
      item: {
        id: 'comp_btn_primary_01',
        psdGuid: '11111111-2222-4333-8444-555555555555',
        name: 'Primary Button',
        exportName: 'Comp_Button_01',
        kind: 'button',
        canonicalWidth: mw,
        canonicalHeight: mh,
        scalePolicy: 'nine-slice',
        nineSliceBorders: [6, 8, 6, 8],
        sourceCount: 3,
        descriptor: computeComponentVisualDescriptor(master)
      },
      rgba: master
    }

    // Scene where left backdrop nearly matches the button's dark outer border (causing local seg border chew)
    const scene = createImage(cw, ch)
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const i = (y * cw + x) * 4
        if (inRect(x, y, btnRect)) {
          const lx = x - btnRect.left
          const ly = y - btnRect.top
          const isBorder = lx < 3 || lx >= btnRect.width - 3 || ly < 3 || ly >= btnRect.height - 3
          if (isBorder) {
            scene.data[i] = 28
            scene.data[i + 1] = 34
            scene.data[i + 2] = 54
          } else {
            const t = ly / Math.max(1, btnRect.height - 1)
            scene.data[i] = Math.round(92 - 42 * t)
            scene.data[i + 1] = Math.round(156 - 58 * t)
            scene.data[i + 2] = Math.round(232 - 52 * t)
          }
          if (inRect(x, y, txtRect) && ((x - txtRect.left) % 6 < 2 || Math.abs(y - 60) <= 1)) {
            scene.data[i] = 255
            scene.data[i + 1] = 255
            scene.data[i + 2] = 255
          }
        } else {
          scene.data[i] = 26 + Math.round((x / cw) * 54)
          scene.data[i + 1] = 32 + Math.round((y / ch) * 28)
          scene.data[i + 2] = 52
        }
        scene.data[i + 3] = 255
      }
    }

    const vlmLayout = JSON.stringify({
      screenKind: 'popup',
      elements: [
        {
          id: 'e_btn',
          name: 'Confirm Button',
          kind: 'button',
          box_2d: toBox2d(btnRect, cw, ch),
          parent: null,
          order: 1
        },
        {
          id: 'e_txt',
          name: 'Confirm Label',
          kind: 'text',
          box_2d: toBox2d(txtRect, cw, ch),
          parent: 'e_btn',
          order: 2,
          ocr: ['T1'],
          text: 'CONFIRM'
        }
      ]
    })

    const res = await runPreciseUiSplit(
      mockIo({
        vlm: async () => vlmLayout,
        ocr: async () => [{ ...txtRect, text: 'CONFIRM', confidence: 0.96 }]
      }),
      scene,
      { generativePeel: false, zoomRefine: false, components: [candidate] }
    )

    expect(res.componentMatches?.some((m) => m.elementId === 'e_btn')).toBe(true)
    const btnLayer = res.layers.find((l) => l.elementId === 'e_btn')!
    expect(btnLayer.componentId).toBe('comp_btn_primary_01')
    expect(btnLayer.width).toBe(btnRect.width)
    expect(btnLayer.height).toBe(btnRect.height)
    // Center pixel under former text stroke must match clean vertical gradient (~[66, 127, 206]), not white text scar
    const centerOff = (16 * btnLayer.width + 50) * 4
    expect(btnLayer.rgba[centerOff]!).toBeLessThan(95)
    expect(btnLayer.rgba[centerOff + 3]!).toBe(255)
  })

  it('purifyLayerImage purifies repeated control skins on solid bg and composes hybrid pixel-locked graphical layers without intermediate 2K peels', async () => {
    const cw = 220
    const ch = 140
    const panelRect = { left: 16, top: 12, width: 188, height: 116 }
    const btn1Rect = { left: 32, top: 88, width: 68, height: 26 }
    const btn2Rect = { left: 120, top: 88, width: 68, height: 26 }
    const txt1Rect = { left: 48, top: 95, width: 36, height: 12 }
    const txt2Rect = { left: 136, top: 95, width: 36, height: 12 }
    const artRect = { left: 60, top: 24, width: 100, height: 34 }
    const badgeRect = { left: 140, top: 42, width: 24, height: 18 }

    const buttonPixel = (
      lx: number,
      ly: number,
      w: number,
      h: number
    ): [number, number, number] => {
      if (lx < 2 || lx >= w - 2 || ly < 2 || ly >= h - 2) return [218, 172, 54]
      // Distinct bright horizontal specular band at ly === 7..9 that push-pull text removal normally blurs
      if (ly >= 7 && ly <= 9) return [130, 198, 250]
      return [48, 108, 188]
    }

    const isArtGlyph = (lx: number, ly: number): boolean =>
      lx >= 8 &&
      lx < 92 &&
      ly >= 5 &&
      ly < 29 &&
      // Leave interior background gaps between stylized strokes
      !(lx >= 42 && lx < 56 && ly >= 4 && ly < 30)

    const renderFullScene = (withPanel: boolean): RgbaImage => {
      const img = createImage(cw, ch)
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          let rgb: [number, number, number] = [18, 22, 34]
          if (withPanel && inRect(x, y, panelRect)) {
            rgb = [38, 46, 68]
            if (inRect(x, y, btn1Rect)) {
              rgb = buttonPixel(
                x - btn1Rect.left,
                y - btn1Rect.top,
                btn1Rect.width,
                btn1Rect.height
              )
              if (inRect(x, y, txt1Rect) && (x - txt1Rect.left) % 5 < 2) rgb = [255, 255, 255]
            } else if (inRect(x, y, btn2Rect)) {
              rgb = buttonPixel(
                x - btn2Rect.left,
                y - btn2Rect.top,
                btn2Rect.width,
                btn2Rect.height
              )
              if (inRect(x, y, txt2Rect) && (x - txt2Rect.left) % 5 < 2) rgb = [255, 255, 255]
            } else if (inRect(x, y, artRect) && isArtGlyph(x - artRect.left, y - artRect.top)) {
              rgb = [238, 72, 54]
            }
            if (inRect(x, y, badgeRect)) {
              rgb = [56, 196, 112]
            }
          }
          const i = (y * cw + x) * 4
          img.data[i] = rgb[0]
          img.data[i + 1] = rgb[1]
          img.data[i + 2] = rgb[2]
          img.data[i + 3] = 255
        }
      }
      return img
    }

    const scene = renderFullScene(true)
    const cleanBase = renderFullScene(false)

    const vlmJson = JSON.stringify({
      screenKind: 'popup',
      background_repair_mode: 'scene',
      elements: [
        {
          id: 'p1',
          name: 'Dialog Panel',
          kind: 'panel',
          box_2d: toBox2d(panelRect, cw, ch),
          parent: null,
          order: 1
        },
        {
          id: 'btn1',
          name: 'Buy Button',
          kind: 'button',
          box_2d: toBox2d(btn1Rect, cw, ch),
          parent: 'p1',
          order: 2
        },
        {
          id: 'btn2',
          name: 'Sell Button',
          kind: 'button',
          box_2d: toBox2d(btn2Rect, cw, ch),
          parent: 'p1',
          order: 3
        },
        {
          id: 'art1',
          name: 'Victory Banner Art',
          kind: 'icon',
          box_2d: toBox2d(artRect, cw, ch),
          parent: 'p1',
          order: 4
        },
        {
          id: 'b1',
          name: 'New Tag',
          kind: 'badge',
          box_2d: toBox2d(badgeRect, cw, ch),
          parent: 'p1',
          order: 5
        },
        {
          id: 't1',
          name: 'Buy Text',
          kind: 'text',
          box_2d: toBox2d(txt1Rect, cw, ch),
          parent: 'btn1',
          order: 6,
          ocr: ['T1'],
          text: 'BUY'
        },
        {
          id: 't2',
          name: 'Sell Text',
          kind: 'text',
          box_2d: toBox2d(txt2Rect, cw, ch),
          parent: 'btn2',
          order: 7,
          ocr: ['T2'],
          text: 'SELL'
        }
      ]
    })

    let editImageCalls = 0
    let purifyCalls = 0

    const res = await runPreciseUiSplit(
      mockIo({
        vlm: async () => vlmJson,
        ocr: async () => [
          { ...txt1Rect, text: 'BUY', confidence: 0.98 },
          { ...txt2Rect, text: 'SELL', confidence: 0.98 }
        ],
        editImage: async () => {
          editImageCalls++
          return cleanBase
        },
        purifyLayerImage: async (req) => {
          purifyCalls++
          if (req.prompt.includes('Victory Banner Art')) {
            // Render unoccluded art-text on flat #FFFFFF studio bg with slightly shifted RGB [232, 78, 60]
            // to prove visible pixels stay 100% locked to original source [238, 72, 54]
            const sw = 120
            const sh = 50
            const studio = createImage(sw, sh)
            studio.data.fill(255)
            const ox = 10
            const oy = 8
            for (let ly = 0; ly < artRect.height; ly++) {
              for (let lx = 0; lx < artRect.width; lx++) {
                if (!isArtGlyph(lx, ly)) continue
                const si = ((oy + ly) * sw + (ox + lx)) * 4
                studio.data[si] = 232
                studio.data[si + 1] = 78
                studio.data[si + 2] = 60
                studio.data[si + 3] = 255
              }
            }
            return studio
          }
          if (req.prompt.includes('Button')) {
            const sw = 88
            const sh = 42
            const studio = createImage(sw, sh)
            studio.data.fill(255)
            const ox = 10
            const oy = 8
            for (let ly = 0; ly < btn1Rect.height; ly++) {
              for (let lx = 0; lx < btn1Rect.width; lx++) {
                const rgb = buttonPixel(lx, ly, btn1Rect.width, btn1Rect.height)
                const si = ((oy + ly) * sw + (ox + lx)) * 4
                studio.data[si] = rgb[0]
                studio.data[si + 1] = rgb[1]
                studio.data[si + 2] = rgb[2]
                studio.data[si + 3] = 255
              }
            }
            return studio
          }
          if (req.prompt.includes('Dialog Panel')) {
            const sw = panelRect.width + 20
            const sh = panelRect.height + 20
            const studio = createImage(sw, sh)
            studio.data.fill(255)
            for (let ly = 0; ly < panelRect.height; ly++) {
              for (let lx = 0; lx < panelRect.width; lx++) {
                const si = ((10 + ly) * sw + (10 + lx)) * 4
                studio.data[si] = 38
                studio.data[si + 1] = 46
                studio.data[si + 2] = 68
                studio.data[si + 3] = 255
              }
            }
            return studio
          }
          if (req.prompt.includes('New Tag')) {
            const sw = 44
            const sh = 36
            const studio = createImage(sw, sh)
            studio.data.fill(255)
            for (let ly = 0; ly < badgeRect.height; ly++) {
              for (let lx = 0; lx < badgeRect.width; lx++) {
                const si = ((9 + ly) * sw + (10 + lx)) * 4
                studio.data[si] = 56
                studio.data[si + 1] = 196
                studio.data[si + 2] = 112
                studio.data[si + 3] = 255
              }
            }
            return studio
          }
          return null
        }
      }),
      scene,
      { zoomRefine: false }
    )

    expect(purifyCalls).toBe(4)
    // Intermediate L3 / L2 whole-canvas 2K peels are skipped; only L1 Base scene repair calls editImage once!
    expect(editImageCalls).toBe(1)

    // Both buttons share a single clean studio-purified Smart Object master with intact specular band
    const btn1 = res.layers.find((l) => l.elementId === 'btn1')!
    const btn2 = res.layers.find((l) => l.elementId === 'btn2')!
    expect(btn1.componentId).toBeTruthy()
    expect(btn1.componentId).toBe(btn2.componentId)
    expect(res.synthesizedComponents?.some((c) => c.item.id === btn1.componentId)).toBe(true)
    const specularIdx = (8 * btn1.width + 24) * 4
    expect(btn1.rgba[specularIdx + 2]!).toBeGreaterThan(220)

    // Art-text layer:
    // 1) Concave gap between strokes (lx=48, ly=16 -> canvas x=108, y=40) is clean transparent (alpha === 0)
    // 2) Visible unoccluded glyph stroke (canvas x=75, y=36) is 100% pixel-locked to source [238, 72, 54, 255]
    // 3) Occluded glyph stroke under New Tag badge (canvas x=144, y=46) is cleanly completed (alpha === 255, crimson)
    const art = res.layers.find((l) => l.elementId === 'art1')!
    const gapOff = ((40 - art.top) * art.width + (108 - art.left)) * 4
    expect(art.rgba[gapOff + 3]!).toBe(0)

    const visOff = ((36 - art.top) * art.width + (75 - art.left)) * 4
    expect([
      art.rgba[visOff]!,
      art.rgba[visOff + 1]!,
      art.rgba[visOff + 2]!,
      art.rgba[visOff + 3]!
    ]).toEqual([238, 72, 54, 255])

    const occOff = ((46 - art.top) * art.width + (144 - art.left)) * 4
    expect(art.rgba[occOff + 3]!).toBeGreaterThanOrEqual(240)
    expect(art.rgba[occOff]!).toBeGreaterThan(200)
    expect(art.rgba[occOff + 1]!).toBeLessThan(110)
  })

  it('purifies > 24 distinct UI elements without budget caps and fails fast without falling back to local on studio failure', async () => {
    const cw = 300
    const ch = 200
    const scene = createImage(cw, ch)
    const cleanBase = createImage(cw, ch)
    for (let p = 0; p < cw * ch; p++) {
      scene.data[p * 4] = 16
      scene.data[p * 4 + 1] = 20
      scene.data[p * 4 + 2] = 32
      scene.data[p * 4 + 3] = 255
      cleanBase.data.set([16, 20, 32, 255], p * 4)
    }

    const elements: Array<{
      id: string
      name: string
      kind: string
      box_2d: [number, number, number, number]
      parent: null
      order: number
    }> = []

    // Place 28 distinct icons (7 cols x 4 rows) exceeding the former 24-call budget limit
    for (let idx = 0; idx < 28; idx++) {
      const col = idx % 7
      const row = Math.floor(idx / 7)
      const rect = { left: 12 + col * 40, top: 14 + row * 44, width: 28, height: 28 }
      const rCol = 60 + ((idx * 37) % 180)
      const gCol = 50 + ((idx * 61) % 185)
      const bCol = 70 + ((idx * 89) % 175)
      for (let y = rect.top; y < rect.top + rect.height; y++) {
        for (let x = rect.left; x < rect.left + rect.width; x++) {
          const i = (y * cw + x) * 4
          scene.data[i] = rCol
          scene.data[i + 1] = gCol
          scene.data[i + 2] = bCol
          scene.data[i + 3] = 255
        }
      }
      elements.push({
        id: `icon_${idx + 1}`,
        name: `Skill Icon ${idx + 1}`,
        kind: 'icon',
        box_2d: toBox2d(rect, cw, ch),
        parent: null,
        order: idx + 1
      })
    }

    const vlmJson = JSON.stringify({
      screenKind: 'fullscreen',
      background_repair_mode: 'surface',
      elements
    })

    let purifyCalls = 0
    let editCalls = 0
    const res = await runPreciseUiSplit(
      mockIo({
        vlm: async () => vlmJson,
        editImage: async () => {
          editCalls++
          return cleanBase
        },
        purifyLayerImage: async () => {
          purifyCalls++
          const studio = createImage(48, 48)
          studio.data.fill(255)
          for (let ly = 0; ly < 28; ly++) {
            for (let lx = 0; lx < 28; lx++) {
              const si = ((10 + ly) * 48 + (10 + lx)) * 4
              studio.data[si] = 90
              studio.data[si + 1] = 150
              studio.data[si + 2] = 220
              studio.data[si + 3] = 255
            }
          }
          return studio
        }
      }),
      scene,
      { zoomRefine: false }
    )

    expect(purifyCalls).toBe(28)
    expect(res.companionPurifiedCount).toBe(28)
    expect(editCalls).toBe(1)

    // Verify studio failure throws instead of silently degrading to local segmentation
    await expect(
      runPreciseUiSplit(
        mockIo({
          vlm: async () => vlmJson,
          editImage: async () => cleanBase,
          purifyLayerImage: async () => null
        }),
        scene,
        { zoomRefine: false }
      )
    ).rejects.toThrow(/PRECISE_SPLIT_PURIFY_FAILED/)
  })

  it('recovers 50% translucent glassmorphism HUD bar with opaque gold border and punches enclosed art-text holes', async () => {
    const cw = 220
    const ch = 120
    const hudRect = { left: 20, top: 14, width: 180, height: 34 }
    const txtRect = { left: 86, top: 24, width: 44, height: 14 }
    const ringArtRect = { left: 88, top: 64, width: 44, height: 44 }

    const cleanBase = createImage(cw, ch)
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const t = x / Math.max(1, cw - 1)
        const i = (y * cw + x) * 4
        cleanBase.data[i] = Math.round(50 + 180 * t)
        cleanBase.data[i + 1] = Math.round(120 + 10 * t)
        cleanBase.data[i + 2] = Math.round(215 - 150 * t)
        cleanBase.data[i + 3] = 255
      }
    }

    const scene = createImage(cw, ch)
    scene.data.set(cleanBase.data)

    // 1) Draw HUD bar: 2px 100%-opaque gold border + 50%-translucent dark glass interior ([18, 22, 34], alpha=0.5)
    for (let y = hudRect.top; y < hudRect.top + hudRect.height; y++) {
      for (let x = hudRect.left; x < hudRect.left + hudRect.width; x++) {
        const lx = x - hudRect.left
        const ly = y - hudRect.top
        const i = (y * cw + x) * 4
        const isBorder = lx < 2 || lx >= hudRect.width - 2 || ly < 2 || ly >= hudRect.height - 2
        if (isBorder) {
          scene.data[i] = 228
          scene.data[i + 1] = 180
          scene.data[i + 2] = 56
        } else {
          scene.data[i] = Math.round(0.5 * 18 + 0.5 * cleanBase.data[i]!)
          scene.data[i + 1] = Math.round(0.5 * 22 + 0.5 * cleanBase.data[i + 1]!)
          scene.data[i + 2] = Math.round(0.5 * 34 + 0.5 * cleanBase.data[i + 2]!)
        }
        if (inRect(x, y, txtRect) && ((x - txtRect.left) % 5 < 2 || y === 31)) {
          scene.data[i] = 255
          scene.data[i + 1] = 255
          scene.data[i + 2] = 255
        }
      }
    }

    // 2) Draw hollow 'O' art-text with a completely enclosed background hole in its center
    for (let y = ringArtRect.top; y < ringArtRect.top + ringArtRect.height; y++) {
      for (let x = ringArtRect.left; x < ringArtRect.left + ringArtRect.width; x++) {
        const d = Math.hypot(x - (ringArtRect.left + 21.5), y - (ringArtRect.top + 21.5))
        if (d >= 8 && d <= 18) {
          const i = (y * cw + x) * 4
          scene.data[i] = 242
          scene.data[i + 1] = 76
          scene.data[i + 2] = 62
        }
      }
    }

    const vlmJson = JSON.stringify({
      screenKind: 'hud',
      background_repair_mode: 'scene',
      elements: [
        {
          id: 'hud1',
          name: 'Top Glass HUD',
          kind: 'panel',
          box_2d: toBox2d(hudRect, cw, ch),
          parent: null,
          order: 1
        },
        {
          id: 't_hud',
          name: 'Gold Count',
          kind: 'text',
          box_2d: toBox2d(txtRect, cw, ch),
          parent: 'hud1',
          order: 2,
          ocr: ['T1'],
          text: '1250'
        },
        {
          id: 'art_o',
          name: 'Hollow Ring Emblem',
          kind: 'art-text',
          box_2d: toBox2d(ringArtRect, cw, ch),
          parent: null,
          order: 3,
          text: 'O'
        }
      ]
    })

    const res = await runPreciseUiSplit(
      mockIo({
        vlm: async () => vlmJson,
        ocr: async () => [{ ...txtRect, text: '1250', confidence: 0.98 }],
        editImage: async () => cleanBase,
        purifyLayerImage: async (req) => {
          if (req.prompt.includes('Top Glass HUD')) {
            // AI renders HUD bar as solid opaque slate on #FFFFFF studio bg (losing translucency)
            const sw = hudRect.width + 16
            const sh = hudRect.height + 16
            const studio = createImage(sw, sh)
            studio.data.fill(255)
            for (let ly = 0; ly < hudRect.height; ly++) {
              for (let lx = 0; lx < hudRect.width; lx++) {
                const isBorder =
                  lx < 2 || lx >= hudRect.width - 2 || ly < 2 || ly >= hudRect.height - 2
                const si = ((8 + ly) * sw + (8 + lx)) * 4
                studio.data[si] = isBorder ? 228 : 80
                studio.data[si + 1] = isBorder ? 180 : 72
                studio.data[si + 2] = isBorder ? 56 : 86
                studio.data[si + 3] = 255
              }
            }
            return studio
          }
          // Hollow 'O' on #FFFFFF studio bg: center hole is completely enclosed white #FFFFFF
          const sw = 64
          const sh = 64
          const studio = createImage(sw, sh)
          studio.data.fill(255)
          for (let ly = 0; ly < ringArtRect.height; ly++) {
            for (let lx = 0; lx < ringArtRect.width; lx++) {
              const d = Math.hypot(lx - 21.5, ly - 21.5)
              if (d >= 8 && d <= 18) {
                const si = ((10 + ly) * sw + (10 + lx)) * 4
                studio.data[si] = 242
                studio.data[si + 1] = 76
                studio.data[si + 2] = 62
                studio.data[si + 3] = 255
              }
            }
          }
          return studio
        }
      }),
      scene,
      { zoomRefine: false }
    )

    const hud = res.layers.find((l) => l.elementId === 'hud1')!
    // 1) Gold border stays 100% opaque
    const borderOff = (0 * hud.width + 20) * 4
    expect(hud.rgba[borderOff + 3]!).toBeGreaterThanOrEqual(245)
    // 2) Right-side interior (over orange sunset bg [210,129,82]) recovers ~50% alpha (~128) and dark glass RGB (no orange bleed!)
    const glassRightOff = (16 * hud.width + 150) * 4
    expect(hud.rgba[glassRightOff + 3]!).toBeGreaterThanOrEqual(112)
    expect(hud.rgba[glassRightOff + 3]!).toBeLessThanOrEqual(144)
    expect(hud.rgba[glassRightOff]!).toBeLessThan(36)
    // 3) Occluded center under "1250" text ALSO gets smooth ~50% translucent dark glass (zero white text scar!)
    const glassUnderTextOff = (17 * hud.width + 86) * 4
    expect(hud.rgba[glassUnderTextOff + 3]!).toBeGreaterThanOrEqual(110)
    expect(hud.rgba[glassUnderTextOff + 3]!).toBeLessThanOrEqual(146)
    expect(hud.rgba[glassUnderTextOff]!).toBeLessThan(40)

    // 4) Hollow 'O' art-text center hole is punched cleanly to alpha = 0 while ring stroke stays opaque crimson
    const artO = res.layers.find((l) => l.elementId === 'art_o')!
    const holeCx = 110 - artO.left
    const holeCy = 86 - artO.top
    expect(artO.rgba[(holeCy * artO.width + holeCx) * 4 + 3]!).toBe(0)
    const strokeCx = 110 - artO.left
    const strokeCy = 73 - artO.top
    expect(artO.rgba[(strokeCy * artO.width + strokeCx) * 4 + 3]!).toBe(255)
    expect(artO.rgba[(strokeCy * artO.width + strokeCx) * 4]!).toBe(242)
  })

  it('preserves singleton panel fine texture, aligns drifted VLM button boxes, and merges zoomRefine non-destructively', async () => {
    const cw = 240
    const ch = 150
    const panelRect = { left: 20, top: 16, width: 200, height: 118 }
    const closeRect = { left: 204, top: 10, width: 22, height: 22 }
    const trueBtnRect = { left: 82, top: 96, width: 76, height: 26 }
    // Intentionally drift VLM button box by (+3px, -2px) to test sub-pixel control registration
    const driftedBtnRect = { left: 85, top: 94, width: 76, height: 26 }
    const smallIconRect = { left: 40, top: 36, width: 20, height: 20 }

    const cleanBase = createImage(cw, ch)
    for (let p = 0; p < cw * ch; p++) {
      cleanBase.data.set([14, 18, 28, 255], p * 4)
    }
    const scene = createImage(cw, ch)
    scene.data.set(cleanBase.data)

    for (let y = panelRect.top; y < panelRect.top + panelRect.height; y++) {
      for (let x = panelRect.left; x < panelRect.left + panelRect.width; x++) {
        const checker = ((x + y) & 1) === 0
        const i = (y * cw + x) * 4
        scene.data[i] = checker ? 42 : 58
        scene.data[i + 1] = checker ? 50 : 68
        scene.data[i + 2] = checker ? 74 : 96
      }
    }
    for (let y = smallIconRect.top; y < smallIconRect.top + smallIconRect.height; y++) {
      for (let x = smallIconRect.left; x < smallIconRect.left + smallIconRect.width; x++) {
        scene.data.set([245, 196, 48, 255], (y * cw + x) * 4)
      }
    }
    for (let y = trueBtnRect.top; y < trueBtnRect.top + trueBtnRect.height; y++) {
      for (let x = trueBtnRect.left; x < trueBtnRect.left + trueBtnRect.width; x++) {
        const onRim =
          x - trueBtnRect.left < 2 ||
          x - trueBtnRect.left >= trueBtnRect.width - 2 ||
          y - trueBtnRect.top < 2 ||
          y - trueBtnRect.top >= trueBtnRect.height - 2
        scene.data.set(onRim ? [230, 182, 58, 255] : [44, 122, 214, 255], (y * cw + x) * 4)
      }
    }
    for (let y = closeRect.top; y < closeRect.top + closeRect.height; y++) {
      for (let x = closeRect.left; x < closeRect.left + closeRect.width; x++) {
        scene.data.set([220, 62, 68, 255], (y * cw + x) * 4)
      }
    }

    let vlmPass = 0
    const res = await runPreciseUiSplit(
      mockIo({
        vlm: async () => {
          vlmPass++
          if (vlmPass === 1) {
            // Coarse pass: misses `smallIconRect`, includes corner-straddling `closeRect`, and drifts `btn`
            return JSON.stringify({
              screenKind: 'popup',
              background_repair_mode: 'scene',
              elements: [
                {
                  id: 'p_main',
                  name: 'Main Panel',
                  kind: 'panel',
                  box_2d: toBox2d(panelRect, cw, ch),
                  parent: null,
                  order: 1
                },
                {
                  id: 'btn_ok',
                  name: 'OK Button',
                  kind: 'button',
                  box_2d: toBox2d(driftedBtnRect, cw, ch),
                  parent: 'p_main',
                  order: 2
                },
                {
                  id: 'btn_close',
                  name: 'Corner Close',
                  kind: 'close-button',
                  box_2d: toBox2d(closeRect, cw, ch),
                  parent: 'p_main',
                  order: 3
                }
              ]
            })
          }
          // Zoomed pass on `p_main` crop: re-detects `p_main` itself (must be deduped!), recalls `smallIconRect`,
          // and omits `btn_close` (must be preserved by non-destructive union merge!)
          const pad = Math.round(Math.max(cw, ch) * 0.015)
          const crop = {
            left: Math.max(0, panelRect.left - pad),
            top: Math.max(0, panelRect.top - pad),
            width:
              Math.min(cw, panelRect.left + panelRect.width + pad) -
              Math.max(0, panelRect.left - pad),
            height:
              Math.min(ch, panelRect.top + panelRect.height + pad) -
              Math.max(0, panelRect.top - pad)
          }
          const toZoomBox = (r: { left: number; top: number; width: number; height: number }) =>
            toBox2d(
              {
                left: r.left - crop.left,
                top: r.top - crop.top,
                width: r.width,
                height: r.height
              },
              crop.width,
              crop.height
            )
          return JSON.stringify({
            elements: [
              {
                id: 'dup_panel',
                name: 'Main Panel Duplicate',
                kind: 'panel',
                box_2d: toZoomBox(panelRect),
                parent: null,
                order: 1
              },
              {
                id: 'icon_recalled',
                name: 'Star Icon',
                kind: 'icon',
                box_2d: toZoomBox(smallIconRect),
                parent: 'dup_panel',
                order: 2
              },
              {
                id: 'btn_ok_z',
                name: 'OK Button',
                kind: 'button',
                box_2d: toZoomBox(driftedBtnRect),
                parent: 'dup_panel',
                order: 3
              }
            ]
          })
        },
        editImage: async () => cleanBase,
        purifyLayerImage: async (req) => {
          if (req.prompt.includes('Main Panel')) {
            // Studio redraw smoothed out the checkerboard texture to flat [50, 59, 85]
            const sw = panelRect.width + 16
            const sh = panelRect.height + 16
            const s = createImage(sw, sh)
            s.data.fill(255)
            for (let ly = 0; ly < panelRect.height; ly++) {
              for (let lx = 0; lx < panelRect.width; lx++) {
                s.data.set([50, 59, 85, 255], ((8 + ly) * sw + (8 + lx)) * 4)
              }
            }
            return s
          }
          if (req.prompt.includes('OK Button')) {
            const sw = trueBtnRect.width + 16
            const sh = trueBtnRect.height + 16
            const s = createImage(sw, sh)
            s.data.fill(255)
            for (let ly = 0; ly < trueBtnRect.height; ly++) {
              for (let lx = 0; lx < trueBtnRect.width; lx++) {
                const onRim =
                  lx < 2 || lx >= trueBtnRect.width - 2 || ly < 2 || ly >= trueBtnRect.height - 2
                s.data.set(
                  onRim ? [230, 182, 58, 255] : [44, 122, 214, 255],
                  ((8 + ly) * sw + (8 + lx)) * 4
                )
              }
            }
            return s
          }
          if (req.prompt.includes('Corner Close')) {
            const s = createImage(40, 40)
            s.data.fill(255)
            for (let ly = 0; ly < closeRect.height; ly++) {
              for (let lx = 0; lx < closeRect.width; lx++) {
                s.data.set([220, 62, 68, 255], ((9 + ly) * 40 + (9 + lx)) * 4)
              }
            }
            return s
          }
          const s = createImage(38, 38)
          s.data.fill(255)
          for (let ly = 0; ly < smallIconRect.height; ly++) {
            for (let lx = 0; lx < smallIconRect.width; lx++) {
              s.data.set([245, 196, 48, 255], ((9 + ly) * 38 + (9 + lx)) * 4)
            }
          }
          return s
        }
      }),
      scene,
      { zoomRefine: true }
    )

    // 1) Self-panel duplicate was dropped; zoomed Star Icon was recalled; coarse Corner Close was preserved!
    expect(res.layers.filter((l) => l.kind === 'panel')).toHaveLength(1)
    expect(res.layers.some((l) => l.name === 'Star Icon')).toBe(true)
    expect(res.layers.some((l) => l.name === 'Corner Close')).toBe(true)

    // 2) Singleton Main Panel keeps 100% authentic checkerboard micro-pattern on unoccluded pixels,
    //    and grafts smooth studio skin [50, 59, 85] cleanly under OK Button!
    const panel = res.layers.find((l) => l.elementId === 'p_main')!
    const visEven = ((60 - panel.top) * panel.width + (60 - panel.left)) * 4
    const visOdd = ((60 - panel.top) * panel.width + (61 - panel.left)) * 4
    expect([panel.rgba[visEven]!, panel.rgba[visEven + 1]!, panel.rgba[visEven + 2]!]).toEqual([
      42, 50, 74
    ])
    expect([panel.rgba[visOdd]!, panel.rgba[visOdd + 1]!, panel.rgba[visOdd + 2]!]).toEqual([
      58, 68, 96
    ])
    const underBtn = ((108 - panel.top) * panel.width + (116 - panel.left)) * 4
    expect(panel.rgba[underBtn + 2]!).toBeLessThan(110) // Not OK Button's bright blue 214!

    // 3) Drifted OK Button (+3px, -2px) snapped back to exact `trueBtnRect`!
    const okBtn = res.layers.find((l) => l.name === 'OK Button')!
    expect(Math.abs(okBtn.left - trueBtnRect.left)).toBeLessThanOrEqual(1)
    expect(Math.abs(okBtn.top - trueBtnRect.top)).toBeLessThanOrEqual(1)
  })
})

describe('uiPreciseSplit · 5 remaining precision boundaries', () => {
  it('Boundary 1: unmixes Screen and Linear Dodge emissive glows with clamped-core hue recovery and preserves PSD blendMode', async () => {
    const cw = 220
    const ch = 124
    const screenRect = { left: 18, top: 24, width: 76, height: 76 }
    const dodgeRect = { left: 120, top: 24, width: 80, height: 76 }

    const cleanBase = createImage(cw, ch)
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const tx = x / Math.max(1, cw - 1)
        const ty = y / Math.max(1, ch - 1)
        const i = (y * cw + x) * 4
        cleanBase.data[i] = Math.round(28 + 30 * tx)
        cleanBase.data[i + 1] = Math.round(34 + 18 * ty)
        cleanBase.data[i + 2] = Math.round(62 + 24 * tx)
        cleanBase.data[i + 3] = 255
      }
    }

    const scene = createImage(cw, ch)
    scene.data.set(cleanBase.data)

    // 1) Soft cyan Screen halo (`S = B + alpha * G * (1 - B/255)`), peak below 240 -> auto-classified as 'screen'
    const screenColor: [number, number, number] = [36, 212, 246]
    for (let y = screenRect.top; y < screenRect.top + screenRect.height; y++) {
      for (let x = screenRect.left; x < screenRect.left + screenRect.width; x++) {
        const d = Math.hypot(x - (screenRect.left + 37.5), y - (screenRect.top + 37.5))
        if (d >= 34) continue
        const a = 0.72 * (1 - d / 34)
        const i = (y * cw + x) * 4
        for (let c = 0; c < 3; c++) {
          const b = cleanBase.data[i + c]! / 255
          const g = screenColor[c]! / 255
          scene.data[i + c] = Math.min(255, Math.round((b + a * g * (1 - b)) * 255))
        }
      }
    }

    // 2) Hot golden Linear Dodge beam (`S = min(255, B + alpha * G)`), center clamps to 255 -> 'linear dodge'
    const dodgeColor: [number, number, number] = [255, 198, 62]
    for (let y = dodgeRect.top; y < dodgeRect.top + dodgeRect.height; y++) {
      for (let x = dodgeRect.left; x < dodgeRect.left + dodgeRect.width; x++) {
        const d = Math.hypot(x - (dodgeRect.left + 39.5), y - (dodgeRect.top + 37.5))
        if (d >= 35) continue
        const a = d <= 14 ? 1 : Math.max(0, 1 - (d - 14) / 21)
        const i = (y * cw + x) * 4
        for (let c = 0; c < 3; c++) {
          scene.data[i + c] = Math.min(255, Math.round(cleanBase.data[i + c]! + a * dodgeColor[c]!))
        }
      }
    }

    const vlmJson = JSON.stringify({
      screenKind: 'hud',
      background_repair_mode: 'scene',
      elements: [
        {
          id: 'g_screen',
          name: 'Cyan Aura',
          kind: 'glow',
          box_2d: toBox2d(screenRect, cw, ch),
          parent: null,
          order: 1
        },
        {
          id: 'g_dodge',
          name: 'Golden Burst',
          kind: 'glow',
          box_2d: toBox2d(dodgeRect, cw, ch),
          parent: null,
          order: 2
        }
      ]
    })

    const res = await runPreciseUiSplit(
      mockIo({
        vlm: async () => vlmJson,
        editImage: async () => cleanBase,
        purifyLayerImage: async () => null
      }),
      scene,
      { zoomRefine: false }
    )

    const cyanLayer = res.layers.find((l) => l.elementId === 'g_screen')!
    const goldLayer = res.layers.find((l) => l.elementId === 'g_dodge')!
    expect(cyanLayer.blendMode).toBe('screen')
    expect(goldLayer.blendMode).toBe('linear dodge')

    // Soft cyan halo pixel has translucent alpha & cyan hue without dark navy background chunks
    const cyanMid = ((56 - cyanLayer.top) * cyanLayer.width + (44 - cyanLayer.left)) * 4
    expect(cyanLayer.rgba[cyanMid + 3]!).toBeGreaterThan(35)
    expect(cyanLayer.rgba[cyanMid + 3]!).toBeLessThan(215)
    expect(cyanLayer.rgba[cyanMid + 2]!).toBeGreaterThan(cyanLayer.rgba[cyanMid]! + 110)

    // Clamped 255 hot core preserves warm golden hue (`R > B + 80`) instead of desaturating to flat grey
    const goldCore = ((62 - goldLayer.top) * goldLayer.width + (160 - goldLayer.left)) * 4
    expect(goldLayer.rgba[goldCore + 3]!).toBeGreaterThan(170)
    expect(goldLayer.rgba[goldCore]!).toBeGreaterThan(goldLayer.rgba[goldCore + 2]! + 80)
    expect(res.reconstructionError).toBeLessThan(1.5)

    // Verify full normalization + PSD binary round-trip (`ag-psd` write -> read)
    const store = new Map<string, RgbaImage>()
    let idSeq = 0
    const mapped = await mapPreciseResultToLayers(res, {
      idPrefix: 'b1',
      encodePng: async (rgba) => {
        idSeq++
        const url = `data:image/png;base64,B1_${idSeq}`
        store.set(url, rgba)
        return url
      }
    })
    const normalized = normalizeImageLayerSplit({
      sourceImageId: 'src',
      canvasWidth: cw,
      canvasHeight: ch,
      layers: mapped.layers
    })!
    const layerUrls: Record<string, string> = {}
    for (const item of mapped.batch) layerUrls[item.id] = item.dataUrl
    const psdBytes = await layerSplitToPsdUint8Array({
      state: normalized,
      layerUrls,
      decodeRgba: async (src) => {
        const hit = store.get(src)!
        return { data: hit.data, width: hit.width, height: hit.height }
      }
    })
    const parsedPsd = readPsd(psdBytes, {
      skipLayerImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true
    })
    const psdChildren = parsedPsd.children ?? []
    expect(psdChildren.find((c) => c.name === 'Cyan Aura')?.blendMode).toBe('screen')
    expect(psdChildren.find((c) => c.name === 'Golden Burst')?.blendMode).toBe('linear dodge')
  })

  it('Boundary 2: recovers blurred frosted glass (backdrop-filter: blur) and continuous spatial gradient-alpha scrims', async () => {
    const cw = 240
    const ch = 152
    const frostedRect = { left: 20, top: 14, width: 200, height: 54 }
    const scrimRect = { left: 20, top: 84, width: 200, height: 52 }

    // Top half: 32px coral-red / sky-blue blocks (sharp step edges + full contrast after R=4 blur)
    // Bottom half: 10px stripes so local pairs (`dist <= 16px`) inside scrim sample crisp jumps
    const cleanBase = createImage(cw, ch)
    for (let y = 0; y < ch; y++) {
      const stripeW = y < 76 ? 32 : 10
      for (let x = 0; x < cw; x++) {
        const isRed = Math.floor(x / stripeW) % 2 === 0
        const i = (y * cw + x) * 4
        cleanBase.data[i] = isRed ? 232 : 40
        cleanBase.data[i + 1] = isRed ? 74 : 176
        cleanBase.data[i + 2] = isRed ? 58 : 230
        cleanBase.data[i + 3] = 255
      }
    }

    // Build 2-pass R=4 box-blurred backdrop to simulate `backdrop-filter: blur(5px)`
    const blurPass = (src: Uint8ClampedArray): Uint8ClampedArray => {
      const tmp = new Uint8ClampedArray(src.length)
      const dst = new Uint8ClampedArray(src.length)
      const r = 4
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          let sr = 0
          let sg = 0
          let sb = 0
          let cnt = 0
          for (let dx = -r; dx <= r; dx++) {
            const sx = Math.max(0, Math.min(cw - 1, x + dx))
            const si = (y * cw + sx) * 4
            sr += src[si]!
            sg += src[si + 1]!
            sb += src[si + 2]!
            cnt++
          }
          const di = (y * cw + x) * 4
          tmp[di] = Math.round(sr / cnt)
          tmp[di + 1] = Math.round(sg / cnt)
          tmp[di + 2] = Math.round(sb / cnt)
          tmp[di + 3] = 255
        }
      }
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          let sr = 0
          let sg = 0
          let sb = 0
          let cnt = 0
          for (let dy = -r; dy <= r; dy++) {
            const sy = Math.max(0, Math.min(ch - 1, y + dy))
            const si = (sy * cw + x) * 4
            sr += tmp[si]!
            sg += tmp[si + 1]!
            sb += tmp[si + 2]!
            cnt++
          }
          const di = (y * cw + x) * 4
          dst[di] = Math.round(sr / cnt)
          dst[di + 1] = Math.round(sg / cnt)
          dst[di + 2] = Math.round(sb / cnt)
          dst[di + 3] = 255
        }
      }
      return dst
    }
    const blurredBg = blurPass(blurPass(cleanBase.data))

    const scene = createImage(cw, ch)
    scene.data.set(cleanBase.data)

    // 1) Frosted glass card: 2px opaque gold border + 50% dark slate tint over `blurredBg`
    for (let y = frostedRect.top; y < frostedRect.top + frostedRect.height; y++) {
      for (let x = frostedRect.left; x < frostedRect.left + frostedRect.width; x++) {
        const lx = x - frostedRect.left
        const ly = y - frostedRect.top
        const onBorder =
          lx < 2 || lx >= frostedRect.width - 2 || ly < 2 || ly >= frostedRect.height - 2
        const i = (y * cw + x) * 4
        if (onBorder) {
          scene.data.set([228, 182, 56, 255], i)
        } else {
          scene.data[i] = Math.round(0.5 * 22 + 0.5 * blurredBg[i]!)
          scene.data[i + 1] = Math.round(0.5 * 28 + 0.5 * blurredBg[i + 1]!)
          scene.data[i + 2] = Math.round(0.5 * 46 + 0.5 * blurredBg[i + 2]!)
        }
      }
    }

    // 2) Continuous spatial gradient-alpha scrim: alpha fades smoothly from 0.84 on left to 0.14 on right
    for (let y = scrimRect.top; y < scrimRect.top + scrimRect.height; y++) {
      for (let x = scrimRect.left; x < scrimRect.left + scrimRect.width; x++) {
        const u = (x - scrimRect.left) / Math.max(1, scrimRect.width - 1)
        const a = 0.84 - 0.7 * u
        const i = (y * cw + x) * 4
        scene.data[i] = Math.round(a * 16 + (1 - a) * cleanBase.data[i]!)
        scene.data[i + 1] = Math.round(a * 20 + (1 - a) * cleanBase.data[i + 1]!)
        scene.data[i + 2] = Math.round(a * 34 + (1 - a) * cleanBase.data[i + 2]!)
      }
    }

    const vlmJson = JSON.stringify({
      screenKind: 'hud',
      background_repair_mode: 'scene',
      elements: [
        {
          id: 'frost1',
          name: 'Frosted Blur Card',
          kind: 'panel',
          box_2d: toBox2d(frostedRect, cw, ch),
          parent: null,
          order: 1
        },
        {
          id: 'scrim1',
          name: 'Fade Scrim Banner',
          kind: 'banner',
          box_2d: toBox2d(scrimRect, cw, ch),
          parent: null,
          order: 2
        }
      ]
    })

    const res = await runPreciseUiSplit(
      mockIo({
        vlm: async () => vlmJson,
        editImage: async () => cleanBase,
        purifyLayerImage: async (req) => {
          if (req.prompt.includes('Frosted Blur Card')) {
            const sw = frostedRect.width + 16
            const sh = frostedRect.height + 16
            const s = createImage(sw, sh)
            s.data.fill(255)
            for (let ly = 0; ly < frostedRect.height; ly++) {
              for (let lx = 0; lx < frostedRect.width; lx++) {
                const onBorder =
                  lx < 2 || lx >= frostedRect.width - 2 || ly < 2 || ly >= frostedRect.height - 2
                s.data.set(
                  onBorder ? [228, 182, 56, 255] : [88, 96, 114, 255],
                  ((8 + ly) * sw + (8 + lx)) * 4
                )
              }
            }
            return s
          }
          // Studio renders gradient scrim with horizontal color ramp (breaking single-bucket global slope!)
          const sw = scrimRect.width + 16
          const sh = scrimRect.height + 16
          const s = createImage(sw, sh)
          s.data.fill(255)
          for (let ly = 0; ly < scrimRect.height; ly++) {
            for (let lx = 0; lx < scrimRect.width; lx++) {
              const u = lx / Math.max(1, scrimRect.width - 1)
              s.data.set(
                [Math.round(24 + 140 * u), Math.round(28 + 135 * u), Math.round(44 + 125 * u), 255],
                ((8 + ly) * sw + (8 + lx)) * 4
              )
            }
          }
          return s
        }
      }),
      scene,
      { zoomRefine: false }
    )

    // 1) Frosted glass card detects `backdropBlurRadius >= 2`, keeps gold border opaque, and recovers ~50% dark tint
    const frost = res.layers.find((l) => l.elementId === 'frost1')!
    expect(frost.backdropBlurRadius).toBeGreaterThanOrEqual(2)
    const frostBorder = (0 * frost.width + 24) * 4
    expect(frost.rgba[frostBorder + 3]!).toBeGreaterThanOrEqual(240)
    // Sample across the blurred red/blue step boundary (`x = 64` -> `lx = 44`): unblurred would leave huge step ghost!
    const frostLeftOfEdge = (26 * frost.width + 41) * 4
    const frostRightOfEdge = (26 * frost.width + 47) * 4
    expect(frost.rgba[frostLeftOfEdge + 3]!).toBeGreaterThanOrEqual(105)
    expect(frost.rgba[frostLeftOfEdge + 3]!).toBeLessThanOrEqual(152)
    expect(
      Math.abs(frost.rgba[frostLeftOfEdge]! - frost.rgba[frostRightOfEdge]!)
    ).toBeLessThanOrEqual(18)

    // 2) Continuous spatial gradient-alpha scrim recovers smooth monotonic left->right opacity decay
    const scrim = res.layers.find((l) => l.elementId === 'scrim1')!
    const aLeft = scrim.rgba[(26 * scrim.width + 16) * 4 + 3]!
    const aMid = scrim.rgba[(26 * scrim.width + 100) * 4 + 3]!
    const aRight = scrim.rgba[(26 * scrim.width + 184) * 4 + 3]!
    expect(aLeft).toBeGreaterThan(170)
    expect(aMid).toBeGreaterThan(90)
    expect(aMid).toBeLessThan(155)
    expect(aRight).toBeLessThan(70)
    expect(aLeft).toBeGreaterThan(aMid + 35)
    expect(aMid).toBeGreaterThan(aRight + 35)
  })

  it('Boundary 3 & 5b: recovers protruding hair strands + pure soft drop shadows and mirrors symmetric texture into heavy occlusions', async () => {
    const cw = 248
    const ch = 148
    const avatarRect = { left: 20, top: 24, width: 56, height: 56 }
    const cardRect = { left: 20, top: 96, width: 72, height: 32 }
    const symBannerRect = { left: 112, top: 28, width: 112, height: 52 }
    const occGemRect = { left: 188, top: 36, width: 28, height: 36 }

    // Bright warm cream backdrop so neutral dark drop shadows are cleanly measurable
    const cleanBase = createImage(cw, ch)
    for (let p = 0; p < cw * ch; p++) {
      cleanBase.data.set([230, 224, 212, 255], p * 4)
    }
    const scene = createImage(cw, ch)
    scene.data.set(cleanBase.data)

    // 1A) Hero avatar (`[188, 42, 64]`) + 2px protruding hair strand extending 2px right of `avatarRect` (`x = 76..77, y = 44..46`)
    for (let y = avatarRect.top; y < avatarRect.top + avatarRect.height; y++) {
      for (let x = avatarRect.left; x < avatarRect.left + avatarRect.width; x++) {
        scene.data.set([188, 42, 64, 255], (y * cw + x) * 4)
      }
    }
    for (let y = 44; y <= 46; y++) {
      for (let x = 76; x <= 77; x++) {
        // 80%-alpha fine crimson hair strand over cream backdrop
        const i = (y * cw + x) * 4
        scene.data[i] = Math.round(0.8 * 188 + 0.2 * 230)
        scene.data[i + 1] = Math.round(0.8 * 42 + 0.2 * 224)
        scene.data[i + 2] = Math.round(0.8 * 64 + 0.2 * 212)
      }
    }

    // 1B) Button card (`[44, 118, 212]`) + soft neutral drop shadow extending 4px below `cardRect` (`y = 128..131`)
    for (let y = cardRect.top; y < cardRect.top + cardRect.height; y++) {
      for (let x = cardRect.left; x < cardRect.left + cardRect.width; x++) {
        scene.data.set([44, 118, 212, 255], (y * cw + x) * 4)
      }
    }
    const shAlphas = [0.28, 0.21, 0.14, 0.09]
    for (let dy = 0; dy < shAlphas.length; dy++) {
      const aSh = shAlphas[dy]!
      const y = cardRect.top + cardRect.height + dy
      for (let x = cardRect.left + 4; x < cardRect.left + cardRect.width - 4; x++) {
        const i = (y * cw + x) * 4
        scene.data[i] = Math.round((1 - aSh) * 230)
        scene.data[i + 1] = Math.round((1 - aSh) * 224)
        scene.data[i + 2] = Math.round((1 - aSh) * 212)
      }
    }

    // 2) Horizontally symmetric striped banner (`f(lx) === f(111 - lx)`) with heavy right-side badge occlusion
    const bannerPattern = (lx: number): [number, number, number] => {
      const symX = Math.min(lx, symBannerRect.width - 1 - lx)
      return symX % 4 < 2 ? [204, 158, 56] : [64, 42, 108]
    }
    for (let y = symBannerRect.top; y < symBannerRect.top + symBannerRect.height; y++) {
      for (let x = symBannerRect.left; x < symBannerRect.left + symBannerRect.width; x++) {
        const rgb = bannerPattern(x - symBannerRect.left)
        scene.data.set([rgb[0], rgb[1], rgb[2], 255], (y * cw + x) * 4)
      }
    }
    for (let y = occGemRect.top; y < occGemRect.top + occGemRect.height; y++) {
      for (let x = occGemRect.left; x < occGemRect.left + occGemRect.width; x++) {
        scene.data.set([38, 214, 236, 255], (y * cw + x) * 4)
      }
    }

    const vlmJson = JSON.stringify({
      screenKind: 'popup',
      background_repair_mode: 'scene',
      elements: [
        {
          id: 'av1',
          name: 'Hero Avatar',
          kind: 'avatar',
          box_2d: toBox2d(avatarRect, cw, ch),
          parent: null,
          order: 1
        },
        {
          id: 'btn_sh',
          name: 'Shadow Button',
          kind: 'button',
          box_2d: toBox2d(cardRect, cw, ch),
          parent: null,
          order: 2
        },
        {
          id: 'ban_sym',
          name: 'Ornate Symmetric Banner',
          kind: 'banner',
          box_2d: toBox2d(symBannerRect, cw, ch),
          parent: null,
          order: 3
        },
        {
          id: 'gem_occ',
          name: 'Overlay Gem',
          kind: 'badge',
          box_2d: toBox2d(occGemRect, cw, ch),
          parent: 'ban_sym',
          order: 4
        }
      ]
    })

    const res = await runPreciseUiSplit(
      mockIo({
        vlm: async () => vlmJson,
        editImage: async () => cleanBase,
        purifyLayerImage: async (req) => {
          if (req.prompt.includes('Hero Avatar')) {
            // Studio clips off the protruding right hair strand (`x = 76..77`)
            const s = createImage(avatarRect.width + 16, avatarRect.height + 16)
            s.data.fill(255)
            for (let ly = 0; ly < avatarRect.height; ly++) {
              for (let lx = 0; lx < avatarRect.width; lx++) {
                s.data.set([188, 42, 64, 255], ((8 + ly) * s.width + (8 + lx)) * 4)
              }
            }
            return s
          }
          if (req.prompt.includes('Shadow Button')) {
            const s = createImage(cardRect.width + 16, cardRect.height + 16)
            s.data.fill(255)
            for (let ly = 0; ly < cardRect.height; ly++) {
              for (let lx = 0; lx < cardRect.width; lx++) {
                s.data.set([44, 118, 212, 255], ((8 + ly) * s.width + (8 + lx)) * 4)
              }
            }
            return s
          }
          if (req.prompt.includes('Ornate Symmetric Banner')) {
            // Studio loses the fine gold/plum stripes and outputs flat average [134, 100, 82]
            const s = createImage(symBannerRect.width + 16, symBannerRect.height + 16)
            s.data.fill(255)
            for (let ly = 0; ly < symBannerRect.height; ly++) {
              for (let lx = 0; lx < symBannerRect.width; lx++) {
                s.data.set([134, 100, 82, 255], ((8 + ly) * s.width + (8 + lx)) * 4)
              }
            }
            return s
          }
          const s = createImage(occGemRect.width + 16, occGemRect.height + 16)
          s.data.fill(255)
          for (let ly = 0; ly < occGemRect.height; ly++) {
            for (let lx = 0; lx < occGemRect.width; lx++) {
              s.data.set([38, 214, 236, 255], ((8 + ly) * s.width + (8 + lx)) * 4)
            }
          }
          return s
        }
      }),
      scene,
      { zoomRefine: false }
    )

    // 1A) Protruding crimson hair strand (`x = 76, y = 45`) outside `avatarRect` was recovered!
    const avLayer = res.layers.find((l) => l.elementId === 'av1')!
    expect(avLayer.left + avLayer.width).toBeGreaterThanOrEqual(78)
    const hairOff = ((45 - avLayer.top) * avLayer.width + (76 - avLayer.left)) * 4
    expect(avLayer.rgba[hairOff + 3]!).toBeGreaterThan(150)
    expect(avLayer.rgba[hairOff]!).toBeGreaterThan(150)
    expect(avLayer.rgba[hairOff + 1]!).toBeLessThan(80)

    // 1B) Soft drop shadow below `Shadow Button` (`x = 56, y = 129`) was recovered as pure `[0, 0, 0, alpha_sh]`!
    const btnLayer = res.layers.find((l) => l.elementId === 'btn_sh')!
    expect(btnLayer.top + btnLayer.height).toBeGreaterThanOrEqual(131)
    const shOff = ((129 - btnLayer.top) * btnLayer.width + (56 - btnLayer.left)) * 4
    expect(btnLayer.rgba[shOff]!).toBe(0)
    expect(btnLayer.rgba[shOff + 1]!).toBe(0)
    expect(btnLayer.rgba[shOff + 2]!).toBe(0)
    expect(btnLayer.rgba[shOff + 3]!).toBeGreaterThanOrEqual(35)
    expect(btnLayer.rgba[shOff + 3]!).toBeLessThanOrEqual(90)

    // 2) Occluded right side of `Ornate Symmetric Banner` (`lx = 88` and `lx = 90`, `y = 52`) recovered
    //    exact high-contrast gold vs plum bilateral mirror stripes instead of flat [134, 100, 82] studio blur!
    const banLayer = res.layers.find((l) => l.elementId === 'ban_sym')!
    const occGold =
      ((52 - banLayer.top) * banLayer.width + (symBannerRect.left + 88 - banLayer.left)) * 4
    const occPlum =
      ((52 - banLayer.top) * banLayer.width + (symBannerRect.left + 90 - banLayer.left)) * 4
    expect(Math.abs(banLayer.rgba[occGold]! - banLayer.rgba[occPlum]!)).toBeGreaterThan(95)
  })

  it('Boundary 4 & 5a: exports gradient/stroke/shadow editable text styles to PSD and auto-recovers missed row stars & orphan pips', async () => {
    const cw = 256
    const ch = 156
    const cardRect = { left: 16, top: 14, width: 224, height: 128 }
    // 4-star rating row (`pitch = 26px`); VLM will omit Star 3 (`left = 88`)!
    const stars = [
      { left: 36, top: 34, width: 14, height: 14 },
      { left: 62, top: 34, width: 14, height: 14 },
      { left: 88, top: 34, width: 14, height: 14 },
      { left: 114, top: 34, width: 14, height: 14 }
    ]
    // Unreported notification dot pip on smooth `cardRect` interior
    const orphanPipRect = { left: 196, top: 36, width: 10, height: 10 }
    // Glossy button + metallic vertical-gradient condensed numeric text `"998"` with dark stroke & SE shadow
    const btnRect = { left: 56, top: 82, width: 136, height: 42 }
    const txtRect = { left: 92, top: 90, width: 64, height: 26 }

    const cleanBase = createImage(cw, ch)
    for (let p = 0; p < cw * ch; p++) {
      cleanBase.data.set([16, 20, 32, 255], p * 4)
    }
    const scene = createImage(cw, ch)
    scene.data.set(cleanBase.data)

    // Smooth `surface` card (`[38, 44, 66]`)
    for (let y = cardRect.top; y < cardRect.top + cardRect.height; y++) {
      for (let x = cardRect.left; x < cardRect.left + cardRect.width; x++) {
        scene.data.set([38, 44, 66, 255], (y * cw + x) * 4)
      }
    }
    // Draw all 4 golden stars (`[248, 202, 48]`) + crimson orphan pip (`[244, 64, 78]`)
    for (const st of stars) {
      for (let y = st.top; y < st.top + st.height; y++) {
        for (let x = st.left; x < st.left + st.width; x++) {
          scene.data.set([248, 202, 48, 255], (y * cw + x) * 4)
        }
      }
    }
    for (let y = orphanPipRect.top; y < orphanPipRect.top + orphanPipRect.height; y++) {
      for (let x = orphanPipRect.left; x < orphanPipRect.left + orphanPipRect.width; x++) {
        scene.data.set([244, 64, 78, 255], (y * cw + x) * 4)
      }
    }

    // Two-tone glossy teal button (`[36, 152, 168]` top / `[24, 114, 132]` bottom)
    for (let y = btnRect.top; y < btnRect.top + btnRect.height; y++) {
      const topHalf = y < btnRect.top + 21
      for (let x = btnRect.left; x < btnRect.left + btnRect.width; x++) {
        scene.data.set(topHalf ? [36, 152, 168, 255] : [24, 114, 132, 255], (y * cw + x) * 4)
      }
    }

    // Render 3 tall condensed glyphs inside `txtRect` (`lx`: 6..15, 24..33, 42..51; `ly`: 2..22):
    // - 1px dark outer stroke `[18, 22, 28]`
    // - Vertical metallic gold-to-amber core gradient (`[255, 248, 205]` top -> `[228, 132, 28]` bottom)
    // - SE semi-transparent drop shadow (`dx=+1..2, dy=+1..2`)
    const glyphMask = new Uint8Array(txtRect.width * txtRect.height)
    const coreMask = new Uint8Array(txtRect.width * txtRect.height)
    for (const gx0 of [6, 24, 42]) {
      for (let ly = 2; ly <= 21; ly++) {
        for (let lx = gx0; lx <= gx0 + 9; lx++) {
          glyphMask[ly * txtRect.width + lx] = 1
          if (lx > gx0 && lx < gx0 + 9 && ly > 2 && ly < 21) {
            coreMask[ly * txtRect.width + lx] = 1
          }
        }
      }
    }
    // Paint SE drop shadow first
    for (let ly = 0; ly < txtRect.height; ly++) {
      for (let lx = 0; lx < txtRect.width; lx++) {
        if (!glyphMask[ly * txtRect.width + lx]) continue
        for (const [sdx, sdy, sa] of [
          [1, 1, 0.52],
          [2, 2, 0.36]
        ] as const) {
          const sx = lx + sdx
          const sy = ly + sdy
          if (sx >= txtRect.width || sy >= txtRect.height) continue
          if (glyphMask[sy * txtRect.width + sx]) continue
          const gi = ((txtRect.top + sy) * cw + (txtRect.left + sx)) * 4
          scene.data[gi] = Math.round(scene.data[gi]! * (1 - sa) + 8 * sa)
          scene.data[gi + 1] = Math.round(scene.data[gi + 1]! * (1 - sa) + 10 * sa)
          scene.data[gi + 2] = Math.round(scene.data[gi + 2]! * (1 - sa) + 14 * sa)
        }
      }
    }
    // Paint dark stroke + vertical metallic gradient core + 50% anti-aliased outer right edge
    for (let ly = 0; ly < txtRect.height; ly++) {
      const tGrad = Math.max(0, Math.min(1, (ly - 3) / 17))
      const coreCol: [number, number, number] = [
        Math.round(255 - 27 * tGrad),
        Math.round(248 - 116 * tGrad),
        Math.round(205 - 177 * tGrad)
      ]
      for (let lx = 0; lx < txtRect.width; lx++) {
        const p = ly * txtRect.width + lx
        const gi = ((txtRect.top + ly) * cw + (txtRect.left + lx)) * 4
        if (coreMask[p]) {
          scene.data.set([coreCol[0], coreCol[1], coreCol[2], 255], gi)
        } else if (glyphMask[p]) {
          scene.data.set([18, 22, 28, 255], gi)
        } else if (lx > 0 && glyphMask[p - 1] && ly >= 4 && ly <= 18) {
          // 50%-blended anti-aliased edge against teal button to verify color decontamination
          scene.data[gi] = Math.round(0.5 * 18 + 0.5 * scene.data[gi]!)
          scene.data[gi + 1] = Math.round(0.5 * 22 + 0.5 * scene.data[gi + 1]!)
          scene.data[gi + 2] = Math.round(0.5 * 28 + 0.5 * scene.data[gi + 2]!)
        }
      }
    }

    const vlmJson = JSON.stringify({
      screenKind: 'popup',
      background_repair_mode: 'surface',
      elements: [
        {
          id: 'card_main',
          name: 'Reward Card',
          kind: 'panel',
          repair: 'surface',
          box_2d: toBox2d(cardRect, cw, ch),
          parent: null,
          order: 1
        },
        {
          id: 'st1',
          name: 'Star 1',
          kind: 'icon',
          box_2d: toBox2d(stars[0]!, cw, ch),
          parent: 'card_main',
          order: 2
        },
        {
          id: 'st2',
          name: 'Star 2',
          kind: 'icon',
          box_2d: toBox2d(stars[1]!, cw, ch),
          parent: 'card_main',
          order: 3
        },
        // Deliberately omit Star 3 (`stars[2]`) AND `orphanPipRect`!
        {
          id: 'st4',
          name: 'Star 4',
          kind: 'icon',
          box_2d: toBox2d(stars[3]!, cw, ch),
          parent: 'card_main',
          order: 4
        },
        {
          id: 'btn_buy',
          name: 'Buy Button',
          kind: 'button',
          box_2d: toBox2d(btnRect, cw, ch),
          parent: 'card_main',
          order: 5
        },
        {
          id: 'txt_price',
          name: 'Price Label',
          kind: 'text',
          font_style: 'condensed',
          box_2d: toBox2d(txtRect, cw, ch),
          parent: 'btn_buy',
          order: 6,
          ocr: ['T1'],
          text: '998'
        }
      ]
    })

    const res = await runPreciseUiSplit(
      mockIo({
        vlm: async () => vlmJson,
        ocr: async () => [{ ...txtRect, text: '998', confidence: 0.99 }],
        editImage: async () => cleanBase,
        purifyLayerImage: async (req) => {
          if (req.prompt.includes('Reward Card')) {
            const s = createImage(cardRect.width + 16, cardRect.height + 16)
            s.data.fill(255)
            for (let ly = 0; ly < cardRect.height; ly++) {
              for (let lx = 0; lx < cardRect.width; lx++) {
                s.data.set([38, 44, 66, 255], ((8 + ly) * s.width + (8 + lx)) * 4)
              }
            }
            return s
          }
          if (req.prompt.includes('Buy Button')) {
            const s = createImage(btnRect.width + 16, btnRect.height + 16)
            s.data.fill(255)
            for (let ly = 0; ly < btnRect.height; ly++) {
              const topHalf = ly < 21
              for (let lx = 0; lx < btnRect.width; lx++) {
                s.data.set(
                  topHalf ? [36, 152, 168, 255] : [24, 114, 132, 255],
                  ((8 + ly) * s.width + (8 + lx)) * 4
                )
              }
            }
            return s
          }
          if (req.prompt.includes('Star')) {
            const s = createImage(30, 30)
            s.data.fill(255)
            for (let ly = 0; ly < 14; ly++) {
              for (let lx = 0; lx < 14; lx++) {
                s.data.set([248, 202, 48, 255], ((8 + ly) * 30 + (8 + lx)) * 4)
              }
            }
            return s
          }
          // Orphan pip studio render
          const s = createImage(26, 26)
          s.data.fill(255)
          for (let ly = 0; ly < orphanPipRect.height; ly++) {
            for (let lx = 0; lx < orphanPipRect.width; lx++) {
              s.data.set([244, 64, 78, 255], ((8 + ly) * 26 + (8 + lx)) * 4)
            }
          }
          return s
        }
      }),
      scene,
      { zoomRefine: false }
    )

    // 1) Missed 3rd star (`x ~ 88, y ~ 34`) AND missed orphan pip (`x ~ 196, y ~ 36`) were both recovered!
    const recoveredStar3 = res.layers.find(
      (l) => Math.abs(l.left - stars[2]!.left) <= 2 && Math.abs(l.top - stars[2]!.top) <= 2
    )
    expect(recoveredStar3).toBeDefined()
    const recoveredPip = res.layers.find(
      (l) => Math.abs(l.left - orphanPipRect.left) <= 2 && Math.abs(l.top - orphanPipRect.top) <= 2
    )
    expect(recoveredPip).toBeDefined()

    // 2) Plain text layer carries condensed font classification (`DINAlternate-Bold`), vertical gradientStops,
    //    dark stroke, and clean decontaminated anti-aliased edge (no bright teal G/B > 110 bleed!)
    const txtLayer = res.layers.find((l) => l.elementId === 'txt_price')!
    expect(txtLayer.editableText?.fontStyle).toBe('condensed')
    expect(txtLayer.editableText?.fontName).toBe('DINAlternate-Bold')
    expect(txtLayer.editableText?.gradientStops).toBeDefined()
    expect(txtLayer.editableText?.strokeColor).toBeDefined()

    const aaX = txtRect.left + 16 - txtLayer.left
    const aaY = txtRect.top + 10 - txtLayer.top
    const aaOff = (aaY * txtLayer.width + aaX) * 4
    if (txtLayer.rgba[aaOff + 3]! > 0) {
      // Decontaminated dark stroke edge must NOT carry teal button's G=152 / B=168 bleed!
      expect(txtLayer.rgba[aaOff + 1]!).toBeLessThan(85)
      expect(txtLayer.rgba[aaOff + 2]!).toBeLessThan(95)
    }

    // 3) PSD binary export round-trip preserves `TySh` font (`DINAlternate-Bold`) and `Lefx` (`gradientOverlay` + `stroke`)!
    const store = new Map<string, RgbaImage>()
    let idSeq = 0
    const mapped = await mapPreciseResultToLayers(res, {
      idPrefix: 'b4',
      encodePng: async (rgba) => {
        idSeq++
        const url = `data:image/png;base64,B4_${idSeq}`
        store.set(url, rgba)
        return url
      }
    })
    const normalized = normalizeImageLayerSplit({
      sourceImageId: 'src',
      canvasWidth: cw,
      canvasHeight: ch,
      layers: mapped.layers
    })!
    const layerUrls: Record<string, string> = {}
    for (const item of mapped.batch) layerUrls[item.id] = item.dataUrl
    const psdBytes = await layerSplitToPsdUint8Array({
      state: normalized,
      layerUrls,
      decodeRgba: async (src) => {
        const hit = store.get(src)!
        return { data: hit.data, width: hit.width, height: hit.height }
      }
    })
    const parsedPsd = readPsd(psdBytes, {
      skipLayerImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true
    })
    const findLayerRecursive = (
      items: NonNullable<typeof parsedPsd.children>,
      name: string
    ): NonNullable<typeof parsedPsd.children>[number] | undefined => {
      for (const item of items) {
        if (item.name === name) return item
        if (item.children) {
          const hit = findLayerRecursive(item.children, name)
          if (hit) return hit
        }
      }
      return undefined
    }
    const psdPriceLayer = findLayerRecursive(parsedPsd.children ?? [], 'Price Label')
    expect(psdPriceLayer?.text?.style?.font?.name).toBe('DINAlternate-Bold')
    expect(psdPriceLayer?.effects?.gradientOverlay?.length).toBe(1)
    expect(psdPriceLayer?.effects?.stroke?.length).toBe(1)
  })
})
