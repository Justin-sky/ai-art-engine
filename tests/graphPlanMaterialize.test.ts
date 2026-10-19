import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyDefaultGenerateModels,
  ensureBoundaryProxyNodes,
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
    const split = result.document!.nodes.find((n) => n.typeId === 'image.gridSplit')!
    expect(split.params.imageGridSplit).toMatchObject({
      rows: 2,
      cols: 2,
      selected: ['1-2']
    })
    expect(split.params.imageGridSplit).not.toHaveProperty('scale')
    expect(split.params.imageGridSplit).not.toHaveProperty('resolution')
  })

  it('keeps params declared by the node type itself (anim.2d)', () => {
    const result = materializeGraphPlan(
      {
        nodes: [
          {
            key: 'anim',
            typeId: 'anim.2d',
            params: { animRows: 2, animCols: 5, animGifFps: 12, animPresetId: 'walk' }
          }
        ],
        edges: []
      },
      { scope: 'subgraphAsset', assetType: 'subgraph' }
    )
    expect(result.ok, result.error).toBe(true)
    expect(result.warnings).toEqual([])
    const anim = result.document!.nodes.find((n) => n.typeId === 'anim.2d')!
    expect(anim.params.animRows).toBe(2)
    expect(anim.params.animCols).toBe(5)
    expect(anim.params.animGifFps).toBe(12)
  })

  it('warns instead of silently dropping undeclared params', () => {
    const result = materializeGraphPlan(
      {
        nodes: [{ key: 'anim', typeId: 'anim.2d', params: { animCol: 5, bogus: 1 } }],
        edges: []
      },
      { scope: 'subgraphAsset', assetType: 'subgraph' }
    )
    expect(result.ok, result.error).toBe(true)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('animCol')
    expect(result.warnings[0]).toContain('bogus')
    // 被丢弃的键回落节点默认值（漏报会让「任务跑完但产物不对」变成静默失败）
    const anim = result.document!.nodes.find((n) => n.typeId === 'anim.2d')!
    expect(anim.params.animCols).toBe(4)
  })

  it('keeps resolvable style-reference params and drops unresolvable style images', () => {
    const result = materializeGraphPlan(
      {
        nodes: [
          {
            key: 'img',
            typeId: 'asset.image',
            params: {
              styleImagesUseGlobal: false,
              styleReferenceSubject: 'ui',
              styleImages: [
                { libraryId: 'character-cinematic', name: '电影感' },
                { name: '没有来源的图' }
              ]
            }
          }
        ],
        edges: []
      },
      { scope: 'subgraphAsset', assetType: 'subgraph' }
    )
    expect(result.ok, result.error).toBe(true)
    const img = result.document!.nodes.find((n) => n.typeId === 'asset.image')!
    expect(img.params.styleImagesUseGlobal).toBe(false)
    expect(img.params.styleReferenceSubject).toBe('ui')
    expect(img.params.styleImages).toHaveLength(1)
    expect(img.params.styleImages?.[0]).toMatchObject({
      libraryId: 'character-cinematic',
      name: '电影感'
    })
    expect(result.warnings.some((w) => w.includes('styleImages'))).toBe(true)
  })

  it('falls back to global style when local style images resolve to nothing', () => {
    const result = materializeGraphPlan(
      {
        nodes: [
          {
            key: 'img',
            typeId: 'asset.image',
            params: { styleImagesUseGlobal: false, styleImages: [{ name: 'no-source' }] }
          }
        ],
        edges: []
      },
      { scope: 'subgraphAsset', assetType: 'subgraph' }
    )
    expect(result.ok, result.error).toBe(true)
    const img = result.document!.nodes.find((n) => n.typeId === 'asset.image')!
    // 两条都回落：本地风格图清空 + 关掉全局风格的开关一起丢，避免「无风格但报成功」
    expect(img.params.styleImages).toBeUndefined()
    expect(img.params.styleImagesUseGlobal).toBeUndefined()
    expect(result.warnings.some((w) => w.includes('回落使用工程全局风格'))).toBe(true)
  })

  it('rejects malformed style switches', () => {
    const result = materializeGraphPlan(
      {
        nodes: [
          {
            key: 'img',
            typeId: 'asset.image',
            params: { styleImagesUseGlobal: 'yes', styleReferenceSubject: 'banner' }
          }
        ],
        edges: []
      },
      { scope: 'subgraphAsset', assetType: 'subgraph' }
    )
    expect(result.ok, result.error).toBe(true)
    const img = result.document!.nodes.find((n) => n.typeId === 'asset.image')!
    expect(img.params.styleImagesUseGlobal).toBeUndefined()
    expect(img.params.styleReferenceSubject).toBeUndefined()
    expect(result.warnings.some((w) => w.includes('styleImagesUseGlobal'))).toBe(true)
    expect(result.warnings.some((w) => w.includes('styleReferenceSubject'))).toBe(true)
  })

  it('keeps character refs only when they carry a resolvable imageUrl', () => {
    const result = materializeGraphPlan(
      {
        nodes: [
          {
            key: 'img',
            typeId: 'asset.image',
            params: {
              characterRefs: [
                { name: '小明', imageUrl: 'Assets/World/Characters/hero.png' },
                { name: '小红' }
              ]
            }
          }
        ],
        edges: []
      },
      { scope: 'subgraphAsset', assetType: 'subgraph' }
    )
    expect(result.ok, result.error).toBe(true)
    const img = result.document!.nodes.find((n) => n.typeId === 'asset.image')!
    expect(img.params.characterRefs).toEqual([
      { name: '小明', imageUrl: 'Assets/World/Characters/hero.png' }
    ])
    expect(result.warnings.some((w) => w.includes('characterRefs'))).toBe(true)
  })

  it('materializes multi-track timeline + anchor + svg workflow plan and all sibling market workflows when present', () => {
    const timelinePlan: GraphPlan = {
      title: '科普动画全流程',
      nodes: [
        { key: 'script', typeId: 'play.script', title: '科普脚本' },
        { key: 'anchor', typeId: 'asset.image', title: '风格锚点' },
        { key: 'svgGen', typeId: 'svg.gen', title: 'SVG 图解' },
        { key: 'svgAnim', typeId: 'svg.anim', title: 'SVG 动效' },
        { key: 'shot1Img', typeId: 'asset.image', title: '镜头1图' },
        { key: 'shot1Vid', typeId: 'asset.video', title: '镜头1视频' },
        { key: 'shot1Voice', typeId: 'asset.voice', title: '镜头1配音' },
        { key: 'bgm', typeId: 'asset.music', title: '背景音乐' },
        { key: 'timeline', typeId: 'output.timeline', title: '成片时间线' }
      ],
      edges: [
        { from: 'script', to: 'anchor', fromPort: 'out', toPort: 'in-text' },
        { from: 'script', to: 'svgGen', fromPort: 'out', toPort: 'in' },
        { from: 'svgGen', to: 'svgAnim', fromPort: 'out', toPort: 'in' },
        { from: 'script', to: 'shot1Img', fromPort: 'out', toPort: 'in-text' },
        { from: 'anchor', to: 'shot1Img', fromPort: 'out', toPort: 'in-image' },
        { from: 'shot1Img', to: 'shot1Vid', fromPort: 'out', toPort: 'in-image' },
        { from: 'script', to: 'shot1Voice', fromPort: 'out', toPort: 'in-text' },
        { from: 'svgAnim', to: 'timeline', fromPort: 'out-gif', toPort: 'in-image' },
        { from: 'shot1Vid', to: 'timeline', fromPort: 'out', toPort: 'in' },
        { from: 'shot1Voice', to: 'timeline', fromPort: 'out', toPort: 'in-voice' },
        { from: 'bgm', to: 'timeline', fromPort: 'out', toPort: 'in-music' }
      ]
    }
    const baseResult = materializeGraphPlan(timelinePlan, {
      scope: 'subgraphAsset',
      assetType: 'subgraph'
    })
    expect(baseResult.ok, baseResult.error).toBe(true)
    expect(baseResult.warnings).toEqual([])
    expect(baseResult.document!.nodes.some((n) => n.typeId === 'output.timeline')).toBe(true)

    const skillsWorkflowsDir = resolve(process.cwd(), '../ai-art-engine-skills/workflows')
    if (existsSync(skillsWorkflowsDir)) {
      const slugs = readdirSync(skillsWorkflowsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
      expect(slugs.length).toBeGreaterThanOrEqual(18)
      for (const slug of slugs) {
        const wfPath = resolve(skillsWorkflowsDir, slug, 'workflow.json')
        if (!existsSync(wfPath)) continue
        const wf = JSON.parse(readFileSync(wfPath, 'utf8')) as { plan?: GraphPlan }
        expect(wf.plan, slug).toBeTruthy()
        const result = materializeGraphPlan(wf.plan!, {
          scope: 'subgraphAsset',
          assetType: 'subgraph'
        })
        expect(result.ok, `${slug}: ${result.error}`).toBe(true)
        expect(result.document!.nodes.length).toBeGreaterThanOrEqual(wf.plan!.nodes.length)
        expect(result.warnings, `${slug}: ${result.warnings.join('; ')}`).toEqual([])
      }
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
      const toBout = wired.edges.filter((e) => e.source === gen.id && boutIds.includes(e.target))
      expect(toBout).toHaveLength(1)
    }
    expect(
      new Set(wired.edges.filter((e) => boutIds.includes(e.target)).map((e) => e.target)).size
    ).toBe(3)
  })

  it('collapses same-type host outputs into one square port with per-sink internal boundaries', () => {
    // 6 路视频 + 3 路审核文本：同类型出口应各收成一个复数方形口（旧版用 36 镜短剧预设验证同一规则）
    const videoKeys = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6']
    const reviewKeys = ['r1', 'r2', 'r3']
    const plan: GraphPlan = {
      title: 'Collapse outputs',
      nodes: [
        { key: 'script', typeId: 'play.script', title: '剧本' },
        ...videoKeys.map((key) => ({ key, typeId: 'asset.video', title: `视频 ${key}` })),
        ...reviewKeys.map((key) => ({
          key,
          typeId: 'prompt.optimize',
          title: `导演审核 ${key}`,
          params: { episodeReviewTarget: 'breakdown' }
        }))
      ],
      edges: [
        ...videoKeys.map((key) => ({
          from: 'script',
          to: key,
          fromPort: 'out',
          toPort: 'in-text'
        })),
        ...reviewKeys.map((key) => ({ from: 'script', to: key, fromPort: 'out', toPort: 'in' }))
      ]
    }
    const result = materializeGraphPlan(plan, {
      scope: 'subgraphAsset',
      assetType: 'subgraph'
    })
    expect(result.ok, result.error).toBe(true)
    const iface = inferHostInterfaceFromGraph(result.document!)
    const videoOuts = iface.outputs.filter((p) => p.dataType === 'video' || p.dataType === 'videos')
    const textOuts = iface.outputs.filter((p) => p.dataType === 'text' || p.dataType === 'texts')
    expect(videoOuts).toHaveLength(1)
    expect(videoOuts[0]).toMatchObject({ dataType: 'videos', multiple: true })
    expect(textOuts).toHaveLength(1)
    expect(textOuts[0]).toMatchObject({ dataType: 'texts', multiple: true })
    expect(iface.outputs.length).toBe(2)

    const wired = ensureBoundaryProxyNodes(result.document!, iface)
    const videoBouts = wired.nodes.filter(
      (n) =>
        n.typeId === 'graph.boundary.output' &&
        n.params.hostBoundaryPort?.portId === videoOuts[0]!.id &&
        !!n.params.hostBoundaryPort?.slotSourceId
    )
    expect(videoBouts).toHaveLength(videoKeys.length)
    const videoGens = wired.nodes.filter((n) => n.typeId === 'asset.video')
    const wiredVideos = videoGens.filter((gen) =>
      wired.edges.some(
        (e) =>
          e.source === gen.id &&
          (e.sourcePort ?? 'out') === 'out' &&
          videoBouts.some((b) => b.id === e.target)
      )
    )
    expect(wiredVideos.length).toBe(videoKeys.length)

    const textBouts = wired.nodes.filter(
      (n) =>
        n.typeId === 'graph.boundary.output' &&
        n.params.hostBoundaryPort?.portId === textOuts[0]!.id &&
        !!n.params.hostBoundaryPort?.slotSourceId
    )
    expect(textBouts).toHaveLength(reviewKeys.length)
    expect(wired.nodes.filter((n) => n.typeId === 'graph.boundary.output').length).toBe(
      videoKeys.length + reviewKeys.length
    )
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
        (e) => e.source === review.id && (e.sourcePort ?? 'out') === 'out' && e.target === boutId
      )
    ).toBe(true)
  })

  it('injects text/image/video models and aspect ratio into film.workbench and wires its plural output port to boundary.output', () => {
    const rawShortDramaPlan: GraphPlan = {
      title: '影视全流程（Agent 闭环）',
      nodes: [
        { key: 'script', typeId: 'play.script', title: '剧本' },
        {
          key: 'workbench',
          typeId: 'film.workbench',
          title: '影视工作台',
          params: {
            filmAspectRatio: '9:16',
            filmTargetShots: 0,
            filmReviewMaxRounds: 2,
            filmCastKinds: 'character,location',
            filmRenderMode: 'video',
            filmRenderQc: true,
            filmRenderMaxRetries: 1
          }
        },
        { key: 'note', typeId: 'note.text', title: '流水线说明' }
      ],
      edges: [{ from: 'script', to: 'workbench', fromPort: 'out', toPort: 'in' }]
    }
    const plan = applyDefaultGenerateModels(rawShortDramaPlan, {
      textModel: 'txt-model',
      textProviderInstanceId: 'prov-txt',
      imageModel: 'img-model',
      imageProviderInstanceId: 'prov-img',
      videoModel: 'vid-model',
      videoProviderInstanceId: 'prov-vid',
      generateAspectRatio: '9:16'
    })
    const wbSpec = plan.nodes.find((n) => n.typeId === 'film.workbench')!
    expect(wbSpec.params).toMatchObject({
      filmTextModel: 'txt-model',
      filmTextProviderInstanceId: 'prov-txt',
      generateModel: 'img-model',
      generateProviderInstanceId: 'prov-img',
      filmVideoModel: 'vid-model',
      filmVideoProviderInstanceId: 'prov-vid',
      filmAspectRatio: '9:16'
    })

    const materialized = materializeGraphPlan(plan, {
      scope: 'subgraphAsset',
      assetType: 'subgraph'
    })
    expect(materialized.ok, materialized.error).toBe(true)
    const iface = inferHostInterfaceFromGraph(materialized.document!)
    expect(iface.outputs).toEqual([
      expect.objectContaining({
        id: 'out',
        dataType: 'videos',
        multiple: true
      })
    ])

    const wired = ensureBoundaryProxyNodes(materialized.document!, iface)
    const wbNode = wired.nodes.find((n) => n.typeId === 'film.workbench')!
    const boutId = boundaryOutputNodeId('out')
    expect(
      wired.edges.some(
        (e) => e.source === wbNode.id && e.sourcePort === 'out-videos' && e.target === boutId
      )
    ).toBe(true)

    // 切换为 keyframes 模式时，自动改接 out-images（images 复数口）
    wbNode.params = { ...wbNode.params, filmRenderMode: 'keyframes' }
    const kfIface = inferHostInterfaceFromGraph(wired)
    expect(kfIface.outputs).toEqual([
      expect.objectContaining({
        id: 'out',
        dataType: 'images',
        multiple: true
      })
    ])
    const kfWired = ensureBoundaryProxyNodes(wired, kfIface)
    expect(
      kfWired.edges.some(
        (e) => e.source === wbNode.id && e.sourcePort === 'out-images' && e.target === boutId
      )
    ).toBe(true)
  })
})
