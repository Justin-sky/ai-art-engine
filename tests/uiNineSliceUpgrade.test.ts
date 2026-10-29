import { describe, expect, it } from 'vitest'
import {
  buildNineSliceManifest,
  detectNineSliceBorders,
  exportGodotNinePatchTscn,
  exportUnityNineSliceSnippet,
  exportWebCssNineSliceSnippet,
  sliceNinePatchRegionsRgba
} from '../src/shared/gameAssets/uiNineSlice'
import { executeGamePbrTileNode } from '../src/shared/graph/execute/gameNodes'
import type { NodeExecuteContext } from '../src/shared/graph/execute/types'

function createTestUiPanelRgba(width = 64, height = 48): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const isBorder = x < 10 || x >= width - 10 || y < 8 || y >= height - 8
      if (isBorder) {
        //Distinctive gold border with asymmetric left/right R channel to test symmetry lock
        rgba[idx] = x < 10 ? 240 : 180
        rgba[idx + 1] = 195
        rgba[idx + 2] = 65
        rgba[idx + 3] = 255
      } else {
        // Dark slate interior
        rgba[idx] = 28
        rgba[idx + 1] = 34
        rgba[idx + 2] = 48
        rgba[idx + 3] = 255
      }
    }
  }
  return rgba
}

describe('UI Container & 9-Slice Practicality Upgrade', () => {
  it('slices raw UI image into 9 patches, exploded 3x3 atlas, hollow frame, and stretched dialog preview', () => {
    const width = 64
    const height = 48
    const rgba = createTestUiPanelRgba(width, height)
    const borders = { left: 10, right: 10, top: 8, bottom: 8 }

    const res = sliceNinePatchRegionsRgba(rgba, width, height, borders, {
      autoKeyBackground: false,
      symmetricLock: true,
      gapPx: 6,
      previewWidth: 120,
      previewHeight: 80,
      stretchMode: 'stretch'
    })

    expect(res.patchList).toHaveLength(9)
    expect(res.patches.top_left.width).toBe(10)
    expect(res.patches.top_left.height).toBe(8)
    expect(res.patches.middle_center.width).toBe(44)
    expect(res.patches.middle_center.height).toBe(32)
    expect(res.patches.bottom_right.width).toBe(10)
    expect(res.patches.bottom_right.height).toBe(8)

    // Exploded atlas adds 2 * gapPx to width and height
    expect(res.explodedWidth).toBe(width + 12)
    expect(res.explodedHeight).toBe(height + 12)
    expect(res.explodedSheetRgba.length).toBe(res.explodedWidth * res.explodedHeight * 4)

    // Hollow frame carves out center interior to alpha = 0 while keeping border alpha = 255
    const centerIdx = (24 * width + 32) * 4
    expect(res.hollowFrameRgba[centerIdx + 3]).toBe(0)
    const borderIdx = (4 * width + 4) * 4
    expect(res.hollowFrameRgba[borderIdx + 3]).toBe(255)

    // Symmetry lock mirrors left border (R=240) onto right border
    const rightBorderIdx = (20 * width + (width - 3)) * 4
    expect(res.cleanedRgba[rightBorderIdx]).toBe(240)

    // Stretched preview matches requested dimensions
    expect(res.previewWidth).toBe(120)
    expect(res.previewHeight).toBe(80)
    expect(res.stretchedPreviewRgba.length).toBe(120 * 80 * 4)
  })

  it('exports Godot 4 NinePatchRect .tscn, Unity .uss snippet, and Web CSS border-image snippet', () => {
    const rgba = createTestUiPanelRgba(64, 48)
    const detected = detectNineSliceBorders(rgba, 64, 48)
    const manifest = buildNineSliceManifest('FantasyDialogBox', {
      ...detected,
      borders: { left: 12, right: 12, top: 10, bottom: 10 }
    })

    const godotTscn = exportGodotNinePatchTscn(manifest, {
      stretchMode: 'tile',
      targetWidth: 320,
      targetHeight: 120
    })
    expect(godotTscn).toContain('[node name="FantasyDialogBox" type="NinePatchRect"]')
    expect(godotTscn).toContain('patch_margin_left = 12')
    expect(godotTscn).toContain('axis_stretch_horizontal = 1')

    const unityUss = exportUnityNineSliceSnippet(manifest, { stretchMode: 'tile' })
    expect(unityUss).toContain('-unity-slice-left: 12;')
    expect(unityUss).toContain('-unity-slice-type: tiled;')
    expect(unityUss).toContain('Vector4(12f, 10f, 12f, 10f)')

    const webCss = exportWebCssNineSliceSnippet(manifest, { stretchMode: 'stretch' })
    expect(webCss).toContain('border-image-slice: 10 12 10 12 fill;')
    expect(webCss).toContain('border-image-repeat: stretch;')
  })

  it('executes raw_nine_slice mode with custom L/R/T/B borders', async () => {
    const updatedParams: Record<string, unknown> = {}
    const ctx: NodeExecuteContext = {
      hostId: 'test-host',
      node: {
        id: 'ui-node-1',
        typeId: 'game.pbrTile',
        title: 'CustomDialog',
        x: 0,
        y: 0,
        width: 240,
        height: 160,
        inputs: [],
        outputs: [],
        params: {
          gamePbrAssetMode: 'raw_nine_slice',
          gameNineSliceLeft: 14,
          gameNineSliceRight: 14,
          gameNineSliceTop: 12,
          gameNineSliceBottom: 12,
          gameNineSliceStretchMode: 'tile',
          gameUiSymmetricLock: true
        }
      },
      inputs: {},
      updateNodeParams: (_nodeId, patch) => {
        Object.assign(updatedParams, patch)
      }
    }

    const outputs = await executeGamePbrTileNode(ctx)
    expect(outputs['out-meta']?.kind).toBe('text')
    const meta = JSON.parse((outputs['out-meta'] as { kind: 'text'; text: string }).text)
    expect(meta.mode).toBe('raw_nine_slice')
    expect(meta.summary.borders).toEqual({ left: 14, right: 14, top: 12, bottom: 12 })
    expect(meta.summary.stretchMode).toBe('tile')
    expect(meta.summary.patchDimensions).toHaveLength(9)
    expect(meta.godotNinePatchTscn).toContain('patch_margin_left = 14')
    expect(meta.unityNineSliceSnippet).toContain('-unity-slice-left: 14;')
    expect(meta.webCssNineSliceSnippet).toContain('border-image-slice: 12 14 12 14 fill;')
  })
})
