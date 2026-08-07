import { describe, expect, it, vi } from 'vitest'
import {
  createNodeFromType,
  executeGameSystemGenerateNode,
  getNodePorts,
  GraphPortType,
  type GraphNode,
  type NodeExecuteContext
} from '../src/shared/graph'

describe('game system plan generation node', () => {
  it('exposes text input / text output ports', () => {
    const node = createNodeFromType('asset.gameSystem', { x: 0, y: 0 })
    const ports = getNodePorts(node)
    expect(ports.some((p) => p.direction === 'in' && p.dataType === GraphPortType.text)).toBe(true)
    expect(ports.some((p) => p.direction === 'out' && p.dataType === GraphPortType.text)).toBe(true)
  })

  it('presets the professional system prompt in default params', () => {
    const node = createNodeFromType('asset.gameSystem', { x: 0, y: 0 })
    const prompt = String(node.params.generateSystemPrompt ?? '')
    expect(prompt).toContain('资深游戏系统策划')
    expect(prompt).toContain('功能点设计')
    expect(prompt).toContain('UI 布局设计')
  })

  it('generates a system plan with the professional system prompt', async () => {
    const generateText = vi.fn(async () => ({ text: '《商城系统》策划案正文', model: 'm' }))
    const patchNode = vi.fn()
    const ctx = {
      node: {
        id: 'gen',
        typeId: 'asset.gameSystem',
        category: 'asset',
        assetType: 'gameSystem',
        title: '系统策划案生成',
        position: { x: 0, y: 0 },
        params: { generateInstruction: '设计一个商城系统' }
      },
      inputs: {},
      generateText,
      patchNode
    } as unknown as NodeExecuteContext
    const out = await executeGameSystemGenerateNode(ctx)
    expect(generateText).toHaveBeenCalledTimes(1)
    const system = String(generateText.mock.calls[0]?.[0]?.system ?? '')
    expect(system).toContain('功能点设计')
    expect(system).toContain('UI 布局设计')
    expect(system).toContain('边界与异常处理')
    expect(out.out).toMatchObject({ kind: 'text', text: '《商城系统》策划案正文' })
    expect((ctx.node.params.generatedTexts as unknown[]).length).toBe(1)
    expect(patchNode).toHaveBeenCalled()
  })
})
