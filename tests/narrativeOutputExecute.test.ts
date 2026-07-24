import { describe, expect, it, vi } from 'vitest'
import { createNodeFromType } from '../src/shared/graph'
import { executeNarrativeOutputNode } from '../src/shared/graph/execute/values'
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

describe('executeNarrativeOutputNode', () => {
  it('persists each texts item as a screenplay path', async () => {
    const node = createNodeFromType('output.narrative', { x: 0, y: 0 })
    const saveRunText = vi.fn(async ({ key }) => `Texts/${key}.txt`)
    const patchNode = vi.fn()

    const result = await executeNarrativeOutputNode(
      baseCtx({
        node,
        saveRunText,
        patchNode,
        inputs: {
          in: [
            {
              kind: 'texts',
              items: [
                { id: 'nu-1', title: '开场建置', text: '1. 开场建置\n\n单元一全文' },
                { id: 'nu-2', title: '冲突升级', text: '2. 冲突升级\n\n单元二全文' }
              ]
            }
          ]
        }
      })
    )

    expect(saveRunText).toHaveBeenCalledTimes(2)
    expect(saveRunText).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ key: '开场建置' })
    )
    expect(saveRunText).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ key: '冲突升级' })
    )
    expect(result.out?.kind).toBe('output')
    if (result.out?.kind === 'output') {
      expect(result.out.texts).toHaveLength(2)
      expect(result.out.texts?.[0]?.relativePath).toMatch(/Texts\/.+\.txt/)
      expect(result.out.texts?.[0]?.text).toBe('')
      expect(result.out.texts?.[0]?.title).toBe('开场建置')
    }
    expect(node.params.generatedTexts).toHaveLength(2)
    expect(patchNode).toHaveBeenCalled()
  })

  it('derives file key from first line when title is missing', async () => {
    const node = createNodeFromType('output.narrative', { x: 0, y: 0 })
    const saveRunText = vi.fn(async ({ key }) => `Texts/${key}.txt`)

    await executeNarrativeOutputNode(
      baseCtx({
        node,
        saveRunText,
        inputs: {
          in: [
            {
              kind: 'texts',
              items: [{ id: 'nu-x', text: '3. 雨夜对峙\n\n正文' }]
            }
          ]
        }
      })
    )

    expect(saveRunText).toHaveBeenCalledWith(
      expect.objectContaining({ key: '雨夜对峙' })
    )
  })

  it('throws when upstream texts are empty', async () => {
    const node = createNodeFromType('output.narrative', { x: 0, y: 0 })
    await expect(
      executeNarrativeOutputNode(
        baseCtx({
          node,
          saveRunText: vi.fn(async () => 'Texts/x.txt'),
          inputs: { in: [{ kind: 'texts', items: [] }] }
        })
      )
    ).rejects.toThrow('GRAPH_PROCESS_NO_INPUT')
  })
})
