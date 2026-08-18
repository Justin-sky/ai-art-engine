import { describe, expect, it, vi } from 'vitest'
import { createNodeFromType } from '../src/shared/graph'
import {
  executeBeatGenNode,
  executeBeatOutputNode,
  executeBeatTableNode
} from '../src/shared/graph/execute'
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

describe('beat table / editor execute', () => {
  it('table imports upstream JSON and passes through', async () => {
    const node = createNodeFromType('beat.table', { x: 0, y: 0 })
    const importBeatCatalogJson = vi.fn()
    const text = '[{"id":"beat-1","title":"场","order":1,"status":"未审核"}]'
    const result = await executeBeatTableNode(
      baseCtx({
        node,
        importBeatCatalogJson,
        inputs: { in: [{ kind: 'beat', text }] }
      })
    )
    expect(importBeatCatalogJson).toHaveBeenCalledWith(text)
    expect(result.out).toEqual({ kind: 'beat', text })
    expect(node.params.text).toBe(text)
  })

  it('gen collects unit texts and materializes to output path', async () => {
    const node = createNodeFromType('beat.gen', { x: 0, y: 0 })
    const importBeatCatalogJson = vi.fn()
    const saveRunText = vi.fn(async ({ key }) => `Texts/${key}.txt`)
    const patchNode = vi.fn()
    const collectBeatUnitTexts = vi.fn(async () => ({
      items: [
        {
          id: 'beat-2',
          title: '高潮',
          text: '雨停了。天台上对峙。'
        },
        {
          id: 'beat-3',
          title: '冲突升级',
          text: '2. 冲突升级\n\n单元二全文'
        }
      ]
    }))
    const text = JSON.stringify([
      {
        id: 'beat-2',
        title: '高潮',
        order: 2,
        time: '雨夜',
        durationHint: '短',
        location: '天台',
        locations: ['天台'],
        characters: ['林晓'],
        action: '林晓与对手对峙',
        conflict: '争夺证据',
        atmosphere: '雨声停止',
        props: [],
        weapons: [],
        sourceExcerpt: '雨停了。',
        status: '已审核'
      }
    ])
    const result = await executeBeatGenNode(
      baseCtx({
        node,
        importBeatCatalogJson,
        collectBeatUnitTexts,
        saveRunText,
        patchNode,
        inputs: { in: [{ kind: 'beat', text }] }
      })
    )
    expect(importBeatCatalogJson).toHaveBeenCalledWith(text)
    expect(collectBeatUnitTexts).toHaveBeenCalled()
    expect(saveRunText).toHaveBeenCalledTimes(2)
    // 文件名 = {资产名}_{单元标题}_{时间戳}[_{序号}]；无宿主名时资产段回落 Generated
    const keys = saveRunText.mock.calls.map((call) => call[0].key as string)
    expect(keys[0]).toMatch(/^Generated_高潮_\d{8}-\d{9}_1$/)
    expect(keys[1]).toMatch(/^Generated_冲突升级_\d{8}-\d{9}_2$/)
    expect(result.out?.kind).toBe('text')
    expect(result['out-all']?.kind).toBe('texts')
    if (result['out-all']?.kind === 'texts') {
      expect(result['out-all'].items).toHaveLength(2)
      expect(result['out-all'].items[0]?.id).toBe('beat-2')
      expect(result['out-all'].items[0]?.relativePath).toMatch(/Texts\/.+\.txt/)
      expect(result['out-all'].items[0]?.text).toBe('')
    }
    expect(node.params.generatedTexts).toHaveLength(2)
    expect(node.params.selectedTextId).toBeTruthy()
    expect(patchNode).toHaveBeenCalled()
  })

  it('gen derives file key from first line when title is missing', async () => {
    const node = createNodeFromType('beat.gen', { x: 0, y: 0 })
    const saveRunText = vi.fn(async ({ key }) => `Texts/${key}.txt`)
    await executeBeatGenNode(
      baseCtx({
        node,
        saveRunText,
        collectBeatUnitTexts: async () => ({
          items: [{ id: 'beat-x', text: '3. 雨夜对峙\n\n正文' }]
        })
      })
    )
    // 无 title 时取首行去掉序号前缀作为单元名；单条不带序号后缀
    expect(saveRunText).toHaveBeenCalledTimes(1)
    expect(saveRunText.mock.calls[0]?.[0].key).toMatch(/^Generated_雨夜对峙_\d{8}-\d{9}$/)
  })

  it('gen without collect returns empty texts', async () => {
    const node = createNodeFromType('beat.gen', { x: 0, y: 0 })
    const result = await executeBeatGenNode(baseCtx({ node }))
    expect(result.out).toEqual({ kind: 'text', text: '' })
    expect(result['out-all']).toEqual({ kind: 'texts', items: [] })
    expect(node.params.generatedTexts).toEqual([])
  })

  it('beat output node only passes through texts', async () => {
    const node = createNodeFromType('output.beat', { x: 0, y: 0 })
    const saveRunText = vi.fn(async () => 'Texts/x.txt')
    const result = await executeBeatOutputNode(
      baseCtx({
        node,
        saveRunText,
        inputs: {
          in: [
            {
              kind: 'texts',
              items: [
                { id: 'beat-1', title: '开场', text: '正文', relativePath: 'Texts/开场.txt' }
              ]
            }
          ]
        }
      })
    )
    expect(saveRunText).not.toHaveBeenCalled()
    expect(result.out?.kind).toBe('output')
    if (result.out?.kind === 'output') {
      expect(result.out.texts?.[0]?.relativePath).toBe('Texts/开场.txt')
    }
  })
})
