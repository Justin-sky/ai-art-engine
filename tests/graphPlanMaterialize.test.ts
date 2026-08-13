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
        { key: 'upscale', typeId: 'image.upscale' },
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
    expect(next.nodes[2]?.params?.generateModel).toBe('img-default')
    expect(next.nodes[2]?.params?.generateProviderInstanceId).toBe('prov-img')
    expect(next.nodes[3]?.params?.generateModel).toBeUndefined()
  })

  it('injects unified aspect ratio into image/video/upscale nodes and leaves grid-split untouched', () => {
    const plan: GraphPlan = {
      nodes: [
        {
          key: 'img',
          typeId: 'asset.image',
          params: { generateAspectRatio: '1:1' }
        },
        { key: 'vid', typeId: 'asset.video' },
        { key: 'upscale', typeId: 'image.upscale' },
        {
          key: 'split',
          typeId: 'image.gridSplit',
          params: {
            imageGridSplit: {
              rows: 2,
              cols: 2,
              selected: ['1-1'],
              scale: 2
            }
          }
        }
      ],
      edges: []
    }
    const next = applyDefaultGenerateModels(plan, {
      generateAspectRatio: '16:9'
    })
    expect(next.nodes[0]?.params?.generateAspectRatio).toBe('16:9')
    expect(next.nodes[1]?.params?.generateAspectRatio).toBe('16:9')
    expect(next.nodes[2]?.params?.generateAspectRatio).toBe('16:9')
    const split = next.nodes[3]?.params?.imageGridSplit as Record<string, unknown>
    expect(split).toMatchObject({
      rows: 2,
      cols: 2,
      selected: ['1-1']
    })
    expect(next.nodes[3]?.params?.generateAspectRatio).toBeUndefined()
    expect(next.nodes[3]?.params?.generateResolution).toBeUndefined()
  })

  it('keeps grid-split params during materialization', () => {
    const result = materializeGraphPlan(
      {
        nodes: [
          {
            key: 'split',
            typeId: 'image.gridSplit',
            params: {
              imageGridSplit: {
                rows: 2,
                cols: 2,
                selected: ['1-2']
              }
            }
          }
        ],
        edges: []
      },
      { scope: 'subgraphAsset', assetType: 'subgraph' }
    )
    expect(result.ok, result.error).toBe(true)
    const split = result.document!.nodes.find(
      (n) => n.typeId === 'image.gridSplit'
    )!
    expect(split.params.imageGridSplit).toMatchObject({
      rows: 2,
      cols: 2,
      selected: ['1-2']
    })
    expect(split.params.imageGridSplit).not.toHaveProperty('scale')
    expect(split.params.imageGridSplit).not.toHaveProperty('resolution')
  })

  it('materializes every curated preset seed plan', () => {
    for (const id of [
      'gameUaVideo',
      'characterSheet',
      'storyboardVideo',
      'productAd',
      'gameUi',
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

  it('collapses same-type host outputs into one square port with per-sink internal boundaries', () => {
    const plan = getAiWorkflowPresetPlan('shortDrama')
    expect(plan).toBeTruthy()
    const result = materializeGraphPlan(plan!, {
      scope: 'subgraphAsset',
      assetType: 'subgraph'
    })
    expect(result.ok, result.error).toBe(true)
    const iface = inferHostInterfaceFromGraph(result.document!)
    const videoOuts = iface.outputs.filter(
      (p) => p.dataType === 'video' || p.dataType === 'videos'
    )
    const textOuts = iface.outputs.filter(
      (p) => p.dataType === 'text' || p.dataType === 'texts'
    )
    // 36 路视频应收成一个视频组方形口，而不是 36 个单数口
    expect(videoOuts).toHaveLength(1)
    expect(videoOuts[0]).toMatchObject({
      dataType: 'videos',
      multiple: true
    })
    // 视频/文本各收成一个复数方形口
    expect(textOuts).toHaveLength(1)
    expect(textOuts[0]).toMatchObject({
      dataType: 'texts',
      multiple: true
    })
    expect(iface.outputs.length).toBe(2)

    const wired = ensureBoundaryProxyNodes(result.document!, iface)
    // 内部：每个视频生成节点对应一个边界输出槽节点，用单输出 out 接入
    const videoBouts = wired.nodes.filter(
      (n) =>
        n.typeId === 'graph.boundary.output' &&
        n.params.hostBoundaryPort?.portId === videoOuts[0]!.id &&
        !!n.params.hostBoundaryPort?.slotSourceId
    )
    expect(videoBouts).toHaveLength(36)
    const videoGens = wired.nodes.filter((n) => n.typeId === 'asset.video')
    expect(videoGens.length).toBe(36)
    const wiredVideos = videoGens.filter((gen) =>
      wired.edges.some(
        (e) =>
          e.source === gen.id &&
          (e.sourcePort ?? 'out') === 'out' &&
          videoBouts.some((b) => b.id === e.target)
      )
    )
    expect(wiredVideos.length).toBe(36)

    // 每个导演审核节点用单输出 out 接到自己的文本边界槽节点
    const textBouts = wired.nodes.filter(
      (n) =>
        n.typeId === 'graph.boundary.output' &&
        n.params.hostBoundaryPort?.portId === textOuts[0]!.id &&
        !!n.params.hostBoundaryPort?.slotSourceId
    )
    expect(textBouts).toHaveLength(4)
    const reviewNodes = wired.nodes.filter(
      (n) => n.typeId === 'prompt.optimize' && !!n.params.episodeReviewTarget
    )
    expect(reviewNodes.length).toBe(4)
    const wiredReviews = reviewNodes.filter((review) =>
      wired.edges.some(
        (e) =>
          e.source === review.id &&
          (e.sourcePort ?? 'out') === 'out' &&
          textBouts.some((b) => b.id === e.target)
      )
    )
    expect(wiredReviews.length).toBe(4)
    // 导演审核节点已接入原始剧本与各自上游阶段：review1(2) + review2(3) + review3(4) + review4(5)
    const reviewInEdges = wired.edges.filter(
      (e) =>
        reviewNodes.some((r) => r.id === e.target) &&
        (e.targetPort ?? 'in') === 'in' &&
        (e.sourcePort ?? 'out') === 'out'
    )
    expect(reviewInEdges.length).toBe(14)
    // 汇总主节点已被槽节点替代，内部只保留逐个拆分的边界输出
    expect(
      wired.nodes.filter((n) => n.typeId === 'graph.boundary.output').length
    ).toBe(40)
  })

  it('wires director review single out to its own boundary output', () => {
    const result = materializeGraphPlan(
      {
        title: 'Review chain',
        nodes: [
          { key: 'gen', typeId: 'prompt.optimize', title: '分镜师·拆解' },
          {
            key: 'review',
            typeId: 'prompt.optimize',
            title: '导演审核·拆解',
            params: { episodeReviewTarget: 'breakdown' }
          }
        ],
        edges: [{ from: 'gen', to: 'review', fromPort: 'out', toPort: 'in' }]
      },
      { scope: 'subgraphAsset', assetType: 'subgraph' }
    )
    expect(result.ok, result.error).toBe(true)
    const iface = inferHostInterfaceFromGraph(result.document!)
    const reviewOuts = iface.outputs.filter(
      (p) => p.dataType === 'text' && p.label.includes('导演审核')
    )
    expect(reviewOuts).toHaveLength(1)
    const wired = ensureBoundaryProxyNodes(result.document!, iface)
    const review = wired.nodes.find(
      (n) => n.typeId === 'prompt.optimize' && !!n.params.episodeReviewTarget
    )!
    const boutId = boundaryOutputNodeId(reviewOuts[0]!.id)
    expect(
      wired.edges.some(
        (e) =>
          e.source === review.id &&
          (e.sourcePort ?? 'out') === 'out' &&
          e.target === boutId
      )
    ).toBe(true)
  })
})
