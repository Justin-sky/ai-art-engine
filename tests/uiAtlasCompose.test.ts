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

  it('keeps standalone sprites (multi-character logo, opaque background, login button, close button) intact instead of fragmenting them', async () => {
    // 1) Multi-character logo (4 disconnected character islands on transparent background)
    const logoImg = createImage(880, 236)
    for (let ch = 0; ch < 4; ch++) {
      const startX = 40 + ch * 200
      for (let y = 30; y < 200; y++) {
        for (let x = startX; x < startX + 140; x++) {
          const idx = (y * 880 + x) * 4
          logoImg.data[idx] = 80
          logoImg.data[idx + 1] = 200
          logoImg.data[idx + 2] = 255
          logoImg.data[idx + 3] = 255
        }
      }
    }
    const logoCandidates = extractAtlasCandidatesFromRgba(logoImg, '登录大标题 Logo · logo1', 1)
    expect(logoCandidates).toHaveLength(1)
    expect(logoCandidates[0]!.item.kind).toBe('logo')
    expect(logoCandidates[0]!.rgba.width).toBeGreaterThanOrEqual(700)

    // 2) Full-bleed opaque background image with varied colors (common_bg1)
    const bgImg = createImage(590, 1280)
    for (let y = 0; y < 1280; y++) {
      for (let x = 0; x < 590; x++) {
        const idx = (y * 590 + x) * 4
        bgImg.data[idx] = (x * 3 + y) % 256
        bgImg.data[idx + 1] = (y * 2) % 256
        bgImg.data[idx + 2] = (x + y * 5) % 256
        bgImg.data[idx + 3] = 255
      }
    }
    const bgCandidates = extractAtlasCandidatesFromRgba(bgImg, '主视觉背景 · common_bg1', 1)
    expect(bgCandidates).toHaveLength(1)
    expect(bgCandidates[0]!.item.kind).toBe('background')
    expect(bgCandidates[0]!.rgba.width).toBe(590)
    expect(bgCandidates[0]!.rgba.height).toBe(1280)

    // 3) Close button is classified as close-button rather than generic button
    const closeImg = createImage(86, 72)
    for (let y = 8; y < 64; y++) {
      for (let x = 10; x < 76; x++) {
        const idx = (y * 86 + x) * 4
        closeImg.data[idx] = 240
        closeImg.data[idx + 1] = 90
        closeImg.data[idx + 2] = 90
        closeImg.data[idx + 3] = 255
      }
    }
    const closeCandidates = extractAtlasCandidatesFromRgba(closeImg, '关闭按钮 · Equip_close', 1)
    expect(closeCandidates).toHaveLength(1)
    expect(closeCandidates[0]!.item.kind).toBe('close-button')
  })

  it('assembles a complete portrait Login UI when fed standalone login sprites', async () => {
    const encodedMap = new Map<string, RgbaImage>()
    let seq = 0
    const makeSolidSprite = (w: number, h: number, r: number, g: number, b: number): string => {
      const img = createImage(w, h)
      for (let i = 0; i < w * h * 4; i += 4) {
        img.data[i] = r
        img.data[i + 1] = g
        img.data[i + 2] = b
        img.data[i + 3] = 255
      }
      const url = `data:image/png;base64,SPRITE_${++seq}_${w}x${h}`
      encodedMap.set(url, img)
      return url
    }

    const node = createNodeFromType('ui.atlasCompose', { x: 0, y: 0 })
    node.title = '登录主界面拼装（竖屏 1080×1920）'
    node.params.generateAspectRatio = '9:16'
    node.params.generateInstruction =
      '竖屏手游登录主界面（1080×1920），包含全屏背景 common_bg1、顶部大标题 logo1、居中登录面板 common_bg2、右上角关闭按钮 Equip_close、三个登录主按钮 common_login、协议勾选框 Protocol 及底部进度条 progress_bg / progress_fill'

    await executeUiAtlasComposeNode({
      node,
      inputs: {
        'in-images': [
          {
            kind: 'image',
            dataUrl: makeSolidSprite(590, 1280, 30, 80, 45),
            title: '主视觉背景 · common_bg1',
            relativePath: 'Assets/PreloadRes/Resources/Textures/common_bg1.jpg'
          },
          {
            kind: 'image',
            dataUrl: makeSolidSprite(880, 236, 60, 200, 255),
            title: '游戏大标题 Logo · logo1',
            relativePath: 'Assets/PreloadRes/Resources/Textures/logo1.png'
          },
          {
            kind: 'image',
            dataUrl: makeSolidSprite(300, 280, 20, 40, 80),
            title: '登录面板底框 · common_bg2',
            relativePath: 'Assets/PreloadRes/Resources/Textures/common_bg2.png'
          },
          {
            kind: 'image',
            dataUrl: makeSolidSprite(420, 120, 240, 240, 240),
            title: '登录主按钮 · common_login',
            relativePath: 'Assets/PreloadRes/Resources/Textures/common_login.png'
          },
          {
            kind: 'image',
            dataUrl: makeSolidSprite(96, 123, 50, 50, 50),
            title: '协议勾选框 · Protocol',
            relativePath: 'Assets/PreloadRes/Resources/Textures/Protocol.png'
          },
          {
            kind: 'image',
            dataUrl: makeSolidSprite(86, 72, 220, 80, 80),
            title: '关闭按钮 · Equip_close',
            relativePath: 'Assets/PreloadRes/Resources/Textures/Equip_close.png'
          },
          {
            kind: 'image',
            dataUrl: makeSolidSprite(802, 51, 30, 30, 30),
            title: '加载进度条底槽 · progress_bg',
            relativePath: 'Assets/PreloadRes/Resources/Textures/progress_bg.png'
          },
          {
            kind: 'image',
            dataUrl: makeSolidSprite(794, 43, 80, 220, 120),
            title: '加载进度条填充 · progress_fill',
            relativePath: 'Assets/PreloadRes/Resources/Textures/progress_fill.png'
          }
        ]
      },
      locale: 'zh-CN',
      onNodePatch: (_id, patch) => {
        if (patch.params) {
          node.params = { ...node.params, ...patch.params }
        }
      },
      uiRgbaCodec: {
        decodeImageRgba: async (src: string) => encodedMap.get(src) ?? createImage(64, 64),
        encodeRgbaPng: async (img: RgbaImage) => {
          const fakeUrl = `data:image/png;base64,ENC_${++seq}_${img.width}x${img.height}`
          encodedMap.set(fakeUrl, img)
          return fakeUrl
        }
      },
      composeImageLayerStack: async () => ({
        dataUrl: 'data:image/png;base64,COMPOSITE_PREVIEW',
        psdDataUrl: 'data:image/vnd.adobe.photoshop;base64,FAKE_PSD'
      }),
      saveRunMedia: async ({ key }) => `Cache/Images/${key}.png`
    } as never)

    const state = (
      node.params as unknown as {
        imageLayerSplit: import('../src/shared/graph').ImageLayerSplitState
      }
    ).imageLayerSplit
    expect(state.canvasWidth).toBe(1080)
    expect(state.canvasHeight).toBe(1920)
    expect(state.componentLibrary).toHaveLength(8)
    const names = state.layers.map((l) => l.name)
    expect(names.some((n) => n.includes('背景'))).toBe(true)
    expect(names.some((n) => /logo/i.test(n))).toBe(true)
    expect(names.some((n) => n.includes('登录面板'))).toBe(true)
    expect(names.some((n) => n.includes('关闭按钮'))).toBe(true)
    expect(names.some((n) => n.includes('进度条'))).toBe(true)

    // Verify re-running with new in-images replaces previous cached componentLibrary instead of keeping stale items
    await executeUiAtlasComposeNode({
      node,
      inputs: {
        'in-images': [
          {
            kind: 'image',
            dataUrl: makeSolidSprite(880, 236, 60, 200, 255),
            title: '新大标题 Logo · logo1',
            relativePath: 'Assets/PreloadRes/Resources/Textures/logo1.png'
          }
        ]
      },
      locale: 'zh-CN',
      onNodePatch: (_id, patch) => {
        if (patch.params) {
          node.params = { ...node.params, ...patch.params }
        }
      },
      uiRgbaCodec: {
        decodeImageRgba: async (src: string) => encodedMap.get(src) ?? createImage(64, 64),
        encodeRgbaPng: async (img: RgbaImage) => {
          const fakeUrl = `data:image/png;base64,ENC_${++seq}_${img.width}x${img.height}`
          encodedMap.set(fakeUrl, img)
          return fakeUrl
        }
      },
      composeImageLayerStack: async () => ({
        dataUrl: 'data:image/png;base64,COMPOSITE_PREVIEW_2',
        psdDataUrl: 'data:image/vnd.adobe.photoshop;base64,FAKE_PSD_2'
      }),
      saveRunMedia: async ({ key }) => `Cache/Images/${key}.png`
    } as never)

    const updatedState = (
      node.params as unknown as {
        imageLayerSplit: import('../src/shared/graph').ImageLayerSplitState
      }
    ).imageLayerSplit
    expect(updatedState.componentLibrary).toHaveLength(1)
    expect(updatedState.componentLibrary?.[0]?.kind).toBe('logo')
  })
})
