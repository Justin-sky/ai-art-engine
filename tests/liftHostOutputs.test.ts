import { describe, expect, it } from 'vitest'
import {
  boundaryInputNodeId,
  boundaryOutputNodeId,
  collectHostOutputLifts,
  HOST_INTERFACE_SCHEMA_VERSION,
  withHostOutputLifts,
  type GraphDocument,
  type GraphNode
} from '../src/shared/graph'

const HOST_ASSET_ID = '00000000-0000-4000-8000-0000000003a1'

function innerDocument(): GraphDocument {
  return {
    nodes: [
      {
        id: boundaryInputNodeId('in-text'),
        typeId: 'graph.boundary.input',
        category: 'note',
        position: { x: 0, y: 0 },
        params: { hostBoundaryPort: { portId: 'in-text', dataType: 'text' } }
      },
      {
        id: boundaryOutputNodeId('out-text'),
        typeId: 'graph.boundary.output',
        category: 'note',
        position: { x: 300, y: 0 },
        params: { hostBoundaryPort: { portId: 'out-text', dataType: 'text' } }
      }
    ],
    edges: [
      {
        id: 'inner-e1',
        source: boundaryInputNodeId('in-text'),
        target: boundaryOutputNodeId('out-text'),
        sourcePort: 'out',
        targetPort: 'in'
      }
    ],
    viewport: { x: 0, y: 0, zoom: 1 }
  }
}

function hostNode(): GraphNode {
  return {
    id: 'host-node',
    typeId: 'asset.subgraph',
    category: 'asset',
    assetId: HOST_ASSET_ID,
    assetType: 'subgraph',
    position: { x: 200, y: 0 },
    title: '子图',
    params: {
      assetRef: true,
      assetHost: true,
      hostInterfaceSnapshot: {
        version: HOST_INTERFACE_SCHEMA_VERSION,
        inputs: [{ id: 'in-text', label: '文本输入', dataType: 'text', multiple: true }],
        outputs: [{ id: 'out-text', label: '文本输出', dataType: 'text', multiple: false }]
      }
    }
  }
}

function parentDocument(): GraphDocument {
  return {
    nodes: [
      {
        id: 'src',
        typeId: 'note.text',
        category: 'note',
        position: { x: 0, y: 0 },
        params: { text: '外层正文' }
      },
      hostNode(),
      {
        id: 'text-output',
        typeId: 'output.text',
        category: 'output',
        position: { x: 460, y: 0 },
        params: { outputKind: 'text' }
      }
    ],
    edges: [
      { id: 'e1', source: 'src', target: 'host-node', sourcePort: 'out', targetPort: 'in-text' },
      {
        id: 'e2',
        source: 'host-node',
        target: 'text-output',
        sourcePort: 'out-text',
        targetPort: 'in'
      }
    ],
    viewport: { x: 0, y: 0, zoom: 1 }
  }
}

describe('liftHostOutputs', () => {
  it('collects video slot from upstream params when the boundary node has not run', () => {
    const boundary = {
      id: 'b-video-1',
      typeId: 'graph.boundary.output',
      category: 'note',
      position: { x: 300, y: 0 },
      params: {
        hostBoundaryPort: {
          portId: 'out',
          dataType: 'video',
          multiple: false,
          slotIndex: 0,
          slotSourceId: 'v1'
        }
      }
    }
    const video = {
      id: 'v1',
      typeId: 'asset.video',
      category: 'asset',
      position: { x: 0, y: 0 },
      params: {
        generatedVideos: [
          {
            id: 'vid-1',
            relativePath: 'Cache/Videos/a.mp4',
            createdAt: '2026-08-07T00:00:00.000Z'
          }
        ],
        selectedVideoId: 'vid-1'
      }
    }
    const inner: GraphDocument = {
      nodes: [video, boundary],
      edges: [{ id: 'e1', source: 'v1', target: 'b-video-1', sourcePort: 'out', targetPort: 'in' }],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    const host = {
      ...hostNode(),
      params: {
        assetRef: true,
        assetHost: true,
        hostInterfaceSnapshot: {
          version: HOST_INTERFACE_SCHEMA_VERSION,
          inputs: [],
          outputs: [{ id: 'out', label: '视频组输出', dataType: 'videos', multiple: true }]
        }
      }
    }
    const parent: GraphDocument = {
      nodes: [host],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    // 边界节点没有任何 runState：靠边界输入（上游视频节点 params）收集
    const lifts = collectHostOutputLifts(HOST_ASSET_ID, inner, {}, parent)
    expect(lifts).toHaveLength(1)
    expect(lifts[0]?.outputs['out']).toMatchObject({
      kind: 'videos',
      items: [{ id: 'vid-1', relativePath: 'Cache/Videos/a.mp4' }]
    })
  })

  it('writes aggregated gallery into host node params for reuse without cook', () => {
    const boundary = {
      id: 'b-video-1',
      typeId: 'graph.boundary.output',
      category: 'note',
      position: { x: 300, y: 0 },
      params: {
        hostBoundaryPort: {
          portId: 'out',
          dataType: 'video',
          multiple: false,
          slotIndex: 0,
          slotSourceId: 'v1'
        }
      }
    }
    const video = {
      id: 'v1',
      typeId: 'asset.video',
      category: 'asset',
      position: { x: 0, y: 0 },
      params: {
        generatedVideos: [
          {
            id: 'vid-1',
            relativePath: 'Cache/Videos/a.mp4',
            createdAt: '2026-08-07T00:00:00.000Z'
          }
        ],
        selectedVideoId: 'vid-1'
      }
    }
    const inner: GraphDocument = {
      nodes: [video, boundary],
      edges: [{ id: 'e1', source: 'v1', target: 'b-video-1', sourcePort: 'out', targetPort: 'in' }],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    const host = {
      ...hostNode(),
      params: {
        assetRef: true,
        assetHost: true,
        hostInterfaceSnapshot: {
          version: HOST_INTERFACE_SCHEMA_VERSION,
          inputs: [],
          outputs: [{ id: 'out', label: '视频组输出', dataType: 'videos', multiple: true }]
        }
      }
    }
    const parent: GraphDocument = {
      nodes: [host],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    const lifts = collectHostOutputLifts(HOST_ASSET_ID, inner, {}, parent)
    const next = withHostOutputLifts(parent, lifts)
    const liftedHost = next.nodes.find((n) => n.id === 'host-node')
    expect((liftedHost?.params.generatedVideos as Array<{ id?: string }>)?.map((i) => i.id)).toEqual(
      ['vid-1']
    )
    expect(liftedHost?.params.selectedVideoId).toBe('vid-1')
    expect(next.runStates?.['host-node']?.status).toBe('done')
  })

  it('maps inner boundary.output states onto parent host node ports', () => {
    const outId = boundaryOutputNodeId('out-text')
    const lifts = collectHostOutputLifts(
      HOST_ASSET_ID,
      innerDocument(),
      {
        [outId]: {
          status: 'done',
          outputs: { out: { kind: 'text', text: '内层直接跑出的正文' } }
        }
      },
      parentDocument()
    )
    expect(lifts).toEqual([
      {
        hostNodeId: 'host-node',
        outputs: { 'out-text': { kind: 'text', text: '内层直接跑出的正文' } }
      }
    ])
  })

  it('writes lifted outputs into parent runStates for reuse without cook', () => {
    const outId = boundaryOutputNodeId('out-text')
    const lifts = collectHostOutputLifts(
      HOST_ASSET_ID,
      innerDocument(),
      {
        [outId]: {
          status: 'done',
          outputs: { out: { kind: 'text', text: '已抬升' } }
        }
      },
      parentDocument()
    )
    const next = withHostOutputLifts(parentDocument(), lifts)
    expect(next.runStates?.['host-node']).toMatchObject({
      status: 'done',
      outputs: { 'out-text': { kind: 'text', text: '已抬升' } }
    })
  })

  it('ignores unrelated parent host nodes', () => {
    const parent = parentDocument()
    parent.nodes = parent.nodes.map((node) =>
      node.id === 'host-node'
        ? { ...node, assetId: '00000000-0000-4000-8000-0000000003a2' }
        : node
    )
    const lifts = collectHostOutputLifts(
      HOST_ASSET_ID,
      innerDocument(),
      {
        [boundaryOutputNodeId('out-text')]: {
          status: 'done',
          outputs: { out: { kind: 'text', text: 'x' } }
        }
      },
      parent
    )
    expect(lifts).toEqual([])
  })
})
