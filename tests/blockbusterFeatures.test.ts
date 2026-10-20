import { describe, expect, it } from 'vitest'
import {
  chatPreviewKind,
  deliverableFormatBadge
} from '../src/renderer/src/features/media/chatPreviewKind'
import { collectRunMediaPaths } from '../src/shared/graph/collectRunMediaPaths'
import { isDeliverableMediaPath, isPsdMediaPath } from '../src/shared/outputScan'
import { resolveChatNextActions } from '../src/shared/chatNextActions'
import {
  buildZeroKeyLiveDemoGraph,
  CHAT_SHOWCASE_STARTERS
} from '../src/shared/chatShowcaseStarters'
import {
  buildGodotSceneTscn,
  buildInteractiveUiPrototypeHtml,
  buildUnityUguiEditorScriptCs,
  buildUnityUiToolkitUss,
  buildUnityUiToolkitUxml,
  classifyUiLayerRole
} from '../src/shared/graph/uiEngineExport'
import {
  buildCapCutDraftContent,
  buildCapCutDraftMetaInfo
} from '../src/shared/graph/timelineNleExport'
import {
  embedGraphInPngBytes,
  extractGraphFromPngBytes,
  slimGraphForPngEmbed
} from '../src/shared/graph/pngWorkflowCodec'
import {
  autoGroupLayersForGameUi,
  buildVlmUiControlDetectionPrompt,
  decomposeControlIntoStandardParts,
  decomposeRgbaBufferToUiLayers,
  estimateEditableTextMeta,
  matchOcrBoxesToControlRect,
  normalizeOcrDetectedText,
  parseVlmUiControlDetectionResponse,
  readImageLayerSplitFromNode,
  recognizeUiControlType,
  separateInteriorForegroundAndCleanPlate,
  UI_CONTROL_SPECS
} from '../src/shared/graph'
import {
  clusterOcrLineWordsIntoBoxes,
  parseTesseractTsvToOcrLines
} from '../src/main/services/localOcrService'
import { buildAgPsdLayerTextData } from '../src/renderer/src/features/graph/model/layerSplitPsd'

// 1x1 transparent PNG bytes for testing PNG chunk steganography
const MINIMAL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function base64ToUint8(b64: string): Uint8Array {
  const binary = Buffer.from(b64, 'base64')
  return new Uint8Array(binary.buffer, binary.byteOffset, binary.byteLength)
}

describe('Blockbuster 6 Pillars & Deliverable First-Class Architecture', () => {
  it('promotes PSD and engine/NLE deliverables to first-class preview & run media', () => {
    expect(chatPreviewKind('Cache/Images/仙侠装备界面UI_⑤.psd')).toBe('deliverable')
    expect(chatPreviewKind('Assets/UI/Panel.prefab')).toBe('deliverable')
    expect(chatPreviewKind('Assets/UI/Scene.tscn')).toBe('deliverable')
    expect(chatPreviewKind('Assets/Edit/timeline.fcpxml')).toBe('deliverable')
    expect(deliverableFormatBadge('Cache/Images/仙侠装备界面UI_⑤.psd').code).toBe('PSD')
    expect(deliverableFormatBadge('Assets/UI/Scene.tscn').code).toBe('GODOT')

    expect(isPsdMediaPath('Cache/Images/test.psd')).toBe(true)
    expect(isDeliverableMediaPath('Cache/Images/test.psd')).toBe(true)
    expect(isDeliverableMediaPath('Cache/Images/test.png')).toBe(false)

    const demoGraph = buildZeroKeyLiveDemoGraph('zh-CN')
    const paths = collectRunMediaPaths(demoGraph, {
      'demo-ui-layersplit': {
        status: 'done',
        outputs: {
          out: {
            kind: 'image',
            assetId: 'layerSplit:composite',
            relativePath: 'Cache/Images/ui_composite.png'
          },
          'out-psd': {
            kind: 'text',
            text: 'Cache/Images/ui_layered.psd'
          }
        }
      }
    })
    expect(paths).toContain('Cache/Images/ui_composite.png')
    expect(paths).toContain('Cache/Images/ui_layered.psd')
  })

  it('resolves context-aware Next-Action Pills for images, PSDs, and videos (Pillar 1)', () => {
    const uiImagePills = resolveChatNextActions('Cache/Images/仙侠装备界面UI_主界面.png')
    expect(uiImagePills.length).toBeGreaterThanOrEqual(3)
    expect(uiImagePills[0]?.id).toBe('split-to-psd')

    const psdPills = resolveChatNextActions('Cache/Images/仙侠装备界面UI.psd')
    expect(psdPills.some((p) => p.id === 'open-layer-workbench')).toBe(true)
    expect(psdPills.some((p) => p.id === 'open-psd-app')).toBe(true)

    const videoPills = resolveChatNextActions('Cache/Videos/shot01.mp4')
    expect(videoPills.some((p) => p.id === 'frame-pull-edit')).toBe(true)
  })

  it('builds 6 showcase starters and a zero-key 8-layer structural UI control demo graph (Pillar 2)', () => {
    expect(CHAT_SHOWCASE_STARTERS).toHaveLength(6)
    const demo = buildZeroKeyLiveDemoGraph('zh-CN')
    expect(demo.nodes.length).toBe(2)
    const splitNode = demo.nodes.find((n) => n.id === 'demo-ui-layersplit')
    expect(splitNode).toBeDefined()
    const splitState = readImageLayerSplitFromNode(splitNode!.params)
    expect(splitState.layers.length).toBe(8)
    expect((splitState.groups ?? []).length).toBeGreaterThanOrEqual(4)
    expect(
      splitState.layers.some(
        (l) => l.uiControlType === 'button' && l.uiPartRole === 'button-bg-pressed'
      )
    ).toBe(true)
    expect(
      splitState.layers.some(
        (l) => l.uiControlType === 'button' && l.uiPartRole === 'button-bg-normal'
      )
    ).toBe(true)
    expect(
      splitState.layers.some((l) => l.uiControlType === 'button' && l.uiPartRole === 'button-label')
    ).toBe(true)
  })

  it('recognizes all 16 standard HTML5 / Unity UI Toolkit controls, decomposes recursive sub-parts, and builds Photoshop TySh editable text layers', () => {
    expect(Object.keys(UI_CONTROL_SPECS)).toEqual(
      expect.arrayContaining([
        'button',
        'slider',
        'progress-bar',
        'item-slot',
        'list-view',
        'tab-bar',
        'dropdown',
        'radio-button',
        'toggle',
        'text-field',
        'scroller',
        'foldout',
        'radial-progress',
        'hud-bar',
        'panel',
        'icon-badge'
      ])
    )

    expect(
      recognizeUiControlType({
        nameHint: '祭炼升阶按钮',
        left: 780,
        top: 880,
        width: 360,
        height: 112,
        canvasWidth: 1920,
        canvasHeight: 1080
      })
    ).toBe('button')

    expect(
      recognizeUiControlType({
        nameHint: '灵力滑动条 Slider',
        left: 600,
        top: 780,
        width: 420,
        height: 36,
        canvasWidth: 1920,
        canvasHeight: 1080
      })
    ).toBe('slider')

    expect(
      recognizeUiControlType({
        nameHint: '法宝背包列表 ListView',
        left: 1180,
        top: 220,
        width: 580,
        height: 640,
        canvasWidth: 1920,
        canvasHeight: 1080
      })
    ).toBe('list-view')

    expect(
      recognizeUiControlType({
        nameHint: '神兵格子 ItemSlot +9',
        left: 200,
        top: 300,
        width: 96,
        height: 96,
        canvasWidth: 1920,
        canvasHeight: 1080
      })
    ).toBe('item-slot')

    expect(
      recognizeUiControlType({
        nameHint: '品质筛选下拉框 Dropdown',
        left: 300,
        top: 160,
        width: 240,
        height: 44,
        canvasWidth: 1920,
        canvasHeight: 1080
      })
    ).toBe('dropdown')

    expect(
      recognizeUiControlType({
        nameHint: '技能冷却环形进度 RadialProgress',
        left: 1500,
        top: 820,
        width: 110,
        height: 110,
        canvasWidth: 1920,
        canvasHeight: 1080
      })
    ).toBe('radial-progress')

    // Synthesize a 120x44 button RGBA buffer with a gold border, bronze fill, and bright center text
    const btnW = 120
    const btnH = 44
    const btnRgba = new Uint8ClampedArray(btnW * btnH * 4)
    for (let y = 0; y < btnH; y++) {
      for (let x = 0; x < btnW; x++) {
        const i = (y * btnW + x) * 4
        const isBorder = x < 3 || x >= btnW - 3 || y < 3 || y >= btnH - 3
        const isTextGlyph =
          y >= 14 && y <= 29 && x >= 34 && x <= 86 && ((x + y) % 3 === 0 || x % 7 === 0)
        if (isBorder) {
          btnRgba[i] = 215
          btnRgba[i + 1] = 172
          btnRgba[i + 2] = 78
          btnRgba[i + 3] = 255
        } else if (isTextGlyph) {
          btnRgba[i] = 255
          btnRgba[i + 1] = 250
          btnRgba[i + 2] = 235
          btnRgba[i + 3] = 255
        } else {
          btnRgba[i] = 92
          btnRgba[i + 1] = 56
          btnRgba[i + 2] = 24
          btnRgba[i + 3] = 255
        }
      }
    }

    const parts = decomposeControlIntoStandardParts({
      controlId: 'ctrl-btn-upgrade',
      nameHint: '祭炼升阶按钮',
      rgba: btnRgba,
      left: 400,
      top: 500,
      width: btnW,
      height: btnH,
      canvasWidth: 1920,
      canvasHeight: 1080
    })

    const roles = parts.map((p) => p.uiPartRole)
    expect(roles).toContain('button-bg-pressed')
    expect(roles).toContain('button-bg-hover')
    expect(roles).toContain('button-bg-normal')
    expect(roles).toContain('button-label')

    const pressedPart = parts.find((p) => p.uiPartRole === 'button-bg-pressed')!
    const hoverPart = parts.find((p) => p.uiPartRole === 'button-bg-hover')!
    const normalPart = parts.find((p) => p.uiPartRole === 'button-bg-normal')!
    const labelPart = parts.find((p) => p.uiPartRole === 'button-label')!
    expect(pressedPart.visible).toBe(false)
    expect(hoverPart.visible).toBe(false)
    expect(normalPart.visible).toBe(true)

    // Verify native Photoshop TySh editableText metadata on labelPart
    expect(labelPart.editableText).toBeDefined()
    expect(labelPart.editableText?.text).toBe('祭炼升阶')
    const psdTextData = buildAgPsdLayerTextData(
      labelPart.editableText!,
      labelPart.left,
      labelPart.top,
      labelPart.width,
      labelPart.height
    )
    expect(psdTextData.text).toBe('祭炼升阶')
    expect(psdTextData.style?.fontSize).toBeGreaterThanOrEqual(10)

    // Test ItemSlot 5-layer structural decomposition
    const slotSize = 80
    const slotRgba = new Uint8ClampedArray(slotSize * slotSize * 4)
    for (let y = 0; y < slotSize; y++) {
      for (let x = 0; x < slotSize; x++) {
        const i = (y * slotSize + x) * 4
        const isFrame = x < 6 || x >= slotSize - 6 || y < 6 || y >= slotSize - 6
        const isCenterIcon = x >= 20 && x <= 60 && y >= 20 && y <= 60
        if (isFrame) {
          slotRgba[i] = 240
          slotRgba[i + 1] = 190
          slotRgba[i + 2] = 60
          slotRgba[i + 3] = 255
        } else if (isCenterIcon) {
          slotRgba[i] = 90
          slotRgba[i + 1] = 210
          slotRgba[i + 2] = 255
          slotRgba[i + 3] = 255
        } else {
          slotRgba[i] = 30
          slotRgba[i + 1] = 35
          slotRgba[i + 2] = 48
          slotRgba[i + 3] = 255
        }
      }
    }
    const slotParts = decomposeControlIntoStandardParts({
      controlId: 'ctrl-slot-1',
      nameHint: '装备格 ItemSlot',
      controlType: 'item-slot',
      rgba: slotRgba,
      left: 100,
      top: 100,
      width: slotSize,
      height: slotSize,
      canvasWidth: 1920,
      canvasHeight: 1080
    })
    const slotRoles = slotParts.map((p) => p.uiPartRole)
    expect(slotRoles).toContain('slot-bg')
    expect(slotRoles).toContain('slot-rarity-frame')
    expect(slotRoles).toContain('slot-item-icon')

    // Verify 2-level nested PSD folders via autoGroupLayersForGameUi
    const grouped = autoGroupLayersForGameUi({
      version: 1,
      sourceAssetId: 'src',
      documentWidth: 1920,
      documentHeight: 1080,
      selectedLayerId: null,
      layers: [
        {
          id: 'base',
          name: '底层背景 (清理补全)',
          assetId: 'a0',
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          zIndex: 0,
          visible: true,
          locked: false,
          opacity: 1
        },
        ...parts.map((p, idx) => ({
          id: `part-${idx}`,
          name: p.name,
          assetId: `asset-${idx}`,
          x: p.left,
          y: p.top,
          width: p.width,
          height: p.height,
          zIndex: idx + 1,
          visible: p.visible,
          locked: false,
          opacity: 1,
          uiControlId: 'ctrl-btn-upgrade',
          uiControlName: '祭炼升阶按钮',
          uiControlType: p.uiControlType,
          uiPartRole: p.uiPartRole
        }))
      ]
    })

    const controlFolder = (grouped.groups ?? []).find(
      (g) => g.id === 'group:ui-ctrl:ctrl-btn-upgrade'
    )
    expect(controlFolder).toBeDefined()
    expect(controlFolder?.parentGroupId).toBe('group:ui-auto:controls')
    expect(controlFolder?.name).toContain('Button')
  })

  it('exports Godot 4 .tscn, Unity UGUI C#, Unity UI Toolkit (.uxml/.uss), Interactive HTML5 Prototype, and JianyingPro draft (Pillar 5)', () => {
    const demo = buildZeroKeyLiveDemoGraph('zh-CN')
    const splitNode = demo.nodes.find((n) => n.id === 'demo-ui-layersplit')!
    const splitState = readImageLayerSplitFromNode(splitNode.params)

    const buttonLayer = splitState.layers.find((l) => l.uiPartRole === 'button-bg-normal')!
    expect(classifyUiLayerRole(splitState, buttonLayer)).toBe('button')

    const tscn = buildGodotSceneTscn({
      state: splitState,
      layerFileNames: {},
      sceneName: 'XianxiaEquipmentUI'
    })
    expect(tscn).toContain('[gd_scene load_steps=')
    expect(tscn).toContain('XianxiaEquipmentUI')
    expect(tscn).toContain('TextureButton')
    expect(tscn).toContain('texture_pressed')

    const uxml = buildUnityUiToolkitUxml({
      state: splitState,
      layerFileNames: {},
      screenName: 'XianxiaEquipmentUI'
    })
    expect(uxml).toContain('<ui:UXML')
    expect(uxml).toContain('<ui:Button')

    const uss = buildUnityUiToolkitUss({
      state: splitState,
      layerFileNames: {}
    })
    expect(uss).toContain(':active')
    expect(uss).toContain('-unity-slice-left')

    const unityCs = buildUnityUguiEditorScriptCs()
    expect(unityCs).toContain('public static class AiArtUiPrefabBuilder')
    expect(unityCs).toContain(
      'MenuItem("Tools/AI Art Engine/Build UI Canvas From Manifest JSON...")'
    )

    const html = buildInteractiveUiPrototypeHtml({
      state: splitState,
      layerUrls: {},
      title: '仙侠装备界面原型'
    })
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('3D')
    expect(html).toContain('button')
    expect(html).toContain('pressedUrl')

    const timelineDoc = {
      clips: [
        {
          id: 'clip-1',
          track: 'video' as const,
          title: 'Shot 1',
          startSec: 0,
          durationSec: 3.5,
          relativePath: 'Assets/Videos/shot1.mp4'
        }
      ],
      hiddenTracks: [],
      mutedTracks: [],
      settings: { durationSec: 3.5, exportWidth: 1920, exportHeight: 1080, exportFps: 30 }
    }
    const draftContent = JSON.parse(buildCapCutDraftContent(timelineDoc, { projectName: 'Demo' }))
    const draftMeta = JSON.parse(buildCapCutDraftMetaInfo(timelineDoc, { projectName: 'Demo' }))
    expect(draftContent.tracks.length).toBeGreaterThan(0)
    expect(draftMeta.draft_name).toBe('Demo')
    expect(draftMeta.tm_duration).toBe(3500000)
  })

  it('embeds and extracts a GraphDocument inside PNG tEXt(aiae:graph) chunk (Pillar 6)', () => {
    const demo = buildZeroKeyLiveDemoGraph('zh-CN')
    const slimmed = slimGraphForPngEmbed(demo)
    // Verify slimming strips inline data: URLs while preserving nodes and edges
    expect(slimmed.nodes.length).toBe(2)
    expect(slimmed.edges.length).toBe(1)

    const rawPng = base64ToUint8(MINIMAL_PNG_BASE64)
    expect(extractGraphFromPngBytes(rawPng)).toBeNull()

    const embeddedPng = embedGraphInPngBytes(rawPng, demo)
    expect(embeddedPng.byteLength).toBeGreaterThan(rawPng.byteLength)

    const restored = extractGraphFromPngBytes(embeddedPng)
    expect(restored).not.toBeNull()
    expect(restored?.nodes.length).toBe(2)
    expect(restored?.edges.length).toBe(1)
    expect(restored?.nodes[0]?.title).toBe(demo.nodes[0]?.title)
  })

  it('parses VLM multimodal UI control detections + OCR text and suppresses AI base hallucinations via ROI mask feathering', () => {
    // 1. VLM prompt & response parser (0..1000 box_2d + controlType + real OCR text)
    const vlmPrompt = buildVlmUiControlDetectionPrompt({
      locale: 'zh-CN',
      userHint: '仙侠突破界面',
      sourceTitle: 'BreakthroughUI'
    })
    expect(vlmPrompt.system).toContain('box_2d')
    expect(vlmPrompt.prompt).toContain('ocrText')

    const vlmJson = `\`\`\`json
[
  {
    "name": "主操作按钮",
    "controlType": "button",
    "ocrText": "立即突破 · 消耗999灵石",
    "description": "底部金色主按钮",
    "box_2d": [750, 250, 900, 750]
  },
  {
    "name": "顶部灵石栏",
    "controlType": "hud-bar",
    "ocrText": "99,999",
    "box_2d": [40, 600, 120, 920]
  }
]
\`\`\``
    const hints = parseVlmUiControlDetectionResponse(vlmJson, 200, 120)
    expect(hints).toHaveLength(2)
    expect(hints[0]).toMatchObject({
      name: '主操作按钮',
      controlType: 'button',
      ocrText: '立即突破 · 消耗999灵石',
      left: 50,
      top: 90,
      width: 100,
      height: 18
    })

    // 2. Synthesize a 200x120 UI canvas with a textured background and a button at [50..150, 90..108]
    const W = 200
    const H = 120
    const sourceRgba = new Uint8ClampedArray(W * H * 4)
    const cleanBaseRgba = new Uint8ClampedArray(W * H * 4)

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4
        const bgR = 24 + ((x + y) % 5)
        const bgG = 32 + ((x * 2 + y) % 7)
        const bgB = 48 + ((x + y * 3) % 5)

        // Source has button at [50..149, 90..107]
        const inBtn = x >= 50 && x < 150 && y >= 90 && y < 108
        if (inBtn) {
          const isGlyph = y >= 95 && y <= 102 && x >= 70 && x <= 130 && (x + y) % 2 === 0
          sourceRgba[idx] = isGlyph ? 255 : 210
          sourceRgba[idx + 1] = isGlyph ? 250 : 155
          sourceRgba[idx + 2] = isGlyph ? 235 : 55
          sourceRgba[idx + 3] = 255
        } else {
          sourceRgba[idx] = bgR
          sourceRgba[idx + 1] = bgG
          sourceRgba[idx + 2] = bgB
          sourceRgba[idx + 3] = 255
        }

        // Simulate AI cleanBaseRgba with:
        // (a) +10 global exposure shift across the entire image
        // (b) a hallucinated bright artifact at top-left (x=20..30, y=15..25) outside any UI control
        const isHallucinatedSpot = x >= 20 && x <= 30 && y >= 15 && y <= 25 && !inBtn
        cleanBaseRgba[idx] = isHallucinatedSpot ? 180 : bgR + 10
        cleanBaseRgba[idx + 1] = isHallucinatedSpot ? 40 : bgG + 10
        cleanBaseRgba[idx + 2] = isHallucinatedSpot ? 180 : bgB + 10
        cleanBaseRgba[idx + 3] = 255
      }
    }

    const decomposed = decomposeRgbaBufferToUiLayers({
      width: W,
      height: H,
      sourceRgba,
      cleanBaseRgba,
      apiLayerHints: [hints[0]!]
    })

    // Verify ROI Mask-Guided Hallucination Suppression:
    // At (x=25, y=20) — where cleanBaseRgba had a purple hallucination (180, 40, 180) —
    // decomposed.baseRgba must preserve 100% of the original sourceRgba background pixel!
    const spotIdx = (20 * W + 25) * 4
    expect(decomposed.baseRgba[spotIdx]).toBe(sourceRgba[spotIdx])
    expect(decomposed.baseRgba[spotIdx + 1]).toBe(sourceRgba[spotIdx + 1])
    expect(decomposed.baseRgba[spotIdx + 2]).toBe(sourceRgba[spotIdx + 2])

    // Verify VLM OCR text ("立即突破 · 消耗999灵石") propagated into the button label's native Photoshop TySh editableText
    const labelLayer = decomposed.layers.find((l) => l.uiPartRole === 'button-label')
    expect(labelLayer).toBeDefined()
    expect(labelLayer?.editableText?.text).toBe('立即突破 · 消耗999灵石')
  })

  it('reconstructs 2D vertical gradients + texture without horizontal streaks in separateInteriorForegroundAndCleanPlate', () => {
    const W = 80
    const H = 36
    const rgba = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4
        // Vertical gradient from top (r=160) to bottom (r=60) + subtle 2D texture
        const gradR = Math.round(160 - (y / (H - 1)) * 100) + ((x + y) % 2 === 0 ? 2 : -2)
        const gradG = Math.round(110 - (y / (H - 1)) * 60)
        const gradB = 40
        const isCenterGlyph = x >= 28 && x <= 52 && y >= 12 && y <= 24 && (x + y) % 2 === 0
        if (isCenterGlyph) {
          rgba[idx] = 255
          rgba[idx + 1] = 255
          rgba[idx + 2] = 250
          rgba[idx + 3] = 255
        } else {
          rgba[idx] = gradR
          rgba[idx + 1] = gradG
          rgba[idx + 2] = gradB
          rgba[idx + 3] = 255
        }
      }
    }

    const { cleanPlateRgba, hasForeground } = separateInteriorForegroundAndCleanPlate({
      rgba,
      width: W,
      height: H,
      insetRatioX: 0.1,
      insetRatioY: 0.14,
      contrastThreshold: 28
    })
    expect(hasForeground).toBe(true)

    // Check that the inpainted glyph pixel at (x=40, y=18) closely matches the vertical gradient at y=18 (~109)
    // and is NOT left as bright white (255)
    const centerIdx = (18 * W + 40) * 4
    expect(cleanPlateRgba[centerIdx]).toBeGreaterThan(85)
    expect(cleanPlateRgba[centerIdx]).toBeLessThan(135)
  })

  it('extracts stroke outline + glyph count in offline text analyzer, unmixes frosted-glass alpha, and de-clumps adjacent touching controls', () => {
    // 1. Offline glyph projection segmentation + core fill vs. outer stroke separation
    const tw = 90
    const th = 28
    const fgRgba = new Uint8ClampedArray(tw * th * 4)
    // Draw 3 distinct character blocks at x=[12..24], [36..48], [60..72], y=[6..21]
    // with dark brown 1px outer stroke (40, 20, 10) and bright gold core fill (250, 230, 140)
    const charRanges = [
      [12, 24],
      [36, 48],
      [60, 72]
    ] as const
    for (const [x0, x1] of charRanges) {
      for (let y = 6; y <= 21; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = (y * tw + x) * 4
          const isOutline = x === x0 || x === x1 || y === 6 || y === 21
          fgRgba[i] = isOutline ? 40 : 250
          fgRgba[i + 1] = isOutline ? 20 : 230
          fgRgba[i + 2] = isOutline ? 10 : 140
          fgRgba[i + 3] = 255
        }
      }
    }

    const textMeta = estimateEditableTextMeta({
      foregroundRgba: fgRgba,
      width: tw,
      height: th,
      rawName: '炼丹炉按钮'
    })
    expect(textMeta.glyphCount).toBe(3)
    expect(textMeta.color[0]).toBeGreaterThan(210)
    expect(textMeta.strokeColor).toBeDefined()
    expect(textMeta.strokeColor![0]).toBeLessThan(90)

    const psdText = buildAgPsdLayerTextData(textMeta, 10, 10, tw, th)
    expect(psdText?.style?.strokeFlag).toBe(true)
    expect(psdText?.style?.strokeColor).toBeDefined()

    // 2. Watershed Projection Valley De-Clumping:
    // 3 adjacent slots separated by 1px gap (x=[10..29], [31..50], [52..71], y=[20..45]) on a 100x70 canvas
    const cw = 100
    const ch = 70
    const src = new Uint8ClampedArray(cw * ch * 4)
    const base = new Uint8ClampedArray(cw * ch * 4)
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const i = (y * cw + x) * 4
        base[i] = 20
        base[i + 1] = 24
        base[i + 2] = 32
        base[i + 3] = 255

        const inSlot1 = x >= 10 && x <= 29 && y >= 20 && y <= 45
        const inSlot2 = x >= 31 && x <= 50 && y >= 20 && y <= 45
        const inSlot3 = x >= 52 && x <= 71 && y >= 20 && y <= 45
        if (inSlot1 || inSlot2 || inSlot3) {
          src[i] = 210
          src[i + 1] = 165
          src[i + 2] = 65
          src[i + 3] = 255
        } else {
          src[i] = 20
          src[i + 1] = 24
          src[i + 2] = 32
          src[i + 3] = 255
        }
      }
    }

    const splitResult = decomposeRgbaBufferToUiLayers({
      width: cw,
      height: ch,
      sourceRgba: src,
      cleanBaseRgba: base,
      decomposeControlParts: false
    })
    // Instead of clumping all 3 adjacent slots into 1 giant wide bar, projection valley de-clumping splits them into 3 distinct controls!
    expect(splitResult.layers.length).toBe(3)
  })

  it('clusters native local OCR words into phrase boxes, normalizes CJK spaces, and matches OCR boxes to UI controls with child exclusion', () => {
    expect(normalizeOcrDetectedText('立 即 突 破 + 99')).toBe('立即突破+99')
    expect(normalizeOcrDetectedText('99 , 999 灵 石')).toBe('99,999灵石')
    expect(normalizeOcrDetectedText('Start Game')).toBe('Start Game')

    // Two buttons on the same horizontal row: left button "取 消" at x=20..80, right button "确 认 升 阶" at x=220..320
    const clustered = clusterOcrLineWordsIntoBoxes([
      {
        text: '取 消 确 认 升 阶',
        words: [
          { text: '取', left: 20, top: 100, width: 24, height: 24 },
          { text: '消', left: 50, top: 100, width: 24, height: 24 },
          { text: '确', left: 220, top: 100, width: 22, height: 24 },
          { text: '认', left: 245, top: 100, width: 22, height: 24 },
          { text: '升', left: 270, top: 100, width: 22, height: 24 },
          { text: '阶', left: 295, top: 100, width: 22, height: 24 }
        ]
      }
    ])
    expect(clustered).toHaveLength(2)
    expect(clustered[0]?.text).toBe('取消')
    expect(clustered[1]?.text).toBe('确认升阶')

    // Parent panel at [10, 10, 340, 160] containing panel title at top [120, 20, 100, 26] and child button at [210, 92, 120, 40]
    const ocrBoxes = [
      { text: '法宝祭炼弹窗', left: 120, top: 20, width: 100, height: 26 },
      ...clustered
    ]
    const childBtnRect = { left: 210, top: 92, width: 120, height: 40 }
    const leftBtnRect = { left: 12, top: 92, width: 80, height: 40 }
    const parentPanelRect = { left: 10, top: 10, width: 340, height: 160 }

    expect(matchOcrBoxesToControlRect(ocrBoxes, parentPanelRect, [leftBtnRect, childBtnRect])).toBe(
      '法宝祭炼弹窗'
    )
    expect(matchOcrBoxesToControlRect(ocrBoxes, childBtnRect)).toBe('确认升阶')
    expect(matchOcrBoxesToControlRect(ocrBoxes, leftBtnRect)).toBe('取消')

    // Verify 100% offline decomposeRgbaBufferToUiLayers injects ocrBoxes into button-label editableText
    const W = 200
    const H = 120
    const sourceRgba = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4
        const inBtn = x >= 60 && x < 140 && y >= 80 && y < 100
        if (inBtn) {
          const isGlyph = x >= 74 && x <= 126 && y >= 86 && y <= 94 && (x + y) % 2 === 0
          sourceRgba[idx] = isGlyph ? 255 : 205
          sourceRgba[idx + 1] = isGlyph ? 250 : 145
          sourceRgba[idx + 2] = isGlyph ? 225 : 45
          sourceRgba[idx + 3] = 255
        } else {
          sourceRgba[idx] = 22
          sourceRgba[idx + 1] = 26
          sourceRgba[idx + 2] = 36
          sourceRgba[idx + 3] = 255
        }
      }
    }

    const offlineDecomposed = decomposeRgbaBufferToUiLayers({
      width: W,
      height: H,
      sourceRgba,
      ocrBoxes: [{ text: '渡劫飞升', left: 72, top: 84, width: 56, height: 12 }]
    })
    const btnLabel = offlineDecomposed.layers.find((l) => l.uiPartRole === 'button-label')
    expect(btnLabel).toBeDefined()
    expect(btnLabel?.editableText?.text).toBe('渡劫飞升')

    // Verify Linux/cross-platform Tesseract TSV parser + word clustering
    const sampleTsv = [
      'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
      '5\t1\t1\t1\t1\t1\t65\t84\t26\t14\t96.2\t立即',
      '5\t1\t1\t1\t1\t2\t94\t84\t26\t14\t95.8\t锻造'
    ].join('\n')
    const tsvBoxes = clusterOcrLineWordsIntoBoxes(parseTesseractTsvToOcrLines(sampleTsv))
    expect(tsvBoxes).toHaveLength(1)
    expect(tsvBoxes[0]?.text).toBe('立即锻造')
  })
})
