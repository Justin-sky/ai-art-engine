import { describe, expect, it, vi } from 'vitest'
import {
  createNodeFromType,
  executeGameSystemGenerateNode,
  getNodePorts,
  GraphPortType,
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

  it('feeds the params.text draft into the prompt when instruction is empty', async () => {
    const generateText = vi.fn(async () => ({ text: '扩写后的策划案', model: 'm' }))
    const ctx = {
      node: {
        id: 'gen',
        typeId: 'asset.gameSystem',
        category: 'asset',
        assetType: 'gameSystem',
        title: '系统策划案生成',
        position: { x: 0, y: 0 },
        params: { text: '## 商城系统底稿\n- 货币：金币' }
      },
      inputs: {},
      generateText
    } as unknown as NodeExecuteContext
    await executeGameSystemGenerateNode(ctx)
    const prompt = String(generateText.mock.calls[0]?.[0]?.prompt ?? '')
    expect(prompt).toContain('策划案底稿')
    expect(prompt).toContain('## 商城系统底稿')
  })

  it('does not re-feed a previous generated output as the draft on rerun', async () => {
    const generateText = vi.fn(async () => ({ text: '重新生成的策划案', model: 'm' }))
    const previous = '上一轮生成的策划案正文'
    const ctx = {
      node: {
        id: 'gen',
        typeId: 'asset.gameSystem',
        category: 'asset',
        assetType: 'gameSystem',
        title: '系统策划案生成',
        position: { x: 0, y: 0 },
        params: {
          text: previous,
          generatedTexts: [
            { id: 'gen-text:1', text: previous, createdAt: '2026-01-01T00:00:00.000Z' }
          ]
        }
      },
      inputs: {},
      generateText
    } as unknown as NodeExecuteContext
    await executeGameSystemGenerateNode(ctx)
    const prompt = String(generateText.mock.calls[0]?.[0]?.prompt ?? '')
    expect(prompt).not.toContain(previous)
    expect(prompt).not.toContain('策划案底稿')
  })
})
