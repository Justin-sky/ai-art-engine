import { describe, expect, it, vi } from 'vitest'
import {
  applyFilmReview,
  buildFilmContinuityChains,
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
  filmBaseEntityName,
  filmCastValue,
  filmStoryboardValue,
  findPrevSameSceneShot,
  getNodeType,
  GraphPortType,
  listAddableNodeTypes,
  matchFilmCastForShot,
  materializeGraphPlan,
  mergeFilmCasts,
  mergeFilmStoryboards,
  parseFilmCast,
  parseFilmRenderCache,
  parseFilmReview,
  parseFilmShotRange,
  parseFilmStoryboard,
  portsCompatible,
  selectFilmShot,
  MANJU_GENRE_SPECS,
  detectManjuGenre,
  resolveManjuGenre,
  buildManjuScreenplayDirective,
  buildManjuStyleAnchorPrompt,
  enrichStoryboardFromScreenplayText,
  executeScreenplayGenerateNode,
  runManjuContinuityAudit,
  deriveManjuPublishPack,
  analyzeScreenplay,
  buildManjuProjectBibleSnippet,
  buildManjuEpisodeFooterSnippet,
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

  it('cast generates one design sheet per entity (including props by default) and skips unchanged ones next run', async () => {
    const node = createNodeFromType('film.cast', { x: 0, y: 0 })
    const generateImage = vi
      .fn()
      .mockResolvedValue({ images: ['data:image/png;base64,AAAA'], model: 'img' })
    const saveRunMedia = vi.fn(async ({ key }: { key: string }) => `Cast/${key}.png`)
    const sbWithProp = sampleStoryboard()
    sbWithProp.entities.push({
      id: 'prop-flashlight',
      kind: 'prop',
      name: '复古铜手电筒',
      description: '黄铜外壳，表面斑驳磨损，玻璃镜片'
    })
    sbWithProp.shots[0] = { ...sbWithProp.shots[0], props: ['复古铜手电筒'] }
    const inputs = { in: [filmStoryboardValue(sbWithProp)] }
    await executeFilmCastNode(ctxFor(node, inputs, { generateImage, saveRunMedia }))
    const cast = parseFilmCast(node.params.filmCast ?? '')
    // 默认覆盖角色 + 地点 + 道具：林夏、老周、旧公寓走廊、复古铜手电筒
    expect(cast?.entries).toHaveLength(4)
    expect(
      cast?.entries.some((entry) => entry.kind === 'prop' && entry.name === '复古铜手电筒')
    ).toBe(true)
    expect(cast?.entries.every((entry) => !!entry.imageRelativePath)).toBe(true)
    expect(generateImage).toHaveBeenCalledTimes(4)

    await executeFilmCastNode(ctxFor(node, inputs, { generateImage, saveRunMedia }))
    expect(generateImage).toHaveBeenCalledTimes(4)

    // 单卡片执行：仅重绘指定条目（忽略 locked 与 hash 缓存），并自动清空 filmCastOnlyId
    const beforeCast = parseFilmCast(node.params.filmCast ?? '')!
    const targetEntryId = beforeCast.entries[0].id
    node.params.filmCastOnlyId = targetEntryId
    await executeFilmCastNode(ctxFor(node, inputs, { generateImage, saveRunMedia }))
    expect(generateImage).toHaveBeenCalledTimes(5)
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
  const plans = {
    shortDrama: {
      title: '影视全流程（Agent 闭环）',
      nodes: [
        { key: 'script', typeId: 'text.plain', title: '剧本' },
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
    },
    shortDrama9: {
      title: '9 镜漫剧短视频（Agent 闭环）',
      nodes: [
        { key: 'script', typeId: 'text.plain', title: '剧本' },
        {
          key: 'workbench',
          typeId: 'film.workbench',
          title: '影视工作台（9 镜）',
          params: {
            filmAspectRatio: '9:16',
            filmTargetShots: 9,
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
  } as const
  for (const id of ['shortDrama', 'shortDrama9'] as const) {
    it(`${id} materializes with every edge connected`, () => {
      const plan = plans[id]
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
    expect(diveCode).toContain('<WorkspaceItemIcon :icon="nodeIcon"')
    expect(diveCode).toContain('.header-right :deep(.node-run-btn)')
    expect(diveCode).toContain(':status="stageRunStatus"')
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

  it('supports cross-episode Series Bible in-cast reuse and Character#Outfit variant inheritance', async () => {
    expect(filmBaseEntityName('林夏#晚礼服')).toBe('林夏')
    expect(filmBaseEntityName('林夏·战损')).toBe('林夏')
    expect(filmBaseEntityName('林夏')).toBeNull()

    const seriesBibleCast: FilmCast = {
      schema: 'film.cast/v1',
      style: '冷色写实电影感',
      entries: [
        {
          id: 'char-lin',
          kind: 'character',
          name: '林夏',
          description: '二十多岁女性，短发，冷峻五官',
          imageRelativePath: 'Bible/lin-base.png',
          locked: true
        },
        {
          id: 'loc-corridor',
          kind: 'location',
          name: '旧公寓走廊',
          description: '昏黄壁灯，潮湿墙面',
          imageRelativePath: 'Bible/corridor.png'
        }
      ]
    }

    expect(
      mergeFilmCasts(seriesBibleCast, {
        schema: 'film.cast/v1',
        style: '',
        entries: [{ id: 'char-zhou', kind: 'character', name: '老周', description: '中年侦探' }]
      })?.entries.map((e) => e.name)
    ).toEqual(['林夏', '旧公寓走廊', '老周'])

    // 1) Breakdown 注入全剧设定库指令，并自动补全同集实体描述
    const ep2Breakdown = createNodeFromType('film.breakdown', { x: 0, y: 0 })
    const generateText = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        title: '第二集：晚宴潜入',
        style: '冷色写实电影感',
        entities: [
          { kind: 'character', name: '林夏', description: '' },
          { kind: 'character', name: '林夏#晚礼服', description: '换上深蓝丝绒露背晚礼服，盘发' },
          { kind: 'location', name: '旧公寓走廊', description: '' }
        ],
        shots: [
          {
            id: 'S01-01',
            location: '旧公寓走廊',
            characters: ['林夏#晚礼服'],
            action: '林夏身穿晚礼服走过走廊'
          }
        ]
      }),
      model: 'txt'
    })
    const bdOut = await executeFilmBreakdownNode(
      ctxFor(
        ep2Breakdown,
        {
          in: [{ kind: 'text', text: '第二集剧本：林夏换上晚礼服。' }],
          'in-cast': [filmCastValue(seriesBibleCast)]
        },
        { generateText }
      )
    )
    expect(generateText.mock.calls[0][0].prompt).toContain('全剧既有设定名录')
    expect(generateText.mock.calls[0][0].prompt).toContain('林夏')
    const ep2Doc = (bdOut.out as { doc: FilmStoryboard }).doc
    expect(ep2Doc.entities.find((e) => e.name === '林夏')?.description).toBe(
      '二十多岁女性，短发，冷峻五官'
    )

    // 当变体尚未单独出图时，matchFilmCastForShot 自动回退主角色设定图
    const fallbackRefs = matchFilmCastForShot(seriesBibleCast, ep2Doc.shots[0])
    expect(fallbackRefs.map((r) => r.imageRelativePath)).toEqual([
      'Bible/lin-base.png',
      'Bible/corridor.png'
    ])

    // 2) Cast 节点跨集复用主角色与旧地点设定图（不重画），仅为 #晚礼服 变体生成新设定图且自动带入主角色图作为 @1 参考
    const ep2CastNode = createNodeFromType('film.cast', { x: 0, y: 0 })
    const generateImage = vi.fn().mockResolvedValue({
      images: ['data:image/png;base64,VkFSSUFOVA=='],
      model: 'img'
    })
    const saveRunMedia = vi.fn(async ({ key }: { key: string }) => `Ep2/${key}.png`)
    const resolveImageUrls = vi.fn(
      async (items: Array<{ dataUrl?: string; relativePath?: string }>) =>
        items.map((item) => item.dataUrl || `file://${item.relativePath}`)
    )

    const castOut = await executeFilmCastNode(
      ctxFor(
        ep2CastNode,
        {
          in: [bdOut.out],
          'in-cast': [filmCastValue(seriesBibleCast)]
        },
        { generateImage, saveRunMedia, resolveImageUrls }
      )
    )
    // 林夏与旧公寓走廊直接复用 Bible，只有 林夏#晚礼服 调了 1 次生图
    expect(generateImage).toHaveBeenCalledTimes(1)
    expect(generateImage.mock.calls[0][0].inputReferences).toEqual(['file://Bible/lin-base.png'])
    expect(generateImage.mock.calls[0][0].prompt).toContain('@1')
    expect(generateImage.mock.calls[0][0].prompt).toContain('林夏')

    const mergedCast = (castOut.out as { doc: FilmCast }).doc
    expect(mergedCast.entries).toHaveLength(3)
    expect(mergedCast.entries.find((e) => e.name === '林夏')?.imageRelativePath).toBe(
      'Bible/lin-base.png'
    )
    expect(mergedCast.entries.find((e) => e.name === '林夏#晚礼服')?.imageRelativePath).toMatch(
      /^Ep2\//
    )
  })

  it('partitions shots into scene continuity chains and renders independent scenes concurrently', async () => {
    const multiSceneDoc = parseFilmStoryboard({
      title: '双线并发测试',
      style: '写实',
      scenes: [
        { id: 'scene-1', heading: '走廊', location: '旧公寓走廊' },
        { id: 'scene-2', heading: '天台', location: '大厦天台' }
      ],
      shots: [
        {
          id: 'S01-01',
          sceneId: 'scene-1',
          location: '旧公寓走廊',
          characters: ['林夏'],
          action: '走廊镜头1',
          imagePrompt: '走廊镜头1'
        },
        {
          id: 'S01-02',
          sceneId: 'scene-1',
          location: '旧公寓走廊',
          characters: ['林夏'],
          action: '走廊镜头2',
          imagePrompt: '走廊镜头2'
        },
        {
          id: 'S02-01',
          sceneId: 'scene-2',
          location: '大厦天台',
          characters: ['老周'],
          action: '天台镜头1',
          imagePrompt: '天台镜头1'
        },
        {
          id: 'S02-02',
          sceneId: 'scene-2',
          location: '大厦天台',
          characters: ['老周'],
          action: '天台镜头2',
          imagePrompt: '天台镜头2'
        }
      ]
    })!

    const chains = buildFilmContinuityChains(multiSceneDoc, [0, 1, 2, 3], true)
    expect(chains).toEqual([
      [0, 1],
      [2, 3]
    ])
    expect(buildFilmContinuityChains(multiSceneDoc, [0, 1, 2, 3], false)).toEqual([
      [0],
      [1],
      [2],
      [3]
    ])

    let activeImages = 0
    let maxConcurrentImages = 0
    const generateImage = vi.fn(async () => {
      activeImages += 1
      maxConcurrentImages = Math.max(maxConcurrentImages, activeImages)
      await new Promise((r) => setTimeout(r, 25))
      activeImages -= 1
      return { images: ['data:image/png;base64,S0Y='], model: 'img' }
    })
    const saveRunMedia = vi.fn(async ({ key }: { key: string }) => `Film/${key}.png`)
    const resolveImageUrls = vi.fn(
      async (items: Array<{ dataUrl?: string; relativePath?: string }>) =>
        items.map((item) => item.dataUrl || `file://${item.relativePath}`)
    )

    const renderNode = createNodeFromType(
      'film.render',
      { x: 0, y: 0 },
      { params: { filmRenderMode: 'keyframe', filmRenderConcurrency: 3 } }
    )
    const out = await executeFilmRenderNode(
      ctxFor(
        renderNode,
        { in: [filmStoryboardValue(multiSceneDoc)] },
        { generateImage, saveRunMedia, resolveImageUrls }
      )
    )
    // 两个场次的第 1 镜（S01-01 与 S02-01）并行启动，而同场第 2 镜严格等待第 1 镜关键帧完成
    expect(maxConcurrentImages).toBeGreaterThanOrEqual(2)
    const images = (out['out-images'] as { items: Array<{ title?: string }> }).items
    expect(images.map((item) => item.title)).toEqual(['S01-01', 'S01-02', 'S02-01', 'S02-02'])
    expect(Object.keys(parseFilmRenderCache(renderNode.params.filmRenders))).toEqual([
      'S01-01',
      'S01-02',
      'S02-01',
      'S02-02'
    ])
  })

  it('controls 3D white-box previz video reference (@2) via filmRenderPrevizVideoRef toggle and MCP smartPatch', async () => {
    const { mergeSmartNodeParams } = await import('../src/shared/graph/smartPatch')
    const docWithPreviz = parseFilmStoryboard({
      title: '白模视频开关测试',
      style: '写实',
      scenes: [{ id: 'scene-1', heading: '走廊', location: '走廊' }],
      shots: [
        {
          id: 'S01-01',
          sceneId: 'scene-1',
          location: '走廊',
          characters: [],
          action: '向前推进',
          imagePrompt: '走廊镜头',
          videoPrompt: '平稳推进镜头',
          media: {
            previzKeyframe: 'Previz/S01-01-kf.png',
            previzVideo: 'Previz/S01-01-vid.webm'
          }
        }
      ]
    })!

    const generateImage = vi.fn(async () => ({
      images: ['data:image/png;base64,S0Y='],
      model: 'img'
    }))
    const generateVideo = vi.fn(async () => ({
      videos: ['data:video/mp4;base64,VklE'],
      model: 'vid'
    }))
    const saveRunMedia = vi.fn(
      async ({ key, ext }: { key: string; ext?: string }) => `Film/${key}.${ext || 'png'}`
    )
    const resolveImageUrls = vi.fn(
      async (items: Array<{ dataUrl?: string; relativePath?: string }>) =>
        items.map((item) => item.dataUrl || `file://${item.relativePath}`)
    )

    // 1) 默认开启（filmRenderPrevizVideoRef = true）：传入 @2 video_url 参考
    const nodeDefault = createNodeFromType(
      'film.render',
      { x: 0, y: 0 },
      { params: { filmRenderMode: 'video' } }
    )
    expect(nodeDefault.params.filmRenderPrevizVideoRef).toBe(true)
    await executeFilmRenderNode(
      ctxFor(
        nodeDefault,
        { in: [filmStoryboardValue(docWithPreviz)] },
        { generateImage, generateVideo, saveRunMedia, resolveImageUrls }
      )
    )
    expect(generateVideo).toHaveBeenCalledTimes(1)
    expect(generateVideo.mock.calls[0][0].inputReferences).toEqual([
      { kind: 'image_url', url: expect.stringMatching(/^file:\/\/Film\//) },
      { kind: 'video_url', url: 'Previz/S01-01-vid.webm' }
    ])

    // 2) 通过 MCP smartPatch（如对话指令「关闭参考3D白模视频」）设为 false：仅用首帧图，不传 @2 video_url
    generateVideo.mockClear()
    nodeDefault.params = mergeSmartNodeParams(nodeDefault, { 参考3D白模视频: false })
    expect(nodeDefault.params.filmRenderPrevizVideoRef).toBe(false)

    await executeFilmRenderNode(
      ctxFor(
        nodeDefault,
        { in: [filmStoryboardValue(docWithPreviz)] },
        { generateImage, generateVideo, saveRunMedia, resolveImageUrls }
      )
    )
    expect(generateVideo).toHaveBeenCalledTimes(1)
    expect(generateVideo.mock.calls[0][0].inputReferences).toBeUndefined()
    expect(generateVideo.mock.calls[0][0].firstFrameImageUrl).toMatch(/^file:\/\/Film\//)
  })
})

describe('ai-manju-skills 5-stage 21-genre industrial pipeline', () => {
  it('registers all 21 genre skills across 4 categories with prompt prefixes and auto-detection', () => {
    expect(MANJU_GENRE_SPECS).toHaveLength(21)
    const byCategory = {
      fantasy: MANJU_GENRE_SPECS.filter((g) => g.category === 'fantasy'),
      ancient: MANJU_GENRE_SPECS.filter((g) => g.category === 'ancient'),
      modern: MANJU_GENRE_SPECS.filter((g) => g.category === 'modern'),
      genre: MANJU_GENRE_SPECS.filter((g) => g.category === 'genre')
    }
    expect(byCategory.fantasy).toHaveLength(5)
    expect(byCategory.ancient).toHaveLength(6)
    expect(byCategory.modern).toHaveLength(8)
    expect(byCategory.genre).toHaveLength(2)

    for (const spec of MANJU_GENRE_SPECS) {
      expect(spec.characterPromptPrefixZh).toContain('角色')
      expect(spec.propPromptPrefixZh.length).toBeGreaterThan(10)
      expect(spec.scenePromptPrefixZh.length).toBeGreaterThan(10)
      expect(spec.characterNegativePromptZh.length).toBeGreaterThan(10)
      expect(spec.videoStyleTagZh.length).toBeGreaterThan(2)
      expect(spec.pitfallRulesZh.length).toBeGreaterThanOrEqual(2)
    }

    expect(detectManjuGenre('筑基修士萧炎御剑飞升，丹炉金丹雷劫降临')?.id).toBe('xuanhuan-manju')
    expect(detectManjuGenre('凤冠霞帔深宫皇后贵妃争宠，太医脉案投毒赐死')?.id).toBe('gongdou-manju')
    expect(detectManjuGenre('外卖员隐藏千亿战神龙王身份，三年之期已到赘婿归来')?.id).toBe(
      'dushi-manju'
    )
    expect(detectManjuGenre('丧尸围城血月降临，安全屋异能觉醒囤物资')?.id).toBe('moshi-manju')
    expect(resolveManjuGenre('xianxia', '')?.id).toBe('xuanhuan-manju')
    expect(resolveManjuGenre('修真', '')?.id).toBe('xuanhuan-manju')

    const styleAnchorPrompt = buildManjuStyleAnchorPrompt(
      resolveManjuGenre('xuanhuan-manju')!,
      '玄青与赤金对比色调'
    )
    expect(styleAnchorPrompt).toContain('STYLE01')
    expect(styleAnchorPrompt).toContain('玄青与赤金对比色调')
  })

  it('compiles Stage 4 A-segment 5-line keyframe prompts and B-segment {{Mixed N}} + 7-line video prompts', () => {
    const sb = parseFilmStoryboard({
      title: '青云断剑',
      genreId: 'xuanhuan-manju',
      style: '3D国漫引擎渲染风格，PBR玉石金属材质',
      bible: {
        sellingPoints: ['废柴少年识海觉醒上古剑灵'],
        powerSystem: '炼气→筑基→金丹→元婴',
        colorScheme: '玄青冷调配赤金灵光',
        continuityRules: ['禁止现代词', '禁止无代价越两阶战平']
      },
      episodeMeta: {
        episodeNumber: 1,
        coldOpen: '断崖雷劫劈碎铁剑',
        cliffhangerHook: '神秘金丹长老破空降临',
        progressLine: '林寒：炼气三层 → 炼气七层（识海剑胎苏醒）',
        isPaywallPossible: false
      },
      entities: [
        {
          id: 'char-lin',
          code: 'P01',
          kind: 'character',
          name: '林寒',
          stateCode: 'LOOK-A',
          heightCm: 182,
          consistencyAnchors: ['左眉断疤', '玄铁束发冠', '青灰破损道袍'],
          description: '少年剑修，眼神凌厉'
        },
        {
          id: 'prop-sword',
          code: 'D01',
          kind: 'prop',
          name: '残缺古剑',
          dimensions: '长115cm，刃宽4cm',
          description: '暗金裂纹青铜古剑'
        },
        {
          id: 'loc-cliff',
          code: 'S01',
          kind: 'location',
          name: '断剑崖',
          dimensions: '直径30m圆形石台，北侧万丈深渊',
          worldLightDirection: '北侧雷云紫电自上而下斜射',
          description: '云海翻涌的险峻古石台'
        },
        {
          id: 'fx-slash',
          code: 'FX01',
          kind: 'vfx',
          name: '赤金剑气',
          description: '纯黑底赤金色半月形剑气光弧'
        }
      ],
      scenes: [
        {
          id: 'scene-1',
          code: 'S01',
          heading: 'EXT. 断剑崖 - 夜',
          location: '断剑崖',
          dimensions: '直径30m圆形石台',
          worldLightDirection: '北侧雷云紫电斜射',
          cameraAxis: '东西向180度轴线，林寒画左面朝画右'
        }
      ],
      shots: [
        {
          id: 'S01-01',
          sceneId: 'scene-1',
          shotSize: 'MS',
          angle: '仰拍',
          focalLength: '35mm',
          cameraMove: '缓推',
          durationSec: 5,
          location: '断剑崖',
          characters: ['林寒'],
          props: ['残缺古剑'],
          action: '林寒单膝跪地紧握残缺古剑，抬头直视雷云',
          blockingAndPose: '林寒位于画左单膝跪地，右手反握残缺古剑插地支撑',
          expression: '眉头紧锁，眼神冷冽倔强，嘴唇微张',
          subjectPosition: '画左三分线交点，面朝画右上方',
          lighting: '北侧雷云冷紫顶逆光勾勒轮廓，古剑泛起赤金暖光补亮面部',
          dialogue: [
            { speaker: '林寒', line: '这一剑，我等了三年！', mode: 'spoken' },
            { speaker: '林寒', line: '剑灵前辈助我！', mode: 'inner' }
          ],
          sound: '雷鸣轰隆与古剑嗡鸣',
          videoBeats: [
            {
              timeRange: '0-3秒',
              visual: '中景，林寒单膝跪地握紧残缺古剑，开口说道：“这一剑，我等了三年！”',
              forbid: '禁止双人换位、禁止古剑穿模或变形、禁止地面多出杂物',
              constraint: '口型对齐台词，左眉断疤清晰，发丝随狂风向画左飘动',
              blocking: '林寒在画左，面朝画右',
              cameraMove: '35mm仰拍镜头由中景缓慢推至近景',
              sound: '狂风呼啸 + 古剑铮鸣',
              summary: '林寒握剑蓄势并说出誓言'
            },
            {
              timeRange: '3-5秒',
              visual: '近景，林寒猛然抬头，古剑裂纹亮起赤金微光',
              forbid: '禁止内心独白张嘴、禁止五官崩坏、禁止背景跳轴',
              constraint: '内心独白期间双唇紧闭，眼神骤然凌厉',
              blocking: '林寒保持画左朝右',
              cameraMove: '镜头定格微震',
              sound: '低沉剑鸣 + 内心独白混响：“剑灵前辈助我！”',
              summary: '识海呼唤剑灵，古剑发光'
            }
          ],
          productionInfo: {
            vfxAssets: ['FX01 赤金剑气（3.5s-5.0s 叠加）'],
            bgm: '苍凉古琴转激昂战鼓',
            subtitleCard: '无'
          }
        }
      ]
    })!

    expect(sb.genreId).toBe('xuanhuan-manju')
    expect(sb.bible?.worldAndPowerSystem).toContain('炼气')
    expect(sb.episodeMeta?.coldOpen).toContain('断崖雷劫')
    expect(sb.shots[0].isLipSyncShot).toBe(true)
    expect(sb.shots[0].timeRange).toBe('0:00-0:05')

    const cast = deriveFilmCast(sb, null, ['character', 'location', 'prop', 'vfx'])
    expect(cast.entries.map((e) => e.code)).toEqual(['P01', 'D01', 'S01', 'FX01'])
    const castWithMedia: FilmCast = {
      ...cast,
      entries: cast.entries.map((e) => ({ ...e, imageRelativePath: `Cast/${e.code}.png` }))
    }

    const refs = matchFilmCastForShot(castWithMedia, sb.shots[0])
    expect(refs.map((r) => r.code)).toEqual(['P01', 'S01', 'D01'])

    const imgPrompt = composeFilmShotImagePrompt(sb, sb.shots[0], refs)
    // A段 5行硬性格式验证
    expect(imgPrompt).toContain('参考：STYLE01｜P01 林寒 LOOK-A｜S01 断剑崖 空景卡｜D01 残缺古剑')
    expect(imgPrompt).toContain('画面：')
    expect(imgPrompt).toContain('表情：')
    expect(imgPrompt).toContain('机位：35mm')
    expect(imgPrompt).toContain('光线：')
    expect(imgPrompt).toContain('视觉风格：')

    const vidPrompt = composeFilmShotVideoPrompt(sb.shots[0], undefined, {
      castRefs: refs,
      storyboard: sb
    })
    // B段 {{Mixed N}} 多参锚定 + 身高锁定 + 7行分时段格式验证
    expect(vidPrompt).toContain('{{Mixed 1}}')
    expect(vidPrompt).toContain('身高182cm')
    expect(vidPrompt).toContain('0-3秒：')
    expect(vidPrompt).toContain('画面：')
    expect(vidPrompt).toContain('禁止：')
    expect(vidPrompt).toContain('约束：')
    expect(vidPrompt).toContain('站位与朝向：')
    expect(vidPrompt).toContain('运镜：')
    expect(vidPrompt).toContain('音效：')
    expect(vidPrompt).toContain('这段大概是：')
  })

  it('runs the 11-point Continuity Audit and catches lip-sync overflow, spoken ratio, and state regression', () => {
    const faultySb = parseFilmStoryboard({
      title: '审计翻车测试',
      genreId: 'dushi-manju',
      entities: [
        { id: 'c1', code: 'P01', kind: 'character', name: '陈默#LOOK-A', stateCode: 'LOOK-A' },
        { id: 'c2', code: 'P01', kind: 'character', name: '陈默#LOOK-B', stateCode: 'LOOK-B' }
      ],
      shots: [
        {
          id: 'S01-01',
          durationSec: 2,
          characters: ['陈默#LOOK-B'],
          location: '总裁办',
          action: '陈默站立',
          // 2秒镜塞入 20 字开口台词（>4字/秒）
          dialogue: [
            {
              speaker: '陈默',
              line: '你们所有人今天都别想离开这间会议室半步！',
              mode: 'spoken'
            }
          ]
        },
        {
          id: 'S01-02',
          durationSec: 3,
          // 未说明回忆就从 LOOK-B 退回 LOOK-A
          characters: ['陈默#LOOK-A'],
          location: '总裁办',
          action: '陈默低头沉思',
          // 大量内心独白导致开口字数占比 < 2/3
          dialogue: [
            {
              speaker: '陈默',
              line: '这群人根本不知道我早已掌握了全部底牌与集团百分之六十的股份……',
              mode: 'inner'
            }
          ]
        }
      ]
    })!

    const audit = runManjuContinuityAudit(faultySb, null, resolveManjuGenre('dushi-manju'))
    expect(audit.items).toHaveLength(11)
    expect(audit.passed).toBe(false)
    expect(audit.items.find((i) => i.id === 'lip_sync_4chars')?.passed).toBe(false)
    expect(audit.items.find((i) => i.id === 'spoken_dialogue_ratio')?.passed).toBe(false)
    expect(audit.items.find((i) => i.id === 'state_non_regression')?.passed).toBe(false)
  })

  it('derives Stage 5 Publish Pack and supports film.workbench publish stage + STYLE01 anchor generation', async () => {
    const sb = sampleStoryboard()
    sb.genreId = 'xuanyi-manju'
    sb.episodeMeta = {
      episodeNumber: 3,
      coldOpen: '走廊尽头亮起红光',
      cliffhangerHook: '门后竟然站着本该死去的老周',
      progressLine: '线索进度：发现密室钥匙'
    }
    const pack = deriveManjuPublishPack(sb, 'zh-CN')
    expect(pack.verticalCoverPrompt).toContain('3:4')
    expect(pack.horizontalCoverPrompt).toContain('4:3')
    expect(pack.titles.length).toBeGreaterThanOrEqual(3)
    expect(pack.hashtags.length).toBeGreaterThanOrEqual(3)
    expect(pack.complianceNotice).toContain('AI')

    // Cast 节点开启 filmEnableStyleAnchor + 指定题材时自动补齐 STYLE01 并使用题材专属四宫格角色前缀
    const castNode = createNodeFromType(
      'film.cast',
      { x: 0, y: 0 },
      { params: { filmGenre: 'xuanhuan-manju', filmEnableStyleAnchor: true } }
    )
    const generateImage = vi
      .fn()
      .mockResolvedValue({ images: ['data:image/png;base64,AAAA'], model: 'img' })
    const saveRunMedia = vi.fn(async ({ key }: { key: string }) => `Cast/${key}.png`)
    await executeFilmCastNode(
      ctxFor(castNode, { in: [filmStoryboardValue(sb)] }, { generateImage, saveRunMedia })
    )
    const generatedCast = parseFilmCast(castNode.params.filmCast ?? '')!
    expect(generatedCast.entries[0].code).toBe('STYLE01')
    expect(generatedCast.entries[0].kind).toBe('style')
    const charPrompts = generateImage.mock.calls.map((c) => (c[0] as { prompt: string }).prompt)
    expect(charPrompts.some((p) => p.includes('STYLE01'))).toBe(true)
    expect(charPrompts.some((p) => p.includes('东方暗黑玄幻国漫角色设定图'))).toBe(true)

    // Workbench publish 阶段运行：自动产出 Stage 5 发布包与 11 项审计
    const wbNode = createNodeFromType(
      'film.workbench',
      { x: 0, y: 0 },
      {
        params: {
          filmStoryboard: JSON.stringify(sb),
          filmWorkbenchRunMode: 'publish'
        }
      }
    )
    const wbOut = await executeFilmWorkbenchNode(ctxFor(wbNode, {}))
    const finalSb = (wbOut.out as { doc: FilmStoryboard }).doc
    expect(finalSb.publishPack?.titles.length).toBeGreaterThanOrEqual(3)
    expect(finalSb.continuityAudit?.items).toHaveLength(11)
  })

  it('analyzes screenplay spoken dialogue ratio and generates Stage 1 Bible & Stage 3 footer snippets', () => {
    const script = [
      '【黄金前3秒冷开场】暴雨夜，林夏一脚踹开铁门。',
      '第1场 【内景 · 旧仓库 - 夜】',
      '△ 林夏持手电筒环视四周。',
      '林夏：出来！我知道你在里面！别装神弄鬼了！',
      '林夏（内心）：手心全是冷汗。',
      '【本集卡点】铁柜突然从内部剧烈震动！'
    ].join('\n')
    const metrics = analyzeScreenplay(script)
    expect(metrics.hasColdOpen).toBe(true)
    expect(metrics.hasCliffhangerHook).toBe(true)
    expect(metrics.spokenDialogueChars).toBeGreaterThan(0)
    expect(metrics.innerAndVoChars).toBeGreaterThan(0)
    expect(metrics.spokenRatio).toBeGreaterThan(60)

    expect(buildManjuProjectBibleSnippet('xuanhuan-manju', 'zh-CN')).toContain('项目圣经')
    expect(buildManjuEpisodeFooterSnippet('xuanhuan-manju', 'zh-CN')).toContain('本集进度')
    expect(buildManjuScreenplayDirective(resolveManjuGenre('xuanhuan-manju'), 'zh-CN')).toContain(
      'xuanhuan-manju'
    )
  })

  it('forms a seamless closed loop from asset.screenplay (Stage 1-3) to film.workbench (Stage 4-5)', async () => {
    const spNode = createNodeFromType(
      'asset.screenplay',
      { x: 0, y: 0 },
      {
        id: 'sp-node',
        params: {
          filmGenre: 'xuanhuan-manju',
          generateInstruction: '创作断魂崖剑修逆袭剧本'
        }
      }
    )

    let capturedSystemPrompt = ''
    const stage1To3Script = [
      '剧本名：断剑开天',
      '',
      '【项目圣经 · 阶段1】',
      '- 题材流派：玄幻修仙（xuanhuan-manju）',
      '- 视觉定调（STYLE01）：东方仙侠CG国漫大片质感，残阳血色云海与凛冽青色剑气冷暖碰撞',
      '- 核心爽点闭环：宗门弃徒受辱 → 断剑惊鸿解封 → 一剑劈开漫天火海',
      '- 全局主光定律：右后方断魂崖残阳血红逆光 + 剑身青色灵光补光',
      '- 避坑红线：严禁现代服饰穿帮；严禁双人同框身高失真',
      '',
      '【人物小传】',
      '- 谢云归（22岁，男，185cm）：青云宗弃徒剑修；外观锚点：高束黑发配银冠、染霜素白剑袍、腰悬青玉剑穗、断裂青铜古剑惊鸿。',
      '- 玄冥长老（50岁，男，180cm）：执法殿首座；外观锚点：灰白长髯、黑底金纹宽袖法袍、赤焰骷髅法杖。',
      '',
      '【场景设定】',
      '- 断魂崖问剑台（50m×50m×开阔高空）：世界主光方向为右后方云海残阳血色逆光 + 问剑台地面法阵赤红底光。',
      '',
      '第1场 【外景 · 断魂崖问剑台 - 黄昏】',
      '△ 残阳如血，玄冥长老凌空而立，赤焰法杖化作火链封死退路。',
      '玄冥长老：谢云归，交出惊鸿剑魄，本座留你全尸！',
      '谢云归：剑修宁折不弯，今日便让你看看，断剑亦能开天！',
      '',
      '【本集卡点与进度 · 阶段3】',
      '- 黄金前3秒冷开场：百座悬浮剑碑崩裂，赤焰锁链封死断魂崖绝路',
      '- 本集进度：执法长老玄冥｜剑心通明半步元婴｜断剑惊鸿第一重剑魄｜右臂经脉震裂',
      '- 结尾钩子：百丈青色剑气劈开火海，云层深处探出太古巨手！'
    ].join('\n')

    const spOut = await executeScreenplayGenerateNode(
      ctxFor(
        spNode,
        {},
        {
          generateText: async ({ system }) => {
            capturedSystemPrompt = system ?? ''
            return { text: stage1To3Script, model: 'mock-llm' }
          }
        }
      )
    )
    expect(capturedSystemPrompt).toContain('xuanhuan-manju')
    expect(capturedSystemPrompt).toContain('阶段1~3 漫剧工业剧本规范')

    // Connect spNode -> film.workbench (with filmGenre left empty/auto to verify inheritance & Stage 1-3 deterministic backfill)
    const wbNode = createNodeFromType('film.workbench', { x: 320, y: 0 }, { id: 'wb-node' })
    const minimalModelJson = JSON.stringify({
      title: '断剑开天',
      aspectRatio: '9:16',
      entities: [
        { kind: 'character', name: '谢云归', description: '' },
        { kind: 'character', name: '玄冥长老', description: '' },
        { kind: 'location', name: '断魂崖问剑台', description: '古老青铜剑台' }
      ],
      scenes: [{ id: 'scene-1', heading: 'EXT. 断魂崖问剑台 - 黄昏', location: '断魂崖问剑台' }],
      shots: [
        {
          sceneId: 'scene-1',
          shotSize: 'LS',
          cameraMove: '推镜',
          durationSec: 4,
          characters: ['谢云归', '玄冥长老'],
          location: '断魂崖问剑台',
          action: '玄冥长老赤焰锁链封路，谢云归拔出断剑惊鸿',
          dialogue: [
            { speaker: '玄冥长老', line: '交出惊鸿剑魄！', mode: 'spoken' },
            { speaker: '谢云归', line: '断剑亦能开天！', mode: 'spoken' }
          ],
          imagePrompt: '断魂崖对峙',
          videoPrompt: '0-4秒 拔剑对峙'
        }
      ]
    })

    const wbOut = await executeFilmBreakdownNode(
      ctxFor(
        wbNode,
        { in: [spOut.out!] },
        {
          document: {
            nodes: [spNode, wbNode],
            edges: [
              {
                id: 'e1',
                source: spNode.id,
                sourcePort: 'out',
                target: wbNode.id,
                targetPort: 'in'
              }
            ]
          },
          generateText: async () => ({ text: minimalModelJson, model: 'mock-llm' })
        }
      )
    )

    const sb = (wbOut.out as { doc: FilmStoryboard }).doc
    expect(sb.genreId).toBe('xuanhuan-manju')
    const xie = sb.entities.find((e) => e.name === '谢云归')
    const elder = sb.entities.find((e) => e.name === '玄冥长老')
    const altar = sb.entities.find((e) => e.name === '断魂崖问剑台')
    expect(xie?.heightCm).toBe(185)
    expect(xie?.consistencyAnchors).toContain('染霜素白剑袍')
    expect(elder?.heightCm).toBe(180)
    expect(altar?.dimensions).toBe('50m×50m×开阔高空')
    expect(altar?.worldLightDirection).toContain('残阳血色逆光')
    expect(sb.scenes[0]?.worldLightDirection).toContain('残阳血色逆光')
    expect(sb.bible?.colorScheme).toContain('东方仙侠CG国漫大片质感')
    expect(sb.episodeMeta?.coldOpen).toContain('赤焰锁链封死断魂崖绝路')
    expect(sb.episodeMeta?.episodeProgress).toContain('断剑惊鸿第一重剑魄')
    expect(sb.episodeMeta?.cliffhangerHook).toContain('太古巨手')
    expect(sb.continuityAudit?.items).toHaveLength(11)
    expect(sb.publishPack?.titles.length).toBeGreaterThanOrEqual(3)
  })

  it('integrates character TTS voice binding, wire-free Series Bible Cast sharing across episodes, and single-click full-episode MP4 composition', async () => {
    // 1) Ep1 workbench with Series Bible Cast (STYLE01 + P01 林夏 + P02 沈墨) marked filmIsSeriesBibleCast: true
    const ep1Wb = createNodeFromType(
      'film.workbench',
      { x: 0, y: 0 },
      {
        id: 'wb-ep1',
        params: {
          filmIsSeriesBibleCast: true,
          filmCast: JSON.stringify({
            schema: 'film.cast/v1',
            style: '新国风赛博写实',
            entries: [
              {
                id: 'char-lin',
                code: 'P01',
                kind: 'character',
                name: '林夏',
                description: '清冷女主，银色短发，机能风衣',
                voicePreset: 'nova',
                heightCm: 168,
                imageRelativePath: 'Bible/lin-sheet.png',
                locked: true
              },
              {
                id: 'char-shen',
                code: 'P02',
                kind: 'character',
                name: '沈墨',
                description: '冷峻男主，黑色战术风衣',
                voicePreset: 'onyx',
                heightCm: 186,
                imageRelativePath: 'Bible/shen-sheet.png',
                locked: true
              },
              {
                id: 'loc-lab',
                code: 'S01',
                kind: 'location',
                name: '量子中枢实验室',
                description: '环形全息主控室',
                imageRelativePath: 'Bible/lab-sheet.png',
                locked: true
              }
            ]
          })
        }
      }
    )

    // 2) Ep2 workbench WITHOUT in-cast edge: automatically inherits Ep1's Series Bible Cast from ctx.document
    const ep2Wb = createNodeFromType('film.workbench', { x: 420, y: 0 }, { id: 'wb-ep2' })
    const document = {
      nodes: [ep1Wb, ep2Wb],
      edges: []
    }

    const ep2BreakdownJson = JSON.stringify({
      title: '第二集：量子密钥',
      aspectRatio: '9:16',
      entities: [
        { kind: 'character', name: '林夏', description: '' },
        { kind: 'character', name: '沈墨', description: '' },
        { kind: 'location', name: '量子中枢实验室', description: '' }
      ],
      scenes: [{ id: 'scene-1', heading: 'INT. 量子中枢实验室 - 夜', location: '量子中枢实验室' }],
      shots: [
        {
          id: 'S01-01',
          sceneId: 'scene-1',
          shotSize: 'MCU',
          cameraMove: '推镜',
          durationSec: 4,
          characters: ['林夏'],
          location: '量子中枢实验室',
          action: '林夏按下全息控制台启动键',
          dialogue: [{ speaker: '林夏', line: '密钥已经解锁，立刻撤离！', mode: 'spoken' }],
          productionInfo: { subtitleCard: '倒计时 10 秒' },
          imagePrompt: '林夏在全息控制台前',
          videoPrompt: '0-4秒 推镜特写'
        },
        {
          id: 'S01-02',
          sceneId: 'scene-1',
          shotSize: 'MS',
          cameraMove: '摇镜',
          durationSec: 4,
          characters: ['沈墨'],
          location: '量子中枢实验室',
          action: '沈墨拔出脉冲枪掩护大门',
          dialogue: [{ speaker: '沈墨', line: '我来断后，你带核心先走！', mode: 'spoken' }],
          imagePrompt: '沈墨持脉冲枪掩护',
          videoPrompt: '0-4秒 摇镜'
        }
      ]
    })

    const generateText = vi.fn().mockResolvedValue({
      text: ep2BreakdownJson,
      model: 'mock-llm'
    })
    const generateImage = vi.fn().mockResolvedValue({
      images: ['data:image/png;base64,S0Y='],
      model: 'mock-img'
    })
    const generateVideo = vi.fn(async ({ name }: { name?: string }) => ({
      relativePath: `Ep2/videos/${name || 'shot'}.mp4`,
      model: 'mock-vid'
    }))
    const generateSpeech = vi.fn(
      async ({ voice, name }: { input: string; voice?: string; name?: string }) => ({
        relativePath: `Ep2/voices/${name || 'voice'}_${voice || 'alloy'}.mp3`,
        model: 'mock-tts'
      })
    )
    const saveRunMedia = vi.fn(async ({ key }: { key: string }) => `Ep2/keyframes/${key}.png`)
    const resolveImageUrls = vi.fn(
      async (items: Array<{ dataUrl?: string; relativePath?: string }>) =>
        items.map((item) => item.dataUrl || `file://${item.relativePath}`)
    )
    const composeTimelineVideo = vi.fn(async () => ({
      relativePath: 'Ep2/exports/ep2_full_episode.mp4',
      assetId: 'asset-ep2-mp4'
    }))

    ep2Wb.params.filmRenderMode = 'video'
    ep2Wb.params.filmReviewMaxRounds = 0

    const ep2Out = await executeFilmWorkbenchNode(
      ctxFor(
        ep2Wb,
        { in: [{ kind: 'text', text: '第二集剧本：林夏与沈墨在量子中枢实验室突围。' }] },
        {
          document,
          generateText,
          generateImage,
          generateVideo,
          generateSpeech,
          saveRunMedia,
          resolveImageUrls,
          composeTimelineVideo
        }
      )
    )

    // Verify wire-free Series Bible Cast reuse: Cast stage generated 0 new sheets (all 3 reused from Ep1),
    // and Render stage generated 2 keyframes (referencing Bible sheets @1/@2)
    expect(generateImage).toHaveBeenCalledTimes(2)
    expect(generateImage.mock.calls[0][0].inputReferences).toContain('file://Bible/lin-sheet.png')
    expect(generateImage.mock.calls[0][0].inputReferences).toContain('file://Bible/lab-sheet.png')

    // Verify per-shot character TTS voice synthesis using bound character voicePresets (nova for 林夏, onyx for 沈墨)
    expect(generateSpeech).toHaveBeenCalledTimes(2)
    const speechCalls = generateSpeech.mock.calls.map((c) => ({
      input: c[0].input,
      voice: c[0].voice
    }))
    expect(speechCalls).toEqual(
      expect.arrayContaining([
        { input: '密钥已经解锁，立刻撤离！', voice: 'nova' },
        { input: '我来断后，你带核心先走！', voice: 'onyx' }
      ])
    )

    // Verify out-voices port output
    const outVoices = (
      ep2Out['out-voices'] as { items: Array<{ relativePath?: string; voice?: string }> }
    ).items
    expect(outVoices).toHaveLength(2)
    expect(outVoices[0]?.relativePath).toContain('nova.mp3')
    expect(outVoices[1]?.relativePath).toContain('onyx.mp3')

    // Verify automatic full-episode MP4 composition via composeTimelineVideo
    expect(composeTimelineVideo).toHaveBeenCalledTimes(1)
    const composeArg = composeTimelineVideo.mock.calls[0][0]
    expect(composeArg.visuals).toHaveLength(2)
    expect(composeArg.voices).toHaveLength(2)
    expect(composeArg.subtitles[0]).toContain('【倒计时 10 秒】')
    expect(composeArg.subtitles[0]).toContain('林夏：密钥已经解锁，立刻撤离！')

    const finalSb = parseFilmStoryboard(ep2Wb.params.filmStoryboard ?? '')!
    expect(finalSb.publishPack?.composedVideoPath).toBe('Ep2/exports/ep2_full_episode.mp4')
    expect(finalSb.publishPack?.composedShotCount).toBe(2)
    expect(finalSb.publishPack?.composedVoiceCount).toBe(2)
    expect(ep2Wb.params.filmComposedVideoPath).toBe('Ep2/exports/ep2_full_episode.mp4')
  })
})
