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
          location: '街道',
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
    expect(result.out.kind).toBe('text')
    if (result.out.kind === 'text') {
      const rows = parseNarrativeUnitJson(result.out.text)
      expect(rows?.[0]?.title).toBe('开场')
    }
    expect(node.params.text).toContain('开场')
    expect(patchNode).toHaveBeenCalled()
  })

  it('falls back to upstream text without generateText', async () => {
    const node = createNodeFromType('narrative.split', { x: 0, y: 0 })
    node.params.generateInstruction = '拆解指令'
    const result = await executeNarrativeSplitNode(
      baseCtx({
        node,
        inputs: {
          in: [{ kind: 'text', text: '上游剧本' }]
        }
      })
    )
    expect(result.out).toEqual({ kind: 'text', text: '上游剧本' })
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
