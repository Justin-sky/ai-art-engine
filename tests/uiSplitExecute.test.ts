import { describe, expect, it, vi } from 'vitest'
import {
  createNodeFromType,
  executeUiSplitNode,
  getNodePorts,
  parseUiScreenPrompts,
  GraphPortType,
  type NodeExecuteContext
} from '../src/shared/graph'

describe('ui.split', () => {
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
