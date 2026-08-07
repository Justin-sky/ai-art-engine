import { describe, expect, it, vi } from 'vitest'
import {
  runGraph,
  boundaryInputNodeId,
  boundaryOutputNodeId,
  isAssetHostNode,
  normalizeAssetGraph,
  resolveBoundaryInputValuesFromParentGraph,
  HOST_INTERFACE_SCHEMA_VERSION,
  type GraphDocument,
  type GraphNode,
  type HostInterfaceDocument
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

/** 存量坏数据：宿主端口还在，assetHost 标记（乃至端口快照）已丢失 */
function hostNodeMissingFlag(options?: { dropSnapshot?: boolean }): GraphNode {
  const node = hostNode()
  const params = { ...node.params }
  delete params.assetHost
  if (options?.dropSnapshot) delete params.hostInterfaceSnapshot
  return { ...node, params }
}

function parentWithHost(host: GraphNode): GraphDocument {
  const doc = parentDocument()
  return {
    ...doc,
    nodes: doc.nodes.map((node) => (node.id === 'host-node' ? host : node))
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

function makeRunner() {
  return vi.fn(async (input: { document: GraphDocument }) => {
    const states: Record<string, { status: 'done'; outputs: Record<string, unknown> }> = {}
    for (const node of input.document.nodes) {
      states[node.id] = { status: 'done', outputs: { out: { kind: 'text', text: '内图产出' } } }
    }
    return { ok: true, states } as never
  })
}

describe('host node cook enqueues inner graph', () => {
  it('calls runHostInnerGraph when running the whole parent workflow', async () => {
    const runHostInnerGraph = makeRunner()
    const result = await runGraph(parentDocument(), {
      stepDelayMs: 1,
      hasAsset: () => true,
      resolveAssetGenParams: () => ({ graphJson: innerDocument() }),
      runHostInnerGraph
    })
    expect(runHostInnerGraph).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
  })

  it('does not cook host inner graph on onlyTargetNode by default', async () => {
    const runHostInnerGraph = makeRunner()
    const result = await runGraph(parentDocument(), {
      stepDelayMs: 1,
      targetNodeId: 'host-node',
      onlyTargetNode: true,
      hasAsset: () => true,
      resolveAssetGenParams: () => ({ graphJson: innerDocument() }),
      priorNodeStates: {
        'host-node': {
          status: 'done',
          outputs: { out: { kind: 'text', text: 'cached-host' } }
        }
      },
      runHostInnerGraph
    })
    expect(runHostInnerGraph).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
    expect(result.states['host-node']?.outputs?.out).toMatchObject({
      kind: 'text',
      text: 'cached-host'
    })
  })

  it('cooks host inner graph when cookHostInnerGraph is true', async () => {
    const runHostInnerGraph = makeRunner()
    await runGraph(parentDocument(), {
      stepDelayMs: 1,
      targetNodeId: 'host-node',
      onlyTargetNode: true,
      cookHostInnerGraph: true,
      hasAsset: () => true,
      resolveAssetGenParams: () => ({ graphJson: innerDocument() }),
      runHostInnerGraph
    })
    expect(runHostInnerGraph).toHaveBeenCalledTimes(1)
  })

  it('errors when onlyTarget host has no cache to reuse', async () => {
    const runHostInnerGraph = makeRunner()
    const result = await runGraph(parentDocument(), {
      stepDelayMs: 1,
      targetNodeId: 'host-node',
      onlyTargetNode: true,
      hasAsset: () => true,
      resolveAssetGenParams: () => ({ graphJson: innerDocument() }),
      runHostInnerGraph
    })
    expect(runHostInnerGraph).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(result.error).toContain('GRAPH_HOST_NO_CACHE_COOK')
  })

  it('collects inner boundary outputs without cook when nothing was lifted yet', async () => {
    // 内层已生成视频但从未 cook 过宿主：出口按内图节点 params 收集，不应报 NO_CACHE
    const inner: GraphDocument = {
      nodes: [
        {
          id: 'v1',
          typeId: 'asset.video',
          category: 'asset',
          position: { x: 0, y: 0 },
          params: {
            generatedVideos: [{ id: 'vid-1', relativePath: 'Cache/Videos/a.mp4' }],
            selectedVideoId: 'vid-1'
          }
        },
        {
          id: 'b-video-1',
          typeId: 'graph.boundary.output',
          category: 'note',
          position: { x: 300, y: 0 },
          params: {
            hostBoundaryPort: {
              portId: 'out-video',
              dataType: 'video',
              multiple: false,
              slotIndex: 0,
              slotSourceId: 'v1'
            }
          }
        }
      ],
      edges: [
        { id: 'inner-e1', source: 'v1', target: 'b-video-1', sourcePort: 'out', targetPort: 'in' }
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    const host: GraphNode = {
      ...hostNode(),
      params: {
        assetRef: true,
        assetHost: true,
        hostInterfaceSnapshot: {
          version: HOST_INTERFACE_SCHEMA_VERSION,
          inputs: [],
          outputs: [{ id: 'out-video', label: '视频组输出', dataType: 'videos', multiple: true }]
        }
      }
    }
    const runHostInnerGraph = makeRunner()
    const result = await runGraph(parentWithHost(host), {
      stepDelayMs: 1,
      targetNodeId: 'host-node',
      onlyTargetNode: true,
      hasAsset: () => true,
      resolveAssetGenParams: () => ({ graphJson: inner }),
      runHostInnerGraph
    })
    expect(runHostInnerGraph).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
    expect(result.states['host-node']?.outputs?.['out-video']).toMatchObject({
      kind: 'videos',
      items: [{ id: 'vid-1', relativePath: 'Cache/Videos/a.mp4' }]
    })
  })

  it('prefers the current inner graph over a stale lifted cache', async () => {
    const inner: GraphDocument = {
      nodes: [
        {
          id: boundaryInputNodeId('in-text'),
          typeId: 'graph.boundary.input',
          category: 'note',
          position: { x: 0, y: 0 },
          params: { hostBoundaryPort: { portId: 'in-text', dataType: 'text' } }
        },
        {
          id: 'writer',
          typeId: 'note.text',
          category: 'note',
          position: { x: 150, y: 0 },
          params: { text: '内图最新正文' }
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
          source: 'writer',
          target: boundaryOutputNodeId('out-text'),
          sourcePort: 'out',
          targetPort: 'in'
        }
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    const result = await runGraph(parentDocument(), {
      stepDelayMs: 1,
      targetNodeId: 'host-node',
      onlyTargetNode: true,
      hasAsset: () => true,
      resolveAssetGenParams: () => ({ graphJson: inner }),
      priorNodeStates: {
        'host-node': {
          status: 'done',
          outputs: { 'out-text': { kind: 'text', text: '过期抬升缓存' } }
        }
      },
      runHostInnerGraph: makeRunner()
    })
    expect(result.states['host-node']?.outputs?.['out-text']).toMatchObject({
      kind: 'text',
      text: '内图最新正文'
    })
  })

  it('passes the outer input value into the boundary input seed', async () => {
    const runHostInnerGraph = makeRunner()
    await runGraph(parentDocument(), {
      stepDelayMs: 1,
      hasAsset: () => true,
      resolveAssetGenParams: () => ({ graphJson: innerDocument() }),
      runHostInnerGraph
    })
    const call = runHostInnerGraph.mock.calls[0]?.[0] as unknown as {
      priorNodeStates: Record<string, { outputs?: Record<string, { text?: string }> }>
    }
    expect(call.priorNodeStates[boundaryInputNodeId('in-text')]?.outputs?.out?.text).toBe(
      '外层正文'
    )
  })

  it('keeps custom boundary ports when normalizing the inner graph on open', () => {
    const iface: HostInterfaceDocument = {
      version: HOST_INTERFACE_SCHEMA_VERSION,
      inputs: [{ id: 'in-text', label: '文本输入', dataType: 'text', multiple: true }],
      outputs: [{ id: 'out-text', label: '文本输出', dataType: 'text', multiple: false }]
    }
    const normalized = normalizeAssetGraph(innerDocument(), 'subgraph', {
      hostAssetId: HOST_ASSET_ID,
      hostInterface: iface
    })
    const ids = normalized.nodes.map((n) => n.id)
    expect(ids).toContain(boundaryInputNodeId('in-text'))
    expect(ids).toContain(boundaryOutputNodeId('out-text'))
    // 默认模板的 in / out 不得被凭空插入
    expect(ids).not.toContain(boundaryInputNodeId('in'))
    expect(ids).not.toContain(boundaryOutputNodeId('out'))
    // 内部连线保留
    expect(
      normalized.edges.some(
        (edge) =>
          edge.source === boundaryInputNodeId('in-text') &&
          edge.target === boundaryOutputNodeId('out-text')
      )
    ).toBe(true)
  })

  it('cooks successfully with the inner graph as normalized on open', async () => {
    const iface: HostInterfaceDocument = {
      version: HOST_INTERFACE_SCHEMA_VERSION,
      inputs: [{ id: 'in-text', label: '文本输入', dataType: 'text', multiple: true }],
      outputs: [{ id: 'out-text', label: '文本输出', dataType: 'text', multiple: false }]
    }
    const liveInner = normalizeAssetGraph(innerDocument(), 'subgraph', {
      hostAssetId: HOST_ASSET_ID,
      hostInterface: iface
    })
    const runHostInnerGraph = makeRunner()
    const result = await runGraph(parentDocument(), {
      stepDelayMs: 1,
      hasAsset: () => true,
      resolveAssetGenParams: () => ({ graphJson: liveInner }),
      runHostInnerGraph
    })
    expect(runHostInnerGraph).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
  })

  it('cooks when the assetHost flag is missing but the port snapshot remains', async () => {
    const runHostInnerGraph = makeRunner()
    const result = await runGraph(parentWithHost(hostNodeMissingFlag()), {
      stepDelayMs: 1,
      hasAsset: () => true,
      resolveAssetGenParams: () => ({ graphJson: innerDocument() }),
      runHostInnerGraph
    })
    expect(runHostInnerGraph).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
  })

  it('cooks a screenplay host, which routes through a type-specific execute', async () => {
    // asset.screenplay 的 execute 是 executeScreenplayGenerateNode，
    // 早期它在 isAssetRefNode 分支直接读正文返回，宿主内图永不入队
    const screenplayHost: GraphNode = {
      id: 'host-node',
      typeId: 'asset.screenplay',
      category: 'asset',
      assetId: HOST_ASSET_ID,
      assetType: 'screenplay',
      position: { x: 200, y: 0 },
      title: 'aadd',
      params: {
        text: '…',
        assetRef: true,
        assetHost: true,
        hostInterfaceSnapshot: {
          version: HOST_INTERFACE_SCHEMA_VERSION,
          inputs: [{ id: 'in', label: 'In', dataType: 'text', multiple: true }],
          outputs: [{ id: 'out', label: 'Out', dataType: 'text', multiple: false }]
        }
      }
    }
    const parent = parentWithHost(screenplayHost)
    const runHostInnerGraph = makeRunner()
    const resolveAssetText = vi.fn(async () => '资产正文（不应被当作宿主产出）')
    await runGraph(parent, {
      stepDelayMs: 1,
      targetNodeId: 'host-node',
      onlyTargetNode: true,
      cookHostInnerGraph: true,
      hasAsset: () => true,
      resolveAssetText,
      resolveAssetGenParams: () => ({ graphJson: innerDocument() }),
      runHostInnerGraph
    })
    expect(runHostInnerGraph).toHaveBeenCalledTimes(1)
    expect(resolveAssetText).not.toHaveBeenCalled()
  })

  it('never cooks a plain reference even when that asset owns an inner graph', async () => {
    const runHostInnerGraph = makeRunner()
    // 素材资产自身也带 graphJson；引用节点（无宿主标记/快照）必须只取产出，不得重跑
    const result = await runGraph(parentWithHost(hostNodeMissingFlag({ dropSnapshot: true })), {
      stepDelayMs: 1,
      hasAsset: () => true,
      resolveAssetGenParams: () => ({ graphJson: innerDocument() }),
      runHostInnerGraph
    })
    expect(runHostInnerGraph).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
  })

  it('treats a node as host with either the flag or the port snapshot', () => {
    expect(isAssetHostNode(hostNode())).toBe(true)
    expect(isAssetHostNode(hostNodeMissingFlag())).toBe(true)
    expect(isAssetHostNode(hostNodeMissingFlag({ dropSnapshot: true }))).toBe(false)
  })

  it('resolves boundary input values from the parent when assetHost is missing', () => {
    const withFlag = resolveBoundaryInputValuesFromParentGraph(parentDocument(), HOST_ASSET_ID)
    const withoutFlag = resolveBoundaryInputValuesFromParentGraph(
      parentWithHost(hostNodeMissingFlag()),
      HOST_ASSET_ID
    )
    // 标记缺失不应让内图边界输入拿不到外层传值
    expect(Object.keys(withoutFlag)).toEqual(Object.keys(withFlag))
  })

  it('fails loudly instead of passing through when the host has no inner graph', async () => {
    const runHostInnerGraph = makeRunner()
    const result = await runGraph(parentDocument(), {
      stepDelayMs: 1,
      hasAsset: () => true,
      resolveAssetGenParams: () => undefined,
      runHostInnerGraph
    })
    expect(runHostInnerGraph).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(result.error).toContain('GRAPH_HOST_INNER_NO_GRAPH')
  })
})
