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
      { key: 'script', typeId: 'text.plain', title: '剧本' },
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
    expect(result.applied.filter((item) => item !== '自动布局')).toHaveLength(2)
    expect(result.applied).toContain('自动布局')
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
    expect(result.applied.filter((item) => item !== '自动布局')).toHaveLength(1)
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
    expect(ids).toContain('image.process')
    expect(ids).toContain('image.iconPack')
    const { graph } = buildSampleGraph()
    const ops: McpGraphEditOp[] = addable.map((def) => ({
      op: 'node_upsert',
      nodeId: `mcp-${def.typeId}`,
      typeId: def.typeId
    }))
    const result = applyGraphEditOps(graph, ops)
    expect(result.applied.filter((item) => item !== '自动布局')).toHaveLength(addable.length)
    expect(result.applied).toContain('自动布局')
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

  it('autoLayout:true 时按连线拓扑拉开节点（不叠在原点）', () => {
    const { graph } = buildSampleGraph()
    // 故意把节点堆到同一点，模拟 MCP 建节点未给坐标
    for (const node of graph.nodes) {
      node.position = { x: 0, y: 0 }
    }
    const result = applyGraphEditOps(graph, [], { autoLayout: true })
    expect(result.applied).toContain('自动布局')
    const xs = new Set(result.graph.nodes.map((node) => node.position.x))
    expect(xs.size).toBeGreaterThan(1)
  })

  it('新建节点时默认自动布局（无需显式 autoLayout）', () => {
    const { graph } = buildSampleGraph()
    for (const node of graph.nodes) {
      node.position = { x: 0, y: 0 }
    }
    const result = applyGraphEditOps(graph, [
      { op: 'node_upsert', nodeId: 'voice-layout', typeId: 'asset.voice', title: '配音' }
    ])
    expect(result.applied).toContain('自动布局')
    const positions = result.graph.nodes.map((node) => `${node.position.x},${node.position.y}`)
    expect(new Set(positions).size).toBe(result.graph.nodes.length)
  })

  it('autoLayout:false 时新建节点仍可叠在原点', () => {
    const { graph } = buildSampleGraph()
    for (const node of graph.nodes) {
      node.position = { x: 0, y: 0 }
    }
    const result = applyGraphEditOps(
      graph,
      [{ op: 'node_upsert', nodeId: 'voice-no-layout', typeId: 'asset.voice', title: '配音' }],
      { autoLayout: false }
    )
    expect(result.applied).not.toContain('自动布局')
    const created = result.graph.nodes.find((node) => node.id === 'voice-no-layout')
    expect(created?.position).toEqual({ x: 0, y: 0 })
  })

  it('仅 node_update 时不触发默认自动布局', () => {
    const { graph, byTitle } = buildSampleGraph()
    const imgId = byTitle.get('分镜图')!
    const before = graph.nodes.map((node) => ({
      id: node.id,
      x: node.position.x,
      y: node.position.y
    }))
    const result = applyGraphEditOps(graph, [
      { op: 'node_update', nodeId: imgId, title: '分镜图改名' }
    ])
    expect(result.applied).not.toContain('自动布局')
    for (const prev of before) {
      const node = result.graph.nodes.find((item) => item.id === prev.id)!
      expect(node.position.x).toBe(prev.x)
      expect(node.position.y).toBe(prev.y)
    }
  })

  it('node_select 记录选中且不改图结构', () => {
    const { graph, byTitle } = buildSampleGraph()
    const imgId = byTitle.get('分镜图')!
    const beforeLen = graph.nodes.length
    const result = applyGraphEditOps(graph, [{ op: 'node_select', nodeId: imgId }])
    expect(result.applied).toContain(`选中节点 ${imgId}`)
    expect(result.selectNodeIds).toEqual([imgId])
    expect(result.graph.nodes).toHaveLength(beforeLen)
    expect(result.applied).not.toContain('自动布局')
  })
})

/**
 * 参考图参数与 GraphPlan 物化同一套校验：放行 ≠ 可用。
 * 远端只写名字 / 没有来源的风格图必须丢弃并告警，不能静默跑出没有参考图的生成。
 */
describe('applyGraphEditOps 参考图参数校验', () => {
  it('node_upsert 保留可解析的参考图，丢弃不可解析的条目', () => {
    const { graph } = buildSampleGraph()
    const result = applyGraphEditOps(graph, [
      {
        op: 'node_upsert',
        nodeId: 'img-2',
        typeId: 'asset.image',
        title: '参考图节点',
        params: {
          styleImagesUseGlobal: false,
          styleReferenceSubject: 'ui',
          styleImages: [{ libraryId: 'character-cinematic', name: '电影感' }, { name: '没有来源' }],
          characterRefs: [
            { name: '小明', imageUrl: 'Assets/World/Characters/hero.png' },
            { name: '小红' }
          ]
        }
      }
    ])
    const node = result.graph.nodes.find((item) => item.id === 'img-2')!
    expect(node.params.styleImagesUseGlobal).toBe(false)
    expect(node.params.styleReferenceSubject).toBe('ui')
    expect(node.params.styleImages).toHaveLength(1)
    expect(node.params.characterRefs).toEqual([
      { name: '小明', imageUrl: 'Assets/World/Characters/hero.png' }
    ])
    expect(result.warnings.some((warning) => warning.includes('styleImages'))).toBe(true)
    expect(result.warnings.some((warning) => warning.includes('characterRefs'))).toBe(true)
  })

  it('node_update 单独改 styleImagesUseGlobal 时按合并后的值校验', () => {
    const { graph, byTitle } = buildSampleGraph()
    const imgId = byTitle.get('分镜图')!
    const seeded = applyGraphEditOps(graph, [
      {
        op: 'node_update',
        nodeId: imgId,
        params: { styleImages: [{ libraryId: 'character-cinematic' }] }
      }
    ])
    expect(seeded.warnings).toEqual([])
    // 只改开关：合并后本地风格图仍在，不能误判成「无风格」而把开关丢掉
    const toggled = applyGraphEditOps(seeded.graph, [
      { op: 'node_update', nodeId: imgId, params: { styleImagesUseGlobal: false } }
    ])
    expect(toggled.warnings).toEqual([])
    const node = toggled.graph.nodes.find((item) => item.id === imgId)!
    expect(node.params.styleImagesUseGlobal).toBe(false)
    expect(node.params.styleImages).toHaveLength(1)
  })

  it('node_update 传入不可解析的风格图时保留原值并告警', () => {
    const { graph, byTitle } = buildSampleGraph()
    const imgId = byTitle.get('分镜图')!
    const seeded = applyGraphEditOps(graph, [
      {
        op: 'node_update',
        nodeId: imgId,
        params: {
          styleImages: [{ libraryId: 'character-cinematic', name: '电影感' }],
          styleImagesUseGlobal: false
        }
      }
    ])
    expect(seeded.warnings).toEqual([])
    const failed = applyGraphEditOps(seeded.graph, [
      { op: 'node_update', nodeId: imgId, params: { styleImages: [{ name: '没有来源' }] } }
    ])
    const seededNode = seeded.graph.nodes.find((item) => item.id === imgId)!
    const node = failed.graph.nodes.find((item) => item.id === imgId)!
    expect(node.params.styleImages).toEqual(seededNode.params.styleImages)
    expect(node.params.styleImagesUseGlobal).toBe(false)
    expect(failed.warnings.some((warning) => warning.includes('styleImages'))).toBe(true)
    expect(failed.warnings.some((warning) => warning.includes('已保留原值'))).toBe(true)
  })
})

describe('知识科普文档转视频流水线 (graph_edit + output.timeline)', () => {
  it('支持通过 graph_edit 创建并连入 output.timeline（含 16:9 SVG 动效、画外音、配图与背景乐）', async () => {
    const emptyGraph: GraphDocument = {
      version: 1,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    const result = applyGraphEditOps(emptyGraph, [
      {
        op: 'node_add',
        nodeId: 'voice-1',
        typeId: 'voice.tts',
        title: '旁白 01',
        params: {
          prompt: '光合作用是植物利用阳光将二氧化碳和水转化为能量的过程。',
          voice: 'female'
        }
      },
      {
        op: 'node_add',
        nodeId: 'svg-1',
        typeId: 'svg.gen',
        title: 'SVG 原理图 01',
        params: {
          prompt: '光合作用能量转化流程图，深色科技风格',
          aspectRatio: '16:9'
        }
      },
      {
        op: 'node_add',
        nodeId: 'svganim-1',
        typeId: 'svg.anim',
        title: 'SVG 动效 01',
        params: {
          prompt: '箭头流动与光粒子闪烁动画',
          aspectRatio: '16:9',
          frames: 16,
          fps: 8,
          svgGifRelativePath: 'Assets/Outputs/svganim-1/anim.gif'
        }
      },
      {
        op: 'node_add',
        nodeId: 'voice-2',
        typeId: 'asset.voice',
        title: '旁白 02',
        params: {
          prompt: '叶绿体就像植物细胞内的微型太阳能发电站。'
        }
      },
      {
        op: 'node_add',
        nodeId: 'img-2',
        typeId: 'asset.image',
        title: '分镜图 02',
        params: {
          prompt: '显微视角下的叶绿体结构科普插画，16:9'
        }
      },
      {
        op: 'node_add',
        nodeId: 'bgm-1',
        typeId: 'audio.music',
        title: '科普背景音乐',
        params: {
          prompt: '轻快温暖的科普背景纯音乐'
        }
      },
      {
        op: 'node_add',
        nodeId: 'timeline-1',
        typeId: 'video.timeline',
        title: '科普成片时间线'
      },
      { op: 'edge_add', from: 'svg-1', to: 'svganim-1' },
      { op: 'edge_add', from: 'svganim-1', to: 'timeline-1' },
      { op: 'edge_add', from: 'img-2', to: 'timeline-1' },
      { op: 'edge_add', from: 'voice-1', to: 'timeline-1' },
      { op: 'edge_add', from: 'voice-2', to: 'timeline-1' },
      { op: 'edge_add', from: 'bgm-1', to: 'timeline-1' }
    ])

    expect(result.warnings).toEqual([])
    const svgGenNode = result.graph.nodes.find((n) => n.id === 'svg-1')!
    expect(svgGenNode.params.svgGenWidth).toBe(1280)
    expect(svgGenNode.params.svgGenHeight).toBe(720)

    const svgAnimNode = result.graph.nodes.find((n) => n.id === 'svganim-1')!
    expect(svgAnimNode.params.svgWidth).toBe(1280)
    expect(svgAnimNode.params.svgHeight).toBe(720)
    expect(svgAnimNode.params.svgFrames).toBe(16)

    const timelineNode = result.graph.nodes.find((n) => n.id === 'timeline-1')!
    expect(timelineNode.typeId).toBe('output.timeline')

    const toTimelineEdges = result.graph.edges.filter((e) => e.target === 'timeline-1')
    expect(toTimelineEdges.map((e) => `${e.source}:${e.sourcePort}->${e.targetPort}`)).toEqual([
      'svganim-1:out->in-image',
      'img-2:out->in-image',
      'voice-1:out->in-voice',
      'voice-2:out->in-voice',
      'bgm-1:out->in-music'
    ])

    const { executeTimelineOutputNode } = await import('../src/shared/graph/execute/narrative')
    let capturedInput: Record<string, unknown> | null = null
    const execResult = await executeTimelineOutputNode({
      node: timelineNode,
      document: result.graph,
      inputs: {
        'in-image': [
          {
            kind: 'images',
            items: [{ id: 'img-1', relativePath: 'Assets/Outputs/svganim-1/sheet.png' }]
          },
          {
            kind: 'images',
            items: [{ id: 'img-2', relativePath: 'Assets/Outputs/img-2/leaf.png' }]
          }
        ],
        'in-voice': [
          {
            kind: 'voices',
            items: [{ id: 'v-1', relativePath: 'Assets/Outputs/voice-1/v1.mp3' }]
          },
          {
            kind: 'voices',
            items: [{ id: 'v-2', relativePath: 'Assets/Outputs/voice-2/v2.mp3' }]
          }
        ],
        'in-music': [
          {
            kind: 'voices',
            items: [{ id: 'm-1', relativePath: 'Assets/Outputs/bgm-1/bgm.mp3' }]
          }
        ]
      },
      composeTimelineVideo: async (input) => {
        capturedInput = input as unknown as Record<string, unknown>
        return { relativePath: 'Assets/Outputs/timeline-1/final.mp4', assetId: 'composed-1' }
      }
    })

    expect(execResult.out).toMatchObject({
      kind: 'videos',
      items: [
        expect.objectContaining({
          id: 'composed-1',
          relativePath: 'Assets/Outputs/timeline-1/final.mp4'
        })
      ]
    })
    expect(capturedInput).toBeTruthy()
    expect(capturedInput!.visuals).toEqual([
      {
        id: 'img-1',
        kind: 'image',
        dataUrl: undefined,
        relativePath: 'Assets/Outputs/svganim-1/anim.gif',
        createdAt: undefined,
        title: 'SVG 动效 01'
      },
      {
        id: 'img-2',
        kind: 'image',
        dataUrl: undefined,
        relativePath: 'Assets/Outputs/img-2/leaf.png',
        createdAt: undefined,
        title: '分镜图 02'
      }
    ])
    expect(capturedInput!.voices).toEqual([
      {
        id: 'v-1',
        relativePath: 'Assets/Outputs/voice-1/v1.mp3',
        title: '旁白 01',
        text: '光合作用是植物利用阳光将二氧化碳和水转化为能量的过程。'
      },
      {
        id: 'v-2',
        relativePath: 'Assets/Outputs/voice-2/v2.mp3',
        title: '旁白 02',
        text: '叶绿体就像植物细胞内的微型太阳能发电站。'
      }
    ])
    expect(capturedInput!.music).toEqual([
      {
        id: 'm-1',
        relativePath: 'Assets/Outputs/bgm-1/bgm.mp3'
      }
    ])

    const { splitNarrationIntoSubtitleSegments } =
      await import('../src/renderer/src/features/graph/model/composeTimelineVideo')
    expect(
      splitNarrationIntoSubtitleSegments(
        '光合作用是植物利用阳光转化能量的过程。叶绿体就像植物细胞内的微型太阳能发电站，源源不断地输送能量！'
      )
    ).toEqual([
      '光合作用是植物利用阳光转化能量的过程',
      '叶绿体就像植物细胞内的微型太阳能发电站',
      '源源不断地输送能量'
    ])
  })

  it('支持给定多张 @Assets 照片与背景乐通过 output.timeline 生成音乐相册（自动剥离 @ 前缀并保持照片顺序）', async () => {
    const doc = { version: 1 as const, nodes: [], edges: [] }
    const res = applyGraphEditOps(doc, [
      {
        op: 'node_upsert',
        nodeId: 'photo-1',
        typeId: 'asset.image',
        title: '照片 1',
        locked: true,
        params: { sourceRelativePath: '@Assets/Images/photo1.jpg' }
      },
      {
        op: 'node_upsert',
        nodeId: 'photo-2',
        typeId: 'asset.image',
        title: '照片 2',
        locked: true,
        params: { sourceRelativePath: '@Assets/Images/photo2.jpg' }
      },
      {
        op: 'node_upsert',
        nodeId: 'photo-3',
        typeId: 'asset.image',
        title: '照片 3',
        locked: true,
        params: { sourceRelativePath: '@Assets/Images/photo3.jpg' }
      },
      {
        op: 'node_upsert',
        nodeId: 'bgm-1',
        typeId: 'asset.music',
        title: '相册背景音乐',
        params: { prompt: '温馨怀旧的木吉他轻音乐', instrumental: true }
      },
      {
        op: 'node_upsert',
        nodeId: 'timeline-out',
        typeId: 'output.timeline',
        title: '成片时间线'
      },
      { op: 'edge_add', from: 'photo-1', to: 'timeline-out' },
      { op: 'edge_add', from: 'photo-2', to: 'timeline-out' },
      { op: 'edge_add', from: 'photo-3', to: 'timeline-out' },
      { op: 'edge_add', from: 'bgm-1', to: 'timeline-out' }
    ])

    expect(res.warnings).toEqual([])
    const p1 = res.graph.nodes.find((n) => n.id === 'photo-1')!
    const p2 = res.graph.nodes.find((n) => n.id === 'photo-2')!
    const p3 = res.graph.nodes.find((n) => n.id === 'photo-3')!
    expect(p1.params.previewRelativePath).toBe('Assets/Images/photo1.jpg')
    expect(p2.params.previewRelativePath).toBe('Assets/Images/photo2.jpg')
    expect(p3.params.previewRelativePath).toBe('Assets/Images/photo3.jpg')
    expect(p1.params.generatedImages?.[0]?.id).not.toBe(p2.params.generatedImages?.[0]?.id)

    const { executeTimelineOutputNode } = await import('../src/shared/graph/execute/narrative')
    const timelineNode = res.graph.nodes.find((n) => n.id === 'timeline-out')!
    let capturedVisuals: unknown[] = []
    await executeTimelineOutputNode({
      node: timelineNode,
      document: res.graph,
      inputs: {
        'in-image': [
          {
            kind: 'image',
            id: p1.params.generatedImages![0]!.id,
            dataUrl: '',
            relativePath: 'Assets/Images/photo1.jpg'
          },
          {
            kind: 'image',
            id: p2.params.generatedImages![0]!.id,
            dataUrl: '',
            relativePath: 'Assets/Images/photo2.jpg'
          },
          {
            kind: 'image',
            id: p3.params.generatedImages![0]!.id,
            dataUrl: '',
            relativePath: 'Assets/Images/photo3.jpg'
          }
        ],
        'in-music': [
          {
            kind: 'voice',
            id: 'bgm-item-1',
            relativePath: 'Cache/Music/bgm.mp3'
          }
        ]
      },
      composeTimelineVideo: async (input) => {
        capturedVisuals = input.visuals ?? []
        return { relativePath: 'Cache/TimelineCompose/album.mp4', assetId: 'album-1' }
      }
    })

    expect(capturedVisuals.map((v: any) => v.relativePath)).toEqual([
      'Assets/Images/photo1.jpg',
      'Assets/Images/photo2.jpg',
      'Assets/Images/photo3.jpg'
    ])
    expect(capturedVisuals.map((v: any) => v.title)).toEqual(['照片 1', '照片 2', '照片 3'])
  })
})
