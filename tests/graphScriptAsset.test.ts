import { describe, expect, it } from 'vitest'
import {
  canConnectNodes,
  createDefaultScopedGraph,
  createNodeFromType,
  createOutputGraphNode,
  getNodePorts,
  listAddableNodeTypes,
  normalizeScopedGraph
} from '../src/shared/graph'
import {
  GRAPH_SCRIPT_SHOT_EDITOR_NODE_ID,
  GRAPH_SCRIPT_SHOT_SPLIT_NODE_ID,
  GRAPH_SCRIPT_SHOT_TABLE_NODE_ID,
  graphOutputNodeId
} from '../src/shared/graph/types'

const VIDEO_OUTPUT_ID = graphOutputNodeId('video')

describe('script asset graph', () => {
  it('creates default launcher nodes and script output', () => {
    const doc = createDefaultScopedGraph('scriptAsset', 'script')
    expect(doc.nodes.some((n) => n.id === GRAPH_SCRIPT_SHOT_SPLIT_NODE_ID)).toBe(true)
    expect(doc.nodes.some((n) => n.id === GRAPH_SCRIPT_SHOT_TABLE_NODE_ID)).toBe(true)
    expect(doc.nodes.some((n) => n.id === GRAPH_SCRIPT_SHOT_EDITOR_NODE_ID)).toBe(true)
    expect(doc.nodes.some((n) => n.typeId === 'script.visual')).toBe(false)
    const output = doc.nodes.find((n) => n.id === VIDEO_OUTPUT_ID)
    expect(output?.params.outputKind).toBe('video')
    expect(output?.params.inputDataType).toBe('videos')

    const split = doc.nodes.find((n) => n.typeId === 'script.shotSplit')
    const table = doc.nodes.find((n) => n.typeId === 'script.shotTable')
    const editor = doc.nodes.find((n) => n.typeId === 'script.shotEditor')
    expect(doc.nodes.some((n) => n.typeId === 'play.script')).toBe(false)
    expect(
      doc.edges.some((edge) => edge.source === split?.id && edge.target === table?.id)
    ).toBe(true)
    expect(
      doc.edges.some((edge) => edge.source === table?.id && edge.target === editor?.id)
    ).toBe(true)
    expect(
      doc.edges.some((edge) => edge.source === editor?.id && edge.target === output?.id)
    ).toBe(true)
  })

  it('exposes launcher nodes in script asset menu', () => {
    const typeIds = listAddableNodeTypes('scriptAsset').map((def) => def.typeId)
    expect(typeIds).toContain('script.shotSplit')
    expect(typeIds).toContain('script.shotTable')
    expect(typeIds).toContain('script.shotEditor')
    expect(typeIds).not.toContain('script.visual')
    expect(typeIds).toContain('note.text')
    expect(typeIds).toContain('play.script')
  })

  it('normalizes empty script asset graph', () => {
    const doc = normalizeScopedGraph('scriptAsset', null, { assetType: 'script' })
    expect(doc.nodes.some((n) => n.typeId === 'script.shotSplit')).toBe(true)
    expect(doc.nodes.some((n) => n.typeId === 'script.shotTable')).toBe(true)
    expect(doc.nodes.some((n) => n.typeId === 'script.shotEditor')).toBe(true)
    expect(doc.nodes.some((n) => n.typeId === 'script.visual')).toBe(false)
    expect(doc.nodes.some((n) => n.category === 'output')).toBe(true)
  })

  it('does not migrate legacy graphs by inserting a shot table', () => {
    const split = createNodeFromType('script.shotSplit', { x: 120, y: 160 }, {
      id: GRAPH_SCRIPT_SHOT_SPLIT_NODE_ID
    })
    const editor = createNodeFromType('script.shotEditor', { x: 340, y: 160 }, {
      id: GRAPH_SCRIPT_SHOT_EDITOR_NODE_ID
    })
    const output = createOutputGraphNode('video', { x: 560, y: 160 }, {
      id: VIDEO_OUTPUT_ID
    })
    const doc = normalizeScopedGraph(
      'scriptAsset',
      {
        nodes: [split, editor, output],
        edges: [
          {
            id: 'e-out',
            source: editor.id,
            target: output.id,
            sourcePort: 'out',
            targetPort: 'in'
          }
        ],
        groups: [],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      { assetType: 'script' }
    )
    expect(doc.nodes.some((n) => n.typeId === 'script.shotTable')).toBe(false)
  })

  it('only accepts the intended chain port types', () => {
    const text = createNodeFromType('play.script', { x: 0, y: 0 })
    const split = createNodeFromType('script.shotSplit', { x: 200, y: 0 })
    const table = createNodeFromType('script.shotTable', { x: 400, y: 0 })
    const editor = createNodeFromType('script.shotEditor', { x: 600, y: 0 })
    const note = createNodeFromType('note.text', { x: 0, y: 100 })

    expect(getNodePorts(split).map((port) => port.dataType)).toEqual(['text', 'text'])
    expect(getNodePorts(table).map((port) => port.dataType)).toEqual(['text', 'text'])
    expect(getNodePorts(editor).map((port) => port.dataType)).toEqual(['text', 'videos'])
    const output = createOutputGraphNode('video', { x: 800, y: 0 }, {
      id: VIDEO_OUTPUT_ID,
      params: { outputKind: 'video', inputDataType: 'videos' }
    })
    expect(getNodePorts(output).map((port) => ({ id: port.id, dataType: port.dataType, direction: port.direction }))).toEqual([
      { id: 'in', dataType: 'videos', direction: 'in' }
    ])
    expect(canConnectNodes(text, split)).toBe(true)
    expect(canConnectNodes(note, split)).toBe(false)
    expect(canConnectNodes(split, table)).toBe(true)
    expect(canConnectNodes(table, editor)).toBe(true)
    expect(canConnectNodes(split, editor)).toBe(true)
    expect(canConnectNodes(text, editor)).toBe(true)
    expect(canConnectNodes(editor, output)).toBe(true)
  })
})
