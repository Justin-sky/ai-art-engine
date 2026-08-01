import { describe, expect, it } from 'vitest'
import {
  applyDefaultGenerateModels,
  ensureBoundaryProxyNodes,
  getAiWorkflowPresetPlan,
  inferHostInterfaceFromGraph,
  materializeGraphPlan,
  parseGraphPlanJson,
  type GraphPlan
} from '../src/shared/graph'
import { boundaryOutputNodeId } from '../src/shared/graph/hostInterface'

describe('graphPlan materialize', () => {
  it('parses fenced JSON GraphPlan', () => {
    const plan = parseGraphPlanJson(`\`\`\`json
{"title":"UA","nodes":[{"key":"a","typeId":"play.script"}],"edges":[]}
\`\`\``)
    expect(plan.title).toBe('UA')
    expect(plan.nodes[0]?.typeId).toBe('play.script')
  })

  it('materializes a simple script → image → video chain', () => {
    const plan: GraphPlan = {
      title: '买量视频',
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
    const result = materializeGraphPlan(plan, {
      scope: 'subgraphAsset',
      assetType: 'subgraph'
    })
    expect(result.ok, result.error).toBe(true)
    expect(result.document).toBeTruthy()
    expect(result.title).toBe('买量视频')
    const typeIds = result.document!.nodes.map((n) => n.typeId)
    expect(typeIds).toContain('play.script')
    expect(typeIds).toContain('asset.image')
    expect(typeIds).toContain('asset.video')
    expect(result.document!.edges.length).toBeGreaterThanOrEqual(2)
  })

  it('skips unknown typeIds and incompatible edges', () => {
    const plan: GraphPlan = {
      nodes: [
        { key: 'a', typeId: 'play.script' },
        { key: 'bad', typeId: 'not.a.real.type' },
        { key: 'b', typeId: 'asset.video' }
      ],
      edges: [
        { from: 'a', to: 'missing' },
        { from: 'a', to: 'b', fromPort: 'out', toPort: 'in' }
      ]
    }
    const result = materializeGraphPlan(plan, {
      scope: 'subgraphAsset',
      assetType: 'subgraph'
    })
    expect(result.ok).toBe(true)
    expect(result.warnings.some((w) => w.includes('not.a.real.type'))).toBe(true)
    expect(result.warnings.some((w) => w.includes('不存在的节点'))).toBe(true)
    expect(result.document!.nodes.some((n) => n.typeId === 'not.a.real.type')).toBe(false)
  })

  it('fails when no usable nodes remain', () => {
    const result = materializeGraphPlan(
      { nodes: [{ key: 'x', typeId: 'totally.fake' }], edges: [] },
      { scope: 'subgraphAsset' }
    )
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/没有可用节点/)
  })

  it('applies default image/video models only when missing', () => {
    const plan: GraphPlan = {
      nodes: [
        {
          key: 'img',
          typeId: 'asset.image',
          params: { generateModel: 'keep-me' }
        },
        { key: 'vid', typeId: 'asset.video' },
        { key: 'txt', typeId: 'play.script' }
      ],
      edges: []
    }
    const next = applyDefaultGenerateModels(plan, {
      imageModel: 'img-default',
      imageProviderInstanceId: 'prov-img',
      videoModel: 'vid-default',
      videoProviderInstanceId: 'prov-vid'
    })
    expect(next.nodes[0]?.params?.generateModel).toBe('keep-me')
    expect(next.nodes[0]?.params?.generateProviderInstanceId).toBe('prov-img')
    expect(next.nodes[1]?.params?.generateModel).toBe('vid-default')
    expect(next.nodes[1]?.params?.generateProviderInstanceId).toBe('prov-vid')
    expect(next.nodes[2]?.params?.generateModel).toBeUndefined()
  })

  it('materializes every curated preset seed plan', () => {
    for (const id of [
      'gameUaVideo',
      'characterSheet',
      'storyboardVideo',
      'productAd',
      'shortDrama'
    ] as const) {
      const plan = getAiWorkflowPresetPlan(id)
      expect(plan, id).toBeTruthy()
      const result = materializeGraphPlan(plan!, {
        scope: 'subgraphAsset',
        assetType: 'subgraph'
      })
      expect(result.ok, `${id}: ${result.error}`).toBe(true)
      expect(result.document!.nodes.length).toBeGreaterThanOrEqual(plan!.nodes.length)
    }
  })

  it('infers video host output for script → image → video chain', () => {
    const result = materializeGraphPlan(
      {
        title: 'UA',
        nodes: [
          { key: 'script', typeId: 'play.script' },
          { key: 'img', typeId: 'asset.image' },
          { key: 'vid', typeId: 'asset.video' }
        ],
        edges: [
          { from: 'script', to: 'img' },
          { from: 'img', to: 'vid' }
        ]
      },
      { scope: 'subgraphAsset', assetType: 'subgraph' }
    )
    expect(result.ok).toBe(true)
    const iface = inferHostInterfaceFromGraph(result.document!)
    expect(iface.outputs.some((p) => p.dataType === 'video')).toBe(true)
    expect(iface.outputs.some((p) => p.dataType === 'text')).toBe(false)
  })

  it('infers one image host output per parallel image sink (character sheet)', () => {
    const result = materializeGraphPlan(
      {
        title: '角色设定',
        nodes: [
          { key: 'bio', typeId: 'play.script', title: '人设描述' },
          {
            key: 'front',
            typeId: 'asset.image',
            title: '正面立绘',
            params: { generateInstruction: '正面' }
          },
          {
            key: 'side',
            typeId: 'asset.image',
            title: '侧面立绘',
            params: { generateInstruction: '侧面' }
          },
          {
            key: 'expr',
            typeId: 'asset.image',
            title: '表情变体',
            params: { generateInstruction: '表情' }
          },
          { key: 'note', typeId: 'note.text', title: '设定备注' }
        ],
        edges: [
          { from: 'bio', to: 'front' },
          { from: 'bio', to: 'side' },
          { from: 'bio', to: 'expr' }
        ]
      },
      { scope: 'subgraphAsset', assetType: 'subgraph' }
    )
    expect(result.ok).toBe(true)
    const iface = inferHostInterfaceFromGraph(result.document!)
    const imageOuts = iface.outputs.filter((p) => p.dataType === 'image')
    expect(imageOuts).toHaveLength(3)
    expect(imageOuts.map((p) => p.label)).toEqual(['正面立绘', '侧面立绘', '表情变体'])
    // 备注便签不暴露为宿主出口
    expect(iface.outputs.some((p) => p.label === '设定备注')).toBe(false)

    const wired = ensureBoundaryProxyNodes(result.document!, iface)
    const boutIds = imageOuts.map((p) => boundaryOutputNodeId(p.id))
    expect(boutIds.every((id) => wired.nodes.some((n) => n.id === id))).toBe(true)
    // 三个立绘各接到一个边界输出，互不挤在同一口
    const imageGens = wired.nodes.filter((n) => n.typeId === 'asset.image')
    expect(imageGens).toHaveLength(3)
    for (const gen of imageGens) {
      const toBout = wired.edges.filter(
        (e) => e.source === gen.id && boutIds.includes(e.target)
      )
      expect(toBout).toHaveLength(1)
    }
    expect(
      new Set(
        wired.edges.filter((e) => boutIds.includes(e.target)).map((e) => e.target)
      ).size
    ).toBe(3)
  })
})
