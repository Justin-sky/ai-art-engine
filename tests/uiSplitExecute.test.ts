import { describe, expect, it, vi } from 'vitest'
import {
  createNodeFromType,
  executeUiSplitNode,
  executeUiGenNode,
  getNodePorts,
  parseUiScreenPrompts,
  buildUiSplitInnerGraph,
  buildUiSplitHostInterface,
  boundaryInputNodeId,
  boundaryOutputNodeId,
  ensureBoundaryProxyNodes,
  screensFromUiGenIncoming,
  UI_SPLIT_SLOT_CAP,
  GraphPortType,
  type NodeExecuteContext
} from '../src/shared/graph'

describe('ui.split', () => {
  it('expands incoming texts array into screens directly (no cook needed)', () => {
    const screens = screensFromUiGenIncoming([
      {
        kind: 'texts',
        items: [
          { title: '主界面', text: '主界面提示词' },
          { title: '商店', text: '商店提示词' }
        ]
      },
      { kind: 'text', text: '结算界面提示词' }
    ])
    expect(screens).toHaveLength(3)
    expect(screens[0]).toMatchObject({ title: '主界面', prompt: '主界面提示词' })
    expect(screens[1]).toMatchObject({ title: '商店', prompt: '商店提示词' })
    expect(screens[2]).toMatchObject({ title: '界面 3', prompt: '结算界面提示词' })
  })

  it('ui.gen stores incoming screen prompts as uiScreens and returns empty images', async () => {
    const patchNode = vi.fn()
    const ctx = {
      node: {
        id: 'gen',
        typeId: 'ui.gen',
        category: 'note',
        title: 'UI 界面生成',
        position: { x: 0, y: 0 },
        params: {}
      },
      inputs: {
        in: [
          {
            kind: 'texts',
            items: [
              { id: 'a', title: '主界面', text: '主界面提示词' },
              { id: 'b', title: '商店', text: '商店提示词' }
            ]
          }
        ]
      },
      patchNode
    } as unknown as NodeExecuteContext
    const out = await executeUiGenNode(ctx)
    expect(out.out).toEqual({ kind: 'images', items: [] })
    expect((ctx.node.params.uiScreens as unknown[]).length).toBe(2)
    expect(ctx.node.params.uiScreens?.[0]).toMatchObject({ title: '主界面', prompt: '主界面提示词' })
    expect(patchNode).toHaveBeenCalled()
  })

  it('ui.gen cook collects all inner boundary outputs', async () => {
    const doc = buildUiSplitInnerGraph([
      { id: 'a', title: '主界面', prompt: 'p1' },
      { id: 'b', title: '商店', prompt: 'p2' }
    ])
    const img1 = doc.nodes.find((n) => n.id === 'ui-img-1')!
    img1.params = {
      ...img1.params,
      generatedImages: [{ id: 'img-1', dataUrl: 'data:image/png;base64,AAA', createdAt: 't1' }]
    }
    const img2 = doc.nodes.find((n) => n.id === 'ui-img-2')!
    img2.params = {
      ...img2.params,
      generatedImages: [{ id: 'img-2', dataUrl: 'data:image/png;base64,BBB', createdAt: 't2' }]
    }
    const patchNode = vi.fn()
    const ctx = {
      node: {
        id: 'gen',
        typeId: 'ui.gen',
        category: 'note',
        title: 'UI 界面生成',
        position: { x: 0, y: 0 },
        params: { uiSplitAssetId: 'sub-1' }
      },
      inputs: {},
      resolveAssetGenParams: () => ({ graphJson: doc }),
      patchNode
    } as unknown as NodeExecuteContext
    const out = await executeUiGenNode(ctx)
    expect(out.out.kind).toBe('images')
    const items = (out.out as { items: Array<{ id?: string }> }).items
    expect(items).toHaveLength(2)
    expect(items.map((item) => item.id).sort()).toEqual(['img-1', 'img-2'])
    expect(patchNode).toHaveBeenCalled()
    expect((ctx.node.params.generatedImages as unknown[]).length).toBe(2)
  })

  it('builds a dive inner graph with one prompt->image->output chain per screen', () => {
    const screens = [
      { id: 'ui-main', title: '主界面', prompt: '主界面 HUD 生图提示词' },
      { id: 'ui-shop', title: '商店', prompt: '商店界面生图提示词' }
    ]
    const doc = buildUiSplitInnerGraph(screens)
    expect(doc.nodes).toHaveLength(6)
    expect(doc.edges).toHaveLength(4)
    const inId = boundaryInputNodeId('in-1')
    const outId = boundaryOutputNodeId('out-1')
    const chain = doc.edges.filter((e) => e.source === inId)
    expect(chain).toHaveLength(1)
    expect(chain[0]?.target).toBe('ui-img-1')
    expect(doc.edges.some((e) => e.source === 'ui-img-1' && e.target === outId)).toBe(true)
    const inNode = doc.nodes.find((n) => n.id === inId)
    expect(inNode?.params?.text).toBe('主界面 HUD 生图提示词')
    const imgNode = doc.nodes.find((n) => n.id === 'ui-img-1')
    expect(imgNode?.typeId).toBe('asset.image')
    expect(imgNode?.title).toBe('UI图·主界面')
    expect(doc.nodes.find((n) => n.id === outId)?.typeId).toBe(
      'graph.boundary.output'
    )
  })

  it('caps the dive inner graph at UI_SPLIT_SLOT_CAP chains', () => {
    const screens = Array.from({ length: 20 }, (_, i) => ({
      id: `ui-${i}`,
      title: `界面 ${i + 1}`,
      prompt: `提示词 ${i + 1}`
    }))
    const doc = buildUiSplitInnerGraph(screens)
    expect(doc.nodes.filter((n) => n.typeId === 'asset.image')).toHaveLength(UI_SPLIT_SLOT_CAP)
  })

  it('keeps one boundary set per chain after host interface normalization', () => {
    const screens = [
      { id: 'ui-main', title: '主界面', prompt: '主界面提示词' },
      { id: 'ui-shop', title: '商店', prompt: '商店提示词' }
    ]
    const doc = buildUiSplitInnerGraph(screens)
    const iface = buildUiSplitHostInterface(screens)
    const normalized = ensureBoundaryProxyNodes(doc, iface)
    expect(normalized.nodes.filter((n) => n.typeId === 'graph.boundary.input')).toHaveLength(2)
    expect(normalized.nodes.filter((n) => n.typeId === 'graph.boundary.output')).toHaveLength(2)
    const in1 = boundaryInputNodeId('in-1')
    const out1 = boundaryOutputNodeId('out-1')
    expect(normalized.edges.some((e) => e.source === in1 && e.target === 'ui-img-1')).toBe(true)
    expect(
      normalized.edges.some(
        (e) => e.source === in1 && e.target === 'ui-img-1' && (e.targetPort ?? 'in') === 'in-text'
      )
    ).toBe(true)
    expect(normalized.edges.some((e) => e.source === 'ui-img-1' && e.target === out1)).toBe(true)
    expect(normalized.edges.filter((e) => e.source === 'ui-img-1')).toHaveLength(1)
  })

  it('exposes text in and texts out ports', () => {
    const node = createNodeFromType('ui.split', { x: 0, y: 0 })
    const ports = getNodePorts(node)
    expect(ports.find((p) => p.direction === 'in' && p.id === 'in')?.dataType).toBe(
      GraphPortType.text
    )
    expect(ports.find((p) => p.direction === 'out' && p.id === 'out')).toMatchObject({
      dataType: GraphPortType.texts,
      multiple: true
    })
  })

  it('parses screen prompt JSON array', () => {
    const items = parseUiScreenPrompts(`\`\`\`json
[
  {"id":"ui-main","title":"主界面","prompt":"主界面 HUD，顶栏资源条"},
  {"title":"背包","prompt":"背包列表界面，三列格子"}
]
\`\`\``)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      id: 'ui-main',
      title: '主界面',
      prompt: '主界面 HUD，顶栏资源条'
    })
    expect(items[1]?.title).toBe('背包')
    expect(items[1]?.id).toMatch(/^ui-/)
  })

  it('unwraps object-wrapped arrays and prose-around JSON', () => {
    const wrapped = parseUiScreenPrompts(
      '{"screens":[{"title":"主界面","prompt":"顶栏资源条"},{"title":"背包","prompt":"三列格子"}]}'
    )
    expect(wrapped.map((item) => item.title)).toEqual(['主界面', '背包'])

    const prose = parseUiScreenPrompts(
      '以下是拆分结果：[{"title":"商店","prompt":"左侧分类右侧商品卡"}] 共 1 个界面'
    )
    expect(prose).toHaveLength(1)
    expect(prose[0]?.title).toBe('商店')
  })

  it('falls back to markdown list when model ignores JSON', () => {
    const items = parseUiScreenPrompts(
      '- 主界面：主界面 HUD，顶栏资源条，底部页签导航\n' +
        '1. 背包：背包列表界面，三列格子\n' +
        '* 商店：商店货架界面，左侧分类右侧商品卡'
    )
    expect(items.map((item) => item.title)).toEqual(['主界面', '背包', '商店'])
    expect(items.every((item) => item.prompt.length > 0)).toBe(true)
    expect(items.every((item) => item.id.startsWith('ui-'))).toBe(true)
  })

  it('outputs texts array from model JSON', async () => {
    const node = createNodeFromType('ui.split', { x: 0, y: 0 })
    const generateText = vi.fn(async () => ({
      text: JSON.stringify([
        { id: 'ui-shop', title: '商店', prompt: '商店货架界面，左侧分类右侧商品卡' },
        { id: 'ui-confirm', title: '购买确认弹窗', prompt: '居中确认弹窗，确认/取消按钮' }
      ])
    }))
    const ctx = {
      node,
      inputs: {
        in: [{ kind: 'text', text: '# UI 布局设计\n## 商店\n## 购买确认弹窗' }]
      },
      locale: 'zh-CN',
      generateText,
      patchNode: vi.fn()
    } as unknown as NodeExecuteContext

    const out = await executeUiSplitNode(ctx)
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(out.out).toMatchObject({
      kind: 'texts',
      items: [
        { id: 'ui-shop', title: '商店', text: '商店货架界面，左侧分类右侧商品卡' },
        { id: 'ui-confirm', title: '购买确认弹窗', text: '居中确认弹窗，确认/取消按钮' }
      ]
    })
    expect(node.params.generatedTexts).toHaveLength(2)
  })

  it('errors when upstream text is missing', async () => {
    const node = createNodeFromType('ui.split', { x: 0, y: 0 })
    const ctx = {
      node,
      inputs: {},
      locale: 'zh-CN',
      generateText: vi.fn()
    } as unknown as NodeExecuteContext
    await expect(executeUiSplitNode(ctx)).rejects.toThrow('GRAPH_PROCESS_NO_INPUT')
  })
})
