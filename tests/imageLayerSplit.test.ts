import { describe, expect, it } from 'vitest'
import {
  autoGroupLayersForGameUi,
  buildLayerSplitList,
  buildLayerSplitTree,
  buildLayerSplitUiManifest,
  buildUiCleanBaseInpaintPrompt,
  collectLayerSplitGroupLayers,
  decomposeRgbaBufferToUiLayers,
  executeLayerSplitNode,
  layerSplitExportFolderSegments,
  isCanvasSafeImageSrc,
  isLayerSplitLayerDrawable,
  isNativeLayerDecompositionModel,
  layerSplitFingerprint,
  nestLayerSplitResult,
  normalizedToRect,
  normalizeImageLayerSplit,
  orderLayerSplitTreeForPsd,
  placeLayersInParentRect,
  renameLayerSplitItem,
  reorderLayerSplit,
  resetLayerSplitRect,
  resolveEffectiveLayerSplitPrompt,
  resolveEffectiveUiLayerSplitStrategy
} from '../src/shared/graph'
import { parseVolcengineArkImageLayers } from '../src/shared/modelProviders/volcengineArk/layerDecomposition'

describe('imageLayerSplit', () => {
  it('normalizes defaults', () => {
    expect(normalizeImageLayerSplit()).toMatchObject({
      prompt: '',
      resolution: '2K',
      selectedId: '',
      layers: [],
      groups: []
    })
  })

  it('keeps 1.5K / auto resolution', () => {
    expect(normalizeImageLayerSplit({ resolution: '1.5K' }).resolution).toBe('1.5K')
    expect(normalizeImageLayerSplit({ resolution: 'auto' }).resolution).toBe('auto')
  })

  it('converts normalized bbox with 0-1000 scale', () => {
    expect(normalizedToRect([187, 59, 808, 188], 2048, 2048)).toEqual({
      left: 383,
      top: 121,
      width: 1272,
      height: 264
    })
  })

  it('reorders element layers without moving the base', () => {
    const layers = normalizeImageLayerSplit({
      layers: [
        {
          id: 'base',
          imageId: 'base',
          zIndex: 0,
          name: 'Base',
          visible: true,
          left: 0,
          top: 0,
          width: 10,
          height: 10
        },
        {
          id: 'a',
          imageId: 'a',
          zIndex: 1,
          name: 'A',
          visible: true,
          left: 0,
          top: 0,
          width: 10,
          height: 10
        },
        {
          id: 'b',
          imageId: 'b',
          zIndex: 2,
          name: 'B',
          visible: true,
          left: 0,
          top: 0,
          width: 10,
          height: 10
        }
      ]
    }).layers
    const up = reorderLayerSplit(layers, 'a', 'up')
    expect(up.find((l) => l.id === 'a')?.zIndex).toBe(2)
    expect(up.find((l) => l.id === 'b')?.zIndex).toBe(1)
    expect(reorderLayerSplit(layers, 'base', 'up').find((l) => l.id === 'base')?.zIndex).toBe(0)
  })

  it('resets a layer to original absolute box', () => {
    const layer = resetLayerSplitRect(
      {
        id: 'a',
        imageId: 'a',
        zIndex: 1,
        name: 'A',
        description: '',
        visible: true,
        left: 10,
        top: 10,
        width: 20,
        height: 20,
        originalAbsolute: [383, 120, 1655, 384]
      },
      2048,
      2048
    )
    expect(layer).toMatchObject({ left: 383, top: 120, width: 1272, height: 264 })
  })

  it('fingerprints source + prompt + resolution', () => {
    const a = layerSplitFingerprint('http://img/a.png', 'person', '2K')
    const b = layerSplitFingerprint('http://img/a.png', 'person', '2K')
    const c = layerSplitFingerprint('http://img/a.png', 'text', '2K')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('rejects remote https as canvas sources', () => {
    expect(isCanvasSafeImageSrc('https://tos.example/a.png')).toBe(false)
    expect(isCanvasSafeImageSrc('data:image/png;base64,aaa')).toBe(true)
    expect(isCanvasSafeImageSrc('studio-media://x')).toBe(true)
  })

  it('nests a selected layer into a group with mapped coordinates', () => {
    const parent = {
      id: 'person',
      imageId: 'person',
      zIndex: 2,
      name: 'Person',
      description: '',
      visible: true,
      left: 100,
      top: 50,
      width: 200,
      height: 100
    }
    const state = normalizeImageLayerSplit({
      canvasWidth: 1000,
      canvasHeight: 1000,
      layers: [
        {
          id: 'base',
          imageId: 'base',
          zIndex: 0,
          name: 'Base',
          visible: true,
          left: 0,
          top: 0,
          width: 1000,
          height: 1000
        },
        {
          id: 'a',
          imageId: 'a',
          zIndex: 1,
          name: 'A',
          visible: true,
          left: 0,
          top: 0,
          width: 10,
          height: 10
        },
        parent,
        {
          id: 'b',
          imageId: 'b',
          zIndex: 3,
          name: 'B',
          visible: true,
          left: 0,
          top: 0,
          width: 10,
          height: 10
        }
      ]
    })
    const nested = placeLayersInParentRect(
      parent,
      [
        {
          id: 'p-base',
          imageId: 'p-base',
          zIndex: 0,
          name: 'Base',
          description: '',
          visible: true,
          left: 0,
          top: 0,
          width: 400,
          height: 200
        },
        {
          id: 'hat',
          imageId: 'hat',
          zIndex: 1,
          name: 'Hat',
          description: '',
          visible: true,
          left: 40,
          top: 20,
          width: 80,
          height: 40
        }
      ],
      { width: 400, height: 200 }
    )
    expect(nested[0]).toMatchObject({ left: 100, top: 50, width: 200, height: 100, role: 'layer' })
    expect(nested[1]).toMatchObject({ left: 120, top: 60, width: 40, height: 20 })

    const next = nestLayerSplitResult({
      state,
      parentId: 'person',
      nestedLayers: nested,
      groupName: 'Person 拆分',
      stamp: 1
    })
    expect(next.groups).toHaveLength(1)
    expect(next.groups[0]).toMatchObject({
      name: 'Person 拆分',
      sourceLayerId: 'person',
      visible: true
    })
    expect(next.layers.find((l) => l.id === 'person')).toMatchObject({
      visible: false,
      groupId: next.groups[0]!.id
    })
    expect(next.layers.find((l) => l.id === 'hat')).toMatchObject({
      groupId: next.groups[0]!.id,
      left: 120,
      top: 60
    })
    expect(next.layers.find((l) => l.id === 'b')?.zIndex).toBe(5)

    const rows = buildLayerSplitList(next)
    expect(
      rows.map((row) =>
        row.kind === 'group' ? `group:${row.group.name}` : `layer:${row.layer.id}`
      )
    ).toEqual([
      'layer:b',
      'group:Person 拆分',
      'layer:hat',
      'layer:p-base',
      'layer:person',
      'layer:a',
      'layer:base'
    ])
    expect(
      isLayerSplitLayerDrawable(
        next,
        next.layers.find((l) => l.id === 'hat')!
      )
    ).toBe(true)
    expect(collectLayerSplitGroupLayers(next, next.groups[0]!.id).map((l) => l.id)).toEqual([
      'person',
      'p-base',
      'hat'
    ])
    expect(
      layerSplitExportFolderSegments(next, next.layers.find((l) => l.id === 'hat')?.groupId)
    ).toEqual(['Person 拆分'])
    expect(
      layerSplitExportFolderSegments(next, next.layers.find((l) => l.id === 'a')?.groupId)
    ).toEqual([])

    const hidden = {
      ...next,
      groups: next.groups.map((g) => ({ ...g, visible: false }))
    }
    expect(
      isLayerSplitLayerDrawable(
        hidden,
        hidden.layers.find((l) => l.id === 'hat')!
      )
    ).toBe(false)
    expect(
      isLayerSplitLayerDrawable(
        hidden,
        hidden.layers.find((l) => l.id === 'base')!
      )
    ).toBe(true)
  })

  it('orders the psd tree bottom -> top so ag-psd children match the layer panel', () => {
    // 图层面板（顶 → 底）：b / group[hat, p-base, person] / a / base
    const state = nestLayerSplitResult({
      state: normalizeImageLayerSplit({
        canvasWidth: 1000,
        canvasHeight: 1000,
        layers: [
          {
            id: 'base',
            imageId: 'base',
            zIndex: 0,
            name: 'Base',
            visible: true,
            left: 0,
            top: 0,
            width: 1000,
            height: 1000
          },
          {
            id: 'a',
            imageId: 'a',
            zIndex: 1,
            name: 'A',
            visible: true,
            left: 0,
            top: 0,
            width: 10,
            height: 10
          },
          {
            id: 'person',
            imageId: 'person',
            zIndex: 2,
            name: 'Person',
            visible: true,
            left: 100,
            top: 50,
            width: 200,
            height: 100
          },
          {
            id: 'b',
            imageId: 'b',
            zIndex: 3,
            name: 'B',
            visible: true,
            left: 0,
            top: 0,
            width: 10,
            height: 10
          }
        ]
      }),
      parentId: 'person',
      nestedLayers: [
        {
          id: 'p-base',
          imageId: 'p-base',
          zIndex: 0,
          name: 'Base',
          description: '',
          visible: true,
          left: 0,
          top: 0,
          width: 200,
          height: 100
        },
        {
          id: 'hat',
          imageId: 'hat',
          zIndex: 1,
          name: 'Hat',
          description: '',
          visible: true,
          left: 40,
          top: 20,
          width: 80,
          height: 40
        }
      ],
      groupName: 'Person 拆分',
      stamp: 1
    })
    const groupId = state.groups[0]!.id

    // ag-psd 的 children[0] 是最底层，所以每一级都应相对面板反转（底 → 顶）。
    const ordered = orderLayerSplitTreeForPsd<{ kind: string; id: string; children?: unknown[] }>(
      buildLayerSplitTree(state),
      {
        layer: (layer) => ({ kind: 'layer', id: layer.id }),
        group: (group, children) => ({ kind: 'group', id: group.id, children })
      }
    )
    expect(ordered).toEqual([
      { kind: 'layer', id: 'base' },
      { kind: 'layer', id: 'a' },
      {
        kind: 'group',
        id: groupId,
        children: [
          { kind: 'layer', id: 'person' },
          { kind: 'layer', id: 'p-base' },
          { kind: 'layer', id: 'hat' }
        ]
      },
      { kind: 'layer', id: 'b' }
    ])
  })

  it('drops empty groups and keeps only rendered leaves in psd order', () => {
    const state = normalizeImageLayerSplit({
      canvasWidth: 100,
      canvasHeight: 100,
      layers: [
        {
          id: 'base',
          imageId: 'base',
          zIndex: 0,
          name: 'Base',
          visible: true,
          left: 0,
          top: 0,
          width: 100,
          height: 100
        },
        {
          id: 'skip',
          imageId: 'skip',
          zIndex: 1,
          name: 'Skip',
          visible: true,
          left: 0,
          top: 0,
          width: 10,
          height: 10,
          groupId: 'g-empty'
        },
        {
          id: 'top',
          imageId: 'top',
          zIndex: 2,
          name: 'Top',
          visible: true,
          left: 0,
          top: 0,
          width: 10,
          height: 10
        }
      ],
      groups: [
        { id: 'g-empty', name: 'Empty', collapsed: false, visible: true, sourceLayerId: 'base' }
      ]
    })
    // 'skip' 没有栅格像素（layer 回调返回 null），其所在分组因此变空要被剔除。
    const ordered = orderLayerSplitTreeForPsd<{ id: string }>(buildLayerSplitTree(state), {
      layer: (layer) => (layer.id === 'skip' ? null : { id: layer.id }),
      group: (group) => ({ id: `group:${group.id}` })
    })
    expect(ordered).toEqual([{ id: 'base' }, { id: 'top' }])
  })

  it('allows z-index beyond a single API split', () => {
    const layer = normalizeImageLayerSplit({
      layers: [
        {
          id: 'x',
          imageId: 'x',
          zIndex: 40,
          name: 'X',
          visible: true,
          left: 0,
          top: 0,
          width: 1,
          height: 1
        }
      ]
    }).layers[0]
    expect(layer?.zIndex).toBe(40)
  })

  it('resolves default Game UI layer split prompt when user prompt is empty', () => {
    const zh = resolveEffectiveLayerSplitPrompt('', {
      locale: 'zh-CN',
      sourceTitle: '底图·商店界面'
    })
    expect(zh).toContain('游戏 UI')
    expect(zh).toContain('商店界面')

    const en = resolveEffectiveLayerSplitPrompt('', { locale: 'en-US', sourceTitle: 'Shop UI' })
    expect(en.toLowerCase()).toContain('game ui')
    expect(en).toContain('Shop UI')

    expect(resolveEffectiveLayerSplitPrompt('custom split prompt', { locale: 'zh-CN' })).toBe(
      'custom split prompt'
    )
  })

  it('renames a foreground layer or group without touching base layer', () => {
    const state = normalizeImageLayerSplit({
      canvasWidth: 1000,
      canvasHeight: 1000,
      layers: [
        {
          id: 'base',
          imageId: 'base',
          zIndex: 0,
          name: 'Base',
          visible: true,
          left: 0,
          top: 0,
          width: 1000,
          height: 1000
        },
        {
          id: 'btn-1',
          imageId: 'btn-1',
          zIndex: 1,
          name: 'Layer 1',
          visible: true,
          left: 100,
          top: 800,
          width: 240,
          height: 80,
          groupId: 'g-1'
        }
      ],
      groups: [
        {
          id: 'g-1',
          name: 'Old Group',
          collapsed: false,
          visible: true,
          sourceLayerId: 'btn-1'
        }
      ]
    })

    const renamedLayer = renameLayerSplitItem(state, 'btn-1', 'Btn_Confirm_Primary')
    expect(renamedLayer.layers.find((l) => l.id === 'btn-1')?.name).toBe('Btn_Confirm_Primary')

    const renamedGroup = renameLayerSplitItem(renamedLayer, 'g-1', '02_交互控件与按钮')
    expect(renamedGroup.groups.find((g) => g.id === 'g-1')?.name).toBe('02_交互控件与按钮')
  })

  it('auto-groups Game UI layers into PSD folders and builds UI layout manifest', () => {
    const state = normalizeImageLayerSplit({
      canvasWidth: 1080,
      canvasHeight: 1920,
      layers: [
        {
          id: 'base',
          imageId: 'base',
          zIndex: 0,
          name: 'Base',
          visible: true,
          left: 0,
          top: 0,
          width: 1080,
          height: 1920
        },
        {
          id: 'panel-bg',
          imageId: 'panel-bg',
          zIndex: 1,
          name: 'Dialog Panel Frame',
          visible: true,
          left: 90,
          top: 360,
          width: 900,
          height: 1200
        },
        {
          id: 'btn-ok',
          imageId: 'btn-ok',
          zIndex: 2,
          name: 'Confirm Button',
          visible: true,
          left: 340,
          top: 1380,
          width: 400,
          height: 110
        },
        {
          id: 'top-bar',
          imageId: 'top-bar',
          zIndex: 3,
          name: 'Top Currency Bar',
          visible: true,
          left: 40,
          top: 30,
          width: 1000,
          height: 90
        }
      ]
    })

    const grouped = autoGroupLayersForGameUi(state, 'zh-CN')
    expect(grouped.groups.map((g) => g.name)).toEqual([
      '03_面板与容器底框',
      '02_交互控件与按钮',
      '01_顶栏与装饰'
    ])
    const listGroupOrder = buildLayerSplitList(grouped)
      .filter((row) => row.kind === 'group')
      .map((row) => (row.kind === 'group' ? row.group.name : ''))
    expect(listGroupOrder).toEqual(['01_顶栏与装饰', '02_交互控件与按钮', '03_面板与容器底框'])
    expect(grouped.layers.find((l) => l.id === 'base')?.groupId).toBeUndefined()
    expect(grouped.layers.find((l) => l.id === 'panel-bg')?.groupId).toBe('group:ui-auto:panels')
    expect(grouped.layers.find((l) => l.id === 'btn-ok')?.groupId).toBe('group:ui-auto:controls')
    expect(grouped.layers.find((l) => l.id === 'top-bar')?.groupId).toBe('group:ui-auto:header')

    const manifest = buildLayerSplitUiManifest(grouped)
    expect(manifest.schemaVersion).toBe('1.0')
    expect(manifest.canvas).toEqual({ width: 1080, height: 1920 })
    expect(manifest.groups).toHaveLength(3)
    const panelEntry = manifest.layers.find((l) => l.id === 'panel-bg')
    expect(panelEntry?.groupPath).toEqual(['03_面板与容器底框'])
    expect(panelEntry?.nineSliceHint.recommended).toBe(true)
    const topEntry = manifest.layers.find((l) => l.id === 'top-bar')
    expect(topEntry?.anchor).toBe('top-center')
  })

  it('resolves split strategy across models and splitMode', () => {
    expect(isNativeLayerDecompositionModel('')).toBe(true)
    expect(isNativeLayerDecompositionModel('doubao-seedream-5-0-260128')).toBe(true)
    expect(isNativeLayerDecompositionModel('ep-20260416-custom')).toBe(true)
    expect(isNativeLayerDecompositionModel('doubao-seedream-4-5-251128')).toBe(false)
    expect(isNativeLayerDecompositionModel('gemini-2.5-flash-image')).toBe(false)
    expect(isNativeLayerDecompositionModel('gpt-image-1')).toBe(false)

    expect(resolveEffectiveUiLayerSplitStrategy('auto', 'doubao-seedream-5-0-260128')).toBe(
      'ai-layers'
    )
    expect(resolveEffectiveUiLayerSplitStrategy('auto', 'gemini-2.5-flash-image')).toBe(
      'ai-inpaint-slice'
    )
    expect(resolveEffectiveUiLayerSplitStrategy('local-slice', 'doubao-seedream-5-0-260128')).toBe(
      'local-slice'
    )
    expect(
      resolveEffectiveUiLayerSplitStrategy('ai-inpaint-slice', 'doubao-seedream-5-0-260128')
    ).toBe('ai-inpaint-slice')

    const inpaintPrompt = buildUiCleanBaseInpaintPrompt('', {
      locale: 'zh-CN',
      sourceTitle: '底图·背包界面'
    })
    expect(inpaintPrompt).toContain('背包界面')
    expect(inpaintPrompt).toContain('背景底板')
  })

  it('decomposes RGBA buffer into clean base + transparent UI widget layers in both AI-inpaint and 0-API local modes', () => {
    const width = 120
    const height = 160
    const cleanBase = new Uint8ClampedArray(width * height * 4)
    const source = new Uint8ClampedArray(width * height * 4)

    // 填充深蓝灰渐变背景底板
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        cleanBase[idx] = 24
        cleanBase[idx + 1] = 28
        cleanBase[idx + 2] = 42
        cleanBase[idx + 3] = 255
      }
    }
    source.set(cleanBase)

    const paintRect = (
      x0: number,
      y0: number,
      w: number,
      h: number,
      r: number,
      g: number,
      b: number
    ): void => {
      for (let y = y0; y < y0 + h; y++) {
        for (let x = x0; x < x0 + w; x++) {
          const idx = (y * width + x) * 4
          source[idx] = r
          source[idx + 1] = g
          source[idx + 2] = b
          source[idx + 3] = 255
        }
      }
    }

    // 1. 顶栏状态条 (Top Header Bar)
    paintRect(10, 8, 100, 14, 215, 175, 65)
    // 2. 中部道具卡片槽 (Center Item Slot)
    paintRect(25, 50, 70, 50, 80, 165, 240)
    // 3. 底部确认按钮 (Bottom Action Button)
    paintRect(28, 126, 64, 20, 240, 95, 60)

    // 模式 A：提供 AI 重绘的干净底板 (ai-inpaint-slice)
    const aiDiffResult = decomposeRgbaBufferToUiLayers({
      width,
      height,
      sourceRgba: source,
      cleanBaseRgba: cleanBase,
      locale: 'zh-CN'
    })
    expect(aiDiffResult.layers.length).toBeGreaterThanOrEqual(3)
    expect(aiDiffResult.layers.some((l) => l.name.includes('顶栏'))).toBe(true)
    expect(aiDiffResult.layers.some((l) => l.name.includes('按钮'))).toBe(true)

    // 模式 B：不提供外部底板，纯本地背景建模 + 内插修补 (local-slice)
    const localResult = decomposeRgbaBufferToUiLayers({
      width,
      height,
      sourceRgba: source,
      locale: 'zh-CN'
    })
    expect(localResult.layers.length).toBeGreaterThanOrEqual(3)
    // 验证本地修补后的底板已将原本亮橙色按钮中心 (x=60, y=136) 修补回深色背景
    const btnCenterIdx = (136 * width + 60) * 4
    expect(localResult.baseRgba[btnCenterIdx]!).toBeLessThan(80)
  })

  it('executes executeLayerSplitNode with any general image model (ai-inpaint-slice) and local-slice mode', async () => {
    let generateCalled = 0
    let lastLayerDecompFlag: boolean | undefined

    const baseCtx = {
      inputs: {
        in: [
          {
            kind: 'images' as const,
            items: [{ id: 'src-1', title: '底图·商城弹窗', dataUrl: 'data:image/png;base64,SRC' }]
          }
        ]
      },
      locale: 'zh-CN',
      generateImage: async (req: { layerDecomposition?: boolean }) => {
        generateCalled += 1
        lastLayerDecompFlag = req.layerDecomposition
        return {
          images: ['data:image/png;base64,CLEAN_BASE'],
          model: 'gemini-2.5-flash-image'
        }
      },
      decomposeImageUiLayers: async () => ({
        width: 1080,
        height: 1920,
        baseDataUrl: 'data:image/png;base64,CLEAN_BASE',
        widgets: [
          {
            name: '顶栏横幅条_1',
            left: 40,
            top: 30,
            width: 1000,
            height: 90,
            dataUrl: 'data:image/png;base64,W1'
          },
          {
            name: '交互按钮_2',
            left: 340,
            top: 1600,
            width: 400,
            height: 110,
            dataUrl: 'data:image/png;base64,W2'
          }
        ]
      })
    }

    // 1) 选择非 Seedream-5 通用模型（如 gemini-2.5-flash-image），splitMode='auto' 自动走 ai-inpaint-slice
    const nodeAi = {
      id: 'split-node-1',
      typeId: 'image.layerSplit',
      title: 'UI 图层分离',
      position: { x: 0, y: 0 },
      params: {
        generateModel: 'gemini-2.5-flash-image',
        imageLayerSplit: normalizeImageLayerSplit({ splitMode: 'auto', resolution: '2K' })
      }
    }
    await executeLayerSplitNode({
      ...(baseCtx as unknown as Parameters<typeof executeLayerSplitNode>[0]),
      node: nodeAi
    })
    expect(generateCalled).toBe(1)
    expect(lastLayerDecompFlag).toBeUndefined()
    const savedStateAi = nodeAi.params.imageLayerSplit
    expect(savedStateAi.layers).toHaveLength(3)
    expect(savedStateAi.groups.map((g) => g.name)).toEqual(['02_交互控件与按钮', '01_顶栏与装饰'])

    // 2) 选择 local-slice 模式：零 API 调用直接完成拆层与 PSD 分组
    generateCalled = 0
    const nodeLocal = {
      id: 'split-node-2',
      typeId: 'image.layerSplit',
      title: 'UI 图层分离',
      position: { x: 0, y: 0 },
      params: {
        imageLayerSplit: normalizeImageLayerSplit({ splitMode: 'local-slice', resolution: '2K' })
      }
    }
    await executeLayerSplitNode({
      ...(baseCtx as unknown as Parameters<typeof executeLayerSplitNode>[0]),
      node: nodeLocal
    })
    expect(generateCalled).toBe(0)
    expect(nodeLocal.params.imageLayerSplit.layers).toHaveLength(3)
    expect(nodeLocal.params.imageLayerSplit.groups.length).toBeGreaterThanOrEqual(2)
  })
})

describe('parseVolcengineArkImageLayers', () => {
  it('maps official layer_decomposition fields', () => {
    const parsed = parseVolcengineArkImageLayers([
      { url: 'https://base.jpg', size: '2048x2048', output_format: 'jpeg', z_index: 0 },
      {
        url: 'https://title.png',
        size: '1273x265',
        output_format: 'png',
        z_index: 1,
        bounding_box: {
          absolute: [383, 120, 1655, 384],
          normalized: [187, 59, 808, 188]
        },
        name: 'Seedream title text',
        description: 'Large yellow Seedream title text in a serif font'
      }
    ])
    expect(parsed.images).toEqual(['https://base.jpg', 'https://title.png'])
    expect(parsed.layers[0]).toMatchObject({ zIndex: 0, url: 'https://base.jpg' })
    expect(parsed.layers[1]).toMatchObject({
      zIndex: 1,
      name: 'Seedream title text',
      boundingBox: {
        absolute: [383, 120, 1655, 384],
        normalized: [187, 59, 808, 188]
      }
    })
  })
})
