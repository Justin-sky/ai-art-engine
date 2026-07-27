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
  GRAPH_OUTPUT_NODE_IDS,
  GRAPH_SCRIPT_SHOT_IMAGE_GEN_NODE_ID,
  GRAPH_SCRIPT_SHOT_SPLIT_NODE_ID,
  GRAPH_SCRIPT_SHOT_TABLE_NODE_ID,
  GRAPH_SCRIPT_SHOT_VIDEO_GEN_NODE_ID,
  graphOutputNodeId
} from '../src/shared/graph/types'

const TIMELINE_OUTPUT_ID = GRAPH_OUTPUT_NODE_IDS.timeline
const VIDEO_OUTPUT_ID = graphOutputNodeId('video')

describe('script asset graph', () => {
  it('creates default launcher nodes and script output', () => {
    const doc = createDefaultScopedGraph('scriptAsset', 'script')
    expect(doc.nodes.some((n) => n.id === GRAPH_SCRIPT_SHOT_SPLIT_NODE_ID)).toBe(true)
    expect(doc.nodes.some((n) => n.id === GRAPH_SCRIPT_SHOT_TABLE_NODE_ID)).toBe(true)
    expect(doc.nodes.some((n) => n.id === GRAPH_SCRIPT_SHOT_IMAGE_GEN_NODE_ID)).toBe(true)
    expect(doc.nodes.some((n) => n.id === GRAPH_SCRIPT_SHOT_VIDEO_GEN_NODE_ID)).toBe(true)
    expect(doc.nodes.some((n) => n.typeId === 'script.visual')).toBe(false)
    const output = doc.nodes.find((n) => n.id === TIMELINE_OUTPUT_ID)
    expect(output?.typeId).toBe('output.timeline')
    expect(output?.params.outputKind).toBe('video')
    expect(output?.params.inputDataType).toBe('video')

    const split = doc.nodes.find((n) => n.typeId === 'script.shotSplit')
    const table = doc.nodes.find((n) => n.typeId === 'script.shotTable')
    const imageGen = doc.nodes.find((n) => n.typeId === 'script.shotImageGen')
    const videoGen = doc.nodes.find((n) => n.typeId === 'script.shotVideoGen')
    expect(doc.nodes.some((n) => n.typeId === 'play.script')).toBe(false)
    expect(
      doc.edges.some((edge) => edge.source === split?.id && edge.target === table?.id)
    ).toBe(true)
    expect(
      doc.edges.some(
        (edge) =>
          edge.source === table?.id &&
          edge.target === imageGen?.id &&
          (edge.targetPort ?? 'in') === 'in'
      )
    ).toBe(true)
    expect(
      doc.edges.some(
        (edge) =>
          edge.source === table?.id &&
          edge.target === videoGen?.id &&
          edge.targetPort === 'in-text'
      )
    ).toBe(true)
    expect(
      doc.edges.some(
        (edge) =>
          edge.source === imageGen?.id &&
          edge.target === videoGen?.id &&
          edge.targetPort === 'in-image'
      )
    ).toBe(true)
    expect(
      doc.edges.some((edge) => edge.source === videoGen?.id && edge.target === output?.id)
    ).toBe(true)
  })

  it('exposes launcher nodes in script asset menu', () => {
    const typeIds = listAddableNodeTypes('scriptAsset').map((def) => def.typeId)
    expect(typeIds).toContain('script.shotSplit')
    expect(typeIds).toContain('script.shotTable')
    expect(typeIds).toContain('script.shotImageGen')
    expect(typeIds).toContain('script.shotVideoGen')
    expect(typeIds).not.toContain('script.shotEditor')
    expect(typeIds).not.toContain('script.visual')
    expect(typeIds).toContain('note.text')
    expect(typeIds).toContain('play.script')
  })

  it('normalizes empty script asset graph', () => {
    const doc = normalizeScopedGraph('scriptAsset', null, { assetType: 'script' })
    expect(doc.nodes.some((n) => n.typeId === 'script.shotSplit')).toBe(true)
    expect(doc.nodes.some((n) => n.typeId === 'script.shotTable')).toBe(true)
    expect(doc.nodes.some((n) => n.typeId === 'script.shotImageGen')).toBe(true)
    expect(doc.nodes.some((n) => n.typeId === 'script.shotVideoGen')).toBe(true)
    expect(doc.nodes.some((n) => n.typeId === 'script.visual')).toBe(false)
    expect(doc.nodes.some((n) => n.category === 'output')).toBe(true)
  })

  it('migrates legacy shotEditor to shotVideoGen without inserting image gen', () => {
    const split = createNodeFromType('script.shotSplit', { x: 120, y: 160 }, {
      id: GRAPH_SCRIPT_SHOT_SPLIT_NODE_ID
    })
    const editor = {
      ...createNodeFromType('script.shotVideoGen', { x: 340, y: 160 }, {
        id: 'script-shot-editor'
      }),
      typeId: 'script.shotEditor' as const,
      title: 'Shot edit'
    }
    const output = createOutputGraphNode('video', { x: 560, y: 160 }, {
      id: VIDEO_OUTPUT_ID
    })
    const doc = normalizeScopedGraph(
      'scriptAsset',
      {
        nodes: [split, editor, output],
        edges: [
          {
            id: 'e-split',
            source: split.id,
            target: editor.id,
            sourcePort: 'out',
            targetPort: 'in'
          },
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
    expect(doc.nodes.some((n) => n.typeId === 'script.shotImageGen')).toBe(false)
    expect(doc.nodes.some((n) => n.typeId === 'script.shotEditor')).toBe(false)
    const videoGen = doc.nodes.find((n) => n.typeId === 'script.shotVideoGen')
    expect(videoGen?.id).toBe(GRAPH_SCRIPT_SHOT_VIDEO_GEN_NODE_ID)
    expect(
      doc.edges.some(
        (edge) =>
          edge.source === split.id &&
          edge.target === videoGen?.id &&
          edge.targetPort === 'in-text'
      )
    ).toBe(true)
  })

  it('only accepts the intended chain port types', () => {
    const text = createNodeFromType('play.script', { x: 0, y: 0 })
    const split = createNodeFromType('script.shotSplit', { x: 200, y: 0 })
    const table = createNodeFromType('script.shotTable', { x: 400, y: 0 })
    const imageGen = createNodeFromType('script.shotImageGen', { x: 600, y: 0 })
    const videoGen = createNodeFromType('script.shotVideoGen', { x: 800, y: 0 })
    const note = createNodeFromType('note.text', { x: 0, y: 100 })

    expect(getNodePorts(split).map((port) => port.dataType)).toEqual(['text', 'text'])
    expect(getNodePorts(table).map((port) => port.dataType)).toEqual(['text', 'text'])
    expect(getNodePorts(imageGen).map((port) => port.dataType)).toEqual(['text', 'image'])
    expect(
      getNodePorts(videoGen).map((port) => ({ id: port.id, dataType: port.dataType, direction: port.direction }))
    ).toEqual([
      { id: 'in-text', dataType: 'text', direction: 'in' },
      { id: 'in-image', dataType: 'image', direction: 'in' },
      { id: 'out', dataType: 'video', direction: 'out' }
    ])
    const output = createOutputGraphNode('video', { x: 1000, y: 0 }, {
      id: VIDEO_OUTPUT_ID,
      params: { outputKind: 'video', inputDataType: 'video' }
    })
    expect(getNodePorts(output).map((port) => ({ id: port.id, dataType: port.dataType, direction: port.direction }))).toEqual([
      { id: 'in', dataType: 'video', direction: 'in' }
    ])
    expect(canConnectNodes(text, split)).toBe(true)
    expect(canConnectNodes(note, split)).toBe(false)
    expect(canConnectNodes(split, table)).toBe(true)
    expect(canConnectNodes(table, imageGen)).toBe(true)
    expect(
      canConnectNodes(table, videoGen, { sourcePort: 'out', targetPort: 'in-text' })
    ).toBe(true)
    expect(
      canConnectNodes(imageGen, videoGen, { sourcePort: 'out', targetPort: 'in-image' })
    ).toBe(true)
    expect(canConnectNodes(split, imageGen)).toBe(true)
    expect(canConnectNodes(text, imageGen)).toBe(true)
    expect(canConnectNodes(videoGen, output)).toBe(true)
  })
})
