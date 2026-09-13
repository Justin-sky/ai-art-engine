import { describe, expect, it } from 'vitest'
import {
  applyGraphEditOps,
  MCP_GRAPH_EDIT_SCOPE,
  type McpGraphEditOp
} from '../src/shared/graph/mcpGraphEdit'
import { listAddableNodeTypes, materializeGraphPlan, type GraphPlan } from '../src/shared/graph'

function buildSampleGraph(): {
  graph: NonNullable<ReturnType<typeof materializeGraphPlan>['document']>
} {
  const plan: GraphPlan = {
    title: 'sample',
    nodes: [
      { key: 'script', typeId: 'play.script', title: '剧本' },
      { key: 'img', typeId: 'asset.image', title: '分镜图' },
      { key: 'vid', typeId: 'asset.video', title: '视频' }
    ],
    edges: [
      { from: 'script', to: 'img' },
      { from: 'img', to: 'vid' }
    ]
  }
  const result = materializeGraphPlan(plan, { scope: 'subgraphAsset', assetType: 'subgraph' })
  expect(result.ok, result.error).toBe(true)
  const graph = result.document!
  // 物化后节点 id 是随机生成的，按 title 建立索引便于断言
  const byTitle = new Map(graph.nodes.map((node) => [node.title ?? '', node.id]))
  return { graph, byTitle }
}

describe('applyGraphEditOps（MCP 图编辑）', () => {
  it('node_upsert 新建节点并以显式 id 命中更新', () => {
    const { graph } = buildSampleGraph()
    const ops: McpGraphEditOp[] = [
      { op: 'node_upsert', nodeId: 'voice-1', typeId: 'asset.voice', title: '配音' },
      {
        op: 'node_upsert',
        nodeId: 'voice-1',
        typeId: 'asset.voice',
        title: '口播配音',
        params: { generateInstruction: '亲切清晰的口播' }
      }
    ]
    const result = applyGraphEditOps(graph, ops)
    expect(result.warnings).toEqual([])
    expect(result.applied).toHaveLength(2)
    const node = result.graph.nodes.find((item) => item.id === 'voice-1')
    expect(node?.title).toBe('口播配音')
    expect((node?.params as Record<string, unknown>).generateInstruction).toBe('亲切清晰的口播')
  })

  it('edge_connect 自动解析兼容端口，重复连线幂等', () => {
    const { graph, byTitle } = buildSampleGraph()
    const scriptId = byTitle.get('剧本')!
    const voiceId = 'voice-1'
    const ops: McpGraphEditOp[] = [
      { op: 'node_upsert', nodeId: voiceId, typeId: 'asset.voice', title: '配音' },
      { op: 'edge_connect', fromNodeId: scriptId, toNodeId: voiceId },
      { op: 'edge_connect', fromNodeId: scriptId, toNodeId: voiceId }
    ]
    const result = applyGraphEditOps(graph, ops)
    expect(result.warnings).toEqual([])
    const edges = result.graph.edges.filter((edge) => edge.target === voiceId)
    expect(edges).toHaveLength(1)
    expect(edges[0].sourcePort).toBe('out')
  })

  it('edge_connect 端口不兼容时记录 warning 并跳过', () => {
    const { graph, byTitle } = buildSampleGraph()
    const imgId = byTitle.get('分镜图')!
    const result = applyGraphEditOps(graph, [
      { op: 'node_upsert', nodeId: 'note-1', typeId: 'note.text', title: '备注' },
      { op: 'edge_connect', fromNodeId: imgId, toNodeId: 'note-1' }
    ])
    expect(result.applied).toHaveLength(1)
    expect(result.warnings.some((warning) => warning.includes('连线不兼容'))).toBe(true)
  })

  it('node_delete 级联删除连线，输出与边界节点受保护', () => {
    const { graph, byTitle } = buildSampleGraph()
    const imgId = byTitle.get('分镜图')!
    const vidId = byTitle.get('视频')!
    const protectedNode = graph.nodes.find(
      (node) => node.typeId.startsWith('output.') || node.typeId === 'graph.boundary.output'
    )
    const result = applyGraphEditOps(graph, [
      { op: 'node_delete', nodeId: vidId },
      ...(protectedNode ? [{ op: 'node_delete', nodeId: protectedNode.id } as McpGraphEditOp] : [])
    ])
    expect(result.graph.nodes.find((node) => node.id === vidId)).toBeUndefined()
    expect(result.graph.edges.some((edge) => edge.source === imgId && edge.target === vidId)).toBe(
      false
    )
    if (protectedNode) {
      expect(result.warnings.some((warning) => warning.includes('禁止删除'))).toBe(true)
      expect(result.graph.nodes.find((node) => node.id === protectedNode.id)).toBeTruthy()
    }
  })

  it('edge_delete 删除指定连线，未知节点记录 warning', () => {
    const { graph, byTitle } = buildSampleGraph()
    const scriptId = byTitle.get('剧本')!
    const imgId = byTitle.get('分镜图')!
    const result = applyGraphEditOps(graph, [
      { op: 'edge_delete', fromNodeId: scriptId, toNodeId: imgId },
      { op: 'node_update', nodeId: 'missing', title: 'x' },
      { op: 'node_upsert', nodeId: 'bad-1', typeId: 'not.a.type' }
    ])
    expect(
      result.graph.edges.some((edge) => edge.source === scriptId && edge.target === imgId)
    ).toBe(false)
    expect(result.warnings.length).toBe(2)
  })

  it('原图不被就地修改', () => {
    const { graph } = buildSampleGraph()
    const before = graph.nodes.length
    applyGraphEditOps(graph, [
      { op: 'node_upsert', nodeId: 'extra', typeId: 'asset.voice', title: '配音' }
    ])
    expect(graph.nodes.length).toBe(before)
  })
})

/**
 * graph_node_types（MCP 节点类型清单工具）与 graph_edit 共用
 * MCP_GRAPH_EDIT_SCOPE 白名单，这里锁定「清单 == 可建集合」这一契约。
 */
describe('MCP_GRAPH_EDIT_SCOPE（清单工具与 graph_edit 同源）', () => {
  it('清单内含新节点类型，且清单里的类型 graph_edit 全部能建', () => {
    const addable = listAddableNodeTypes(MCP_GRAPH_EDIT_SCOPE)
    const ids = addable.map((def) => def.typeId)
    expect(ids.length).toBeGreaterThan(0)
    expect(ids).toContain('stage.2d')
    expect(ids).toContain('image.gridSplit')
    expect(ids).toContain('image.iconPack')
    const { graph } = buildSampleGraph()
    const ops: McpGraphEditOp[] = addable.map((def) => ({
      op: 'node_upsert',
      nodeId: `mcp-${def.typeId}`,
      typeId: def.typeId
    }))
    const result = applyGraphEditOps(graph, ops)
    expect(result.applied).toHaveLength(addable.length)
    expect(result.warnings).toEqual([])
  })

  it('清单外的类型（输出节点）被 graph_edit 跳过', () => {
    const ids = listAddableNodeTypes(MCP_GRAPH_EDIT_SCOPE).map((def) => def.typeId)
    expect(ids).not.toContain('output.video')
    const { graph } = buildSampleGraph()
    const result = applyGraphEditOps(graph, [{ op: 'node_upsert', typeId: 'output.video' }])
    expect(result.applied).toEqual([])
    expect(result.warnings.some((warning) => warning.includes('不可添加'))).toBe(true)
  })
})
