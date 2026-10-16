import { describe, expect, it, vi } from 'vitest'
import {
  applyFilmReview,
  composeFilmShotImagePrompt,
  composeFilmShotVideoPrompt,
  createNodeFromType,
  deriveFilmCast,
  executeFilmBreakdownNode,
  executeFilmCastNode,
  executeFilmRenderNode,
  executeFilmReviewNode,
  executeFilmShotNode,
  executeFilmWorkbenchNode,
  filmStoryboardValue,
  findPrevSameSceneShot,
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
  it('exposes film.workbench and film.shot as addable nodes, keeps legacy stage nodes registered for compatibility, and removes legacy episode / beat / world nodes', () => {
    const ids = listAddableNodeTypes('workflow').map((def) => def.typeId)
    for (const id of ['film.workbench', 'film.shot']) {
      expect(ids).toContain(id)
    }
    for (const id of ['film.breakdown', 'film.review', 'film.cast', 'film.render']) {
      expect(getNodeType(id)).toBeDefined()
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

    // 指定 15s 长分镜：触发重新拆解（sourceHash 变化），下发多时间段提示词指令并写回 durationSec=15
    node.params.filmShotDurationSec = 15
    generateText.mockResolvedValueOnce({ text: MODEL_STORYBOARD, model: 'm' })
    const longOut = await executeFilmBreakdownNode(ctxFor(node, inputs, { generateText }))
    expect(generateText).toHaveBeenCalledTimes(3)
    const callArg = generateText.mock.calls[2][0] as { prompt: string }
    expect(callArg.prompt).toContain('单镜目标时长：15 秒（长分镜模式）')
    expect(callArg.prompt).toContain('0-2s')
    expect(callArg.prompt).toContain('11-15s')
    const longDoc = (longOut.out as { doc: FilmStoryboard }).doc
    expect(longDoc.shots.every((shot) => shot.durationSec === 15)).toBe(true)
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

    // 单卡片执行：仅重绘指定条目（忽略 locked 与 hash 缓存），并自动清空 filmCastOnlyId
    const beforeCast = parseFilmCast(node.params.filmCast ?? '')!
    const targetEntryId = beforeCast.entries[0].id
    node.params.filmCastOnlyId = targetEntryId
    await executeFilmCastNode(ctxFor(node, inputs, { generateImage, saveRunMedia }))
    expect(generateImage).toHaveBeenCalledTimes(4)
    expect(node.params.filmCastOnlyId).toBe('')
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
    // 第 2 镜（S01-02，同场同地点）自动注入第 1 镜（S01-01）的关键帧作为 @3 参考图，并写入承接指令
    const secondShotCall = generateImage.mock.calls[2][0] as {
      prompt: string
      inputReferences?: string[]
    }
    expect(secondShotCall.inputReferences).toHaveLength(3)
    expect(secondShotCall.inputReferences?.slice(0, 2)).toEqual([
      'file://Cast/linxia.png',
      'file://Cast/hall.png'
    ])
    expect(secondShotCall.inputReferences?.[2]).toMatch(/^file:\/\/Film\//)
    expect(secondShotCall.prompt).toContain('紧接同场上一镜 S01-01')
    expect(secondShotCall.prompt).toContain('参考图@3')
    expect(generateVideo).toHaveBeenCalledTimes(2)
    expect((generateVideo.mock.calls[1][0] as { prompt: string }).prompt).toContain(
      '紧接同场上一镜（S01-01：林夏走进走廊）'
    )
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

    // 单镜卡片执行：仅重拍指定镜头 S01-02，其余镜头保持原缓存，且自动清空 filmRenderOnlyShotId
    node.params.filmRenderOnlyShotId = 'S01-02'
    await executeFilmRenderNode(ctxFor(node, inputs, extra))
    expect(generateImage).toHaveBeenCalledTimes(4)
    expect(generateVideo).toHaveBeenCalledTimes(3)
    expect(node.params.filmRenderOnlyShotId).toBe('')
  })

  it('film.render reuses existing keyframe when switching image -> video and auto-retries unsupported 3s video duration', async () => {
    const generateImage = vi
      .fn()
      .mockResolvedValue({ images: ['data:image/png;base64,S0Y='], model: 'img-m' })
    const generateVideo = vi
      .fn()
      .mockRejectedValueOnce(
        new Error('400 Duration 3s is not supported for this model. Supported durations: 4, 5, 10s')
      )
      .mockResolvedValue({ assetId: 'v1', relativePath: 'Film/shot1.mp4', model: 'vid-m' })
    const saveRunMedia = vi.fn(async ({ key }: { key: string }) => `Film/${key}.png`)
    const resolveImageUrls = vi.fn(
      async (items: Array<{ dataUrl?: string; relativePath?: string }>) =>
        items.map((item) => item.dataUrl || `file://${item.relativePath}`)
    )

    const node: GraphNode = {
      id: 'render-retry',
      typeId: 'film.render',
      position: { x: 0, y: 0 },
      params: {
        generateModel: 'img-m',
        filmVideoModel: 'vid-m',
        filmRenderMode: 'keyframe',
        generateAspectRatio: '2.39:1',
        generateResolution: '2K'
      }
    }
    const inputs = { in: [filmStoryboardValue(sampleStoryboard())] }
    const extra = { generateImage, generateVideo, saveRunMedia, resolveImageUrls }

    // 1) 先在仅关键帧模式下生成 2 张关键帧
    await executeFilmRenderNode(ctxFor(node, inputs, extra))
    expect(generateImage).toHaveBeenCalledTimes(2)
    expect(generateVideo).toHaveBeenCalledTimes(0)

    // 2) 切换到 关键帧 + 视频 模式，点击 S01-02（durationSec=3）卡片单独生成视频：
    //    直接复用已有关键帧（不重拍图片），且遇到 3s 时长不支持时自动回退到 4s 重试成功
    node.params.filmRenderMode = 'video'
    node.params.filmRenderOnlyShotId = 'S01-02'
    const out = await executeFilmRenderNode(ctxFor(node, inputs, extra))
    expect(generateImage).toHaveBeenCalledTimes(2)
    expect(generateVideo).toHaveBeenCalledTimes(2)
    expect((generateVideo.mock.calls[0][0] as { duration?: number }).duration).toBe(3)
    expect((generateVideo.mock.calls[1][0] as { duration?: number }).duration).toBe(4)
    expect((generateVideo.mock.calls[0][0] as { aspectRatio?: string }).aspectRatio).toBe('16:9')
    expect((out['out-videos'] as { items: unknown[] }).items).toHaveLength(1)

    // 3) 配置了独立的视频参数（filmVideoResolution / filmVideoAspectRatio / filmVideoDuration / filmVideoAudio）时优先传给 generateVideo
    node.params.filmVideoResolution = '1080p'
    node.params.filmVideoAspectRatio = '9:16'
    node.params.filmVideoDuration = 10
    node.params.filmVideoAudio = true
    node.params.filmVideoSeed = 42
    node.params.filmVideoSeedUseGlobal = false
    node.params.filmRenderOnlyShotId = 'S01-01'
    await executeFilmRenderNode(ctxFor(node, inputs, extra))
    const lastVideoCall = generateVideo.mock.calls.at(-1)?.[0] as {
      resolution?: string
      aspectRatio?: string
      duration?: number
      generateAudio?: boolean
      seed?: number
    }
    expect(lastVideoCall.resolution).toBe('1080p')
    expect(lastVideoCall.aspectRatio).toBe('9:16')
    expect(lastVideoCall.duration).toBe(10)
    expect(lastVideoCall.generateAudio).toBe(true)
    expect(lastVideoCall.seed).toBe(42)
  })

  it('film.workbench supports both single-stage run and full-pipeline run on one node', async () => {
    const node = createNodeFromType(
      'film.workbench',
      { x: 0, y: 0 },
      {
        params: {
          filmReviewMaxRounds: 1,
          filmRenderMode: 'video',
          filmWorkbenchRunMode: 'breakdown'
        }
      }
    )
    const generateText = vi
      .fn()
      .mockResolvedValueOnce({ text: MODEL_STORYBOARD, model: 'txt' })
      .mockResolvedValueOnce({ text: '{"verdict":"PASS","score":92,"shots":[]}', model: 'txt' })
    const generateImage = vi
      .fn()
      .mockResolvedValue({ images: ['data:image/png;base64,S0Y='], model: 'img' })
    const generateVideo = vi.fn(async (input: { name?: string }) => ({
      assetId: 'v',
      relativePath: `Film/${input.name}.mp4`,
      model: 'vid'
    }))
    const saveRunMedia = vi.fn(async ({ key }: { key: string }) => `Film/${key}.png`)
    const resolveImageUrls = vi.fn(
      async (items: Array<{ dataUrl?: string; relativePath?: string }>) =>
        items.map((item) => item.dataUrl || `file://${item.relativePath}`)
    )
    const inputs = { in: [{ kind: 'text', text: '雨夜走廊，林夏寻找老周。' } as GraphValue] }
    const extra = { generateText, generateImage, generateVideo, saveRunMedia, resolveImageUrls }

    // 1) 单阶段运行（breakdown）：只执行分镜拆解，不触发审核 / 设定图 / 批量拍摄，且自动清空 filmWorkbenchRunMode
    const out1 = await executeFilmWorkbenchNode(ctxFor(node, inputs, extra))
    expect(node.params.filmWorkbenchRunMode).toBe('')
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(generateImage).toHaveBeenCalledTimes(0)
    expect(generateVideo).toHaveBeenCalledTimes(0)
    expect((out1.out as { doc: FilmStoryboard }).doc.shots).toHaveLength(2)

    // 2) 全流程运行（默认 / all）：复用未变的分镜，依次执行导演审核 → 角色场景设定（3 实体）→ 批量拍摄（2 镜关键帧 + 2 镜视频）
    const out2 = await executeFilmWorkbenchNode(ctxFor(node, inputs, extra))
    expect(generateText).toHaveBeenCalledTimes(2)
    expect(generateImage).toHaveBeenCalledTimes(3 + 2)
    expect(generateVideo).toHaveBeenCalledTimes(2)
    expect((out2['out-cast'] as { doc: FilmCast }).doc.entries).toHaveLength(3)
    expect((out2['out-sheets'] as { items: unknown[] }).items).toHaveLength(3)
    expect((out2['out-images'] as { items: unknown[] }).items).toHaveLength(2)
    expect((out2['out-videos'] as { items: unknown[] }).items).toHaveLength(2)
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
      expect(result.document!.nodes.some((node) => node.typeId === 'film.workbench')).toBe(true)
    })
  }
})

describe('film workbench dive & soft resolve wiring', () => {
  it('GraphNodeCard routes film.* double-click to film.workbench dive instead of notepad', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const cardCode = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/GraphNodeCard.vue'),
      'utf8'
    )
    expect(cardCode).toContain("viewId: 'film.workbench'")
    expect(cardCode).toContain("t('graph.inspector.film.openWorkbenchHint')")

    const hostCode = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/EditorDiveChildHost.vue'),
      'utf8'
    )
    expect(hostCode).toContain(
      "'film.workbench': defineAsyncComponent(() => import('./dive/EditorDiveFilmView.vue'))"
    )

    const inspectorCode = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/FilmInspector.vue'),
      'utf8'
    )
    expect(inspectorCode).toContain("viewId: 'film.workbench'")
    expect(inspectorCode).not.toContain('InstructionModelSelect')

    const diveCode = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/dive/EditorDiveFilmView.vue'),
      'utf8'
    )
    expect(diveCode).toContain('VideoGenerateParamsSelect')
    expect(diveCode).toContain('ImageGenerateParamsSelect')
  })

  it('filters non-spatial placeholder locations (e.g. 黑屏 / 纯黑背景) out of entities and cast sheets', () => {
    const sb = parseFilmStoryboard({
      title: '职场短剧',
      style: '现代都市职场写实',
      entities: [
        { kind: 'location', name: '开放式办公室', description: '现代公司开放式办公区' },
        { kind: 'location', name: '黑屏', description: '纯黑背景，用于字幕。' },
        { kind: 'location', name: '场景A', description: '纯黑背景，仅用于转场字幕' }
      ],
      shots: [
        {
          id: 'S01-01',
          location: '黑屏',
          action: '黑屏字幕：三年前'
        },
        {
          id: 'S01-02',
          location: '开放式办公室',
          action: '林小满坐在工位前'
        }
      ]
    })
    expect(sb).not.toBeNull()
    expect(sb!.entities.map((e) => e.name)).toEqual(['开放式办公室'])

    const cast = deriveFilmCast(sb!, null, ['character', 'location'])
    expect(cast.entries.map((e) => e.name)).toEqual(['开放式办公室'])

    const parsedLegacyCast = parseFilmCast(
      JSON.stringify({
        style: '现代都市职场写实',
        entries: [
          {
            id: 'loc-1',
            kind: 'location',
            name: '开放式办公室',
            description: '现代公司开放式办公区',
            imageRelativePath: 'Cache/office.png'
          },
          {
            id: 'loc-2',
            kind: 'location',
            name: '黑屏',
            description: '纯黑背景，用于字幕。',
            imageRelativePath: 'Cache/bogus-office.png'
          }
        ]
      })
    )
    expect(parsedLegacyCast?.entries.map((e) => e.name)).toEqual(['开放式办公室'])
    // 黑屏转场镜头不与下一镜产生空间衔接
    expect(findPrevSameSceneShot(sb!, sb!.shots[1])).toBeNull()
    const doc = sampleStoryboard()
    expect(findPrevSameSceneShot(doc, doc.shots[0])).toBeNull()
    expect(findPrevSameSceneShot(doc, doc.shots[1])?.id).toBe('S01-01')
  })
})
