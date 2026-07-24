import { describe, expect, it } from 'vitest'
import {
  isNodeTextCapable,
  resolveNodeTextContent,
  textFromGraphValue,
  type GraphNode
} from '../src/shared/graph'

function baseNode(partial: Partial<GraphNode> & Pick<GraphNode, 'id' | 'category'>): GraphNode {
  return {
    position: { x: 0, y: 0 },
    params: {},
    ...partial
  }
}

describe('graph text output', () => {
  it('extracts text, texts and output notes/texts from GraphValue', () => {
    expect(textFromGraphValue({ kind: 'text', text: 'hello' })).toBe('hello')
    expect(
      textFromGraphValue({
        kind: 'texts',
        items: [{ text: 'a' }, { text: 'b' }]
      })
    ).toBe('a\n\nb')
    expect(
      textFromGraphValue({
        kind: 'output',
        outputKind: 'text',
        items: [],
        notes: [
          { kind: 'text', text: 'a' },
          { kind: 'text', text: 'b' }
        ],
        params: {}
      })
    ).toBe('a\n\nb')
    expect(
      textFromGraphValue({
        kind: 'output',
        outputKind: 'text',
        items: [],
        notes: [],
        texts: [{ text: 'x' }, { text: 'y' }],
        params: {}
      })
    ).toBe('x\n\ny')
  })

  it('recognizes screenplay edit / text-output / note nodes', () => {
    expect(
      isNodeTextCapable(
        baseNode({
          id: 'n1',
          category: 'asset',
          assetType: 'screenplay',
          typeId: 'asset.screenplay'
        })
      )
    ).toBe(true)

    expect(
      isNodeTextCapable(
        baseNode({
          id: 'n2',
          category: 'output',
          typeId: 'output.text',
          params: { outputKind: 'text' }
        })
      )
    ).toBe(true)

    expect(
      isNodeTextCapable(
        baseNode({
          id: 'n3',
          category: 'note',
          typeId: 'note.text'
        })
      )
    ).toBe(true)
  })

  it('does not treat screenplay asset refs as text-preview capable', () => {
    expect(
      isNodeTextCapable(
        baseNode({
          id: 'ref',
          category: 'asset',
          assetType: 'screenplay',
          typeId: 'asset.screenplay',
          assetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          params: { assetRef: true }
        })
      )
    ).toBe(false)
  })

  it('prefers live run output, then persisted fields', () => {
    const screenplay = baseNode({
      id: 'edit',
      category: 'asset',
      assetType: 'screenplay',
      typeId: 'asset.screenplay',
      params: { text: 'saved' }
    })
    expect(resolveNodeTextContent(screenplay)?.text).toBe('saved')
    expect(
      resolveNodeTextContent(screenplay, {
        status: 'done',
        outputs: { out: { kind: 'texts', items: [{ text: 'live' }] } }
      })?.text
    ).toBe('live')

    const output = baseNode({
      id: 'out',
      category: 'output',
      typeId: 'output.text',
      params: { outputKind: 'text', resultText: 'result' }
    })
    expect(resolveNodeTextContent(output)).toEqual({
      text: 'result',
      field: 'resultText'
    })
  })
})
