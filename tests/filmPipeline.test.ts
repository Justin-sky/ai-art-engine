import { describe, expect, it, vi } from 'vitest'
import {
  applyFilmReview,
  composeFilmShotImagePrompt,
  composeFilmShotVideoPrompt,
  createNodeFromType,
  executeFilmBreakdownNode,
  executeFilmCastNode,
  executeFilmRenderNode,
  executeFilmReviewNode,
  executeFilmShotNode,
  filmStoryboardValue,
  getAiWorkflowPresetPlan,
  getNodeType,
  GraphPortType,
  listAddableNodeTypes,
  matchFilmCastForShot,
  materializeGraphPlan,
  mergeFilmStoryboards,
  parseFilmCast,
  parseFilmRenderCache,
  parseFilmReview,
  parseFilmShotRange,
  parseFilmStoryboard,
  portsCompatible,
  selectFilmShot,
  type FilmCast,
  type FilmStoryboard,
  type GraphNode,
  type GraphValue,
  type NodeExecuteContext
} from '../src/shared/graph'

const MODEL_STORYBOARD = `\`\`\`json
{
  "title": "雨夜",
  "style": "冷色写实电影感",
  "aspectRatio": "16:9",
  "entities": [
    { "kind": "character", "name": "林夏", "description": "二十多岁女性，短发，黑色风衣" },
    { "kind": "location", "name": "旧公寓走廊", "description": "昏黄壁灯，潮湿墙面" }
  ],
  "scenes": [{ "id": "scene-1", "heading": "INT. 旧公寓走廊 - 夜", "location": "旧公寓走廊" }],
  "shots": [
    { "sceneId": "scene-1", "shotSize": "LS", "cameraMove": "缓推", "durationSec": 4,
      "characters": ["林夏"], "location": "旧公寓走廊", "action": "林夏走进走廊",
      "imagePrompt": "长走廊纵深构图，林夏在远处", "videoPrompt": "0-4秒 林夏缓步走近" },
    { "sceneId": "scene-1", "shotSize": "CU", "durationSec": 3,
      "characters": ["林夏", "老周"], "location": "旧公寓走廊", "action": "林夏回头",
      "dialogue": [{ "speaker": "林夏", "line": "谁在那里？" }],
      "imagePrompt": "林夏侧脸特写", "videoPrompt": "0-3秒 回头" }
  ]
}
\`\`\``

function ctxFor(
  node: GraphNode,
  inputs: Record<string, GraphValue[]>,
  extra: Partial<NodeExecuteContext> = {}
): NodeExecuteContext {
  return {
    node,
    inputs,
    locale: 'zh-CN',
    patchNode: (patch) => {
      if (patch.params) node.params = { ...node.params, ...patch.params }
    },
    ...extra
  }
}

function sampleStoryboard(): FilmStoryboard {
  const doc = parseFilmStoryboard(MODEL_STORYBOARD)
  if (!doc) throw new Error('sample storyboard should parse')
  return doc
}

function sampleCast(): FilmCast {
  return {
    schema: 'aiart.film-cast@1',
    style: '',
    entries: [
      {
        id: 'c1',
        kind: 'character',
        name: '林夏',
        description: '',
        imageRelativePath: 'Cast/linxia.png'
      },
      {
        id: 'l1',
        kind: 'location',
        name: '旧公寓走廊',
        description: '',
        imageRelativePath: 'Cast/hall.png'
      }
    ]
  }
}

describe('film storyboard model', () => {
  it('parses fenced model output, assigns shot ids and back-fills missing entities', () => {
    const doc = sampleStoryboard()
    expect(doc.shots.map((shot) => shot.id)).toEqual(['S01-01', 'S01-02'])
    expect(doc.shots[1].dialogue).toEqual([{ speaker: '林夏', line: '谁在那里？' }])
    // 镜头里出现但实体表没有的「老周」被自动补进实体表，等待设定库补全描述
    expect(doc.entities.some((e) => e.kind === 'character' && e.name === '老周')).toBe(true)
  })

  it('accepts Chinese keys and a bare shots array', () => {
    const doc = parseFilmStoryboard(
      JSON.stringify([{ 景别: 'MS', 角色: '甲、乙', 地点: '码头', 画面: '两人对峙', 时长: '5' }])
    )
    expect(doc?.shots[0]).toMatchObject({
      shotSize: 'MS',
      characters: ['甲', '乙'],
      location: '码头',
      action: '两人对峙',
      durationSec: 5
    })
    expect(doc?.scenes[0]?.location).toBe('码头')
  })

  it('keeps locked shots and reusable media when re-breaking down', () => {
    const previous = sampleStoryboard()
    previous.shots[0] = { ...previous.shots[0], locked: true, action: '人工改过的动作' }
    previous.shots[1] = { ...previous.shots[1], media: { keyframe: 'Film/S01-02.png' } }
    const next = sampleStoryboard()
    next.shots[0] = { ...next.shots[0], action: 'AI 新稿' }
    const merged = mergeFilmStoryboards(previous, next)
    expect(merged.shots[0].action).toBe('人工改过的动作')
    expect(merged.shots[1].media?.keyframe).toBe('Film/S01-02.png')
  })

  it('selects shots by index or id and parses ranges', () => {
    const doc = sampleStoryboard()
    expect(selectFilmShot(doc, '2')?.id).toBe('S01-02')
    expect(selectFilmShot(doc, 's01-01')?.id).toBe('S01-01')
    expect(selectFilmShot(doc, 'nope')).toBeNull()
    expect(parseFilmShotRange('', doc.shots)).toEqual([0, 1])
    expect(parseFilmShotRange('2,S01-01,9', doc.shots)).toEqual([0, 1])
  })

  it('composes prompts that bind cast references and keep dialogue verbatim', () => {
    const doc = sampleStoryboard()
    const refs = matchFilmCastForShot(sampleCast(), doc.shots[1])
    expect(refs.map((ref) => ref.name)).toEqual(['林夏', '旧公寓走廊'])
    const image = composeFilmShotImagePrompt(doc, doc.shots[1], refs)
    expect(image).toContain('林夏以参考图@1为准')
    expect(image).toContain('冷色写实电影感')
    expect(composeFilmShotVideoPrompt(doc.shots[1])).toContain('“谁在那里？”')
  })

  it('applies a structured review (fail → revise, locked shots keep status)', () => {
    const doc = sampleStoryboard()
    doc.shots[0] = { ...doc.shots[0], locked: true, status: 'approved' }
    const review = parseFilmReview(
      '{"verdict":"PASS","score":90,"shots":[{"id":"S01-01","verdict":"fail","notes":"x"},{"id":"S01-02","verdict":"fail","notes":"景别重复"}]}'
    )!
    // 有失败镜头时即使模型写 PASS 也判 FAIL
    expect(review.verdict).toBe('FAIL')
    const applied = applyFilmReview(doc, review, 1)
    expect(applied.shots[0].status).toBe('approved')
    expect(applied.shots[1].status).toBe('revise')
    expect(applied.shots[1].review?.notes).toBe('景别重复')
  })

  it('projects storyboard / cast documents onto text ports one-way only', () => {
    expect(portsCompatible(GraphPortType.storyboard, GraphPortType.text)).toBe(true)
    expect(portsCompatible(GraphPortType.filmCast, GraphPortType.text)).toBe(true)
    expect(portsCompatible(GraphPortType.text, GraphPortType.storyboard)).toBe(false)
    expect(portsCompatible(GraphPortType.storyboard, GraphPortType.filmCast)).toBe(false)
  })
})

describe('film nodes', () => {
  it('exposes the five film nodes and removes the legacy episode / beat / world nodes', () => {
    const ids = listAddableNodeTypes('workflow').map((def) => def.typeId)
    for (const id of ['film.breakdown', 'film.review', 'film.cast', 'film.shot', 'film.render']) {
      expect(ids).toContain(id)
    }
    for (const id of [
      'beat.select',
      'beat.split',
      'beat.table',
      'beat.gen',
      'beat.unitGen',
      'beat.unitRef',
      'episode.anchorSelect',
      'episode.cellSelect',
      'world.extract',
      'world.table',
      'world.gen',
      'output.beat',
      'output.beatUnit',
      'output.world'
    ]) {
      expect(getNodeType(id)).toBeUndefined()
    }
  })

  it('breakdown repairs invalid JSON once, then reuses the storyboard while the script is unchanged', async () => {
    const node = createNodeFromType('film.breakdown', { x: 0, y: 0 })
    const generateText = vi
      .fn()
      .mockResolvedValueOnce({ text: '好的，这是分镜：', model: 'm' })
      .mockResolvedValueOnce({ text: MODEL_STORYBOARD, model: 'm' })
    const inputs = { in: [{ kind: 'text', text: '林夏雨夜回到旧公寓……' } as GraphValue] }
    const out = await executeFilmBreakdownNode(ctxFor(node, inputs, { generateText }))
    expect(generateText).toHaveBeenCalledTimes(2)
    expect(out.out.kind).toBe('storyboard')
    expect(out['out-text'].kind).toBe('text')
    expect(parseFilmStoryboard(node.params.filmStoryboard ?? '')?.shots).toHaveLength(2)

    const again = await executeFilmBreakdownNode(ctxFor(node, inputs, { generateText }))
    expect(generateText).toHaveBeenCalledTimes(2)
    expect(again.out.kind).toBe('storyboard')
  })

  it('review closes the loop: FAIL → revise failing shots → PASS', async () => {
    const node = createNodeFromType('film.review', { x: 0, y: 0 })
    const generateText = vi
      .fn()
      .mockResolvedValueOnce({
        text: '{"verdict":"FAIL","score":60,"shots":[{"id":"S01-02","verdict":"fail","notes":"改成过肩反打"}]}',
        model: 'm'
      })
      .mockResolvedValueOnce({
        text: '{"shots":[{"id":"S01-02","shotSize":"OTS","characters":["林夏"],"location":"旧公寓走廊","action":"过肩反打林夏回头","imagePrompt":"过肩构图","videoPrompt":"0-3秒 回头"}]}',
        model: 'm'
      })
      .mockResolvedValueOnce({ text: '{"verdict":"PASS","score":88,"shots":[]}', model: 'm' })
    const out = await executeFilmReviewNode(
      ctxFor(node, { in: [filmStoryboardValue(sampleStoryboard())] }, { generateText })
    )
    expect(generateText).toHaveBeenCalledTimes(3)
    const doc = (out.out as { doc: FilmStoryboard }).doc
    expect(doc.review?.verdict).toBe('PASS')
    expect(doc.review?.rounds).toBe(2)
    expect(doc.shots[1]).toMatchObject({ id: 'S01-02', shotSize: 'OTS', status: 'draft' })
    expect(node.params.filmReviewVerdict).toBe('PASS')
  })

  it('cast generates one design sheet per entity and skips unchanged ones next run', async () => {
    const node = createNodeFromType('film.cast', { x: 0, y: 0 })
    const generateImage = vi
      .fn()
      .mockResolvedValue({ images: ['data:image/png;base64,AAAA'], model: 'img' })
    const saveRunMedia = vi.fn(async ({ key }: { key: string }) => `Cast/${key}.png`)
    const inputs = { in: [filmStoryboardValue(sampleStoryboard())] }
    await executeFilmCastNode(ctxFor(node, inputs, { generateImage, saveRunMedia }))
    const cast = parseFilmCast(node.params.filmCast ?? '')
    // 默认只做角色 + 地点：林夏、老周、旧公寓走廊
    expect(cast?.entries).toHaveLength(3)
    expect(cast?.entries.every((entry) => !!entry.imageRelativePath)).toBe(true)
    expect(generateImage).toHaveBeenCalledTimes(3)

    await executeFilmCastNode(ctxFor(node, inputs, { generateImage, saveRunMedia }))
    expect(generateImage).toHaveBeenCalledTimes(3)
  })

  it('shot node emits prompts and the cast refs for one shot', async () => {
    const node = createNodeFromType('film.shot', { x: 0, y: 0 }, { params: { filmShotRef: '2' } })
    const out = await executeFilmShotNode(
      ctxFor(node, {
        in: [filmStoryboardValue(sampleStoryboard())],
        'in-cast': [{ kind: 'filmCast', doc: sampleCast(), text: '' }]
      })
    )
    expect((out.out as { text: string }).text).toContain('林夏侧脸特写')
    expect((out['out-motion'] as { text: string }).text).toContain('谁在那里')
    expect((out['out-refs'] as { items: unknown[] }).items).toHaveLength(2)
  })

  it('render retakes on QC failure, renders video from the keyframe, and caches by fingerprint', async () => {
    const node = createNodeFromType(
      'film.render',
      { x: 0, y: 0 },
      {
        params: { filmRenderMode: 'video', filmRenderQc: true, filmRenderMaxRetries: 1 }
      }
    )
    const generateImage = vi
      .fn()
      .mockResolvedValue({ images: ['data:image/png;base64,BBBB'], model: 'img' })
    let qcCalls = 0
    const generateText = vi.fn(async () => {
      qcCalls += 1
      // 第 1 镜第一次质检不过，其余都过
      return {
        text: qcCalls === 1 ? '{"pass":false,"issues":"人物太小"}' : '{"pass":true}',
        model: 'v'
      }
    })
    const generateVideo = vi.fn(async (input: { firstFrameImageUrl?: string; name?: string }) => ({
      assetId: 'a',
      relativePath: `Film/${input.name}.mp4`,
      model: 'vid'
    }))
    const saveRunMedia = vi.fn(async ({ key }: { key: string }) => `Film/${key}.png`)
    const resolveImageUrls = vi.fn(
      async (items: Array<{ dataUrl?: string; relativePath?: string }>) =>
        items.map((item) => item.dataUrl || `file://${item.relativePath}`)
    )
    const inputs = {
      in: [filmStoryboardValue(sampleStoryboard())],
      'in-cast': [{ kind: 'filmCast', doc: sampleCast(), text: '' } as GraphValue]
    }
    const extra = { generateImage, generateText, generateVideo, saveRunMedia, resolveImageUrls }
    const out = await executeFilmRenderNode(ctxFor(node, inputs, extra))

    // 2 镜 + 1 次重拍
    expect(generateImage).toHaveBeenCalledTimes(3)
    const firstCall = generateImage.mock.calls[0][0] as { inputReferences?: string[] }
    expect(firstCall.inputReferences).toEqual(['file://Cast/linxia.png', 'file://Cast/hall.png'])
    const retake = generateImage.mock.calls[1][0] as { prompt: string }
    expect(retake.prompt).toContain('人物太小')
    expect(generateVideo).toHaveBeenCalledTimes(2)
    expect(
      (generateVideo.mock.calls[0][0] as { firstFrameImageUrl?: string }).firstFrameImageUrl
    ).toMatch(/^file:\/\/Film\//)
    expect((out['out-images'] as { items: unknown[] }).items).toHaveLength(2)
    expect((out['out-videos'] as { items: unknown[] }).items).toHaveLength(2)
    const doc = (out.out as { doc: FilmStoryboard }).doc
    expect(doc.shots.every((shot) => shot.media?.keyframe && shot.media?.video)).toBe(true)
    expect(Object.keys(parseFilmRenderCache(node.params.filmRenders))).toEqual(['S01-01', 'S01-02'])

    // 第二次：提示词与参考没变 → 全部复用，不再调用任何模型
    await executeFilmRenderNode(ctxFor(node, inputs, extra))
    expect(generateImage).toHaveBeenCalledTimes(3)
    expect(generateVideo).toHaveBeenCalledTimes(2)
  })
})

describe('film presets', () => {
  for (const id of ['shortDrama', 'shortDrama9'] as const) {
    it(`${id} materializes with every edge connected`, () => {
      const plan = getAiWorkflowPresetPlan(id)!
      const result = materializeGraphPlan(plan, { scope: 'subgraphAsset', assetType: 'subgraph' })
      expect(result.ok, result.error).toBe(true)
      expect(result.warnings).toEqual([])
      // 规划的边全部保留（规范化可能额外补边界连线，所以只要求不少于计划）
      expect(result.document!.edges.length).toBeGreaterThanOrEqual(plan.edges.length)
      expect(result.document!.nodes.some((node) => node.typeId === 'film.breakdown')).toBe(true)
    })
  }
})
