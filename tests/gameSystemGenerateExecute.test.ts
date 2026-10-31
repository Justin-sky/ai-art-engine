import { describe, expect, it, vi } from 'vitest'
import {
  buildInstructionFinalPromptPreview,
  buildMentionSourcesForNode,
  canConnectNodes,
  canConnectToNodeType,
  createNodeFromType,
  executeGameSystemGenerateNode,
  findCompatibleInPort,
  findCompatibleOutPort,
  getNodePorts,
  getNodeType,
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

  it('supports closed-loop port connections: game.economy -> asset.novel (out & out-all) -> asset.gameSystem -> ui.split', () => {
    const econNode = createNodeFromType('game.economy', { x: 0, y: 0 })
    const novelNode = createNodeFromType('asset.novel', { x: 300, y: 0 })
    const gsNode = createNodeFromType('asset.gameSystem', { x: 600, y: 0 })
    const uiSplitNode = createNodeFromType('ui.split', { x: 900, y: 0 })
    const gsDef = getNodeType('asset.gameSystem')!

    // 1) Both novel 'out' (text) and 'out-all' (texts) connect to asset.gameSystem 'in'
    expect(canConnectNodes(novelNode, gsNode, { sourcePort: 'out', targetPort: 'in' })).toBe(true)
    expect(canConnectNodes(novelNode, gsNode, { sourcePort: 'out-all', targetPort: 'in' })).toBe(
      true
    )
    expect(findCompatibleInPort(gsNode, GraphPortType.texts)?.id).toBe('in')
    expect(canConnectToNodeType(novelNode, gsDef, { sourcePort: 'out' })).toBe(true)
    expect(canConnectToNodeType(novelNode, gsDef, { sourcePort: 'out-all' })).toBe(true)

    // 2) game.economy automatically selects 'out-text' when connecting to novel or gameSystem
    expect(findCompatibleOutPort(econNode, novelNode)?.id).toBe('out-text')
    expect(findCompatibleOutPort(econNode, gsNode)?.id).toBe('out-text')
    expect(canConnectNodes(econNode, novelNode)).toBe(true)
    expect(canConnectNodes(econNode, gsNode)).toBe(true)

    // 3) asset.gameSystem 'out' connects to ui.split 'in'
    expect(canConnectNodes(gsNode, uiSplitNode, { sourcePort: 'out', targetPort: 'in' })).toBe(true)
  })

  it('closes the loop in prompt preview & execution when asset.novel (out or out-all) connects to asset.gameSystem', async () => {
    const novelNode = createNodeFromType('asset.novel', { x: 0, y: 0 })
    novelNode.params.novelGenre = 'xianxia_cultivation'
    novelNode.params.novelWorldBible = '九天十地灵气复苏，境界分炼气、筑基、金丹'
    novelNode.params.text = '第1章：太初矿脉\n林玄在寒潭深处运转太初灵火，突破筑基三层。'
    novelNode.params.generatedTexts = [
      {
        id: 'chap:1',
        title: '第1章：太初矿脉',
        text: '第1章：太初矿脉\n林玄在寒潭深处运转太初灵火，突破筑基三层。',
        createdAt: '2026-01-01T00:00:00.000Z'
      },
      {
        id: 'chap:2',
        title: '第2章：青云大比',
        text: '第2章：青云大比\n林玄祭出青莲剑诀，正面击溃执法长老座下首徒。',
        createdAt: '2026-01-01T00:01:00.000Z'
      }
    ]

    const gsNode = createNodeFromType('asset.gameSystem', { x: 300, y: 0 })
    const graphDoc = {
      nodes: [novelNode, gsNode],
      edges: [
        {
          id: 'e1',
          source: novelNode.id,
          sourcePort: 'out-all',
          target: gsNode.id,
          targetPort: 'in'
        }
      ]
    }
    const sources = buildMentionSourcesForNode({
      graph: graphDoc,
      nodeId: gsNode.id,
      byId: new Map([
        [novelNode.id, novelNode],
        [gsNode.id, gsNode]
      ]),
      outputs: new Map()
    })
    const preview = buildInstructionFinalPromptPreview({
      kind: 'gameSystem',
      instructionRaw: '根据上游小说生成核心养成与副本挑战系统策划案',
      sources
    })

    expect(preview).toContain('上游小说 IP（asset.novel）➔ 游戏系统策划案')
    expect(preview).toContain('太初矿脉')
    expect(preview).toContain('青云大比')

    const generateText = vi.fn(async () => ({
      text: '# 系统概述\n修仙养成与宗门大比系统',
      model: 'm'
    }))
    const ctx = {
      node: {
        id: 'gs-1',
        typeId: 'asset.gameSystem',
        category: 'asset',
        assetType: 'gameSystem',
        title: '策划案生成',
        position: { x: 300, y: 0 },
        params: {
          generateInstruction: '结合小说剧情设计境界突破与宗门大比系统',
          gameSystemArchetype: 'rpg_progression_combat'
        }
      },
      inputs: {
        in: [
          {
            kind: 'texts',
            items: novelNode.params.generatedTexts
          }
        ]
      },
      generateText
    } as unknown as NodeExecuteContext

    await executeGameSystemGenerateNode(ctx)
    const sentPrompt = String(generateText.mock.calls[0]?.[0]?.prompt ?? '')
    expect(sentPrompt).toContain('上游小说 IP（asset.novel）➔ 游戏系统策划案')
    expect(sentPrompt).toContain('太初矿脉')
    expect(sentPrompt).toContain('青云大比')
  })
})
