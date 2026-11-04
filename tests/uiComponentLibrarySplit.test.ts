import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readPsd } from 'ag-psd'
import {
  GraphPortType,
  buildGodotSceneTscn,
  buildLayerSplitUiManifest,
  buildUnityUiToolkitUss,
  componentIdToPsdGuid,
  createNodeFromType,
  emptyUiComponentLibrary,
  executeLayerSplitNode,
  executeUiComponentLibNode,
  getNodePorts,
  isNodeTextCapable,
  mergeUiComponentLibraries,
  normalizeImageLayerSplit,
  parseUiComponentLibrary,
  portsCompatible,
  readImageLayerSplitFromNode,
  resolveNodeTextContent,
  stringifyUiComponentLibrary,
  toggleLayerComponentReplacement,
  type GraphNode,
  type ImageLayerSplitState,
  type NodeExecuteContext,
  type UiSharedComponentItem
} from '../src/shared/graph'
import {
  computeComponentVisualDescriptor,
  createImage,
  extractSharedComponentsFromSplitResults,
  matchElementToComponentLibrary,
  renderComponentToRect,
  runPreciseUiSplit,
  type PreciseSplitComponentCandidate,
  type PreciseSplitIo,
  type PreciseSplitResult,
  type RgbaImage
} from '../src/shared/graph/uiPreciseSplit'
import { mapPreciseResultToLayers } from '../src/shared/graph/execute/layerSplitPrecise'
import { layerSplitToPsdUint8Array } from '../src/renderer/src/features/graph/model/layerSplitPsd'

function encodeRawRgbaDataUrl(img: RgbaImage): string {
  const b64 = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength).toString(
    'base64'
  )
  return `data:image/x-raw-rgba;w=${img.width};h=${img.height};base64,${b64}`
}

function decodeRawRgbaDataUrl(url: string): RgbaImage {
  const m = url.match(/^data:image\/x-raw-rgba;w=(\d+);h=(\d+);base64,([\s\S]+)$/)
  if (!m) throw new Error(`Unsupported test image URL: ${url.slice(0, 48)}`)
  const width = Number(m[1])
  const height = Number(m[2])
  const buf = Buffer.from(m[3]!, 'base64')
  return {
    width,
    height,
    data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, width * height * 4)
  }
}

/**
 * Synthesizes a rounded gold-bordered blue UI button/slot frame (`w × h`).
 */
function makeButtonFrameRgba(
  w: number,
  h: number,
  opts?: {
    borderPx?: number
    borderRgb?: [number, number, number]
    fillRgb?: [number, number, number]
    cornerRadius?: number
  }
): RgbaImage {
  const borderPx = opts?.borderPx ?? 5
  const borderRgb = opts?.borderRgb ?? [232, 186, 74]
  const fillRgb = opts?.fillRgb ?? [38, 72, 136]
  const r = opts?.cornerRadius ?? 5
  const img = createImage(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Rounded corner cutout
      let inside = true
      if (x < r && y < r) {
        inside = (x - r) * (x - r) + (y - r) * (y - r) <= r * r
      } else if (x >= w - r && y < r) {
        inside = (x - (w - 1 - r)) ** 2 + (y - r) ** 2 <= r * r
      } else if (x < r && y >= h - r) {
        inside = (x - r) ** 2 + (y - (h - 1 - r)) ** 2 <= r * r
      } else if (x >= w - r && y >= h - r) {
        inside = (x - (w - 1 - r)) ** 2 + (y - (h - 1 - r)) ** 2 <= r * r
      }
      if (!inside) continue
      const isBorder = x < borderPx || y < borderPx || x >= w - borderPx || y >= h - borderPx
      const idx = (y * w + x) * 4
      const rgb = isBorder ? borderRgb : fillRgb
      img.data[idx] = rgb[0]
      img.data[idx + 1] = rgb[1]
      img.data[idx + 2] = rgb[2]
      img.data[idx + 3] = 255
    }
  }
  return img
}

function compositeOver(dst: RgbaImage, src: RgbaImage, left: number, top: number): void {
  for (let y = 0; y < src.height; y++) {
    const gy = top + y
    if (gy < 0 || gy >= dst.height) continue
    for (let x = 0; x < src.width; x++) {
      const gx = left + x
      if (gx < 0 || gx >= dst.width) continue
      const si = (y * src.width + x) * 4
      const sa = src.data[si + 3]! / 255
      if (sa <= 0) continue
      const di = (gy * dst.width + gx) * 4
      const da = dst.data[di + 3]! / 255
      const outA = sa + da * (1 - sa)
      if (outA <= 0) continue
      dst.data[di] = Math.round((src.data[si]! * sa + dst.data[di]! * da * (1 - sa)) / outA)
      dst.data[di + 1] = Math.round(
        (src.data[si + 1]! * sa + dst.data[di + 1]! * da * (1 - sa)) / outA
      )
      dst.data[di + 2] = Math.round(
        (src.data[si + 2]! * sa + dst.data[di + 2]! * da * (1 - sa)) / outA
      )
      dst.data[di + 3] = Math.round(outA * 255)
    }
  }
}

describe('UI Shared Component Library & PSD Smart Object Split Pipeline', () => {
  it('generates valid lowercase RFC-4122 PSD GUIDs and preserves locked masters across merges', () => {
    const guidA = componentIdToPsdGuid('comp_button_01')
    const guidA2 = componentIdToPsdGuid('comp_button_01')
    const guidB = componentIdToPsdGuid('comp_slot_01')

    expect(guidA).toBe(guidA2)
    expect(guidA).not.toBe(guidB)
    expect(guidA).toMatch(/^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/)
    expect(guidB).toMatch(/^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/)

    const baseDoc = emptyUiComponentLibrary('Main UI')
    baseDoc.items.push({
      id: 'comp_btn_01',
      psdGuid: guidA,
      name: 'Curated Primary Button',
      exportName: 'Comp_Btn_Primary',
      kind: 'button',
      canonicalWidth: 120,
      canonicalHeight: 44,
      scalePolicy: 'nine-slice',
      nineSliceBorders: [8, 12, 8, 12],
      imageUrl: 'data:image/png;base64,CURATED',
      locked: true
    })

    const incomingDoc = parseUiComponentLibrary(
      stringifyUiComponentLibrary({
        ...emptyUiComponentLibrary(),
        items: [
          {
            id: 'comp_btn_01',
            psdGuid: guidA,
            name: 'Auto Extracted Button',
            exportName: 'Comp_Btn_Auto',
            kind: 'button',
            canonicalWidth: 120,
            canonicalHeight: 44,
            scalePolicy: 'uniform',
            imageUrl: 'data:image/png;base64,AUTO'
          },
          {
            id: 'comp_slot_01',
            psdGuid: guidB,
            name: 'Item Slot',
            exportName: 'Comp_Slot_01',
            kind: 'item-slot',
            canonicalWidth: 64,
            canonicalHeight: 64,
            scalePolicy: 'uniform',
            imageUrl: 'data:image/png;base64,SLOT'
          }
        ]
      })
    )

    const merged = mergeUiComponentLibraries(baseDoc, incomingDoc)
    expect(merged.items).toHaveLength(2)
    const btn = merged.items.find((i) => i.id === 'comp_btn_01')!
    expect(btn.name).toBe('Curated Primary Button')
    expect(btn.locked).toBe(true)
    expect(btn.nineSliceBorders).toEqual([8, 12, 8, 12])
  })

  it('clusters repeated UI controls across instances, fuses unobstructed pixels to remove per-instance overlays, and preserves 9-slice corners', () => {
    const w = 48
    const h = 32
    const cleanMaster = makeButtonFrameRgba(w, h, { borderPx: 6, cornerRadius: 4 })

    // Create 3 instances where each has a different occluded region (e.g. different icon/label hole)
    const holeRects = [
      { x0: 8, y0: 8, x1: 20, y1: 24 },
      { x0: 20, y0: 8, x1: 32, y1: 24 },
      { x0: 30, y0: 10, x1: 40, y1: 22 }
    ]

    const splitLayers = holeRects.map((hole, idx) => {
      const rgba = new Uint8ClampedArray(cleanMaster.data)
      const knownMask = new Uint8Array(w * h).fill(1)
      for (let y = hole.y0; y < hole.y1; y++) {
        for (let x = hole.x0; x < hole.x1; x++) {
          const p = y * w + x
          knownMask[p] = 0
          // Contaminate occluded pixels with bright magenta/cyan noise so simple averaging would fail
          rgba[p * 4] = 250
          rgba[p * 4 + 1] = 10
          rgba[p * 4 + 2] = 240
          rgba[p * 4 + 3] = 0
        }
      }
      return {
        id: `slot_${idx}`,
        elementId: `slot_${idx}`,
        name: 'Item Slot',
        kind: 'item-slot' as const,
        parentElementId: null,
        paintIndex: idx + 1,
        left: 10 + idx * 60,
        top: 20,
        width: w,
        height: h,
        rgba,
        knownMask
      }
    })

    const fakeSplitResult: PreciseSplitResult = {
      canvasWidth: 220,
      canvasHeight: 80,
      base: createImage(220, 80),
      layers: splitLayers,
      tree: { canvasWidth: 220, canvasHeight: 80, elements: [] },
      reconstructionError: 0,
      peelReport: [],
      notes: []
    }

    const extracted = extractSharedComponentsFromSplitResults([{ split: fakeSplitResult }], {
      mode: 'repeated'
    })
    expect(extracted.length).toBe(1)
    const master = extracted[0]!
    expect(master.item.sourceCount).toBe(3)
    expect(master.rgba.width).toBe(w)
    expect(master.rgba.height).toBe(h)

    // Every interior pixel that was occluded in only 1 of the 3 instances must match cleanMaster fill [38, 72, 136, 255]
    for (const hole of holeRects) {
      const cx = Math.floor((hole.x0 + hole.x1) / 2)
      const cy = Math.floor((hole.y0 + hole.y1) / 2)
      const idx = (cy * w + cx) * 4
      expect(master.rgba.data[idx]).toBeCloseTo(38, 0)
      expect(master.rgba.data[idx + 1]).toBeCloseTo(72, 0)
      expect(master.rgba.data[idx + 2]).toBeCloseTo(136, 0)
      expect(master.rgba.data[idx + 3]).toBe(255)
    }

    // Verify 9-slice rendering to 2x width (96×32) preserves exact 6px left & right gold borders!
    const stretched = renderComponentToRect(master.rgba, 96, 32, 'nine-slice', [6, 6, 6, 6])
    expect(stretched.width).toBe(96)
    expect(stretched.height).toBe(32)
    // x = 4 (inside 6px left border) => gold [232, 186, 74]
    const leftBorderIdx = (16 * 96 + 4) * 4
    expect(stretched.data[leftBorderIdx]).toBe(232)
    // x = 7 (just inside fill, would still be gold if uniformly stretched 2x to 12px!) => blue fill [38, 72, 136]
    const leftFillIdx = (16 * 96 + 7) * 4
    expect(stretched.data[leftFillIdx]).toBe(38)
    expect(stretched.data[leftFillIdx + 2]).toBe(136)

    // Verify occlusion-aware matcher still matches when interior is covered by text (`knownMask = 0`)
    const detectedMask = new Uint8Array(w * h)
    for (let p = 0; p < w * h; p++) {
      if (splitLayers[0]!.rgba[p * 4 + 3]! >= 32 || splitLayers[0]!.knownMask[p] === 0) {
        detectedMask[p] = 1
      }
    }
    const matchRes = matchElementToComponentLibrary({
      elementKind: 'item-slot',
      box: { left: 10, top: 20, width: w, height: h },
      observedPatch: { width: w, height: h, data: splitLayers[0]!.rgba },
      detectedMask,
      knownMask: splitLayers[0]!.knownMask,
      candidates: extracted
    })
    expect(matchRes).not.toBeNull()
    expect(matchRes!.candidate.item.id).toBe(master.item.id)
    expect(matchRes!.score).toBeGreaterThan(0.85)
  })

  it('replaces matched controls in runPreciseUiSplit, preserves editable text children, and leaves zero corner residue on base', async () => {
    const W = 180
    const H = 96
    const source = createImage(W, H)
    // Dark slate background [22, 26, 36, 255]
    for (let i = 0; i < W * H; i++) {
      source.data[i * 4] = 22
      source.data[i * 4 + 1] = 26
      source.data[i * 4 + 2] = 36
      source.data[i * 4 + 3] = 255
    }

    const masterRgba = makeButtonFrameRgba(64, 28, {
      borderPx: 5,
      cornerRadius: 6
    })
    const masterItem: UiSharedComponentItem = {
      id: 'comp_gold_btn',
      psdGuid: componentIdToPsdGuid('comp_gold_btn'),
      name: 'Gold Action Button',
      exportName: 'Comp_Btn_Gold',
      kind: 'button',
      canonicalWidth: 64,
      canonicalHeight: 28,
      scalePolicy: 'nine-slice',
      nineSliceBorders: [6, 6, 6, 6],
      descriptor: computeComponentVisualDescriptor(masterRgba)
    }
    const candidates: PreciseSplitComponentCandidate[] = [{ item: masterItem, rgba: masterRgba }]

    // Paint 2 buttons onto `source`, deliberately adding a 1px noisy bright corner artifact at (0,0) of button 1
    // (where clean masterRgba has alpha = 0 due to cornerRadius = 6!) + bright white text bar in the middle
    const dirtyBtn1 = {
      width: 64,
      height: 28,
      data: new Uint8ClampedArray(masterRgba.data)
    }
    dirtyBtn1.data[0] = 245
    dirtyBtn1.data[1] = 190
    dirtyBtn1.data[2] = 60
    dirtyBtn1.data[3] = 255
    compositeOver(source, dirtyBtn1, 16, 34)
    compositeOver(source, masterRgba, 100, 34)

    // Paint white glyph pixels inside button 1 at [32..60, 42..52]
    for (let y = 43; y < 51; y++) {
      for (let x = 34; x < 58; x += 2) {
        const idx = (y * W + x) * 4
        source.data[idx] = 250
        source.data[idx + 1] = 250
        source.data[idx + 2] = 252
        source.data[idx + 3] = 255
      }
    }

    const toBox2d = (r: { left: number; top: number; width: number; height: number }): number[] => [
      Math.round((r.top / H) * 1000),
      Math.round((r.left / W) * 1000),
      Math.round(((r.top + r.height) / H) * 1000),
      Math.round(((r.left + r.width) / W) * 1000)
    ]

    const io: PreciseSplitIo = {
      encodePng: async (img) => encodeRawRgbaDataUrl(img),
      ocr: async () => [
        {
          text: 'START',
          left: 32,
          top: 41,
          width: 28,
          height: 12
        }
      ],
      vlm: async () =>
        JSON.stringify({
          screenKind: 'hud',
          elements: [
            {
              id: 'btn_start',
              name: 'Start Button',
              kind: 'button',
              box_2d: toBox2d({ left: 16, top: 34, width: 64, height: 28 }),
              parent: null,
              order: 1,
              component_id: 'comp_gold_btn'
            },
            {
              id: 'btn_shop',
              name: 'Shop Button',
              kind: 'button',
              box_2d: toBox2d({ left: 100, top: 34, width: 64, height: 28 }),
              parent: null,
              order: 2
            },
            {
              id: 'txt_start',
              name: 'Start Label',
              kind: 'text',
              box_2d: toBox2d({ left: 32, top: 41, width: 28, height: 12 }),
              parent: 'btn_start',
              order: 3,
              ocr: ['T1'],
              text: 'START'
            }
          ]
        })
    }

    const res = await runPreciseUiSplit(io, source, {
      components: candidates
    })

    const btnStartLayer = res.layers.find((l) => l.elementId === 'btn_start')!
    const btnShopLayer = res.layers.find((l) => l.elementId === 'btn_shop')!
    const txtLayer = res.layers.find((l) => l.kind === 'text')!

    expect(btnStartLayer).toBeDefined()
    expect(btnShopLayer).toBeDefined()
    expect(txtLayer).toBeDefined()
    expect(txtLayer.editableText?.text).toBe('START')

    // Both buttons matched the shared component master
    expect(btnStartLayer.componentId).toBe('comp_gold_btn')
    expect(btnShopLayer.componentId).toBe('comp_gold_btn')
    expect(btnStartLayer.originalRgba).toBeInstanceOf(Uint8ClampedArray)

    // Replaced button 1 corner (0,0) is cleanly transparent (alpha = 0), NOT the dirty source corner!
    expect(btnStartLayer.rgba[3]).toBe(0)

    // Base plate at (16, 34) — where dirtyBtn1 had a bright [245, 190, 60] pixel — must NOT have leaked back onto base!
    const baseCornerIdx = (34 * W + 16) * 4
    expect(res.base.data[baseCornerIdx]).toBeLessThan(60)

    // Map to ImageLayerSplitState and test toggling between master & raw cutout
    const mapped = await mapPreciseResultToLayers(res, {
      idPrefix: 'testSplit',
      encodePng: async (img) => encodeRawRgbaDataUrl(img),
      components: candidates
    })
    expect(mapped.componentLibrary).toHaveLength(1)

    const normState = normalizeImageLayerSplit({
      prompt: '',
      resolution: '2K',
      selectedId: '',
      canvasWidth: W,
      canvasHeight: H,
      layers: mapped.layers,
      groups: mapped.groups,
      componentLibrary: mapped.componentLibrary
    })
    const mappedBtn = normState.layers.find((l) => l.componentId === 'comp_gold_btn')!
    expect(mappedBtn.componentImageId).toBeTruthy()
    expect(mappedBtn.originalImageId).toBeTruthy()

    const toggledRaw = toggleLayerComponentReplacement(normState, mappedBtn.id, true)
    const rawLayer = toggledRaw.layers.find((l) => l.id === mappedBtn.id)!
    expect(rawLayer.keepOriginalPixels).toBe(true)
    expect(rawLayer.imageId).toBe(mappedBtn.originalImageId)

    const toggledMaster = toggleLayerComponentReplacement(toggledRaw, mappedBtn.id, false)
    const masterLayer = toggledMaster.layers.find((l) => l.id === mappedBtn.id)!
    expect(Boolean(masterLayer.keepOriginalPixels)).toBe(false)
    expect(masterLayer.imageId).toBe(mappedBtn.componentImageId)
  })

  it('embeds shared PSD Smart Objects (linkedFiles + placedLayer) that roundtrip cleanly via ag-psd', async () => {
    const masterRgba = makeButtonFrameRgba(64, 28, { borderPx: 5, cornerRadius: 4 })
    const rawCutoutRgba = makeButtonFrameRgba(64, 28, {
      borderPx: 5,
      borderRgb: [180, 90, 90],
      cornerRadius: 4
    })
    const baseRgba = createImage(200, 120)
    for (let i = 0; i < 200 * 120; i++) {
      baseRgba.data[i * 4] = 20
      baseRgba.data[i * 4 + 1] = 24
      baseRgba.data[i * 4 + 2] = 32
      baseRgba.data[i * 4 + 3] = 255
    }

    const psdGuid = componentIdToPsdGuid('comp_btn_primary')
    const state: ImageLayerSplitState = normalizeImageLayerSplit({
      prompt: '',
      resolution: '2K',
      selectedId: '',
      canvasWidth: 200,
      canvasHeight: 120,
      componentLibrary: [
        {
          id: 'comp_btn_primary',
          psdGuid,
          name: 'Primary Button',
          exportName: 'Comp_Btn_Primary',
          kind: 'button',
          canonicalWidth: 64,
          canonicalHeight: 28,
          scalePolicy: 'nine-slice',
          nineSliceBorders: [6, 6, 6, 6],
          imageId: 'img:comp_btn_primary'
        }
      ],
      layers: [
        {
          id: 'l_base',
          imageId: 'img:base',
          zIndex: 0,
          name: 'Base',
          description: '',
          visible: true,
          left: 0,
          top: 0,
          width: 200,
          height: 120,
          role: 'canvas-base',
          uiPartRole: 'canvas-base'
        },
        {
          id: 'l_btn_1',
          imageId: 'img:comp_btn_primary',
          originalImageId: 'img:raw_1',
          componentImageId: 'img:comp_btn_primary',
          componentId: 'comp_btn_primary',
          zIndex: 1,
          name: 'Btn_Start',
          exportName: 'Btn_Start',
          description: '',
          visible: true,
          left: 20,
          top: 30,
          width: 64,
          height: 28
        },
        {
          id: 'l_btn_2',
          imageId: 'img:comp_btn_primary',
          originalImageId: 'img:raw_2',
          componentImageId: 'img:comp_btn_primary',
          componentId: 'comp_btn_primary',
          zIndex: 2,
          name: 'Btn_Settings',
          exportName: 'Btn_Settings',
          description: '',
          visible: true,
          left: 110,
          top: 30,
          width: 64,
          height: 28
        },
        {
          id: 'l_btn_raw',
          imageId: 'img:raw_3',
          originalImageId: 'img:raw_3',
          componentImageId: 'img:comp_btn_primary',
          componentId: 'comp_btn_primary',
          keepOriginalPixels: true,
          zIndex: 3,
          name: 'Btn_CustomRaw',
          exportName: 'Btn_CustomRaw',
          description: '',
          visible: true,
          left: 20,
          top: 74,
          width: 64,
          height: 28
        },
        {
          id: 'l_txt_1',
          imageId: 'img:raw_1',
          zIndex: 4,
          name: 'Txt_Start',
          exportName: 'Txt_Start',
          description: '',
          visible: true,
          left: 34,
          top: 36,
          width: 36,
          height: 16,
          editableText: {
            text: 'START',
            fontSize: 14,
            color: [255, 255, 255]
          }
        }
      ]
    })

    const layerUrls: Record<string, string> = {
      'img:base': encodeRawRgbaDataUrl(baseRgba),
      'img:comp_btn_primary': encodeRawRgbaDataUrl(masterRgba),
      'img:raw_1': encodeRawRgbaDataUrl(rawCutoutRgba),
      'img:raw_2': encodeRawRgbaDataUrl(rawCutoutRgba),
      'img:raw_3': encodeRawRgbaDataUrl(rawCutoutRgba)
    }

    const psdBytes = await layerSplitToPsdUint8Array({
      state,
      layerUrls,
      decodeRgba: async (url) => decodeRawRgbaDataUrl(url)
    })

    expect(psdBytes.byteLength).toBeGreaterThan(256)

    const parsed = readPsd(psdBytes, {
      skipLayerImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true
    })

    // 1 shared Smart Object embedded in linkedFiles
    expect(parsed.linkedFiles).toBeDefined()
    expect(parsed.linkedFiles).toHaveLength(1)
    expect(parsed.linkedFiles![0]!.id).toBe(psdGuid)
    expect(parsed.linkedFiles![0]!.type).toBe('8BPS')

    // Child PSD inside linkedFiles[0].data is a valid 64×28 PSD document
    const childPsd = readPsd(parsed.linkedFiles![0]!.data!, {
      skipLayerImageData: true,
      skipCompositeImageData: true
    })
    expect(childPsd.width).toBe(64)
    expect(childPsd.height).toBe(28)

    const psdBtn1 = parsed.children?.find((c) => c.name === 'Btn_Start')
    const psdBtn2 = parsed.children?.find((c) => c.name === 'Btn_Settings')
    const psdBtnRaw = parsed.children?.find((c) => c.name === 'Btn_CustomRaw')
    const psdTxt1 = parsed.children?.find((c) => c.name === 'Txt_Start')

    // Both replaced buttons share the exact same Smart Object GUID and accurate corner transforms
    expect(psdBtn1?.placedLayer?.id).toBe(psdGuid)
    expect(psdBtn2?.placedLayer?.id).toBe(psdGuid)
    expect(psdBtn1?.placedLayer?.transform).toEqual([20, 30, 84, 30, 84, 58, 20, 58])
    expect(psdBtn2?.placedLayer?.transform).toEqual([110, 30, 174, 30, 174, 58, 110, 58])

    // Toggled raw cutout layer does NOT carry placedLayer
    expect(psdBtnRaw?.placedLayer).toBeUndefined()

    // Editable text layer remains an editable Photoshop TySh text layer above the Smart Objects
    expect(psdTxt1?.text?.text).toBe('START')
  })

  it('buckets non-uniformly stretched 9-slice instances into shared baked Smart Objects without distorting corners', async () => {
    const masterRgba = makeButtonFrameRgba(64, 28, { borderPx: 6, cornerRadius: 4 })
    const baseRgba = createImage(320, 120)
    const state = normalizeImageLayerSplit({
      prompt: '',
      resolution: '2K',
      selectedId: '',
      canvasWidth: 320,
      canvasHeight: 120,
      componentLibrary: [
        {
          id: 'comp_btn_9s',
          psdGuid: componentIdToPsdGuid('comp_btn_9s'),
          name: '9-Slice Wide Button',
          exportName: 'Comp_Btn_Wide',
          kind: 'button',
          canonicalWidth: 64,
          canonicalHeight: 28,
          scalePolicy: 'nine-slice',
          nineSliceBorders: [6, 6, 6, 6],
          imageId: 'img:comp_9s'
        }
      ],
      layers: [
        {
          id: 'l_base',
          imageId: 'img:base',
          zIndex: 0,
          name: 'Base',
          description: '',
          visible: true,
          left: 0,
          top: 0,
          width: 320,
          height: 120,
          role: 'canvas-base',
          uiPartRole: 'canvas-base'
        },
        {
          id: 'l_wide_1',
          imageId: 'img:comp_9s',
          componentId: 'comp_btn_9s',
          zIndex: 1,
          name: 'Btn_Wide_1',
          description: '',
          visible: true,
          left: 16,
          top: 20,
          width: 140,
          height: 28,
          nineSliceBorders: [6, 6, 6, 6]
        },
        {
          id: 'l_wide_2',
          imageId: 'img:comp_9s',
          componentId: 'comp_btn_9s',
          zIndex: 2,
          name: 'Btn_Wide_2',
          description: '',
          visible: true,
          left: 16,
          top: 64,
          width: 140,
          height: 28,
          nineSliceBorders: [6, 6, 6, 6]
        }
      ]
    })

    const psdBytes = await layerSplitToPsdUint8Array({
      state,
      layerUrls: {
        'img:base': encodeRawRgbaDataUrl(baseRgba),
        'img:comp_9s': encodeRawRgbaDataUrl(masterRgba)
      },
      decodeRgba: async (url) => decodeRawRgbaDataUrl(url)
    })

    const parsed = readPsd(psdBytes, {
      skipLayerImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true
    })
    expect(parsed.linkedFiles).toHaveLength(1)
    const child = readPsd(parsed.linkedFiles![0]!.data!, {
      skipLayerImageData: true,
      skipCompositeImageData: true
    })
    // Baked at exact 140×28 9-slice dimensions and shared across both 140×28 instances!
    expect(child.width).toBe(140)
    expect(child.height).toBe(28)
    const w1 = parsed.children?.find((c) => c.name === 'Btn_Wide_1')
    const w2 = parsed.children?.find((c) => c.name === 'Btn_Wide_2')
    expect(w1?.placedLayer?.id).toBe(parsed.linkedFiles![0]!.id)
    expect(w2?.placedLayer?.id).toBe(parsed.linkedFiles![0]!.id)
  })

  it('deduplicates Godot .tscn ExtResources, Unity .uss urls, and manifest entries across shared component instances', () => {
    const state = normalizeImageLayerSplit({
      prompt: '',
      resolution: '2K',
      selectedId: '',
      canvasWidth: 320,
      canvasHeight: 180,
      componentLibrary: [
        {
          id: 'comp_slot',
          psdGuid: componentIdToPsdGuid('comp_slot'),
          name: 'Inventory Slot',
          exportName: 'Comp_Slot_Frame',
          kind: 'item-slot',
          canonicalWidth: 48,
          canonicalHeight: 48,
          scalePolicy: 'nine-slice',
          nineSliceBorders: [6, 6, 6, 6]
        }
      ],
      layers: [0, 1, 2].map((i) => ({
        id: `slot_${i}`,
        imageId: `img_slot`,
        componentId: 'comp_slot',
        zIndex: i + 1,
        name: `Slot ${i + 1}`,
        exportName: `Slot_0${i + 1}`,
        description: '',
        visible: true,
        left: 16 + i * 56,
        top: 40,
        width: 48,
        height: 48,
        nineSliceBorders: [6, 6, 6, 6] as [number, number, number, number]
      }))
    })

    const manifest = buildLayerSplitUiManifest(state)
    expect(manifest.componentLibrary).toHaveLength(1)
    expect(manifest.layers.every((l) => l.componentId === 'comp_slot')).toBe(true)

    const tscn = buildGodotSceneTscn({ state, sceneName: 'InventoryHud' })
    const extMatches = tscn.match(/\[ext_resource type="Texture2D"/g) ?? []
    expect(extMatches).toHaveLength(1)
    expect(tscn).toContain('res://components/Comp_Slot_Frame.png')

    const uss = buildUnityUiToolkitUss({ state })
    expect(uss).toContain('url("components/Comp_Slot_Frame.png")')
  })

  it('wires ui.componentLib -> image.layerSplit via GraphPortType.uiComponents end-to-end', async () => {
    expect(portsCompatible(GraphPortType.uiComponents, GraphPortType.uiComponents)).toBe(true)
    expect(portsCompatible(GraphPortType.uiComponents, GraphPortType.text)).toBe(true)
    expect(portsCompatible(GraphPortType.text, GraphPortType.uiComponents)).toBe(false)

    const libNode = createNodeFromType('ui.componentLib', { x: 0, y: 0 })
    const splitNode = createNodeFromType('image.layerSplit', { x: 300, y: 0 })
    expect(getNodePorts(libNode).map((p) => p.id)).toEqual([
      'in',
      'in-images',
      'in-components',
      'out',
      'out-images'
    ])
    expect(getNodePorts(splitNode).some((p) => p.id === 'in-components')).toBe(true)

    // Synthesize a UI screen with 2 identical isolated buttons on a solid dark background for offline local extraction + split
    const W = 160
    const H = 90
    const screen = createImage(W, H)
    for (let i = 0; i < W * H; i++) {
      screen.data[i * 4] = 18
      screen.data[i * 4 + 1] = 20
      screen.data[i * 4 + 2] = 28
      screen.data[i * 4 + 3] = 255
    }
    const btn = makeButtonFrameRgba(48, 28, { borderPx: 4, cornerRadius: 3 })
    compositeOver(screen, btn, 20, 30)
    compositeOver(screen, btn, 92, 30)
    const screenUrl = encodeRawRgbaDataUrl(screen)

    const decomposeImageUiLayers = async (input: { sourceDataUrl: string }) => {
      const src = decodeRawRgbaDataUrl(input.sourceDataUrl)
      const base = createImage(src.width, src.height)
      for (let i = 0; i < src.width * src.height; i++) {
        base.data[i * 4] = 18
        base.data[i * 4 + 1] = 20
        base.data[i * 4 + 2] = 28
        base.data[i * 4 + 3] = 255
      }
      return {
        canvasWidth: src.width,
        canvasHeight: src.height,
        baseDataUrl: encodeRawRgbaDataUrl(base),
        widgets: [
          {
            name: 'Action Button 1',
            dataUrl: encodeRawRgbaDataUrl(btn),
            left: 20,
            top: 30,
            width: 48,
            height: 28,
            uiControlType: 'button' as const
          },
          {
            name: 'Action Button 2',
            dataUrl: encodeRawRgbaDataUrl(btn),
            left: 92,
            top: 30,
            width: 48,
            height: 28,
            uiControlType: 'button' as const
          }
        ]
      }
    }

    const uiRgbaCodec = {
      decodeImageRgba: async (url: string) => decodeRawRgbaDataUrl(url),
      encodeRgbaPng: async (img: RgbaImage) => encodeRawRgbaDataUrl(img)
    }

    const libPatches: Record<string, unknown> = {}
    const libCtx = {
      node: libNode,
      inputs: {
        in: [{ kind: 'image', dataUrl: screenUrl }]
      },
      decomposeImageUiLayers,
      uiRgbaCodec,
      patchNode: vi.fn((patch: { params?: Record<string, unknown> }) => {
        if (patch.params) Object.assign(libPatches, patch.params)
      })
    } as unknown as NodeExecuteContext

    const libOut = await executeUiComponentLibNode(libCtx)
    expect(libOut.out.kind).toBe('uiComponents')
    if (libOut.out.kind !== 'uiComponents') throw new Error('expected uiComponents')
    expect(libOut.out.doc.items.length).toBeGreaterThanOrEqual(1)

    const splitPatches: Record<string, unknown> = {}
    splitNode.params = {
      ...splitNode.params,
      imageLayerSplit: {
        ...readImageLayerSplitFromNode(splitNode.params),
        splitMode: 'local-slice'
      }
    }
    const splitCtx = {
      node: splitNode as GraphNode,
      inputs: {
        in: [{ kind: 'image', dataUrl: screenUrl }],
        'in-components': [libOut.out]
      },
      decomposeImageUiLayers,
      uiRgbaCodec,
      patchNode: vi.fn((patch: { params?: Record<string, unknown> }) => {
        if (patch.params) Object.assign(splitPatches, patch.params)
      })
    } as unknown as NodeExecuteContext

    await executeLayerSplitNode(splitCtx)
    const finalSplitState = readImageLayerSplitFromNode(splitPatches)
    expect(finalSplitState.componentLibrary?.length).toBeGreaterThanOrEqual(1)
    const matchedWidgets = finalSplitState.layers.filter((l) => Boolean(l.componentId))
    expect(matchedWidgets).toHaveLength(2)
  })

  it('excludes ui.componentLib from isNodeTextCapable/resolveNodeTextContent and routes double-click to ui.componentLib Dive workbench instead of Notepad', () => {
    const node = createNodeFromType('ui.componentLib', { x: 0, y: 0 })
    node.params = {
      ...node.params,
      text: 'should never open notepad',
      uiComponentLibrary: stringifyUiComponentLibrary(emptyUiComponentLibrary())
    }
    expect(isNodeTextCapable(node)).toBe(false)
    expect(resolveNodeTextContent(node)).toBeNull()

    const cardCode = readFileSync(
      resolve(__dirname, '../src/renderer/src/components/GraphNodeCard.vue'),
      'utf-8'
    )
    expect(cardCode).toContain("viewId: 'ui.componentLib'")

    const hostCode = readFileSync(
      resolve(__dirname, '../src/renderer/src/components/EditorDiveChildHost.vue'),
      'utf-8'
    )
    expect(hostCode).toContain(
      "'ui.componentLib': defineAsyncComponent(() => import('./dive/EditorDiveUiComponentLibView.vue'))"
    )

    const diveViewCode = readFileSync(
      resolve(__dirname, '../src/renderer/src/components/dive/EditorDiveUiComponentLibView.vue'),
      'utf-8'
    )
    expect(diveViewCode).toContain("t('graph.uiComponentLib.extractMode')")
    expect(diveViewCode).toContain("t('graph.layerSplit.visionModelLabel')")
    expect(diveViewCode).toContain('<ImageGenerateModelField')
  })
})
