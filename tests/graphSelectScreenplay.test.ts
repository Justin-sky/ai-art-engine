import { describe, expect, it, vi } from 'vitest'
import {
  canConnectNodes,
  createNodeFromType,
  executeSelectScreenplayNode,
  getNodePorts,
  GraphPortType,
  pickTextItem,
  textItemKey,
  type GraphTextItem,
  type NodeExecuteContext
} from '../src/shared/graph'

describe('screenplay.select node', () => {
  it('has text in and text out ports', () => {
    const node = createNodeFromType('screenplay.select', { x: 0, y: 0 })
    const ports = getNodePorts(node)
    expect(ports.map((p) => [p.direction, p.dataType])).toEqual([
      ['in', GraphPortType.text],
      ['out', GraphPortType.text]
    ])
  })

  it('connects from screenplay generate and into narrative split', () => {
    const generate = createNodeFromType('asset.screenplay', { x: 0, y: 0 })
    const select = createNodeFromType('screenplay.select', { x: 120, y: 0 })
    const narrative = createNodeFromType('narrative.split', { x: 240, y: 0 })
    expect(canConnectNodes(generate, select)).toBe(true)
    expect(canConnectNodes(select, narrative)).toBe(true)
    expect(canConnectNodes(generate, narrative)).toBe(true)
  })

  it('defaults to the first text and can pick by id', () => {
    const items: GraphTextItem[] = [
      { id: 'a', text: '剧本A' },
      { id: 'b', text: '剧本B' }
    ]
    expect(pickTextItem(items)?.id).toBe('a')
    expect(pickTextItem(items, 'b')?.id).toBe('b')
    expect(textItemKey(items[1]!, 1)).toBe('b')
  })

  it('execute outputs the selected single text and hydrates relativePath', async () => {
    const node = createNodeFromType('screenplay.select', { x: 0, y: 0 }, {
      params: { selectedTextId: 'b' }
    })
    const patched: Record<string, unknown>[] = []
    const ctx: NodeExecuteContext = {
      node,
      inputs: {
        in: [
          {
            kind: 'texts',
            items: [
              { id: 'a', text: '剧本A' },
              { id: 'b', text: '', relativePath: 'Texts/b.txt' }
            ]
          }
        ]
      },
      readRunText: vi.fn(async () => '落盘剧本B'),
      patchNode: (patch) => {
        patched.push(patch.params ?? {})
      }
    }
    const result = await executeSelectScreenplayNode(ctx)
    expect(result.out).toEqual({ kind: 'text', text: '落盘剧本B' })
    expect(patched[0]).toMatchObject({
      selectedTextId: 'b',
      text: '落盘剧本B',
      previewRelativePath: 'Texts/b.txt'
    })
  })
})
