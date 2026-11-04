import { describe, expect, it } from 'vitest'
import {
  DEFAULT_IMAGE_LAYER_SPLIT,
  applyRepairedLayerToState,
  buildLayerRepairPrompt,
  finalizeLayerRepairRgba,
  inpaintLayerHolesInPlace,
  isExplicitLayerCutoutHint,
  normalizeLayerRepairResolution,
  pickContrastMatteRgb,
  prepareLayerRepairReference
} from '../src/shared/graph'
import { createImage, resizeBilinear } from '../src/shared/graph/uiPreciseSplit'

describe('layerSplitAiRepair', () => {
  it('normalizes resolution values unsupported by image-edit providers to 2K', () => {
    expect(normalizeLayerRepairResolution(undefined)).toBe('2K')
    expect(normalizeLayerRepairResolution('')).toBe('2K')
    expect(normalizeLayerRepairResolution('auto')).toBe('2K')
    expect(normalizeLayerRepairResolution('1.5K')).toBe('2K')
    expect(normalizeLayerRepairResolution('1K')).toBe('1K')
    expect(normalizeLayerRepairResolution('2K')).toBe('2K')
    expect(normalizeLayerRepairResolution('4K')).toBe('4K')
  })

  it('picks high-contrast neutral matte RGB against dark vs light UI edges', () => {
    const darkBorderBtn = createImage(48, 32)
    for (let y = 6; y < 26; y++) {
      for (let x = 6; x < 42; x++) {
        const i = (y * 48 + x) * 4
        const isEdge = x === 6 || x === 41 || y === 6 || y === 25
        darkBorderBtn.data[i] = isEdge ? 18 : 65
        darkBorderBtn.data[i + 1] = isEdge ? 22 : 120
        darkBorderBtn.data[i + 2] = isEdge ? 30 : 210
        darkBorderBtn.data[i + 3] = 255
      }
    }
    const matteForDark = pickContrastMatteRgb(darkBorderBtn)
    expect(matteForDark[0]).toBeGreaterThan(220)

    const whiteIcon = createImage(48, 48)
    for (let y = 10; y < 38; y++) {
      for (let x = 10; x < 38; x++) {
        const i = (y * 48 + x) * 4
        whiteIcon.data[i] = 248
        whiteIcon.data[i + 1] = 250
        whiteIcon.data[i + 2] = 252
        whiteIcon.data[i + 3] = 255
      }
    }
    const matteForWhite = pickContrastMatteRgb(whiteIcon)
    expect(matteForWhite[0]).toBeLessThan(50)
  })

  it('pads ultra-wide or tiny sprites to API-safe sizes and crops back without aspect distortion', () => {
    // 320x24 ultra-wide bar (13.3:1 > 21:9) with transparent exterior and an internal hole
    const orig = createImage(320, 24)
    for (let y = 4; y < 20; y++) {
      for (let x = 8; x < 312; x++) {
        // Leave a 10x8 occlusion hole in the middle
        if (x >= 155 && x < 165 && y >= 8 && y < 16) continue
        const i = (y * 320 + x) * 4
        orig.data[i] = 230
        orig.data[i + 1] = 165
        orig.data[i + 2] = 40
        orig.data[i + 3] = 255
      }
    }

    const prepared = prepareLayerRepairReference(orig, { nativeTransparent: false })
    expect(prepared.aspectRatio).toBe('21:9')
    expect(Math.max(prepared.image.width, prepared.image.height)).toBeGreaterThanOrEqual(512)
    expect(Math.min(prepared.image.width, prepared.image.height)).toBeGreaterThanOrEqual(128)
    expect(prepared.workHeight).toBeGreaterThan(orig.height)
    expect(prepared.cropTop).toBeGreaterThan(0)
    expect(prepared.matteRgb).not.toBeNull()

    // Simulate non-native image model returning an opaque 1050x450 image where the hole is repaired
    const simulatedWork = createImage(prepared.workWidth, prepared.workHeight)
    const [mr, mg, mb] = prepared.matteRgb!
    for (let p = 0; p < simulatedWork.width * simulatedWork.height; p++) {
      const i = p * 4
      simulatedWork.data[i] = mr
      simulatedWork.data[i + 1] = mg
      simulatedWork.data[i + 2] = mb
      simulatedWork.data[i + 3] = 255
    }
    for (let y = 4; y < 20; y++) {
      for (let x = 8; x < 312; x++) {
        const wy = prepared.cropTop + y
        const wx = prepared.cropLeft + x
        const i = (wy * simulatedWork.width + wx) * 4
        simulatedWork.data[i] = 230
        simulatedWork.data[i + 1] = 165
        simulatedWork.data[i + 2] = 40
        simulatedWork.data[i + 3] = 255
      }
    }
    const modelOutput = resizeBilinear(simulatedWork, 1050, 450)
    const finalRgba = finalizeLayerRepairRgba(modelOutput, orig, prepared)

    expect(finalRgba.width).toBe(320)
    expect(finalRgba.height).toBe(24)
    // Exterior stays transparent
    expect(finalRgba.data[3]).toBe(0)
    expect(finalRgba.data[(1 * 320 + 160) * 4 + 3]).toBe(0)
    expect(finalRgba.data[(22 * 320 + 160) * 4 + 3]).toBe(0)
    // Repaired internal hole is preserved as opaque gold!
    const centerHoleIdx = (12 * 320 + 160) * 4
    expect(finalRgba.data[centerHoleIdx + 3]).toBe(255)
    expect(finalRgba.data[centerHoleIdx]).toBeGreaterThan(200)
  })

  it('preserves native translucent glow when model already outputs real RGBA alpha', () => {
    const orig = createImage(64, 64)
    for (let y = 16; y < 48; y++) {
      for (let x = 16; x < 48; x++) {
        const i = (y * 64 + x) * 4
        orig.data[i] = 80
        orig.data[i + 1] = 190
        orig.data[i + 2] = 255
        orig.data[i + 3] = 255
      }
    }
    const prepared = prepareLayerRepairReference(orig, { nativeTransparent: true })
    expect(prepared.matteRgb).toBeNull()

    const gen = createImage(64, 64)
    for (let y = 12; y < 52; y++) {
      for (let x = 12; x < 52; x++) {
        const i = (y * 64 + x) * 4
        const inCore = x >= 16 && x < 48 && y >= 16 && y < 48
        gen.data[i] = 80
        gen.data[i + 1] = 190
        gen.data[i + 2] = 255
        gen.data[i + 3] = inCore ? 255 : 96
      }
    }

    const finalRgba = finalizeLayerRepairRgba(gen, orig, prepared)
    // Outer border stays 0, soft glow ring keeps alpha ~96 instead of being forced to 0 or 255
    expect(finalRgba.data[3]).toBe(0)
    expect(finalRgba.data[(14 * 64 + 32) * 4 + 3]).toBeGreaterThan(70)
    expect(finalRgba.data[(14 * 64 + 32) * 4 + 3]).toBeLessThan(120)
  })

  it('does not erode corners of a fully opaque rectangular UI card unless cutout is requested', () => {
    const orig = createImage(80, 60)
    for (let p = 0; p < 80 * 60; p++) {
      orig.data[p * 4] = 42
      orig.data[p * 4 + 1] = 48
      orig.data[p * 4 + 2] = 64
      orig.data[p * 4 + 3] = 255
    }
    const prepared = prepareLayerRepairReference(orig, { nativeTransparent: false })
    expect(prepared.matteRgb).toBeNull()

    const finalRgba = finalizeLayerRepairRgba(orig, orig, {
      ...prepared,
      forceCutout: isExplicitLayerCutoutHint('修复划痕')
    })
    expect(finalRgba.data[3]).toBe(255)
    expect(finalRgba.data[(59 * 80 + 79) * 4 + 3]).toBe(255)
  })

  it('builds localized prompts and clears resolved QA flags on repaired layer state', () => {
    const promptZh = buildLayerRepairPrompt({
      userInstruction: '修复边缘锯齿',
      layerName: '确认按钮',
      locale: 'zh-CN',
      nativeTransparent: false,
      matteRgb: [246, 248, 252]
    })
    expect(promptZh).toContain('修复边缘锯齿')
    expect(promptZh).toContain('确认按钮')

    const next = applyRepairedLayerToState(
      {
        ...DEFAULT_IMAGE_LAYER_SPLIT,
        canvasWidth: 200,
        canvasHeight: 100,
        layers: [
          {
            id: 'base',
            imageId: 'base',
            zIndex: 0,
            name: 'Base',
            description: '',
            visible: true,
            left: 0,
            top: 0,
            width: 200,
            height: 100,
            role: 'base'
          },
          {
            id: 'btn_ok',
            imageId: 'btn_ok_old',
            zIndex: 1,
            name: '确认按钮',
            description: '',
            visible: true,
            left: 20,
            top: 20,
            width: 120,
            height: 44,
            role: 'layer',
            qaIssues: ['edge_halo', 'occluded_blurry', 'under_extracted']
          }
        ]
      },
      'btn_ok',
      'btn_ok:aiFix:123'
    )
    const updated = next.layers.find((l) => l.id === 'btn_ok')!
    expect(updated.imageId).toBe('btn_ok:aiFix:123')
    expect(updated.qaIssues).toEqual(['under_extracted'])
  })

  it('prepares and finalizes Base layer repair as an opaque clean background plate', () => {
    const baseOrig = createImage(160, 120)
    for (let y = 0; y < 120; y++) {
      for (let x = 0; x < 160; x++) {
        const i = (y * 160 + x) * 4
        // Simulate peeled-out alpha=0 hole in the middle from leaf-to-root extraction
        if (x >= 50 && x < 110 && y >= 40 && y < 80) {
          baseOrig.data[i + 3] = 0
          continue
        }
        baseOrig.data[i] = 28
        baseOrig.data[i + 1] = 36
        baseOrig.data[i + 2] = 54
        baseOrig.data[i + 3] = 255
      }
    }

    const prepared = prepareLayerRepairReference(baseOrig, {
      nativeTransparent: true,
      isBase: true
    })
    expect(prepared.keepOpaque).toBe(true)
    expect(prepared.matteRgb).toBeNull()

    // Reference sent to image model must have internal peeled holes pre-inpainted opaque
    const refMidX = Math.floor(prepared.image.width / 2)
    const refMidY = Math.floor(prepared.image.height / 2)
    const refMidIdx = (refMidY * prepared.image.width + refMidX) * 4
    expect(prepared.image.data[refMidIdx + 3]).toBe(255)
    expect(prepared.image.data[refMidIdx]).toBeGreaterThan(15)

    const basePrompt = buildLayerRepairPrompt({
      userInstruction: '',
      layerName: '底图',
      locale: 'zh-CN',
      nativeTransparent: true,
      matteRgb: prepared.matteRgb,
      isBase: true
    })
    expect(basePrompt).toContain('底层背景底图')
    expect(basePrompt).toContain('严禁新增任何按钮')

    // Simulate model returning repaired base plate
    const modelGen = createImage(prepared.image.width, prepared.image.height)
    for (let p = 0; p < modelGen.width * modelGen.height; p++) {
      modelGen.data[p * 4] = 30
      modelGen.data[p * 4 + 1] = 38
      modelGen.data[p * 4 + 2] = 56
      modelGen.data[p * 4 + 3] = 255
    }

    const finalBase = finalizeLayerRepairRgba(modelGen, baseOrig, {
      ...prepared,
      forceCutout: false
    })
    expect(finalBase.width).toBe(160)
    expect(finalBase.height).toBe(120)
    // Corners AND repaired interior hole remain solid opaque!
    expect(finalBase.data[3]).toBe(255)
    expect(finalBase.data[(60 * 160 + 80) * 4 + 3]).toBe(255)
  })

  it('strips fake two-tone gray/white checkerboard & halo residue around a glowing UI panel', () => {
    const W = 120
    const H = 90
    const orig = createImage(W, H)
    // Build a dark-blue UI panel [18..102, 14..76] with a soft outer glow halo [8..112, 6..84]
    for (let y = 6; y < 84; y++) {
      for (let x = 8; x < 112; x++) {
        const i = (y * W + x) * 4
        const inCore = x >= 18 && x < 102 && y >= 14 && y < 76
        if (inCore) {
          // Leave an internal occlusion hole at [50..62, 40..50]
          if (x >= 50 && x < 62 && y >= 40 && y < 50) continue
          const isBorder = x < 21 || x >= 99 || y < 17 || y >= 73
          orig.data[i] = isBorder ? 45 : 22
          orig.data[i + 1] = isBorder ? 155 : 68
          orig.data[i + 2] = isBorder ? 255 : 145
          orig.data[i + 3] = 255
        } else {
          // Soft outer glow / extraction residue (alpha 28..72)
          orig.data[i] = 40
          orig.data[i + 1] = 140
          orig.data[i + 2] = 245
          orig.data[i + 3] = 48
        }
      }
    }

    const prepared = prepareLayerRepairReference(orig, {
      nativeTransparent: false,
      transparentBackground: true
    })
    expect(prepared.keepOpaque).toBe(false)

    // Simulate model returning an image where:
    // - top-left corner has partial transparency (alpha=0),
    // - the rest of the exterior AND the soft glow halo has a drawn gray-and-white checkerboard (#ffffff / #cccccc),
    // - the internal hole inside the blue panel is repaired with dark blue.
    const simWork = createImage(prepared.workWidth, prepared.workHeight)
    for (let y = 0; y < simWork.height; y++) {
      for (let x = 0; x < simWork.width; x++) {
        const i = (y * simWork.width + x) * 4
        const lx = x - prepared.cropLeft
        const ly = y - prepared.cropTop
        const inCore = lx >= 18 && lx < 102 && ly >= 14 && ly < 76
        if (inCore) {
          const isBorder = lx < 21 || lx >= 99 || ly < 17 || ly >= 73
          simWork.data[i] = isBorder ? 45 : 22
          simWork.data[i + 1] = isBorder ? 155 : 68
          simWork.data[i + 2] = isBorder ? 255 : 145
          simWork.data[i + 3] = 255
        } else if (lx < 25 && ly < 12) {
          // Partial transparent corner
          simWork.data[i + 3] = 0
        } else {
          // Drawn 6x6 gray/white checkerboard in both exterior and glow ring
          const isWhiteCell = ((Math.floor(x / 6) + Math.floor(y / 6)) & 1) === 0
          const c = isWhiteCell ? 252 : 198
          simWork.data[i] = c
          simWork.data[i + 1] = c
          simWork.data[i + 2] = c
          simWork.data[i + 3] = 255
        }
      }
    }

    const finalRgba = finalizeLayerRepairRgba(simWork, orig, prepared)
    // Both white and gray checkerboard cells in exterior AND in the old glow ring must be stripped to alpha=0
    expect(finalRgba.data[(2 * W + 100) * 4 + 3]).toBe(0)
    expect(finalRgba.data[(2 * W + 106) * 4 + 3]).toBe(0)
    expect(finalRgba.data[(10 * W + 60) * 4 + 3]).toBe(0)
    expect(finalRgba.data[(45 * W + 108) * 4 + 3]).toBe(0)
    expect(finalRgba.data[(80 * W + 60) * 4 + 3]).toBe(0)
    // Solid blue panel interior and repaired internal hole stay opaque!
    expect(finalRgba.data[(45 * W + 55) * 4 + 3]).toBe(255)
    expect(finalRgba.data[(45 * W + 55) * 4 + 2]).toBeGreaterThan(120)
  })

  it('honors explicit transparentBackground=false option on foreground layers', () => {
    const orig = createImage(64, 48)
    for (let y = 8; y < 40; y++) {
      for (let x = 8; x < 56; x++) {
        const i = (y * 64 + x) * 4
        orig.data[i] = 60
        orig.data[i + 1] = 110
        orig.data[i + 2] = 200
        orig.data[i + 3] = 255
      }
    }
    const prepared = prepareLayerRepairReference(orig, {
      nativeTransparent: false,
      transparentBackground: false
    })
    expect(prepared.keepOpaque).toBe(true)
    const prompt = buildLayerRepairPrompt({
      userInstruction: '',
      layerName: '面板',
      locale: 'zh-CN',
      nativeTransparent: false,
      matteRgb: prepared.matteRgb,
      transparentBackground: false
    })
    expect(prompt).toContain('保持不透明背景')
  })

  it('fills feathered brush holes & 1-2px dark cutout rims without leaving a seam ring', () => {
    const W = 120
    const H = 80
    const img = createImage(W, H)
    // Build a golden-yellow foreground card [8..112, 8..72] with 1px outer anti-aliased silhouette
    for (let y = 7; y <= 72; y++) {
      for (let x = 7; x <= 112; x++) {
        const i = (y * W + x) * 4
        const isOuterAa = x === 7 || x === 112 || y === 7 || y === 72
        img.data[i] = 247
        img.data[i + 1] = 194
        img.data[i + 2] = 54
        img.data[i + 3] = isOuterAa ? 140 : 255
      }
    }

    // Simulate a feathered brush erase (radius 18 at center 60,40, outer 25% feathered alpha 0..254)
    // plus dark anti-aliased stroke contamination right on the alpha=180..255 rim
    const cx = 60
    const cy = 40
    const r = 18
    for (let y = 18; y <= 62; y++) {
      for (let x = 38; x <= 82; x++) {
        const dist = Math.hypot(x - cx, y - cy)
        if (dist > r + 1.2) continue
        const i = (y * W + x) * 4
        if (dist <= r * 0.75) {
          img.data[i + 3] = 0
        } else if (dist <= r) {
          const strength = Math.max(0, (r - dist) / (r * 0.25))
          img.data[i + 3] = Math.round(255 * (1 - strength))
          // Dark residue in the semi-transparent band
          img.data[i] = 120
          img.data[i + 1] = 95
          img.data[i + 2] = 40
        } else {
          // 1px opaque dark anti-aliased stroke ring right outside the brush feather
          img.data[i] = 150
          img.data[i + 1] = 118
          img.data[i + 2] = 45
          img.data[i + 3] = 255
        }
      }
    }

    expect(inpaintLayerHolesInPlace(img)).toBe(true)

    // Every pixel across the hole center AND the entire former feather/dark-rim band must be seamlessly yellow & alpha=255
    for (let x = 36; x <= 84; x++) {
      const i = (40 * W + x) * 4
      expect(img.data[i + 3]).toBe(255)
      expect(Math.abs(img.data[i]! - 247)).toBeLessThanOrEqual(2)
      expect(Math.abs(img.data[i + 1]! - 194)).toBeLessThanOrEqual(2)
      expect(Math.abs(img.data[i + 2]! - 54)).toBeLessThanOrEqual(2)
    }

    // Outer transparent background and 1px outer silhouette anti-aliasing remain untouched
    expect(img.data[(2 * W + 60) * 4 + 3]).toBe(0)
    expect(img.data[(7 * W + 60) * 4 + 3]).toBe(140)
  })

  it('preserves plateau translucency when filling holes inside a semi-transparent glass panel', () => {
    const W = 80
    const H = 60
    const glass = createImage(W, H)
    for (let y = 6; y < 54; y++) {
      for (let x = 6; x < 74; x++) {
        const i = (y * W + x) * 4
        const isBorder = x < 9 || x >= 71 || y < 9 || y >= 51
        glass.data[i] = 48
        glass.data[i + 1] = 168
        glass.data[i + 2] = 235
        glass.data[i + 3] = isBorder ? 255 : 176
      }
    }
    // Punch an internal hole [34..46, 24..36]
    for (let y = 24; y < 36; y++) {
      for (let x = 34; x < 46; x++) {
        glass.data[(y * W + x) * 4 + 3] = 0
      }
    }

    expect(inpaintLayerHolesInPlace(glass)).toBe(true)
    // Hole is filled to match surrounding glass translucency (~176), not forced to opaque 255
    const centerAlpha = glass.data[(30 * W + 40) * 4 + 3]!
    expect(centerAlpha).toBeGreaterThanOrEqual(168)
    expect(centerAlpha).toBeLessThanOrEqual(184)
    // Untouched glass region remains 176
    expect(glass.data[(16 * W + 16) * 4 + 3]).toBe(176)
  })
})
