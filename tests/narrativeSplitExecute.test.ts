import { describe, expect, it, vi } from 'vitest'
import { createNodeFromType } from '../src/shared/graph'
import { executeNarrativeSplitNode } from '../src/shared/graph/execute/values'
import type { NodeExecuteContext } from '../src/shared/graph/execute/types'
import { parseNarrativeUnitJson } from '../src/shared/graph/narrativeUnitParse'

function baseCtx(
  overrides: Partial<NodeExecuteContext> & { node: NodeExecuteContext['node'] }
): NodeExecuteContext {
  return {
    inputs: {},
    locale: 'zh-CN',
    ...overrides
  }
}

describe('executeNarrativeSplitNode', () => {
  it('calls generateText and writes parsed JSON to params.text', async () => {
    const node = createNodeFromType('narrative.split', { x: 0, y: 0 })
    const generateText = vi.fn(async () => ({
      text: JSON.stringify([
        {
          id: 'nu-1',
          title: '开场',
          order: 1,
          summary: '登场',
          dramaticFunction: '建置',
          characters: ['林晓'],
          scenes: ['街道'],
          props: [],
          weapons: [],
          sourceExcerpt: '……',
          emotionalBeat: '平静',
          durationHint: '中',
          status: '未审核'
        }
      ]),
      model: 'mock'
    }))
    const patchNode = vi.fn()

    const result = await executeNarrativeSplitNode(
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
    expect(result.out.kind).toBe('narrative')
    if (result.out.kind === 'narrative') {
      const rows = parseNarrativeUnitJson(result.out.text)
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
        id: 'nu-1',
        title: '开场',
        order: 1,
        status: '未审核'
      }
    ])
    const node = createNodeFromType('narrative.split', { x: 0, y: 0 })
    const result = await executeNarrativeSplitNode(
      baseCtx({
        node,
        generateText: vi.fn(async () => ({ text: catalog, model: 'mock' })),
        saveRunText: vi.fn(async () => 'Texts/narrative_split_1.txt'),
        patchNode: vi.fn(),
        inputs: {
          in: [{ kind: 'text', text: '林晓走在雨夜街道上。' }]
        }
      })
    )
    expect(result.out.kind).toBe('narrative')
    if (result.out.kind === 'narrative') {
      expect(result.out.text).toContain('开场')
    }
    const galleryText = node.params.generatedTexts?.[0]?.text ?? ''
    expect(galleryText).toContain('开场')
    expect(node.params.generatedTexts?.[0]?.relativePath).toBe('Texts/narrative_split_1.txt')
  })

  it('without generateText outputs local catalog, not upstream screenplay', async () => {
    const catalog = '[{"id":"nu-1","title":"本地","order":1,"status":"未审核"}]'
    const node = createNodeFromType('narrative.split', { x: 0, y: 0 }, {
      params: {
        text: catalog,
        generatedTexts: [{ id: 'local', text: catalog }],
        selectedTextId: 'local',
        generateInstruction: '拆解指令'
      }
    })
    const result = await executeNarrativeSplitNode(
      baseCtx({
        node,
        inputs: {
          in: [{ kind: 'text', text: '上游剧本' }]
        }
      })
    )
    expect(result.out).toEqual({
      kind: 'narrative',
      text: catalog
    })
    expect(result['out-all']?.kind).toBe('texts')
  })

  it('throws when generateText has no upstream screenplay text', async () => {
    const node = createNodeFromType('narrative.split', { x: 0, y: 0 })
    await expect(
      executeNarrativeSplitNode(
        baseCtx({
          node,
          generateText: vi.fn(async () => ({ text: '[]', model: 'mock' })),
          inputs: {}
        })
      )
    ).rejects.toThrow('GRAPH_PROCESS_NO_INPUT')
  })
})
