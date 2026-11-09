import { describe, expect, it } from 'vitest'
import { readPsd } from 'ag-psd'
import {
  createNodeFromType,
  ensureBuiltinNodeTypes,
  executeUiAtlasComposeNode,
  extractAtlasCandidatesFromRgba,
  getNodeType,
  isLayerSplitEditorNode,
  parseAiAtlasLayoutPlan
} from '../src/shared/graph'
import { createImage, type RgbaImage } from '../src/shared/graph/uiPreciseSplit'
import { layerSplitToPsdUint8Array } from '../src/renderer/src/features/graph/model/layerSplitPsd'

ensureBuiltinNodeTypes()

function buildSyntheticAtlasRgba(): RgbaImage {
  // 256x128 transparent sprite sheet with 2 distinct UI elements:
  // 1) Left: 96x80 gold-bordered panel frame (x: 12..108, y: 16..96)
  // 2) Right: 80x40 blue action button (x: 140..220, y: 36..76)
  const img = createImage(256, 128)
  for (let y = 16; y < 96; y++) {
    for (let x = 12; x < 108; x++) {
      const idx = (y * 256 + x) * 4
      const border = x < 18 || x >= 102 || y < 22 || y >= 90
      img.data[idx] = border ? 230 : 38
      img.data[idx + 1] = border ? 185 : 44
      img.data[idx + 2] = border ? 85 : 64
      img.data[idx + 3] = 255
    }
  }
  for (let y = 36; y < 76; y++) {
    for (let x = 140; x < 220; x++) {
      const idx = (y * 256 + x) * 4
      const border = x < 144 || x >= 216 || y < 40 || y >= 72
      img.data[idx] = border ? 120 : 45
      img.data[idx + 1] = border ? 200 : 115
      img.data[idx + 2] = border ? 255 : 210
      img.data[idx + 3] = 255
    }
  }
  return img
}

describe('ui.atlasCompose (图集拼装 UI -> 类 PS 分层工作台 & PSD 导出)', () => {
  it('registers ui.atlasCompose node and enables PS-like layerSplit dive editor on double-click', () => {
    const def = getNodeType('ui.atlasCompose')
    expect(def).toBeDefined()
    expect(def?.inspectorId).toBe('studio.graph.layerSplit')
    expect(isLayerSplitEditorNode({ typeId: 'ui.atlasCompose' })).toBe(true)
    expect(def?.ports.map((p) => p.id)).toEqual(
      expect.arrayContaining(['in-components', 'in', 'in-images', 'in-text', 'out', 'out-all'])
    )
  })

  it('automatically slices a multi-element Sprite Atlas RGBA into independent UI components', () => {
    const atlas = buildSyntheticAtlasRgba()
    const candidates = extractAtlasCandidatesFromRgba(atlas, 'XianxiaAtlas', 1)
    expect(candidates.length).toBe(2)
    expect(candidates[0]!.rgba.width).toBe(96)
    expect(candidates[0]!.rgba.height).toBe(80)
    expect(candidates[1]!.rgba.width).toBe(80)
    expect(candidates[1]!.rgba.height).toBe(40)
  })

  it('executes ui.atlasCompose to assemble layered UI state and exports a valid multi-layer PSD with Smart Objects and Editable Text', async () => {
    const atlas = buildSyntheticAtlasRgba()
    const encodedMap = new Map<string, RgbaImage>()
    let seq = 0

    const node = {
      id: 'node_atlas_1',
      typeId: 'ui.atlasCompose',
      title: '背包图集拼装',
      position: { x: 0, y: 0 },
      size: { width: 220, height: 160 },
      params: {
        generateInstruction: '组装《仙侠背包界面》，包含主面板底框、道具格与强化按钮'
      }
    }

    const atlasUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    encodedMap.set(atlasUrl, atlas)

    const outputs = await executeUiAtlasComposeNode({
      node: node as never,
      inputs: {
        in: [{ kind: 'image', dataUrl: atlasUrl }]
      },
      locale: 'zh-CN',
      uiRgbaCodec: {
        decodeImageRgba: async (src: string) => {
          return encodedMap.get(src) ?? atlas
        },
        encodeRgbaPng: async (img: RgbaImage) => {
          const fakeUrl = `data:image/png;base64,SYNTH_${++seq}_${img.width}x${img.height}`
          encodedMap.set(fakeUrl, img)
          return fakeUrl
        }
      },
      composeImageLayerStack: async ({ state, layerUrls }) => {
        const psdBytes = await layerSplitToPsdUint8Array({
          state,
          layerUrls,
          decodeRgba: async (src, tw, th) => {
            const found = encodedMap.get(src)
            const w = tw ?? found?.width ?? 64
            const h = th ?? found?.height ?? 64
            return {
              width: w,
              height: h,
              data: new Uint8ClampedArray(w * h * 4)
            }
          }
        })
        const b64 = Buffer.from(psdBytes).toString('base64')
        return {
          dataUrl: 'data:image/png;base64,COMPOSITE_PREVIEW',
          psdDataUrl: `data:image/vnd.adobe.photoshop;base64,${b64}`
        }
      },
      saveRunMedia: async ({ key, dataUrl }) => {
        if (dataUrl.startsWith('data:image/vnd.adobe.photoshop')) {
          return `Cache/Images/${key}.psd`
        }
        return `Cache/Images/${key}.png`
      }
    } as never)

    expect(outputs['out-psd']).toBeDefined()
    expect((outputs['out-psd'] as { text: string }).text).toMatch(/\.psd$/)

    const state = node.params as unknown as {
      imageLayerSplit: import('../src/shared/graph').ImageLayerSplitState
      layerSplitPsdRelativePath?: string
    }
    expect(state.layerSplitPsdRelativePath).toMatch(/\.psd$/)
    expect(state.imageLayerSplit.layers.length).toBeGreaterThan(4)
    expect(state.imageLayerSplit.componentLibrary?.length).toBe(2)

    // Verify exported PSD structure via ag-psd readPsd
    const layerUrls: Record<string, string> = {}
    for (const l of state.imageLayerSplit.layers) {
      layerUrls[l.imageId] = `data:image/png;base64,SYNTH_LAYER_${l.width}x${l.height}`
    }
    for (const comp of state.imageLayerSplit.componentLibrary ?? []) {
      if (comp.imageId) {
        layerUrls[comp.imageId] =
          `data:image/png;base64,SYNTH_COMP_${comp.canonicalWidth}x${comp.canonicalHeight}`
      }
    }
    const psdBytes = await layerSplitToPsdUint8Array({
      state: state.imageLayerSplit,
      layerUrls,
      decodeRgba: async (_src, tw, th) => ({
        width: tw || 64,
        height: th || 64,
        data: new Uint8ClampedArray((tw || 64) * (th || 64) * 4)
      })
    })
    const parsedPsd = readPsd(psdBytes, { skipLayerImageData: true, skipCompositeImageData: true })
    expect(parsedPsd.width).toBe(1920)
    expect(parsedPsd.height).toBe(1080)
    expect(parsedPsd.children?.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(parsedPsd.linkedFiles?.length ?? 0).toBeGreaterThanOrEqual(1)
  })

  it('parses AI layout JSON plan and clamps coordinates safely', () => {
    const plan = parseAiAtlasLayoutPlan(
      JSON.stringify({
        canvasWidth: 1920,
        canvasHeight: 1080,
        placements: [
          {
            name: '主面板',
            componentId: 'comp_panel',
            left: 100,
            top: 80,
            width: 1720,
            height: 920,
            zIndex: 1
          },
          {
            name: '标题',
            left: 760,
            top: 100,
            width: 400,
            height: 50,
            zIndex: 10,
            editableText: { text: '仙侠背包', fontSize: 32 }
          }
        ]
      }),
      new Set(['comp_panel'])
    )
    expect(plan).not.toBeNull()
    expect(plan?.placements).toHaveLength(2)
    expect(plan?.placements[0]?.componentId).toBe('comp_panel')
    expect(plan?.placements[1]?.editableText?.text).toBe('仙侠背包')
  })

  it('builds distinct UI suite graph plans for ai_generate vs atlas_compose mode', async () => {
    const { buildUiSuiteGraphPlanFromPrompt } =
      await import('../src/shared/gameAssets/oneSentenceGameSpec')
    const aiPlan = buildUiSuiteGraphPlanFromPrompt('背包界面', { uiMode: 'ai_generate' })
    expect(aiPlan.uiMode).toBe('ai_generate')
    expect(aiPlan.plan.nodes.map((n) => n.typeId)).toEqual([
      'note.text',
      'asset.gameSystem',
      'ui.split',
      'ui.gen',
      'image.layerSplit'
    ])

    const atlasPlan = buildUiSuiteGraphPlanFromPrompt('背包界面', { uiMode: 'atlas_compose' })
    expect(atlasPlan.uiMode).toBe('atlas_compose')
    expect(atlasPlan.plan.nodes.map((n) => n.typeId)).toEqual([
      'note.text',
      'asset.gameSystem',
      'ui.componentLib',
      'ui.atlasCompose'
    ])
    expect(atlasPlan.plan.edges).toEqual([
      {
        from: 'ui_game_system',
        to: 'ui_suite_atlas_compose',
        fromPort: 'out',
        toPort: 'in-text'
      },
      {
        from: 'ui_suite_component_lib',
        to: 'ui_suite_atlas_compose',
        fromPort: 'out',
        toPort: 'in-components'
      }
    ])
  })

  it('executes ui.atlasCompose with only in-text connected (synthesizing procedural 9-slice UI kit without throwing GRAPH_PROCESS_NO_INPUT)', async () => {
    const node = createNodeFromType('ui.atlasCompose', { x: 0, y: 0 })
    const backpackPrompt =
      '横屏手游背包主界面全屏窗口。顶部信息条：左侧返回按钮与标题「背包」，右侧为玩家资源区。信息条下方为容量行：左端文本「1832 / 2000」，中部为容量进度条，右端并排两个按钮「整理」「筛选」。主体区左侧为竖向导航栏，自上而下五个页签按钮：道具、碎片、装备、晶石、舰炮，当前选中「道具」。右侧为道具网格区，六列多行的方形道具格。窗口底部为一条操作条，左侧并排「自动升品」「多选」按钮。'

    const outputs = await executeUiAtlasComposeNode({
      node,
      inputs: {
        'in-components': [],
        in: [],
        'in-images': [],
        'in-text': [{ kind: 'text', text: backpackPrompt }]
      },
      locale: 'zh-CN',
      onNodePatch: (_id, patch) => {
        if (patch.params) {
          node.params = { ...node.params, ...patch.params }
        }
      },
      uiRgbaCodec: {
        decodeImageRgba: async () => createImage(64, 64),
        encodeRgbaPng: async (img) => `data:image/png;base64,PROC_${img.width}x${img.height}`
      },
      composeImageLayerStack: async ({ state }) => {
        const layerUrls: Record<string, string> = {}
        for (const l of state.layers) {
          layerUrls[l.imageId] = `data:image/png;base64,LAYER_${l.width}x${l.height}`
        }
        const psdBytes = await layerSplitToPsdUint8Array({
          state,
          layerUrls,
          decodeRgba: async (_src, tw, th) => ({
            width: tw || 64,
            height: th || 64,
            data: new Uint8ClampedArray((tw || 64) * (th || 64) * 4)
          })
        })
        return {
          dataUrl: 'data:image/png;base64,COMPOSITE_PREVIEW',
          psdDataUrl: `data:image/vnd.adobe.photoshop;base64,${Buffer.from(psdBytes).toString('base64')}`
        }
      },
      saveRunMedia: async ({ key, dataUrl }) =>
        dataUrl.startsWith('data:image/vnd.adobe.photoshop')
          ? `Cache/Images/${key}.psd`
          : `Cache/Images/${key}.png`
    } as never)

    expect(outputs['out-psd']).toBeDefined()
    const state = (
      node.params as unknown as {
        imageLayerSplit: import('../src/shared/graph').ImageLayerSplitState
      }
    ).imageLayerSplit
    expect(state.componentLibrary?.length).toBeGreaterThanOrEqual(8)
    const layerNames = state.layers.map((l) => l.name)
    expect(layerNames.some((n) => n.includes('背包'))).toBe(true)
    expect(layerNames.some((n) => n.includes('1832 / 2000'))).toBe(true)
    expect(layerNames.some((n) => n.includes('舰炮'))).toBe(true)
  })

  it('builds ui.split inner graph with ui.componentLib + ui.atlasCompose when composeMode is atlas_compose', async () => {
    const { buildUiSplitInnerGraph } = await import('../src/shared/graph/uiSplitParse')
    const doc = buildUiSplitInnerGraph(
      [{ id: 's1', title: '背包', prompt: '横屏背包主界面', aspectRatio: '16:9' }],
      'zh-CN',
      { composeMode: 'atlas_compose' }
    )
    expect(doc.nodes.some((n) => n.typeId === 'ui.componentLib')).toBe(true)
    expect(doc.nodes.some((n) => n.typeId === 'ui.atlasCompose')).toBe(true)
    expect(doc.nodes.some((n) => n.typeId === 'asset.image')).toBe(false)
  })

  it('automatically discovers project-wide UI atlas / componentLib / iconPack resources via collectProjectUiAtlasResources', async () => {
    const { collectProjectUiAtlasResources } = await import('../src/shared/graph')
    const iconPackNode = createNodeFromType('image.iconPack', { x: 0, y: 0 })
    iconPackNode.params.generatedImages = [
      { id: 'ic1', title: '装备图标集', dataUrl: '', relativePath: 'Cache/Images/icons.png' }
    ]
    const discovered = collectProjectUiAtlasResources({
      graphs: [{ nodes: [iconPackNode], edges: [] }],
      assets: [
        {
          id: 'asset_atlas_1',
          type: 'image',
          name: '背包UI图集_SpriteAtlas',
          relativePath: 'Assets/UI/bag_atlas.png',
          folderId: 'f_ui'
        }
      ],
      folders: [{ id: 'f_ui', name: 'UI图集资源', parentId: null }]
    })
    expect(discovered.images.map((i) => i.relativePath)).toEqual([
      'Cache/Images/icons.png',
      'Assets/UI/bag_atlas.png'
    ])
  })

  it('resolves UI atlas search directories according to project session vs global workspace session rules', async () => {
    const { resolveChatUiAtlasSearchDirs } = await import('../src/shared/graph')
    const allProjects = [
      { name: 'Client_Harmmy', rootPath: 'F:\\projects\\Client_Harmmy' },
      { name: 'Client_Legacy', rootPath: 'F:\\projects\\Client_Legacy' }
    ]

    // 1) In Client_Harmmy project session: defaults to Client_Harmmy
    expect(
      resolveChatUiAtlasSearchDirs({
        activeProject: allProjects[0],
        allProjects,
        workspaceRootPath: 'F:\\workspace',
        prompt: '使用已有图集拼装一个横屏背包界面'
      })
    ).toEqual(['F:\\projects\\Client_Harmmy'])

    // 2) In Client_Harmmy project session + specifies Client_Legacy: searches both Client_Harmmy and Client_Legacy
    expect(
      resolveChatUiAtlasSearchDirs({
        activeProject: allProjects[0],
        allProjects,
        workspaceRootPath: 'F:\\workspace',
        prompt: '结合 Client_Legacy 的图标拼装背包界面'
      })
    ).toEqual(['F:\\projects\\Client_Harmmy', 'F:\\projects\\Client_Legacy'])

    // 3) In Global Workspace session (activeProject = null): searches Cache directory
    expect(
      resolveChatUiAtlasSearchDirs({
        activeProject: null,
        allProjects,
        workspaceRootPath: 'F:\\workspace',
        prompt: '拼装一个背包界面'
      })
    ).toEqual(['F:\\workspace\\Cache'])
  })
})
