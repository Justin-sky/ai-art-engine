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
  choosePurificationStudioBg,
  computeComponentVisualDescriptor,
  createImage,
  extractCleanComponentMatteFromSolidBg,
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
import { resolveGalleryOutputsFromNodeParams } from '../src/shared/graph/execute/helpers'
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

  it('unmixes solid studio backgrounds while preserving white interior highlights (bggg-creator-image2psd white-preserve)', () => {
    // Off-white AI studio canvas (252, 252, 250)
    const W = 96
    const H = 64
    const studio = createImage(W, H)
    for (let p = 0; p < W * H; p++) {
      studio.data[p * 4] = 252
      studio.data[p * 4 + 1] = 252
      studio.data[p * 4 + 2] = 250
      studio.data[p * 4 + 3] = 255
    }

    const btn = makeButtonFrameRgba(60, 32, {
      borderPx: 5,
      borderRgb: [228, 176, 62],
      fillRgb: [36, 74, 142],
      cornerRadius: 4
    })
    // Paint a pure-white [255, 255, 255] specular shine bar right inside the button interior!
    for (let y = 11; y < 18; y++) {
      for (let x = 18; x < 42; x++) {
        const i = (y * 60 + x) * 4
        btn.data[i] = 255
        btn.data[i + 1] = 255
        btn.data[i + 2] = 255
        btn.data[i + 3] = 255
      }
    }
    // Add 50% translucent anti-aliased top border edge row (y = 0, x = 10..50)
    for (let x = 10; x < 50; x++) {
      const i = x * 4
      btn.data[i] = 228
      btn.data[i + 1] = 176
      btn.data[i + 2] = 62
      btn.data[i + 3] = 128
    }

    compositeOver(studio, btn, 18, 16)

    const matte = extractCleanComponentMatteFromSolidBg(studio, {
      expectedBgRgb: [255, 255, 255]
    })
    expect(matte).not.toBeNull()
    expect(matte!.width).toBe(60)
    expect(matte!.height).toBe(32)

    // Rounded corner at (0, 0) is cleanly transparent (alpha = 0)
    expect(matte!.data[3]).toBe(0)

    // Pure-white interior highlight at button center (30, 14) MUST stay 100% opaque [255, 255, 255, 255] (zero punch-through hole!)
    const centerIdx = (14 * matte!.width + 30) * 4
    expect(matte!.data[centerIdx]).toBe(255)
    expect(matte!.data[centerIdx + 1]).toBe(255)
    expect(matte!.data[centerIdx + 2]).toBe(255)
    expect(matte!.data[centerIdx + 3]).toBe(255)

    // Anti-aliased top border pixel (x = 25, y = 0) unmixed cleanly from off-white background (blue channel recovered near 62, not 156!)
    const edgeIdx = 25 * 4
    expect(matte!.data[edgeIdx + 3]).toBeGreaterThan(60)
    expect(matte!.data[edgeIdx + 3]).toBeLessThan(220)
    expect(matte!.data[edgeIdx + 2]).toBeLessThan(120)

    // Adaptive studio background selector picks #FFFFFF for gold-rimmed controls and #141820 for white-rimmed controls
    expect(choosePurificationStudioBg(btn).bgHex).toBe('#FFFFFF')
    const whiteRimmed = makeButtonFrameRgba(60, 32, {
      borderPx: 5,
      borderRgb: [246, 248, 252],
      fillRgb: [40, 48, 68],
      cornerRadius: 4
    })
    expect(choosePurificationStudioBg(whiteRimmed).bgHex).toBe('#141820')
  })

  it('clusters occupied item-slots by outer border ring, suppresses unseparated interior icons via cleanest exemplar, and filters non-components', () => {
    const w = 48
    const h = 48
    const cleanSlot = makeButtonFrameRgba(w, h, { borderPx: 6, cornerRadius: 4 })

    // Slot 1 & Slot 2 contain unseparated bright red/green item icons in their centers (with NO explicit knownMask=0!)
    const occupiedSlotRed = {
      width: w,
      height: h,
      data: new Uint8ClampedArray(cleanSlot.data)
    }
    const occupiedSlotGreen = {
      width: w,
      height: h,
      data: new Uint8ClampedArray(cleanSlot.data)
    }
    for (let y = 14; y < 34; y++) {
      for (let x = 14; x < 34; x++) {
        const i = (y * w + x) * 4
        // Checker/textured icon pattern so interior gradient clutter is high
        const alt = (x + y) % 2 === 0 ? 245 : 165
        occupiedSlotRed.data[i] = alt
        occupiedSlotRed.data[i + 1] = 25
        occupiedSlotRed.data[i + 2] = 30
        occupiedSlotGreen.data[i] = 20
        occupiedSlotGreen.data[i + 1] = alt
        occupiedSlotGreen.data[i + 2] = 45
      }
    }

    const giantBackdrop = makeButtonFrameRgba(180, 140, { borderPx: 4, cornerRadius: 2 })

    const splitResult: PreciseSplitResult = {
      canvasWidth: 200,
      canvasHeight: 160,
      base: createImage(200, 160),
      layers: [
        {
          id: 'bg_panel',
          elementId: 'bg_panel',
          name: 'Giant Dialog Backdrop',
          kind: 'panel',
          parentElementId: null,
          paintIndex: 1,
          left: 10,
          top: 10,
          width: 180,
          height: 140,
          rgba: giantBackdrop.data
        },
        {
          id: 'slot_red',
          elementId: 'slot_red',
          name: 'Reward Slot',
          kind: 'item-slot',
          parentElementId: 'bg_panel',
          paintIndex: 2,
          left: 16,
          top: 30,
          width: w,
          height: h,
          rgba: occupiedSlotRed.data
        },
        {
          id: 'slot_green',
          elementId: 'slot_green',
          name: 'Reward Slot',
          kind: 'item-slot',
          parentElementId: 'bg_panel',
          paintIndex: 3,
          left: 72,
          top: 30,
          width: w,
          height: h,
          rgba: occupiedSlotGreen.data
        },
        {
          id: 'slot_empty',
          elementId: 'slot_empty',
          name: 'Reward Slot',
          kind: 'item-slot',
          parentElementId: 'bg_panel',
          paintIndex: 4,
          left: 128,
          top: 30,
          width: w,
          height: h,
          rgba: cleanSlot.data
        },
        {
          id: 'hero_avatar',
          elementId: 'hero_avatar',
          name: 'Hero Portrait',
          kind: 'avatar',
          parentElementId: 'bg_panel',
          paintIndex: 5,
          left: 20,
          top: 90,
          width: 48,
          height: 48,
          rgba: occupiedSlotRed.data
        },
        {
          id: 'sword_icon',
          elementId: 'sword_icon',
          name: 'Sword Icon',
          kind: 'icon',
          parentElementId: 'slot_red',
          paintIndex: 6,
          left: 24,
          top: 38,
          width: 32,
          height: 32,
          rgba: occupiedSlotGreen.data
        }
      ],
      tree: { canvasWidth: 200, canvasHeight: 160, elements: [] },
      reconstructionError: 0,
      peelReport: [],
      notes: []
    }

    const extracted = extractSharedComponentsFromSplitResults([{ split: splitResult }], {
      mode: 'auto'
    })

    // Avatar, standalone icon, and >40%-screen giant panel backdrop are all excluded;
    // the 3 item-slots (2 occupied + 1 empty) cluster into a single clean master!
    expect(extracted).toHaveLength(1)
    expect(extracted[0]!.item.kind).toBe('item-slot')
    expect(extracted[0]!.item.sourceCount).toBe(3)

    // Center pixel (24, 24) matches the clean slot's blue fill [38, 72, 136] without red/green icon ghosting
    const centerOff = (24 * w + 24) * 4
    expect(extracted[0]!.rgba.data[centerOff]).toBeCloseTo(38, 0)
    expect(extracted[0]!.rgba.data[centerOff + 1]).toBeCloseTo(72, 0)
    expect(extracted[0]!.rgba.data[centerOff + 2]).toBeCloseTo(136, 0)
  })

  it('runs VLM component-family catalog + solid-BG imagegen purification in executeUiComponentLibNode even when generateModel is default empty', async () => {
    const W = 200
    const H = 100
    const screen = createImage(W, H)
    for (let p = 0; p < W * H; p++) {
      screen.data[p * 4] = 24
      screen.data[p * 4 + 1] = 28
      screen.data[p * 4 + 2] = 40
      screen.data[p * 4 + 3] = 255
    }
    const rawBtn = makeButtonFrameRgba(64, 30, { borderPx: 5, cornerRadius: 4 })
    compositeOver(screen, rawBtn, 20, 35)
    compositeOver(screen, rawBtn, 110, 35)

    // Simulate dirty white label glyphs drawn across button 1 on the mockup
    for (let y = 45; y < 55; y++) {
      for (let x = 36; x < 68; x += 2) {
        const i = (y * W + x) * 4
        screen.data[i] = 255
        screen.data[i + 1] = 255
        screen.data[i + 2] = 255
      }
    }

    // Simulate a 2x higher-res purified studio render on #FFFFFF returned by ctx.generateImage
    const studioW = 160
    const studioH = 90
    const studioRender = createImage(studioW, studioH)
    for (let p = 0; p < studioW * studioH; p++) {
      studioRender.data[p * 4] = 254
      studioRender.data[p * 4 + 1] = 254
      studioRender.data[p * 4 + 2] = 252
      studioRender.data[p * 4 + 3] = 255
    }
    const hiResCleanBtn = makeButtonFrameRgba(128, 60, { borderPx: 10, cornerRadius: 8 })
    compositeOver(studioRender, hiResCleanBtn, 16, 15)

    const generateText = vi.fn(async () => ({
      text: JSON.stringify({
        components: [
          {
            id: 'c1',
            name: 'Primary Gold Button',
            kind: 'button',
            exemplar_box_2d: [350, 550, 650, 870],
            instance_boxes_2d: [
              [350, 100, 650, 420],
              [350, 550, 650, 870]
            ],
            has_embedded_content: true,
            embedded_content_desc: 'white text BUY',
            skin_desc: 'rounded gold-bordered blue button'
          }
        ]
      })
    }))

    const generateImage = vi.fn(async () => ({
      images: [encodeRawRgbaDataUrl(studioRender)]
    }))

    const libNode = createNodeFromType('ui.componentLib', { x: 0, y: 0 })
    // Explicitly verify default empty `generateModel: ''` still activates AI solid-BG purification!
    expect(libNode.params.generateModel ?? '').toBe('')

    const uiRgbaCodec = {
      decodeImageRgba: async (url: string) => decodeRawRgbaDataUrl(url),
      encodeRgbaPng: async (img: RgbaImage) => encodeRawRgbaDataUrl(img)
    }

    const out = await executeUiComponentLibNode({
      node: libNode,
      inputs: {
        in: [{ kind: 'image', dataUrl: encodeRawRgbaDataUrl(screen) }]
      },
      generateText,
      generateImage,
      uiRgbaCodec,
      patchNode: vi.fn()
    } as unknown as NodeExecuteContext)

    expect(generateText).toHaveBeenCalledTimes(1)
    expect(generateImage).toHaveBeenCalledTimes(1)
    expect(out.out.kind).toBe('uiComponents')
    if (out.out.kind !== 'uiComponents') throw new Error('expected uiComponents')
    expect(out.out.doc.items).toHaveLength(1)

    const item = out.out.doc.items[0]!
    expect(item.name).toBe('Primary Gold Button')
    expect(item.kind).toBe('button')
    expect(item.sourceCount).toBe(2)
    expect(item.canonicalWidth).toBe(64)
    expect(item.canonicalHeight).toBe(30)
    expect(item.scalePolicy).toBe('nine-slice')

    const masterDecoded = decodeRawRgbaDataUrl(item.imageUrl!)
    expect(masterDecoded.width).toBe(64)
    expect(masterDecoded.height).toBe(30)
    // Outer corner (0,0) is transparent, interior center (32, 15) is clean blue fill [38, 72, 136, 255]
    expect(masterDecoded.data[3]).toBe(0)
    const mid = (15 * 64 + 32) * 4
    expect(masterDecoded.data[mid]).toBeCloseTo(38, 1)
    expect(masterDecoded.data[mid + 1]).toBeCloseTo(72, 1)
    expect(masterDecoded.data[mid + 2]).toBeCloseTo(136, 1)
    expect(masterDecoded.data[mid + 3]).toBe(255)
  })

  it('extracts ALL distinct UI components across multiple screens in auto mode (>12 cap, singletons, same-border color variants, asset/colliding-id inputs, and local fallback on imagegen error)', async () => {
    const W = 400
    const H = 300
    const makeDarkScreen = (): RgbaImage => {
      const img = createImage(W, H)
      for (let p = 0; p < W * H; p++) {
        img.data[p * 4] = 20
        img.data[p * 4 + 1] = 24
        img.data[p * 4 + 2] = 34
        img.data[p * 4 + 3] = 255
      }
      return img
    }

    const screen1 = makeDarkScreen()
    const screen2 = makeDarkScreen()
    const screen3 = makeDarkScreen()

    // Shared Blue Item Slot across Screen 1 (2x) and Screen 2 (1x) -> should merge into 1 entry with sourceCount = 3
    const sharedSlot = makeButtonFrameRgba(44, 44, {
      borderPx: 4,
      borderRgb: [224, 178, 68],
      fillRgb: [38, 72, 136],
      cornerRadius: 4
    })
    compositeOver(screen1, sharedSlot, 20, 20)
    compositeOver(screen1, sharedSlot, 80, 20)
    compositeOver(screen2, sharedSlot, 20, 20)

    // 14 MORE distinct single-instance controls across the 3 screens (total = 15 distinct component skins > old 12 cap!),
    // ALL sharing the exact same gold border [224, 178, 68] so old border-only deduplication would falsely collapse them!
    const distinctControls: Array<{
      screenIdx: 0 | 1 | 2
      name: string
      kind: string
      x: number
      y: number
      w: number
      h: number
      fillRgb: [number, number, number]
    }> = [
      {
        screenIdx: 0,
        name: 'Green Confirm Btn',
        kind: 'button',
        x: 150,
        y: 20,
        w: 68,
        h: 32,
        fillRgb: [42, 168, 76]
      },
      {
        screenIdx: 0,
        name: 'Blue Upgrade Btn',
        kind: 'button',
        x: 240,
        y: 20,
        w: 68,
        h: 32,
        fillRgb: [40, 96, 204]
      },
      {
        screenIdx: 0,
        name: 'Close Btn S1',
        kind: 'close-button',
        x: 340,
        y: 20,
        w: 32,
        h: 32,
        fillRgb: [176, 44, 52]
      },
      {
        screenIdx: 0,
        name: 'Active Gold Tab',
        kind: 'tab',
        x: 20,
        y: 90,
        w: 72,
        h: 28,
        fillRgb: [212, 152, 42]
      },
      {
        screenIdx: 0,
        name: 'Inactive Slate Tab',
        kind: 'tab',
        x: 110,
        y: 90,
        w: 72,
        h: 28,
        fillRgb: [52, 58, 76]
      },
      {
        screenIdx: 1,
        name: 'Red Danger Btn',
        kind: 'button',
        x: 100,
        y: 20,
        w: 68,
        h: 32,
        fillRgb: [198, 48, 56]
      },
      {
        screenIdx: 1,
        name: 'Purple Gacha Btn',
        kind: 'button',
        x: 190,
        y: 20,
        w: 68,
        h: 32,
        fillRgb: [138, 56, 196]
      },
      {
        screenIdx: 1,
        name: 'Legendary Gold Slot',
        kind: 'item-slot',
        x: 280,
        y: 20,
        w: 44,
        h: 44,
        fillRgb: [164, 112, 28]
      },
      {
        screenIdx: 1,
        name: 'HP Progress Bar',
        kind: 'progress-bar',
        x: 20,
        y: 100,
        w: 120,
        h: 22,
        fillRgb: [36, 148, 92]
      },
      {
        screenIdx: 1,
        name: 'VIP Badge Pill',
        kind: 'badge',
        x: 170,
        y: 100,
        w: 52,
        h: 24,
        fillRgb: [192, 92, 34]
      },
      {
        screenIdx: 2,
        name: 'Cyan Craft Btn',
        kind: 'button',
        x: 20,
        y: 20,
        w: 68,
        h: 32,
        fillRgb: [32, 164, 182]
      },
      {
        screenIdx: 2,
        name: 'Epic Violet Slot',
        kind: 'item-slot',
        x: 110,
        y: 20,
        w: 44,
        h: 44,
        fillRgb: [116, 44, 158]
      },
      {
        screenIdx: 2,
        name: 'Quest Header Banner',
        kind: 'banner',
        x: 180,
        y: 20,
        w: 140,
        h: 36,
        fillRgb: [88, 52, 36]
      },
      {
        screenIdx: 2,
        name: 'Compact Sub Panel',
        kind: 'panel',
        x: 20,
        y: 100,
        w: 130,
        h: 80,
        fillRgb: [44, 52, 74]
      }
    ]

    const screens = [screen1, screen2, screen3]
    for (const ctrl of distinctControls) {
      const sprite = makeButtonFrameRgba(ctrl.w, ctrl.h, {
        borderPx: 4,
        borderRgb: [224, 178, 68],
        fillRgb: ctrl.fillRgb,
        cornerRadius: 4
      })
      compositeOver(screens[ctrl.screenIdx]!, sprite, ctrl.x, ctrl.y)
    }

    const toBox2d = (
      x: number,
      y: number,
      w: number,
      h: number
    ): [number, number, number, number] => [
      Math.round((y / H) * 1000),
      Math.round((x / W) * 1000),
      Math.round(((y + h) / H) * 1000),
      Math.round(((x + w) / W) * 1000)
    ]

    const catalogsByScreen = [0, 1, 2].map((sIdx) => {
      const entries: Array<Record<string, unknown>> = []
      if (sIdx === 0) {
        entries.push({
          id: 'shared_slot_s1',
          name: 'Shared Blue Slot',
          kind: 'item-slot',
          exemplar_box_2d: toBox2d(20, 20, 44, 44),
          instance_boxes_2d: [toBox2d(20, 20, 44, 44), toBox2d(80, 20, 44, 44)],
          has_embedded_content: false,
          skin_desc: 'gold-bordered blue item slot'
        })
      } else if (sIdx === 1) {
        entries.push({
          id: 'shared_slot_s2',
          name: 'Shared Blue Slot',
          kind: 'item-slot',
          exemplar_box_2d: toBox2d(20, 20, 44, 44),
          instance_boxes_2d: [toBox2d(20, 20, 44, 44)],
          has_embedded_content: false,
          skin_desc: 'gold-bordered blue item slot'
        })
      }
      for (const ctrl of distinctControls.filter((c) => c.screenIdx === sIdx)) {
        entries.push({
          id: ctrl.name.replace(/\s+/g, '_').toLowerCase(),
          name: ctrl.name,
          kind: ctrl.kind,
          exemplar_box_2d: toBox2d(ctrl.x, ctrl.y, ctrl.w, ctrl.h),
          instance_boxes_2d: [toBox2d(ctrl.x, ctrl.y, ctrl.w, ctrl.h)],
          has_embedded_content: false,
          skin_desc: ctrl.name
        })
      }
      return { components: entries }
    })

    const url1 = encodeRawRgbaDataUrl(screen1)
    const url2 = encodeRawRgbaDataUrl(screen2)
    const url3 = encodeRawRgbaDataUrl(screen3)

    const generateText = vi.fn(async (req: { images?: string[] }) => {
      const imgUrl = req.images?.[0] ?? ''
      const idx = imgUrl === url1 ? 0 : imgUrl === url2 ? 1 : 2
      return { text: JSON.stringify(catalogsByScreen[idx]) }
    })

    // Simulate solid-BG purified studio render for all components EXCEPT 'Quest Header Banner',
    // where `generateImage` throws a simulated timeout error to verify local fallback preservation!
    const generateImage = vi.fn(async (req: { prompt: string }) => {
      if (req.prompt.includes('Quest Header Banner')) {
        throw new Error('Simulated upstream imagegen rate limit')
      }
      const matchCtrl = distinctControls.find((c) => req.prompt.includes(c.name))
      const cw = matchCtrl ? matchCtrl.w : 44
      const ch = matchCtrl ? matchCtrl.h : 44
      const fill = matchCtrl ? matchCtrl.fillRgb : ([38, 72, 136] as [number, number, number])
      const studio = createImage(cw + 24, ch + 24)
      for (let p = 0; p < studio.width * studio.height; p++) {
        studio.data[p * 4] = 255
        studio.data[p * 4 + 1] = 255
        studio.data[p * 4 + 2] = 255
        studio.data[p * 4 + 3] = 255
      }
      const clean = makeButtonFrameRgba(cw, ch, {
        borderPx: 4,
        borderRgb: [224, 178, 68],
        fillRgb: fill,
        cornerRadius: 4
      })
      compositeOver(studio, clean, 12, 12)
      return { images: [encodeRawRgbaDataUrl(studio)] }
    })

    const libNode = createNodeFromType('ui.componentLib', { x: 0, y: 0 })
    // Default extract mode is `auto`!
    expect(libNode.params.uiComponentExtractMode).toBe('auto')

    const uiRgbaCodec = {
      decodeImageRgba: async (url: string) => decodeRawRgbaDataUrl(url),
      encodeRgbaPng: async (img: RgbaImage) => encodeRawRgbaDataUrl(img)
    }

    // Wire Screen 1 & Screen 2 with colliding generic `id: '0'` on `in`, and Screen 3 as an `asset` on `in-images`!
    const out = await executeUiComponentLibNode({
      node: libNode,
      inputs: {
        in: [
          { kind: 'image', id: '0', title: 'Main HUD', dataUrl: url1 },
          { kind: 'image', id: '0', title: 'Inventory', dataUrl: url2 }
        ],
        'in-images': [{ kind: 'asset', assetId: 'asset_s3', assetType: 'image', name: 'Quest UI' }]
      },
      resolveAssetImageUrl: async (assetId: string) => (assetId === 'asset_s3' ? url3 : undefined),
      generateText,
      generateImage,
      uiRgbaCodec,
      patchNode: vi.fn()
    } as unknown as NodeExecuteContext)

    expect(generateText).toHaveBeenCalledTimes(3)
    expect(out.out.kind).toBe('uiComponents')
    if (out.out.kind !== 'uiComponents') throw new Error('expected uiComponents')

    const names = out.out.doc.items.map((i) => i.name)
    // 1 shared cross-screen slot + 14 distinct controls = ALL 15 components extracted!
    expect(out.out.doc.items).toHaveLength(15)
    expect(names).toContain('Shared Blue Slot')
    for (const ctrl of distinctControls) {
      expect(names).toContain(ctrl.name)
    }

    const mergedSlot = out.out.doc.items.find((i) => i.name === 'Shared Blue Slot')!
    expect(mergedSlot.sourceCount).toBe(3)
  })

  it('preserves multi-screen batch out on ui.gen and uiComponents out on ui.componentLib in resolveGalleryOutputsFromNodeParams', () => {
    const uiGenOutputs = resolveGalleryOutputsFromNodeParams(
      {
        generatedImages: [
          { id: 's1', title: 'Screen 1', dataUrl: 'data:image/png;base64,AAA' },
          { id: 's2', title: 'Screen 2', dataUrl: 'data:image/png;base64,BBB' },
          { id: 's3', title: 'Screen 3', dataUrl: 'data:image/png;base64,CCC' }
        ],
        selectedImageId: 's2'
      },
      { typeId: 'ui.gen' }
    )
    expect(uiGenOutputs?.out).toEqual({
      kind: 'images',
      items: expect.arrayContaining([
        expect.objectContaining({ id: 's1' }),
        expect.objectContaining({ id: 's2' }),
        expect.objectContaining({ id: 's3' })
      ])
    })
    expect(uiGenOutputs?.['out-selected']).toMatchObject({ kind: 'image', id: 's2' })

    const sampleLib = emptyUiComponentLibrary('Test Lib')
    sampleLib.items.push({
      id: 'comp_btn_01',
      psdGuid: componentIdToPsdGuid('comp_btn_01'),
      name: 'Gold Button',
      exportName: 'Comp_Btn_01',
      kind: 'button',
      canonicalWidth: 64,
      canonicalHeight: 32,
      scalePolicy: 'nine-slice',
      imageUrl: 'data:image/png;base64,AAA'
    })
    const compLibOutputs = resolveGalleryOutputsFromNodeParams(
      {
        uiComponentLibrary: stringifyUiComponentLibrary(sampleLib),
        generatedImages: [
          { id: 'img_1', title: 'Gold Button', dataUrl: 'data:image/png;base64,AAA' }
        ]
      },
      { typeId: 'ui.componentLib' }
    )
    expect(compLibOutputs?.out?.kind).toBe('uiComponents')
    expect(compLibOutputs?.['out-images']?.kind).toBe('images')
  })
})
