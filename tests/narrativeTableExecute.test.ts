import { describe, expect, it, vi } from 'vitest'
import { createNodeFromType } from '../src/shared/graph'
import {
  executeNarrativeEditorNode,
  executeNarrativeTableNode
} from '../src/shared/graph/execute/values'
import type { NodeExecuteContext } from '../src/shared/graph/execute/types'

function baseCtx(
  overrides: Partial<NodeExecuteContext> & { node: NodeExecuteContext['node'] }
): NodeExecuteContext {
  return {
    inputs: {},
    locale: 'zh-CN',
    ...overrides
  }
}

describe('narrative table / editor execute', () => {
  it('table imports upstream JSON and passes through', async () => {
    const node = createNodeFromType('narrative.table', { x: 0, y: 0 })
    const importNarrativeCatalogJson = vi.fn()
    const text = '[{"id":"nu-1","title":"节拍","order":1,"status":"未审核"}]'
    const result = await executeNarrativeTableNode(
      baseCtx({
        node,
        importNarrativeCatalogJson,
        inputs: { in: [{ kind: 'text', text }] }
      })
    )
    expect(importNarrativeCatalogJson).toHaveBeenCalledWith(text)
    expect(result.out).toEqual({ kind: 'text', text })
    expect(node.params.text).toBe(text)
  })

  it('editor applies upstream catalog JSON and outputs texts array', async () => {
    const node = createNodeFromType('narrative.editor', { x: 0, y: 0 })
    const importNarrativeCatalogJson = vi.fn()
    const text = JSON.stringify([
      {
        id: 'nu-2',
        title: '高潮',
        order: 2,
        summary: '对峙',
        dramaticFunction: '高潮',
        characters: ['林晓'],
        location: '天台',
        sourceExcerpt: '雨停了。',
        emotionalBeat: '决绝',
        durationHint: '短',
        status: '已审核'
      }
    ])
    const result = await executeNarrativeEditorNode(
      baseCtx({
        node,
        importNarrativeCatalogJson,
        inputs: { in: [{ kind: 'text', text }] }
      })
    )
    expect(importNarrativeCatalogJson).toHaveBeenCalledWith(text)
    expect(result.out?.kind).toBe('texts')
    if (result.out?.kind === 'texts') {
      expect(result.out.items).toHaveLength(1)
      expect(result.out.items[0]?.id).toBe('nu-2')
      expect(result.out.items[0]?.text).toContain('高潮')
      expect(result.out.items[0]?.text).toContain('雨停了。')
    }
  })
})
