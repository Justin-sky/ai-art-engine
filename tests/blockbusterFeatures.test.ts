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
  decomposeControlIntoStandardParts,
  readImageLayerSplitFromNode,
  recognizeUiControlType,
  UI_CONTROL_SPECS
} from '../src/shared/graph'
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
})
