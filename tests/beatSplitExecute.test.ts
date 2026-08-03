import { describe, expect, it, vi } from 'vitest'
import { createNodeFromType } from '../src/shared/graph'
import { executeBeatSplitNode } from '../src/shared/graph/execute/values'
import type { NodeExecuteContext } from '../src/shared/graph/execute/types'
import { parseBeatJson } from '../src/shared/graph/beatParse'

function baseCtx(
  overrides: Partial<NodeExecuteContext> & { node: NodeExecuteContext['node'] }
): NodeExecuteContext {
  return {
    inputs: {},
    locale: 'zh-CN',
    ...overrides
  }
}

describe('executeBeatSplitNode', () => {
  it('calls generateText and writes parsed JSON to params.text', async () => {
    const node = createNodeFromType('beat.split', { x: 0, y: 0 })
    const generateText = vi.fn(async () => ({
      text: JSON.stringify([
        {
          id: 'beat-1',
          title: '开场',
          order: 1,
          time: '雨夜',
          durationHint: '中',
          location: '街道',
          locations: ['街道'],
          characters: ['林晓'],
          action: '林晓登场',
          conflict: '',
          atmosphere: '雨声',
          props: [],
          weapons: [],
          sourceExcerpt: '……',
          status: '未审核'
        }
      ]),
      model: 'mock'
    }))
    const patchNode = vi.fn()

    const result = await executeBeatSplitNode(
      baseCtx({
        node,
        generateText,
        patchNode,
        inputs: {
          in: [{ kind: 'text', text: '林晓走在雨夜街道上。' }]
        }
      })
    )

    expect(generateText).toHaveBeenCalled()
    expect(result.out.kind).toBe('beat')
    if (result.out.kind === 'beat') {
      const rows = parseBeatJson(result.out.text)
      expect(rows?.[0]?.title).toBe('开场')
    }
    expect(result['out-all']?.kind).toBe('texts')
    expect(node.params.text).toContain('开场')
    expect(node.params.generatedTexts?.length).toBeGreaterThan(0)
    expect(node.params.selectedTextId).toBeTruthy()
    expect(patchNode).toHaveBeenCalled()
  })

  it('keeps catalog JSON inline in gallery even after saveRunText', async () => {
    const catalog = JSON.stringify([
      {
        id: 'beat-1',
        title: '开场',
        order: 1,
        status: '未审核'
      }
    ])
    const node = createNodeFromType('beat.split', { x: 0, y: 0 })
    const result = await executeBeatSplitNode(
      baseCtx({
        node,
        generateText: vi.fn(async () => ({ text: catalog, model: 'mock' })),
        saveRunText: vi.fn(async () => 'Texts/beat_split_1.txt'),
        patchNode: vi.fn(),
        inputs: {
          in: [{ kind: 'text', text: '林晓走在雨夜街道上。' }]
        }
      })
    )
    expect(result.out.kind).toBe('beat')
    if (result.out.kind === 'beat') {
      expect(result.out.text).toContain('开场')
    }
    const galleryText = node.params.generatedTexts?.[0]?.text ?? ''
    expect(galleryText).toContain('开场')
    expect(node.params.generatedTexts?.[0]?.relativePath).toBe('Texts/beat_split_1.txt')
  })

  it('without generateText outputs local catalog, not upstream screenplay', async () => {
    const catalog = '[{"id":"beat-1","title":"本地","order":1,"status":"未审核"}]'
    const node = createNodeFromType('beat.split', { x: 0, y: 0 }, {
      params: {
        text: catalog,
        generatedTexts: [{ id: 'local', text: catalog }],
        selectedTextId: 'local',
        generateInstruction: '拆解指令'
      }
    })
    const result = await executeBeatSplitNode(
      baseCtx({
        node,
        inputs: {
          in: [{ kind: 'text', text: '上游剧本' }]
        }
      })
    )
    expect(result.out).toEqual({
      kind: 'beat',
      text: catalog
    })
    expect(result['out-all']?.kind).toBe('texts')
  })

  it('throws when generateText has no upstream screenplay text', async () => {
    const node = createNodeFromType('beat.split', { x: 0, y: 0 })
    await expect(
      executeBeatSplitNode(
        baseCtx({
          node,
          generateText: vi.fn(async () => ({ text: '[]', model: 'mock' })),
          inputs: {}
        })
      )
    ).rejects.toThrow('GRAPH_PROCESS_NO_INPUT')
  })
})
