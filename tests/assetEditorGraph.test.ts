import { describe, expect, it } from 'vitest'
import {
  boundaryInputNodeId,
  boundaryOutputNodeId,
  canConnectNodes,
  createAssetGraphNode,
  createDefaultScopedGraph,
  createNodeFromType,
  createOutputGraphNode,
  getNodePorts,
  isAssetRefNode,
  isNodeDeletable,
  isProcessingAssetNode,
  normalizeAssetGraph,
  normalizeScopedGraph
} from '../src/shared/graph'
import { graphOutputNodeId } from '../src/shared/graph/types'

const IMAGE_OUTPUT_ID = graphOutputNodeId('image')
const VIDEO_OUTPUT_ID = graphOutputNodeId('video')
const VOICE_OUTPUT_ID = graphOutputNodeId('voice')
const TEXT_OUTPUT_ID = graphOutputNodeId('text')
const BOUNDARY_OUTPUT_ID = boundaryOutputNodeId('out')

describe('asset editor graph', () => {
  it('creates default workflow graph with processing node wired to boundary output', () => {
    const doc = createDefaultScopedGraph('workflow', 'image')
    const processing = doc.nodes.find((node) => node.typeId === 'asset.image')
    expect(processing && isProcessingAssetNode(processing)).toBe(true)
    expect(doc.nodes.some((node) => node.category === 'output')).toBe(false)
    expect(doc.nodes.some((node) => node.id === BOUNDARY_OUTPUT_ID)).toBe(true)
    expect(
      doc.edges.some(
        (edge) => edge.source === processing?.id && edge.target === BOUNDARY_OUTPUT_ID
      )
    ).toBe(true)
  })

  it('binds imported media host as asset-ref without input ports', () => {
    const hosts = {
      image: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      video: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      voice: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    } as const
    for (const type of ['image', 'video', 'voice'] as const) {
      const doc = createDefaultScopedGraph('workflow', type, {
        hostAssetId: hosts[type],
        hasMediaFile: true
      })
      const host = doc.nodes.find((node) => node.typeId === `asset.${type}`)
      expect(host && isAssetRefNode(host)).toBe(true)
      expect(host?.assetId).toBe(hosts[type])
      expect(getNodePorts(host!).some((port) => port.direction === 'in')).toBe(false)
      expect(doc.nodes.some((node) => node.category === 'output')).toBe(false)
      expect(doc.edges.some((edge) => edge.source === host?.id && edge.target === BOUNDARY_OUTPUT_ID)).toBe(
        true
      )
      expect(
        doc.nodes.some((node) => node.typeId === `asset.${type}` && isProcessingAssetNode(node))
      ).toBe(false)
    }
  })

  it('converts legacy processing node to host media ref on normalize', () => {
    const hostId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const processing = createNodeFromType('asset.voice', { x: 200, y: 0 }, { id: 'audio-edit-1' })
    const output = createOutputGraphNode('voice', { x: 400, y: 0 }, {
      id: VOICE_OUTPUT_ID,
      params: { outputKind: 'voice' }
    })
    const reloaded = normalizeAssetGraph(
      {
        nodes: [processing, output],
        edges: [
          {
            id: 'e1',
            source: 'audio-edit-1',
            target: VOICE_OUTPUT_ID,
            sourcePort: 'out',
            targetPort: 'in'
          }
        ],
        groups: [],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      'voice',
      { hostAssetId: hostId, hasMediaFile: true }
    )
    const host = reloaded.nodes.find((node) => node.id === 'audio-edit-1')
    expect(host && isAssetRefNode(host)).toBe(true)
    expect(host?.assetId).toBe(hostId)
    expect(getNodePorts(host!).some((port) => port.direction === 'in')).toBe(false)
  })

  it('creates default image asset graph with processing wired to boundary output', () => {
    const doc = createDefaultScopedGraph('workflow', 'image')
    const processing = doc.nodes.find((node) => node.typeId === 'asset.image')
    expect(processing && isProcessingAssetNode(processing)).toBe(true)
    expect(doc.nodes.some((node) => node.category === 'output')).toBe(false)
    expect(doc.nodes.some((node) => node.id === BOUNDARY_OUTPUT_ID)).toBe(true)
    expect(
      doc.edges.some(
        (edge) => edge.source === processing?.id && edge.target === BOUNDARY_OUTPUT_ID
      )
    ).toBe(true)
  })

  it('creates default director asset graph without classic output', () => {
    const doc = createDefaultScopedGraph('directorAsset', 'motion')
    const processing = doc.nodes.find((node) => node.typeId === 'asset.motion')
    expect(processing && isProcessingAssetNode(processing)).toBe(true)
    expect(doc.nodes.some((node) => node.category === 'output')).toBe(false)
    expect(doc.edges).toHaveLength(0)
  })

  it('creates default screenplay asset graph with boundary output and without text.select', () => {
    const doc = createDefaultScopedGraph('screenplayAsset', 'screenplay')
    const processing = doc.nodes.find((node) => node.typeId === 'asset.screenplay')
    const select = doc.nodes.find((node) => node.typeId === 'text.select')
    const beat = doc.nodes.find(
      (node) => node.typeId === 'beat.split'
    )
    const output = doc.nodes.find((node) => node.id === BOUNDARY_OUTPUT_ID)
    expect(processing && isProcessingAssetNode(processing)).toBe(true)
    expect(select).toBeUndefined()
    expect(beat).toBeUndefined()
    expect(output?.typeId).toBe('graph.boundary.output')
    expect(doc.nodes.some((node) => node.category === 'output')).toBe(false)
    expect(getNodePorts(output!).map((p) => [p.direction, p.dataType])).toEqual([
      ['in', 'text']
    ])
    expect(doc.edges.some((edge) => edge.source === processing?.id && edge.target === output?.id)).toBe(
      true
    )
  })

  it('normalize screenplay asset creates boundary input (HDA)', () => {
    const doc = normalizeScopedGraph('screenplayAsset', null, {
      assetType: 'screenplay',
      hostAssetId: '00000000-0000-4000-8000-000000000301'
    })
    const boundaryIn = doc.nodes.find((n) => n.typeId === 'graph.boundary.input')
    const select = doc.nodes.find((n) => n.typeId === 'text.select')
    const processing = doc.nodes.find((n) => n.typeId === 'asset.screenplay')
    expect(boundaryIn).toBeTruthy()
    expect(boundaryIn?.params.hostBoundaryPort?.portId).toBe('in')
    expect(select).toBeUndefined()
    expect(processing).toBeTruthy()
    expect(doc.nodes.some((n) => n.typeId === 'graph.input.slot')).toBe(false)
  })

  it('normalize strips classic graph.input.slot and keeps only boundary ports', () => {
    const polluted = normalizeScopedGraph('workflow', null, {
      assetType: 'image',
      hostAssetId: '00000000-0000-4000-8000-000000000411'
    })
    const processing = polluted.nodes.find((n) => n.typeId === 'asset.image')!
    polluted.nodes.push({
      id: 'graph-input-in-text-0',
      typeId: 'graph.input.slot',
      category: 'note',
      position: { x: 0, y: 0 },
      title: '输入·文本 1',
      params: {
        hostInputSlot: { portId: 'in-text', index: 0, dataType: 'text' },
        text: 'legacy'
      }
    })
    polluted.edges.push({
      id: 'e-legacy-slot',
      source: 'graph-input-in-text-0',
      target: processing.id,
      sourcePort: 'out',
      targetPort: 'in-text'
    })
    const cleaned = normalizeScopedGraph('workflow', polluted, {
      assetType: 'image',
      hostAssetId: '00000000-0000-4000-8000-000000000411'
    })
    expect(cleaned.nodes.some((n) => n.typeId === 'graph.input.slot')).toBe(false)
    expect(cleaned.edges.some((e) => e.id === 'e-legacy-slot')).toBe(false)
    expect(cleaned.nodes.some((n) => n.id === boundaryInputNodeId('in-text'))).toBe(true)
    expect(cleaned.nodes.some((n) => n.id === boundaryInputNodeId('in-image'))).toBe(true)
  })

  it('normalize image/video/world assets create matching boundary inputs (HDA)', () => {
    const image = normalizeScopedGraph('workflow', null, {
      assetType: 'image',
      hostAssetId: '00000000-0000-4000-8000-000000000401'
    })
    const imageGen = image.nodes.find((n) => n.typeId === 'asset.image')
    expect(imageGen).toBeTruthy()
    expect(image.nodes.some((n) => n.id === boundaryInputNodeId('in-text'))).toBe(true)
    expect(image.nodes.some((n) => n.id === boundaryInputNodeId('in-image'))).toBe(true)
    expect(image.nodes.some((n) => n.typeId === 'graph.input.slot')).toBe(false)

    const video = normalizeScopedGraph('workflow', null, {
      assetType: 'video',
      hostAssetId: '00000000-0000-4000-8000-000000000402'
    })
    const videoGen = video.nodes.find((n) => n.typeId === 'asset.video')
    expect(videoGen).toBeTruthy()
    for (const port of ['in-text', 'in-image', 'in-video', 'in-voice'] as const) {
      expect(video.nodes.some((n) => n.id === boundaryInputNodeId(port)), port).toBe(true)
    }

    const world = normalizeScopedGraph('worldAsset', null, {
      assetType: 'world',
      hostAssetId: '00000000-0000-4000-8000-000000000403'
    })
    const extract = world.nodes.find((n) => n.typeId === 'world.extract')
    expect(extract).toBeTruthy()
    expect(world.nodes.some((n) => n.id === boundaryInputNodeId('in'))).toBe(true)
  })

  it('creates default beat asset graph with split → table → boundary (no gen)', () => {
    const doc = createDefaultScopedGraph('beatAsset', 'beat')
    const split = doc.nodes.find((node) => node.typeId === 'beat.split')
    const table = doc.nodes.find((node) => node.typeId === 'beat.table')
    const editor = doc.nodes.find((node) => node.typeId === 'beat.gen')
    const select = doc.nodes.find((node) => node.typeId === 'text.select')
    const output = doc.nodes.find((node) => node.id === BOUNDARY_OUTPUT_ID)
    expect(split).toBeTruthy()
    expect(table).toBeTruthy()
    expect(editor).toBeUndefined()
    expect(select).toBeUndefined()
    expect(output).toBeTruthy()
    expect(output?.typeId).toBe('graph.boundary.output')
    expect(doc.nodes.some((node) => node.category === 'output')).toBe(false)
    expect(getNodePorts(split!).map((p) => [p.direction, p.dataType])).toEqual([
      ['in', 'text'],
      ['out', 'beat'],
      ['out', 'texts']
    ])
    expect(getNodePorts(table!).map((p) => [p.direction, p.dataType])).toEqual([
      ['in', 'beat'],
      ['out', 'beat']
    ])
    expect(getNodePorts(output!).map((p) => [p.direction, p.dataType])).toEqual([
      ['in', 'beat']
    ])
    expect(
      doc.edges.some((edge) => edge.source === split?.id && edge.target === table?.id)
    ).toBe(true)
    expect(
      doc.edges.some((edge) => edge.source === table?.id && edge.target === output?.id)
    ).toBe(true)
    expect(
      doc.edges.some((edge) => edge.source === table?.id && edge.target === editor?.id)
    ).toBe(false)
    expect(canConnectNodes(split!, table!)).toBe(true)
    expect(canConnectNodes(table!, output!)).toBe(true)
    expect(isNodeDeletable(split!)).toBe(true)
    expect(isNodeDeletable(table!)).toBe(true)
    expect(isNodeDeletable(output!)).toBe(false)
  })

  it('beat asset host creates text boundary input (HDA)', () => {
    const doc = normalizeScopedGraph('beatAsset', null, {
      assetType: 'beat',
      hostAssetId: '00000000-0000-4000-8000-000000000601'
    })
    const table = doc.nodes.find((node) => node.typeId === 'beat.table')
    const split = doc.nodes.find((node) => node.typeId === 'beat.split')
    expect(table).toBeTruthy()
    expect(split).toBeTruthy()
    expect(getNodePorts(table!).some((p) => p.id === 'in-worldEntities')).toBe(false)
    expect(doc.nodes.some((n) => n.id === boundaryInputNodeId('in'))).toBe(true)
    expect(doc.nodes.some((n) => n.typeId === 'graph.input.slot')).toBe(false)
  })

  it('script asset host creates beat and worldEntities boundary inputs (HDA)', () => {
    const doc = normalizeScopedGraph('scriptAsset', null, {
      assetType: 'script',
      hostAssetId: '00000000-0000-4000-8000-000000000701'
    })
    const table = doc.nodes.find((node) => node.typeId === 'script.shotTable')
    const split = doc.nodes.find((node) => node.typeId === 'script.shotSplit')
    expect(table).toBeTruthy()
    expect(split).toBeTruthy()
    expect(getNodePorts(table!).some((p) => p.id === 'in-worldEntities')).toBe(true)
    expect(getNodePorts(split!).find((p) => p.id === 'in')?.dataType).toBe('text')
    expect(doc.nodes.some((n) => n.id === boundaryInputNodeId('in-beat'))).toBe(true)
    expect(doc.nodes.some((n) => n.id === boundaryInputNodeId('in-worldEntities'))).toBe(true)
    expect(doc.nodes.some((n) => n.typeId === 'graph.input.slot')).toBe(false)
  })

  it('drops beat.gen → text.select edge on incompatible out port', () => {
    const gen = createNodeFromType('beat.gen', { x: 0, y: 0 }, { id: 'gen' })
    const select = createNodeFromType('text.select', { x: 200, y: 0 }, { id: 'select' })
    const doc = normalizeScopedGraph('beatAsset', {
      nodes: [gen, select],
      edges: [
        {
          id: 'e1',
          source: 'gen',
          target: 'select',
          sourcePort: 'out',
          targetPort: 'in'
        }
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    }, { assetType: 'beat' })
    expect(
      doc.edges.some((edge) => edge.source === 'gen' && edge.target === 'select')
    ).toBe(false)
  })

  it('creates default world asset graph with extract → table → editor → boundary chain', () => {
    const doc = createDefaultScopedGraph('worldAsset', 'world')
    const extract = doc.nodes.find((node) => node.typeId === 'world.extract')
    const table = doc.nodes.find((node) => node.typeId === 'world.table')
    const editor = doc.nodes.find((node) => node.typeId === 'world.gen')
    const output = doc.nodes.find((node) => node.id === BOUNDARY_OUTPUT_ID)
    expect(extract).toBeTruthy()
    expect(table).toBeTruthy()
    expect(editor).toBeTruthy()
    expect(output).toBeTruthy()
    expect(output?.typeId).toBe('graph.boundary.output')
    expect(doc.nodes.some((node) => node.category === 'output')).toBe(false)
    expect(getNodePorts(extract!).map((p) => [p.direction, p.dataType])).toEqual([
      ['in', 'text'],
      ['out', 'world'],
      ['out', 'texts']
    ])
    expect(getNodePorts(table!).map((p) => [p.direction, p.dataType])).toEqual([
      ['in', 'world'],
      ['out', 'world']
    ])
    expect(getNodePorts(editor!).map((p) => [p.direction, p.dataType])).toEqual([
      ['in', 'world'],
      ['out', 'worldEntities']
    ])
    expect(getNodePorts(output!).map((p) => [p.direction, p.dataType])).toEqual([
      ['in', 'worldEntities']
    ])
    expect(
      doc.edges.some((edge) => edge.source === extract?.id && edge.target === table?.id)
    ).toBe(true)
    expect(
      doc.edges.some((edge) => edge.source === table?.id && edge.target === editor?.id)
    ).toBe(true)
    expect(
      doc.edges.some((edge) => edge.source === editor?.id && edge.target === output?.id)
    ).toBe(true)
    expect(canConnectNodes(editor!, output!)).toBe(true)
    expect(isNodeDeletable(output!)).toBe(false)
  })

  it('keeps screenplay processing node id and play.script edges across normalize reload', () => {
    const play = createNodeFromType('play.script', { x: 0, y: 0 }, { id: 'play-1' })
    const processing = createNodeFromType('asset.screenplay', { x: 200, y: 0 }, { id: 'sp-edit-1' })
    const output = createOutputGraphNode('text', { x: 400, y: 0 }, {
      id: TEXT_OUTPUT_ID
    })
    const saved = {
      nodes: [play, processing, output],
      edges: [
        {
          id: 'e-play-sp',
          source: 'play-1',
          target: 'sp-edit-1',
          sourcePort: 'out',
          targetPort: 'in'
        },
        {
          id: 'e-sp-out',
          source: 'sp-edit-1',
          target: TEXT_OUTPUT_ID,
          sourcePort: 'out',
          targetPort: 'in'
        }
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    }

    const reloaded = normalizeScopedGraph('screenplayAsset', saved, { assetType: 'screenplay' })
    expect(reloaded.nodes.some((node) => node.id === 'sp-edit-1')).toBe(true)
    const outputNode = reloaded.nodes.find((node) => node.id === BOUNDARY_OUTPUT_ID)
    expect(outputNode?.typeId).toBe('graph.boundary.output')
    expect(outputNode?.params.hostBoundaryPort?.dataType).toBe('text')
    expect(reloaded.nodes.some((node) => node.category === 'output')).toBe(false)
    expect(
      reloaded.edges.some(
        (edge) => edge.id === 'e-play-sp' && edge.source === 'play-1' && edge.target === 'sp-edit-1'
      )
    ).toBe(true)
    expect(
      reloaded.edges.some(
        (edge) => edge.source === 'sp-edit-1' && edge.target === BOUNDARY_OUTPUT_ID
      )
    ).toBe(true)
  })

  it('normalizes empty asset graph to include processing chain', () => {
    const doc = normalizeAssetGraph(null, 'video')
    expect(doc.nodes.some((node) => node.typeId === 'asset.video')).toBe(true)
    expect(doc.edges.length).toBeGreaterThan(0)
  })

  it('allows image processing and image refs to connect to image output', () => {
    const output = createOutputGraphNode('image', { x: 400, y: 0 }, {
      id: IMAGE_OUTPUT_ID,
      params: { outputKind: 'image' }
    })
    const ref = createAssetGraphNode('00000000-0000-4000-8000-000000000301', 'image', 'Ref', {
      x: 0,
      y: 0
    })
    const processing = createNodeFromType('asset.image', { x: 200, y: 0 })
    expect(canConnectNodes(ref, processing)).toBe(true)
    expect(canConnectNodes(processing, output)).toBe(true)
    expect(canConnectNodes(ref, output)).toBe(true)
  })

  it('drops image generate edges targeting removed in port', () => {
    const ref = createAssetGraphNode('00000000-0000-4000-8000-000000000401', 'image', 'Ref', {
      x: 0,
      y: 0
    })
    const processing = createNodeFromType('asset.image', { x: 200, y: 0 }, { id: 'img-gen' })
    const doc = normalizeScopedGraph('workflow', {
      nodes: [ref, processing],
      edges: [
        {
          id: 'e1',
          source: ref.id,
          target: processing.id,
          sourcePort: 'out',
          targetPort: 'in'
        }
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    }, { assetType: 'image' })
    // 不再把 in 迁成 in-image；非法口边被丢弃（合法 in-image 边需显式写出）
    expect(
      doc.edges.some(
        (item) =>
          item.source === ref.id &&
          item.target === processing.id &&
          (item.targetPort ?? 'in') === 'in'
      )
    ).toBe(false)
  })

  it('strips classic video output while preserving refs and video processing', () => {
    const doc = normalizeScopedGraph('shotWorkflow', {
      nodes: [
        createAssetGraphNode('00000000-0000-4000-8000-000000000011', 'image', 'Ref', { x: 0, y: 0 }),
        createAssetGraphNode('00000000-0000-4000-8000-000000000012', 'video', 'Vid', {
          x: 0,
          y: 80
        }),
        createNodeFromType('asset.video', { x: 200, y: 0 }),
        createOutputGraphNode('video', { x: 400, y: 0 }, { id: VIDEO_OUTPUT_ID })
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    })
    const imageRef = doc.nodes.find((node) => node.assetId === '00000000-0000-4000-8000-000000000011')
    const videoRef = doc.nodes.find((node) => node.assetId === '00000000-0000-4000-8000-000000000012')
    const processing = doc.nodes.find(
      (node) => node.typeId === 'asset.video' && !node.assetId
    )
    expect(imageRef).toBeTruthy()
    expect(videoRef).toBeTruthy()
    expect(doc.nodes.some((node) => node.typeId.startsWith('output.'))).toBe(false)
    expect(
      processing &&
        getNodePorts(processing).some((p) => p.direction === 'out' && p.dataType === 'video')
    ).toBe(true)
  })
})
